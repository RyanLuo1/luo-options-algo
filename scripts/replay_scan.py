"""B1b backtest replay — RANKER_SPEC.md Phase B-replay.

Replays the daily sector scan for a historical (date, slot) from the local
flat-file extracts (data/extracts/DATE.parquet + day_aggs), writing to
ml_dataset/sector_scan_runs with source='backtest_open' / 'backtest_close'
(slot-split, mirroring live_open/live_close — requires
docs/backtest_slot_split_migration.sql).

SAME CODE PATH as live, by construction:
  - `screener.scan_ticker` runs unchanged — this module only injects a
    chain_provider that serves contract dicts from the extract instead of the
    live Massive snapshot, and `as_of=<historical date>` so time-to-expiry
    anchors correctly. All leg/delta-window/monotonicity/scoring logic is
    shared, not copied.
  - Liquidity guards via `screener.passes_quote_guards` and the volume≥20
    filter via `screener.MIN_VOLUME` (volume sourced from the stored
    day_aggs file for that date).
  - Selection + DB writes via sector_scan's `select_top_n`, `write_picked`,
    `write_nonpicked` (same de-dup/cleanup semantics; the slot-split source
    keeps backtest rows separable from live AND from the other slot, so
    per-slot re-runs replace only their own slot's rows).

Delta: computed from the slot quote MID via lib/bs.py (implied_vol → delta),
since Massive serves no historical Greeks. Contracts whose IV solve is
ill-posed return None and are excluded — the replay analogue of the live
IV≤0.01 placeholder filter.

Slot quote: the extract window's newest quote (q10, right-aligned), i.e. the
last NBBO at ≤ 10:05 / 15:35 ET. The live cron scans tickers sequentially
over ~0–4 minutes after the slot, so the window-end quote mirrors live
timing; documented approximation, NOT a lookahead (the window closes 5 min
after the slot, never before a live scan would have run).

POINT-IN-TIME sourcing (spec rule #6):
  - spot per ticker: Massive minute aggs, last bar at/before the slot
    (disk-cached in data/extracts/spot_cache.json).
  - SPY: same minute-agg path. VIX: yfinance ^VIX 60m bar covering the slot
    (indices are blocked on our Massive plan; hourly granularity documented).
    A missing VIX bar raises — no silent substitution.
  - days_to_earnings: yfinance `earnings_dates` (a historical+future table),
    next date after the replay date — NOT `.calendar` (which only knows the
    next earnings from *now* and would leak the present into the past).
  - FOMC/CPI/PPI/NFP: the published annual schedules via event_filter
    (through sector_scan.load_macro_proximity). Valid point-in-time ONLY
    while no macro event falls between the replay date and today — enforced
    by refusing replay dates > MAX_LOOKBACK_DAYS old. Year-scale replay
    requires historical schedule reconstruction: known TODO, not silently
    approximated.

Usage (from project root):
  python3 scripts/replay_scan.py --date 2026-07-24            # both slots, DRY RUN
  python3 scripts/replay_scan.py --date 2026-07-24 --write    # write source='backtest_<slot>'
  python3 scripts/replay_scan.py --date 2026-07-20 --date 2026-07-21 --slot close --write
"""

import argparse
import json
import gzip
import os
import sys
import time as _time
from datetime import date as date_cls, datetime, timedelta
from zoneinfo import ZoneInfo

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))
sys.path.insert(0, _HERE)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(_HERE, "..", ".env"))

import yfinance as yf  # noqa: E402

from options_screener import get_next_fridays, massive_client  # noqa: E402
from screener import scan_ticker, passes_quote_guards, MIN_VOLUME  # noqa: E402
from lib.bs import implied_vol, delta as bs_delta, RISK_FREE_RATE  # noqa: E402
from sector_scan import (  # noqa: E402
    select_top_n, write_picked, write_nonpicked, _make_supabase,
    load_macro_proximity, _next_event_days, DEFAULT_TOP_N,
)

ET = ZoneInfo("America/New_York")
EXTRACT_DIR = os.path.join(_HERE, "..", "data", "extracts")
SPOT_CACHE_PATH = os.path.join(EXTRACT_DIR, "spot_cache.json")
SLOTS = {"open": (10, 0), "close": (15, 30)}   # slot clock time ET; window label == slot name
MAX_LOOKBACK_DAYS = 14   # macro-proximity point-in-time validity guard (see docstring)
DEFAULT_MIN_PREMIUM = 5.00
DEFAULT_MIN_PP = 0.50
WEEKS_MAX = 12


# ── Extract-backed chain store ────────────────────────────────────────────────

class ExtractStore:
    """One day's extract, bucketed for provider lookups.

    Buckets: {window: {(underlying, 'YYYY-MM-DD', side): [(strike, bid, ask), ...]}}
    using the newest in-window quote (q10) per contract. Volume from day_aggs.
    """

    def __init__(self, date_str):
        import pandas as pd
        path = os.path.join(EXTRACT_DIR, f"{date_str}.parquet")
        if not os.path.exists(path):
            raise FileNotFoundError(f"no extract for {date_str} at {path}")
        df = pd.read_parquet(path)
        self.date_str = date_str
        self.buckets = {w: {} for w in SLOTS}
        win = df[(df.window.isin(list(SLOTS))) & (df.q10_ts > 0)]
        for r in win.itertuples(index=False):
            sym = r.contract[2:]              # strip 'O:'
            root, tail = sym[:-15], sym[-15:]
            exp = f"20{tail[0:2]}-{tail[2:4]}-{tail[4:6]}"
            side = "call" if tail[6] == "C" else "put"
            strike = int(tail[7:]) / 1000.0
            self.buckets[r.window].setdefault((root, exp, side), []).append(
                (strike, float(r.q10_bid), float(r.q10_ask), r.contract))

        self.volumes = {}
        da = os.path.join(EXTRACT_DIR, "day_aggs", f"{date_str}.csv.gz")
        with gzip.open(da) as f:
            header = f.readline().decode().strip().split(",")
            t_i, v_i = header.index("ticker"), header.index("volume")
            for line in f:
                p = line.decode().rstrip("\n").split(",")
                try:
                    self.volumes[p[t_i]] = int(float(p[v_i]))
                except (ValueError, IndexError):
                    continue

    def make_provider(self, window, spot, as_of):
        """chain_provider(ticker, exp, side, lo, hi) for scan_ticker —
        identical output shape to screener._parse_massive_contracts."""
        bucket = self.buckets[window]

        def provider(ticker, exp, side, strike_low, strike_high):
            rows = bucket.get((ticker, exp, side), [])
            exp_date = datetime.strptime(exp, "%Y-%m-%d").date()
            T = (exp_date - as_of).days / 365.0
            if T <= 0:
                return []
            out = []
            for strike, bid, ask, contract in rows:
                if not (strike_low <= strike <= strike_high):
                    continue
                if not passes_quote_guards(bid, ask):
                    continue
                vol = self.volumes.get(contract, 0)
                if vol < MIN_VOLUME:
                    continue
                mid = (bid + ask) / 2
                iv = implied_vol(side, mid, spot, strike, T)
                if iv is None:
                    continue          # ill-posed solve — replay analogue of the IV placeholder filter
                d = bs_delta(side, spot, strike, T, RISK_FREE_RATE, iv)
                if d is None:
                    continue
                out.append({
                    "strike": strike,
                    "bid":    round(bid, 4),
                    "ask":    round(ask, 4),
                    "mid":    round(mid, 4),
                    "delta":  round(abs(d), 6),
                    "volume": vol,
                })
            return out

        return provider


# ── Point-in-time context ─────────────────────────────────────────────────────

def _load_spot_cache():
    if os.path.exists(SPOT_CACHE_PATH):
        with open(SPOT_CACHE_PATH) as f:
            return json.load(f)
    return {}


_spot_cache = _load_spot_cache()


def _save_spot_cache():
    with open(SPOT_CACHE_PATH + ".tmp", "w") as f:
        json.dump(_spot_cache, f)
    os.rename(SPOT_CACHE_PATH + ".tmp", SPOT_CACHE_PATH)


def spot_at_slot(ticker, date_str, slot, retries=3):
    """Underlying price at the slot: last Massive minute bar at/before the
    slot time (historical stock aggs — in-plan). Successful lookups are
    disk-cached; failures are NEVER cached (recent dates 429 until Massive
    tiers them as historical — a cached None would poison re-runs). Returns
    None on failure; the ticker is skipped, mirroring live price-fetch
    failures."""
    key = f"{ticker}|{date_str}|{slot}"
    if key in _spot_cache:
        return _spot_cache[key]
    h, m = SLOTS[slot]
    y, mo, d = (int(x) for x in date_str.split("-"))
    slot_ms = int(datetime(y, mo, d, h, m, tzinfo=ET).timestamp() * 1000)
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            bars = massive_client.get_aggs(ticker, 1, "minute", date_str, date_str, limit=1200)
            px = None
            for b in bars:
                if b.timestamp <= slot_ms and b.close is not None:
                    px = float(b.close)
                elif b.timestamp > slot_ms:
                    break
            if px is not None:
                _spot_cache[key] = px       # cache successes only
                _save_spot_cache()
            return px
        except Exception as e:  # noqa: BLE001
            last_err = e
            wait = 3 * attempt if "429" in str(e) else attempt
            _time.sleep(wait)
    print(f"    [!] spot {ticker} {date_str} {slot}: {last_err}", flush=True)
    return None


def vix_at_slot(date_str, slot):
    """^VIX at the slot from yfinance 60m bars (hourly granularity; indices
    are blocked on our Massive plan). Raises if unavailable — the spec
    forbids silently substituting a non-point-in-time value."""
    y, mo, d = (int(x) for x in date_str.split("-"))
    h, m = SLOTS[slot]
    slot_dt = datetime(y, mo, d, h, m, tzinfo=ET)
    hist = yf.Ticker("^VIX").history(
        start=date_str, end=(date_cls(y, mo, d) + timedelta(days=1)).isoformat(),
        interval="60m")
    if hist.empty:
        raise RuntimeError(f"no point-in-time ^VIX bars for {date_str} — refusing to substitute")
    best = None
    for ts, row in hist.iterrows():
        t = ts.tz_convert(ET) if ts.tzinfo else ts.tz_localize(ET)
        if t <= slot_dt:
            best = float(row["Close"])
    if best is None:
        raise RuntimeError(f"no ^VIX bar at/before {slot} slot on {date_str}")
    return round(best, 2)


_earnings_tbl_cache = {}


def days_to_earnings_pit(ticker, ref):
    """Point-in-time days-to-earnings: next date > ref from yfinance's
    earnings_dates TABLE (contains past and future dates), NOT .calendar
    (which only knows the next earnings from today). Best-effort → None."""
    try:
        if ticker not in _earnings_tbl_cache:
            tbl = yf.Ticker(ticker).earnings_dates
            _earnings_tbl_cache[ticker] = (
                sorted({ts.date() for ts in tbl.index}) if tbl is not None else [])
        return _next_event_days(_earnings_tbl_cache[ticker], ref)
    except Exception:
        return None


# ── Replay one (date, slot) ───────────────────────────────────────────────────

def replay_slot(date_str, slot, supabase, top_n=DEFAULT_TOP_N,
                min_premium=DEFAULT_MIN_PREMIUM, min_pp=DEFAULT_MIN_PP, write=False,
                sleep_s=0.15):
    as_of = datetime.strptime(date_str, "%Y-%m-%d").date()
    h, m = SLOTS[slot]
    scan_timestamp = datetime(as_of.year, as_of.month, as_of.day, h, m, tzinfo=ET).isoformat()
    # Slot-split source (mirrors live_open/live_close): the de-dup keys are
    # (source, scan_date, sector)-shaped, so the slot must live inside source
    # or a both-slots replay's close pass would replace the open pass's rows.
    # Requires docs/backtest_slot_split_migration.sql applied.
    source = f"backtest_{slot}"

    store = ExtractStore(date_str)
    spy = spot_at_slot("SPY", date_str, slot)
    vix = vix_at_slot(date_str, slot)
    d_fomc, d_cpi, d_macro = load_macro_proximity(as_of)
    print(f"\n=== REPLAY {date_str} slot={slot}  VIX={vix} SPY={spy}  "
          f"macro: fomc={d_fomc} cpi={d_cpi} any={d_macro}  "
          f"{'WRITE' if write else 'DRY-RUN'} ===", flush=True)

    with open(os.path.join(_HERE, "..", "data", "universe.json")) as f:
        sectors = json.load(f)["sectors"]           # the REAL $100B scan universe

    fridays = get_next_fridays(WEEKS_MAX, as_of=as_of)
    week_exps = [(i + 1, d.strftime("%Y-%m-%d")) for i, d in enumerate(fridays)]

    weeks_range = f"W1-W{WEEKS_MAX}"
    summary = []
    for sector, tickers in sectors.items():
        t0 = _time.time()
        sector_triplets = []
        scanned = skipped = evaluated_total = 0
        price_by_ticker = {}
        for ticker in tickers:
            spot = spot_at_slot(ticker, date_str, slot)
            _time.sleep(sleep_s)            # pace Massive spot lookups (429s)
            if spot is None:
                skipped += 1
                continue
            provider = store.make_provider(slot, spot, as_of)
            triplets, ev = scan_ticker(
                ticker, spot, week_exps, min_premium, min_p_profit=min_pp,
                chain_provider=provider, as_of=as_of)
            scanned += 1
            evaluated_total += ev
            sector_triplets.extend(triplets)
            price_by_ticker[ticker] = spot

        ranked = sorted(sector_triplets, key=lambda t: t["score"], reverse=True)
        picks = select_top_n(ranked, top_n)
        elapsed_ms = int((_time.time() - t0) * 1000)

        run_row = {
            "source": source, "scan_date": date_str, "scan_timestamp": scan_timestamp,
            "sector": sector, "min_net_premium": float(min_premium),
            "min_p_profit": float(min_pp), "weeks_range": weeks_range,
            "tickers_scanned": scanned, "tickers_skipped": skipped,
            "contracts_evaluated": evaluated_total, "setups_qualified": len(ranked),
            "elapsed_ms": elapsed_ms,
        }
        if picks:
            run_row.update(status="picked", best_ticker=picks[0]["ticker"],
                           best_score=float(picks[0]["score"]))
            ml_rows = []
            for i, t in enumerate(picks):
                exp_date = datetime.strptime(t["expiration"], "%Y-%m-%d").date()
                dte = (exp_date - as_of).days
                d_earn = days_to_earnings_pit(t["ticker"], as_of)
                px = price_by_ticker.get(t["ticker"])
                ml_rows.append({
                    "source": source, "scan_date": date_str,
                    "scan_timestamp": scan_timestamp, "sector": sector,
                    "ticker": t["ticker"], "is_best_in_sector": i == 0,
                    "expiration": t["expiration"],
                    "weeks_to_expiration": int(t["week"]),
                    "days_to_expiration": int(dte),
                    "leg_a_strike": float(t["leg_a_strike"]), "leg_a_prem": float(t["leg_a_prem"]),
                    "leg_a_delta": float(t["leg_a_delta"]),
                    "leg_b_strike": float(t["leg_b_strike"]), "leg_b_prem": float(t["leg_b_prem"]),
                    "leg_b_delta": float(t["leg_b_delta"]),
                    "leg_c_strike": float(t["leg_c_strike"]), "leg_c_prem": float(t["leg_c_prem"]),
                    "leg_c_delta": float(t["leg_c_delta"]),
                    "net_premium": float(t["net_premium"]), "spread_width": float(t["spread_width"]),
                    "score": float(t["score"]), "p_max_profit": float(t["p_max_profit"]),
                    "underlying_price_at_scan": float(px) if px is not None else None,
                    "fair_value": None,
                    "moneyness_a": (round(px / t["leg_a_strike"], 6)
                                    if px and t["leg_a_strike"] else None),
                    "vix": vix, "spy_price": spy,
                    "days_to_earnings": d_earn,
                    "days_to_next_fomc": d_fomc, "days_to_next_cpi": d_cpi,
                    "days_to_next_macro": d_macro,
                    "earnings_before_expiry": (d_earn is not None and d_earn <= dte),
                    "outcome_filled": False,
                    "notes": "backtest replay (B1b)",
                })
            if write:
                write_picked(supabase, run_row, ml_rows, source, date_str, sector)
            summary.append((sector, "picked", picks[0]["ticker"], picks[0]["score"],
                            len(ranked), scanned, skipped))
        else:
            run_row.update(
                status="none_qualified" if scanned else "no_tickers",
                best_ticker=None, best_score=None)
            if write:
                write_nonpicked(supabase, run_row, source, date_str, sector)
            summary.append((sector, run_row["status"], None, None,
                            len(ranked), scanned, skipped))

        s = summary[-1]
        tag = (f"{s[2]} score={s[3]:.4f}" if s[1] == "picked" else s[1])
        print(f"  {sector:22s} {tag:28s} qual={s[4]:<6d} scan={s[5]} skip={s[6]}", flush=True)

    return summary


def main():
    ap = argparse.ArgumentParser(description="B1b backtest replay from flat-file extracts")
    ap.add_argument("--date", action="append", required=True, help="YYYY-MM-DD (repeatable)")
    ap.add_argument("--slot", choices=["open", "close", "both"], default="both")
    ap.add_argument("--top-n", type=int, default=DEFAULT_TOP_N)
    ap.add_argument("--write", action="store_true",
                    help="write to ml_dataset/sector_scan_runs (source='backtest_<slot>'); default is dry-run")
    ap.add_argument("--sleep", type=float, default=0.15,
                    help="pause between per-ticker spot lookups (default 0.15s)")
    args = ap.parse_args()

    today = date_cls.today()
    for ds in args.date:
        d = datetime.strptime(ds, "%Y-%m-%d").date()
        if (today - d).days > MAX_LOOKBACK_DAYS:
            sys.exit(f"{ds} is > {MAX_LOOKBACK_DAYS} days back: macro-event proximity can no "
                     f"longer be sourced point-in-time from the published schedules "
                     f"(events between then and now have scrolled off). Year-scale replay "
                     f"needs historical schedule reconstruction first — see module docstring.")

    supabase = _make_supabase() if args.write else None
    slots = ["open", "close"] if args.slot == "both" else [args.slot]
    for ds in args.date:
        for slot in slots:
            replay_slot(ds, slot, supabase, top_n=args.top_n, write=args.write,
                        sleep_s=args.sleep)


if __name__ == "__main__":
    main()
