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
retried a couple times with backoff; a ticker that still fails (network error,
no sector, no marketCap) is logged and skipped, never fatal. Requests are
paced with a small sleep. Correctness over speed.

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

def fetch_ticker_info(ticker, retries=2, backoff=1.5):
    """Return (sector, market_cap) for a ticker, or (None, None) on failure.

    Retries transient errors with backoff. Returns (None, None) when info
    can't be fetched or is missing the fields we need; the caller logs/skips.
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

def build_universe(limit=None, sleep=0.25, threshold=THRESHOLD, out_path=OUTPUT_PATH):
    print(f"[universe] fetching S&P 500 candidate pool from Wikipedia ...")
    symbols = fetch_sp500_symbols()
    if limit:
        symbols = symbols[:limit]
    print(f"[universe] {len(symbols)} candidate tickers; "
          f"filtering to market cap > ${threshold:,} ...\n")

    sectors = defaultdict(list)
    kept = 0
    skipped_no_sector = 0
    skipped_no_cap = 0
    skipped_below = 0
    skipped_error = 0

    for i, ticker in enumerate(symbols, 1):
        sector, market_cap = fetch_ticker_info(ticker)

        if sector is None and market_cap is None:
            skipped_error += 1
            time.sleep(sleep)
            continue
        if not sector:
            print(f"[universe] {ticker}: no sector — skipping", file=sys.stderr)
            skipped_no_sector += 1
            time.sleep(sleep)
            continue
        if not market_cap:
            print(f"[universe] {ticker}: no marketCap — skipping", file=sys.stderr)
            skipped_no_cap += 1
            time.sleep(sleep)
            continue

        # Flag unexpected sector strings so outliers are visible.
        if sector not in KNOWN_SECTORS:
            print(f"[universe] {ticker}: unexpected sector string "
                  f"{sector!r} — keeping but flagging", file=sys.stderr)

        if market_cap > threshold:
            sectors[sector].append(ticker)
            kept += 1
            print(f"[universe] [{i}/{len(symbols)}] {ticker:6s} "
                  f"${market_cap/1e9:8.1f}B  {sector}")
        else:
            skipped_below += 1

        time.sleep(sleep)

    # Sort tickers within each sector for stable output.
    sectors = {s: sorted(t) for s, t in sorted(sectors.items())}

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

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")

    # --- summary ---
    print("\n" + "=" * 60)
    print(f"Universe written to {out_path}")
    print(f"  {kept} tickers > ${threshold/1e9:.0f}B across "
          f"{len(sectors)} sectors")
    print(f"  skipped: {skipped_below} below threshold, "
          f"{skipped_no_sector} no sector, {skipped_no_cap} no cap, "
          f"{skipped_error} fetch errors")
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
    args = parser.parse_args()

    build_universe(limit=args.limit, sleep=args.sleep,
                   threshold=args.threshold, out_path=args.out)


if __name__ == "__main__":
    main()
