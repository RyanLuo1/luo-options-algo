#!/usr/bin/env python3
"""
scripts/build_universe.py — build the sector → large-cap-ticker map for the
daily sector scan.

Usage:
    python3 scripts/build_universe.py                 # full S&P 500 sweep
    python3 scripts/build_universe.py --limit 30      # quick smoke test
    python3 scripts/build_universe.py --sleep 0.5     # pace requests harder

What it does
------------
1. Pulls the S&P 500 constituent list from Wikipedia as the candidate pool —
   nearly every US company over $100B is in the index, so it's a stable,
   reproducible starting universe.
2. For each candidate, fetches `sector` and `marketCap` from yfinance
   (`yf.Ticker(t).info`). We group by whatever sector string yfinance returns
   — these ARE the standard GICS-style sectors yfinance uses (Technology,
   Financial Services, Healthcare, Consumer Cyclical, Consumer Defensive,
   Energy, Industrials, Basic Materials, Real Estate, Utilities,
   Communication Services). No custom taxonomy is imposed.
3. Keeps only tickers with market cap > $100B.
4. Groups survivors by sector and writes data/universe.json:
       { "metadata": {...}, "sectors": { "<sector>": ["TICK", ...], ... } }

This is a STANDALONE, periodically-run script. It does NOT touch Massive,
scan options, or change the app. The daily sector scan reads the JSON it
produces — it is NOT regenerated on every scan.

Resilience: yfinance is slow/flaky over hundreds of tickers. Each lookup is
retried with backoff, and any ticker still unresolved after the main sweep
gets dedicated recovery passes with long waits. A name that STILL won't
resolve is a LOUD ERROR — the build exits non-zero and writes nothing.
(Changed 2026-08-27: the old skip-on-failure behavior silently dropped 12
S&P mega-caps — MU, JPM, XOM, HD, ... — from the 2026-08-07 extraction
universe, which cost those names in every fleet extract built with it. A
below-threshold name is a normal filter outcome, never an error.)

Superset gate: pass --require-superset-of data/universe.json when building
the extraction universe — the build fails (without writing) unless every
scan-universe ticker is present in the output. --extra appends non-S&P
tickers (SPY/QQQ) under the '_index_etf' group; --note records a metadata
note. The extraction-universe invocation is:

    python3 scripts/build_universe.py --threshold 50000000000 \
        --out data/universe_extract.json --extra SPY QQQ \
        --require-superset-of data/universe.json \
        --note "extraction universe: $50B S&P superset + SPY/QQQ index ETFs"

NOTE on sector strings: the project brief lists the canonical GICS labels
(e.g. "Financials", "Health Care"). yfinance returns its own close variants
("Financial Services", "Healthcare"). Per the brief we group by exactly what
yfinance returns and do not remap — so the output reflects yfinance's labels.
"""

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone

import requests
import yfinance as yf
from bs4 import BeautifulSoup

# --- config -----------------------------------------------------------------

WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
SOURCE_LABEL = f"S&P 500 constituents via Wikipedia ({WIKI_URL})"

THRESHOLD = 100_000_000_000  # $100B market-cap floor

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(_PROJECT_ROOT, "data")
OUTPUT_PATH = os.path.join(DATA_DIR, "universe.json")

# yfinance's known sector strings — used ONLY to flag outliers (an unexpected
# or empty sector gets a warning). We still group by whatever string we get.
KNOWN_SECTORS = {
    "Technology",
    "Financial Services",
    "Healthcare",
    "Consumer Cyclical",
    "Consumer Defensive",
    "Energy",
    "Industrials",
    "Basic Materials",
    "Real Estate",
    "Utilities",
    "Communication Services",
}

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}


# --- S&P 500 candidate pool -------------------------------------------------

def fetch_sp500_symbols(retries=3):
    """Return the list of S&P 500 tickers from Wikipedia's constituents table.

    Symbols are normalized for yfinance: Wikipedia uses dots for share
    classes (BRK.B), yfinance uses dashes (BRK-B).
    """
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(WIKI_URL, headers=_HEADERS, timeout=30)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")
            table = soup.find("table", {"id": "constituents"})
            if table is None:
                # Fall back to the first sortable wikitable on the page.
                table = soup.find("table", {"class": "wikitable"})
            if table is None:
                raise ValueError("could not locate the constituents table")

            symbols = []
            for row in table.find_all("tr")[1:]:  # skip header
                cell = row.find("td")
                if not cell:
                    continue
                sym = cell.get_text(strip=True)
                if sym:
                    symbols.append(sym.replace(".", "-").upper())
            if not symbols:
                raise ValueError("constituents table parsed but no symbols found")
            return symbols
        except Exception as err:  # noqa: BLE001 — log and retry
            last_err = err
            print(f"[universe] Wikipedia fetch attempt {attempt}/{retries} "
                  f"failed: {err}", file=sys.stderr)
            time.sleep(2 * attempt)

    raise RuntimeError(f"failed to fetch S&P 500 symbols after {retries} "
                       f"attempts: {last_err}")


# --- per-ticker sector + market cap ----------------------------------------

def fetch_ticker_info(ticker, retries=4, backoff=2.0):
    """Return (sector, market_cap) for a ticker, or (None, None) on failure.

    Retries transient errors with backoff. Returns (None, None) when info
    can't be fetched; the caller queues the ticker for recovery passes and
    ultimately fails the build if it never resolves (no silent drops).
    """
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            info = yf.Ticker(ticker).info or {}
            sector = info.get("sector")
            market_cap = info.get("marketCap")
            return sector, market_cap
        except Exception as err:  # noqa: BLE001 — transient yfinance/network
            last_err = err
            if attempt < retries:
                time.sleep(backoff * attempt)
    print(f"[universe] {ticker}: info fetch failed after {retries} attempts: "
          f"{last_err}", file=sys.stderr)
    return None, None


# --- main -------------------------------------------------------------------

RECOVERY_PASSES = 3          # dedicated re-sweeps for unresolved names
RECOVERY_WAIT_S = 20         # base wait before each recovery pass (× pass #)


def load_universe_tickers(path):
    """Flat set of tickers in a universe JSON file."""
    with open(path) as f:
        uni = json.load(f)
    return {t for lst in uni["sectors"].values() for t in lst}


def build_universe(limit=None, sleep=0.25, threshold=THRESHOLD, out_path=OUTPUT_PATH,
                   extra=None, require_superset_of=None, note=None):
    print(f"[universe] fetching S&P 500 candidate pool from Wikipedia ...")
    symbols = fetch_sp500_symbols()
    if limit:
        symbols = symbols[:limit]
    print(f"[universe] {len(symbols)} candidate tickers; "
          f"filtering to market cap > ${threshold:,} ...\n")

    sectors = defaultdict(list)
    kept = 0
    skipped_below = 0
    unresolved = {}  # ticker -> reason; retried in recovery passes, fatal if it stays

    def attempt(ticker, i, total, tag=""):
        nonlocal kept, skipped_below
        sector, market_cap = fetch_ticker_info(ticker)
        if sector is None and market_cap is None:
            unresolved[ticker] = "fetch error"
            return False
        if not sector:
            unresolved[ticker] = "no sector"
            return False
        if not market_cap:
            unresolved[ticker] = "no marketCap"
            return False

        unresolved.pop(ticker, None)
        # Flag unexpected sector strings so outliers are visible.
        if sector not in KNOWN_SECTORS:
            print(f"[universe] {ticker}: unexpected sector string "
                  f"{sector!r} — keeping but flagging", file=sys.stderr)
        if market_cap > threshold:
            sectors[sector].append(ticker)
            kept += 1
            print(f"[universe] {tag}[{i}/{total}] {ticker:6s} "
                  f"${market_cap/1e9:8.1f}B  {sector}")
        else:
            skipped_below += 1
        return True

    for i, ticker in enumerate(symbols, 1):
        attempt(ticker, i, len(symbols))
        time.sleep(sleep)

    # Recovery passes: no silent drops. Anything still unresolved after these
    # is a LOUD failure — the 2026-08-07 build silently lost 12 mega-caps.
    for rp in range(1, RECOVERY_PASSES + 1):
        if not unresolved:
            break
        wait = RECOVERY_WAIT_S * rp
        print(f"\n[universe] recovery pass {rp}/{RECOVERY_PASSES}: "
              f"{len(unresolved)} unresolved {sorted(unresolved)} — "
              f"waiting {wait}s first", file=sys.stderr)
        time.sleep(wait)
        for i, ticker in enumerate(sorted(unresolved), 1):
            attempt(ticker, i, len(unresolved), tag=f"R{rp} ")
            time.sleep(max(sleep, 1.0))

    if unresolved:
        print("\n[universe] FATAL: could not resolve "
              f"{len(unresolved)} candidate(s) after {RECOVERY_PASSES} recovery "
              f"passes — refusing to write a universe with silent gaps:",
              file=sys.stderr)
        for t, why in sorted(unresolved.items()):
            print(f"[universe]   {t}: {why}", file=sys.stderr)
        raise SystemExit(1)

    # Extra non-S&P tickers (e.g. SPY/QQQ) go under a dedicated group.
    for t in (extra or []):
        t = t.upper()
        if all(t not in lst for lst in sectors.values()):
            sectors["_index_etf"].append(t)
            kept += 1
            print(f"[universe] extra: {t} -> _index_etf")

    # Sort tickers within each sector for stable output.
    sectors = {s: sorted(t) for s, t in sorted(sectors.items())}

    # Superset gate: the extraction universe must contain every scan-universe
    # name — fail BEFORE writing, so a broken build can't reach a box.
    if require_superset_of:
        required = load_universe_tickers(require_superset_of)
        built = {t for lst in sectors.values() for t in lst}
        missing = sorted(required - built)
        if missing:
            print(f"\n[universe] FATAL: output is not a superset of "
                  f"{require_superset_of} — missing {len(missing)}: "
                  f"{missing}", file=sys.stderr)
            raise SystemExit(1)
        print(f"[universe] superset gate OK: all {len(required)} tickers "
              f"from {require_superset_of} present")

    payload = {
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": SOURCE_LABEL,
            "threshold": threshold,
            "threshold_label": f"${threshold/1e9:.0f}B market cap",
            "candidates_evaluated": len(symbols),
            "total_tickers": kept,
            "sector_count": len(sectors),
        },
        "sectors": sectors,
    }
    if note:
        payload["metadata"]["note"] = note

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")

    # --- summary ---
    print("\n" + "=" * 60)
    print(f"Universe written to {out_path}")
    print(f"  {kept} tickers > ${threshold/1e9:.0f}B across "
          f"{len(sectors)} sectors")
    print(f"  skipped: {skipped_below} below threshold "
          f"(unresolved names are fatal, never skipped)")
    print("=" * 60)
    for sector, tickers in sectors.items():
        print(f"\n{sector} ({len(tickers)})")
        print("  " + ", ".join(tickers))
    print()

    return payload


def main():
    parser = argparse.ArgumentParser(
        description="Build the sector → large-cap-ticker universe map.")
    parser.add_argument("--limit", type=int, default=None,
                        help="only evaluate the first N candidates (testing)")
    parser.add_argument("--sleep", type=float, default=0.25,
                        help="seconds to pause between tickers (default 0.25)")
    parser.add_argument("--threshold", type=float, default=THRESHOLD,
                        help="market-cap floor in dollars (default $100B)")
    parser.add_argument("--out", default=OUTPUT_PATH,
                        help="output path (default data/universe.json)")
    parser.add_argument("--extra", nargs="*", default=None,
                        help="extra non-S&P tickers to append under '_index_etf' "
                             "(e.g. --extra SPY QQQ)")
    parser.add_argument("--require-superset-of", default=None,
                        help="path to a universe JSON whose tickers must ALL be "
                             "present in the output (fails without writing "
                             "otherwise); use data/universe.json when building "
                             "the extraction universe")
    parser.add_argument("--note", default=None,
                        help="free-text note stored in output metadata")
    args = parser.parse_args()

    build_universe(limit=args.limit, sleep=args.sleep,
                   threshold=args.threshold, out_path=args.out,
                   extra=args.extra, require_superset_of=args.require_superset_of,
                   note=args.note)


if __name__ == "__main__":
    main()
