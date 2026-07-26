#!/usr/bin/env python3
"""
scripts/sector_scan.py — daily SECTOR scan job (MANUAL version).

Reads the sector → large-cap-ticker universe (data/universe.json, built by
scripts/build_universe.py), runs the existing Call Spread Risk Reversal scan on
every ticker in every sector, picks the single best setup per sector, and writes
the results to two Supabase tables:

    ml_dataset        — the best setup per 'picked' sector (the labeled ML row;
                        see docs/ml_dataset_schema.sql)
    sector_scan_runs  — one row per sector per run: status + counts + link
                        (see docs/sector_scan_schema.sql)

This is a STANDALONE job. It reuses screener.scan_ticker and the
Massive client — it does NOT change the app, the algorithm, the discretionary
tradebook, or trade_outcomes. It is MANUAL for now (run by hand); scheduling
comes later.

Usage:
    python3 scripts/sector_scan.py --slot open
    python3 scripts/sector_scan.py --slot close
    python3 scripts/sector_scan.py --slot open --source backtest
    python3 scripts/sector_scan.py --slot open --weeks-max 4 --min-premium 2 --dry-run

    --slot {open,close}   REQUIRED. Sets source to live_open / live_close.
    --source SOURCE       Override source (default live_<slot>; must be one of
                          live_open | live_close | backtest — DB CHECK enforced).
    --weeks-min N         Min expiration week (default 1).
    --weeks-max N         Max expiration week (default 12, max 12).
    --min-premium D       Min net credit in dollars (default 5.00).
    --min-p-profit P      Min P(max profit) 0–1 (default 0.50).
    --sleep S             Pause between tickers, seconds (default 0.15).
    --limit-per-sector N  Only scan the first N tickers of each sector (testing).
    --universe PATH       Universe JSON (default data/universe.json).
    --dry-run             Scan but write NOTHING to Supabase (validate logic).

The 'open'/'close' slot is encoded INTO `source` (live_open / live_close); the
tables have no separate slot column. De-dup is therefore one row per
(source, scan_date, sector) — re-running the same slot upserts rather than
duplicating.

Resilience (this scans ~118 tickers — far more than the app's usual 10):
  * Dedicated Massive client with a 15s read timeout + 3 internal retries, so a
    hung provider response fails fast instead of freezing the run.
  * Per-ticker retry/backoff with rate-limit detection (mirrors
    scripts/backfill_outcomes.py).
  * A ticker that still fails after retries is logged, counted in the sector's
    tickers_skipped, and SKIPPED — it never kills the sector or the run.
  * A sector that fails unexpectedly is written with status='error' and the run
    moves on to the next sector.
  * Requests are paced (--sleep) to avoid tripping burst limits.
  * Output is line-buffered + flushed so a long run shows live progress.

Auth: uses SUPABASE_SERVICE_KEY (both tables have RLS with no public policies —
only the service role can write).
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, date, timezone
from zoneinfo import ZoneInfo

# Show progress live, not in a silent buffer.
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _PROJECT_ROOT)

# options_screener.load_dotenv() runs on import → MASSIVE_API_KEY / SUPABASE_*.
import options_screener  # noqa: E402, F401
import yfinance as yf  # noqa: E402
from massive import RESTClient  # noqa: E402

# Reuse the existing scan logic. We inject a dedicated, tighter-timeout Massive
# client into screener so scan_ticker() fails fast under load. scan_ticker looks
# up `massive_client` in screener's module namespace at call time, so reassigning
# screener.massive_client is enough — no edit to screener.py / the app.
import screener  # noqa: E402
from screener import scan_ticker  # noqa: E402

_massive = RESTClient(
    os.getenv("MASSIVE_API_KEY"),
    connect_timeout=10,
    read_timeout=15,
    retries=3,
)
screener.massive_client = _massive

# Macro-event scrapers (reused for event proximity).
from event_filter import fetch_fomc_dates, fetch_bls_dates, BLS_URLS  # noqa: E402

from options_screener import get_next_fridays  # noqa: E402

SUPABASE_URL         = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Unique-index column lists (mirror docs/*.sql; used for upsert on_conflict).
RUN_CONFLICT = "source,scan_date,sector"

# How far ahead to look for macro events so we always find the NEXT one even if
# it's more than the app's default 4-week window away (FOMC meets ~6w apart).
MACRO_WEEKS = 26

# How many distinct setups to log per sector (the best + runners-up). The #1 is
# flagged is_best_in_sector=True; the rest False. Tunable via --top-n. Logging
# runners-up enriches ml_dataset with marginal/weaker examples (negative cases)
# so a future model can learn the boundary between strong and weak setups —
# instead of only ever seeing the single setup the algorithm already liked.
DEFAULT_TOP_N = 5

# Cap on how many rows a single ticker may contribute to one sector's top-N, so
# a high-volume name (e.g. MU produced ~9,900 near-identical adjacent-strike
# setups) can't fill the quota with clones. With cap=2 and N=5 the quota spans
# at least three tickers when available, while a thin sector whose only
# qualifying setups share a ticker still logs both (no padding, no over-filter).
MAX_PER_TICKER = 2

# Per-ticker retry backoff schedule (seconds between attempts). len+1 attempts.
TICKER_DELAYS = (2, 5)


# ── Resilience helpers ────────────────────────────────────────────────────────

def _is_rate_limit_error(exc):
    """Heuristic — Massive surfaces 429s with these substrings in str(exc)."""
    msg = str(exc).lower()
    return any(s in msg for s in (
        "429", "rate limit", "too many requests", "rate_limit", "ratelimit",
    ))


def scan_one_ticker(ticker, week_exps, min_premium, min_p_profit, delays=TICKER_DELAYS):
    """
    Scan a single ticker with retry/backoff. Returns
    (triplets, evaluated, price) on success, or None if the ticker
    had to be skipped after exhausting retries (caller counts it as skipped).
    """
    max_attempts = len(delays) + 1
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            hist = yf.Ticker(ticker).history(period="1d")
            if hist.empty:
                raise ValueError("no price data from yfinance")
            price = round(float(hist["Close"].iloc[-1]), 2)

            triplets, evaluated = scan_ticker(
                ticker, price, week_exps,
                min_premium, min_p_profit=min_p_profit,
            )
            return triplets, evaluated, price
        except Exception as e:  # noqa: BLE001 — retry/skip, never fatal
            last_err = e
            if attempt < max_attempts:
                wait = delays[attempt - 1]
                tag = "rate-limited" if _is_rate_limit_error(e) else "errored"
                print(f"      ⟳ {ticker}: {tag}, retry in {wait}s "
                      f"(attempt {attempt}/{max_attempts}): {e}", flush=True)
                time.sleep(wait)

    print(f"      ! {ticker}: SKIPPED after {max_attempts} attempts: {last_err}",
          flush=True)
    return None


# ── Market context + event proximity ──────────────────────────────────────────

def _yf_last_close(symbol):
    """Latest non-NaN close from yfinance, or None on any failure."""
    try:
        hist = yf.Ticker(symbol).history(period="2d")
        if hist.empty:
            return None
        for c in reversed(hist["Close"].tolist()):
            try:
                f = float(c)
                if f == f:  # not NaN
                    return round(f, 4)
            except (TypeError, ValueError):
                continue
    except Exception as e:  # noqa: BLE001
        print(f"[market_ctx] {symbol} fetch failed: {e}", flush=True)
    return None


def _next_event_days(dates, ref):
    """Days from `ref` to the soonest date >= ref, or None if there is none."""
    upcoming = sorted(d for d in dates if d >= ref)
    return (upcoming[0] - ref).days if upcoming else None


def _days_to_earnings(ticker, ref):
    """Calendar days to the ticker's next earnings date, or None. Best-effort."""
    try:
        cal = yf.Ticker(ticker).calendar
        dates = cal.get("Earnings Date", []) if isinstance(cal, dict) else []
        return _next_event_days([d for d in dates if isinstance(d, date)], ref)
    except Exception:
        return None


def load_macro_proximity(scan_date):
    """Return (days_to_fomc, days_to_cpi, days_to_macro) relative to scan_date."""
    print(f"Loading macro events ({MACRO_WEEKS}w window) for event proximity...",
          flush=True)
    fomc = fetch_fomc_dates(weeks=MACRO_WEEKS)
    cpi  = fetch_bls_dates("CPI", BLS_URLS["CPI"], weeks=MACRO_WEEKS)
    ppi  = fetch_bls_dates("PPI", BLS_URLS["PPI"], weeks=MACRO_WEEKS)
    nfp  = fetch_bls_dates("NFP", BLS_URLS["NFP"], weeks=MACRO_WEEKS)
    all_macro = fomc + cpi + ppi + nfp
    d_fomc  = _next_event_days(fomc, scan_date)
    d_cpi   = _next_event_days(cpi, scan_date)
    d_macro = _next_event_days(all_macro, scan_date)
    print(f"  days_to_fomc={d_fomc}  days_to_cpi={d_cpi}  days_to_macro={d_macro}",
          flush=True)
    return d_fomc, d_cpi, d_macro


# ── Runner-up selection ────────────────────────────────────────────────────────

def select_top_n(ranked, top_n, max_per_ticker=MAX_PER_TICKER):
    """
    Pick up to `top_n` DISTINCT setups from a sector's already-ranked triplets.

    `ranked` is the in-memory list scan_ticker already produced for the sector,
    sorted by score descending — so this is PURE selection: it makes ZERO
    additional Massive/network calls, it just chooses more rows from results we
    already have. ranked[0] (the global best) is always taken first, so the
    returned list[0] is the best (→ is_best_in_sector=True).

    A per-ticker cap stops one high-volume ticker from filling the quota with
    near-identical adjacent-strike clones; the quota then spreads across the
    sector's strongest tickers. If fewer than `top_n` distinct setups exist
    (within the cap), returns what exists — no padding.
    """
    from collections import Counter
    per_ticker = Counter()
    selected = []
    for t in ranked:
        if per_ticker[t["ticker"]] >= max_per_ticker:
            continue
        selected.append(t)
        per_ticker[t["ticker"]] += 1
        if len(selected) >= top_n:
            break
    return selected


# ── Supabase writes (service role) ─────────────────────────────────────────────
# Idempotent on re-run. Notes on the foreign key:
#   sector_scan_runs.ml_dataset_id → ml_dataset(id) has NO ON DELETE clause, so
#   a referenced ml_dataset row can't be deleted. Every write path therefore
#   FIRST upserts the run row with ml_dataset_id=NULL (releasing any prior
#   reference), THEN deletes stale ml_dataset rows for the slot, THEN (if picked)
#   inserts the fresh ml_dataset row and points the run row at it.

def _make_supabase():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env "
              "(service-role key required — these tables are RLS-locked).",
              file=sys.stderr)
        sys.exit(1)
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _delete_ml(supabase, source, scan_date, sector):
    supabase.table("ml_dataset").delete() \
        .eq("source", source).eq("scan_date", scan_date).eq("sector", sector) \
        .execute()


def write_picked(supabase, run_row, ml_rows, source, scan_date, sector):
    """
    Persist a 'picked' sector: the run row plus the top-N ml_dataset rows
    (exactly one with is_best_in_sector=True, the rest runners-up). The run row
    is linked to the BEST row only. Returns the best row's id.

    `ml_rows` is an ordered list; ml_rows[0] is the best (is_best_in_sector=True).
    Idempotent: deletes ALL ml rows for this slot/sector first, so a re-run
    replaces the whole N-row set rather than accumulating or orphaning runners-up.
    """
    # 1. Upsert run row with the link cleared so any prior ml rows are freed
    #    (the FK has no ON DELETE, so the reference must be released before delete).
    run_row = {**run_row, "ml_dataset_id": None}
    supabase.table("sector_scan_runs").upsert(run_row, on_conflict=RUN_CONFLICT).execute()
    # 2. Drop ALL stale ml rows for this slot (old best + old runners-up).
    _delete_ml(supabase, source, scan_date, sector)
    # 3. Batch-insert the fresh N rows (cheap — pure DB, no Massive/network scan).
    resp = supabase.table("ml_dataset").insert(ml_rows).execute()
    # 4. Point the run row at the BEST row (the one flagged is_best_in_sector).
    best_id = next((r["id"] for r in (resp.data or []) if r.get("is_best_in_sector")), None)
    if best_id is None and resp.data:        # defensive fallback
        best_id = resp.data[0]["id"]
    if best_id:
        supabase.table("sector_scan_runs").update({"ml_dataset_id": best_id}) \
            .eq("source", source).eq("scan_date", scan_date).eq("sector", sector) \
            .execute()
    return best_id


def write_nonpicked(supabase, run_row, source, scan_date, sector):
    """Persist a non-picked sector (none_qualified / no_tickers / error)."""
    run_row = {**run_row, "ml_dataset_id": None}
    supabase.table("sector_scan_runs").upsert(run_row, on_conflict=RUN_CONFLICT).execute()
    # Clear any stale pick from a previous 'picked' run of this slot.
    _delete_ml(supabase, source, scan_date, sector)


# ── Market-day guard ──────────────────────────────────────────────────────────
# The scan only runs on US equity trading days. This lives in the script (not
# cron-only) so it protects manual runs too: a manual weekend/holiday run skips
# cleanly without scanning or writing any rows. Half-days / early closes count
# as trading days. Source of truth is the NYSE calendar from
# pandas_market_calendars (a pinned dependency — see server/requirements.txt);
# its holiday rules update when the library is upgraded.

def market_day_status(d):
    """
    Return (is_trading_day: bool, info: str) for date `d` (datetime.date), per
    the NYSE calendar. Early-close / half-days count as trading days. Raises
    RuntimeError if pandas_market_calendars isn't installed (so the caller can
    surface a clear 'pip install' message instead of guessing).
    """
    try:
        import pandas_market_calendars as mcal
    except ImportError as e:
        raise RuntimeError(
            "pandas_market_calendars not installed — run "
            "`venv/bin/pip install -r server/requirements.txt` "
            "(or `pip install pandas_market_calendars`). "
            "Cannot determine whether today is a trading day."
        ) from e

    nyse = mcal.get_calendar("NYSE")
    sched = nyse.schedule(start_date=d.isoformat(), end_date=d.isoformat())
    if sched.empty:
        return False, "NYSE closed (weekend or holiday)"

    info = "NYSE open (regular session)"
    try:  # flag early-close half-days for the log, but still treat as trading
        close_et = sched.iloc[0]["market_close"].tz_convert("America/New_York")
        if (close_et.hour, close_et.minute) < (16, 0):
            info = f"NYSE open (early close {close_et.strftime('%H:%M %Z')})"
    except Exception:
        pass
    return True, info


def _run_market_day_check(arg):
    """Handle --check-market-day: evaluate the guard for a date and exit."""
    if arg == "__today__":
        d = datetime.now(ZoneInfo("America/New_York")).date()
    else:
        d = datetime.strptime(arg, "%Y-%m-%d").date()
    try:
        is_trading, info = market_day_status(d)
    except RuntimeError as e:
        print(f"[guard] {e}", file=sys.stderr)
        sys.exit(1)
    label = "TRADING DAY" if is_trading else "CLOSED"
    print(f"{d.isoformat()} ({d.strftime('%A')}): {label} — {info}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Daily sector scan (manual) — Luo Capital",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--slot", choices=["open", "close"], default=None,
                        help="scan slot (required for a scan); sets source to live_open / live_close")
    parser.add_argument("--check-market-day", nargs="?", const="__today__",
                        default=None, metavar="YYYY-MM-DD",
                        help="evaluate the market-day guard for a date "
                             "(default today) and exit, without scanning/writing")
    parser.add_argument("--source", default=None,
                        help="override source (default live_<slot>; backtest allowed)")
    parser.add_argument("--weeks-min", type=int, default=1)
    parser.add_argument("--weeks-max", type=int, default=12)
    parser.add_argument("--min-premium", type=float, default=5.00)
    parser.add_argument("--min-p-profit", type=float, default=0.50)
    parser.add_argument("--sleep", type=float, default=0.15,
                        help="pause between tickers, seconds (default 0.15)")
    parser.add_argument("--limit-per-sector", type=int, default=None,
                        help="only scan the first N tickers per sector (testing)")
    parser.add_argument("--top-n", type=int, default=DEFAULT_TOP_N,
                        help=f"distinct setups to log per sector — #1 is best, "
                             f"rest are runners-up (default {DEFAULT_TOP_N})")
    parser.add_argument("--universe", default=os.path.join(_PROJECT_ROOT, "data", "universe.json"))
    parser.add_argument("--dry-run", action="store_true",
                        help="scan but write nothing to Supabase")
    args = parser.parse_args()

    # --check-market-day: just report the guard decision for a date and exit.
    if args.check_market_day is not None:
        _run_market_day_check(args.check_market_day)
        return

    if args.slot is None:
        parser.error("--slot is required (open|close) for a scan")

    slot        = args.slot
    source      = args.source or f"live_{slot}"
    weeks_max   = max(1, min(12, args.weeks_max))
    weeks_min   = max(1, min(weeks_max, args.weeks_min))
    min_premium = args.min_premium
    min_pp      = args.min_p_profit
    sleep_s     = args.sleep
    top_n       = max(1, args.top_n)
    weeks_range = f"W{weeks_min}-W{weeks_max}"

    if source not in ("live_open", "live_close", "backtest"):
        print(f"error: source must be live_open | live_close | backtest "
              f"(got {source!r}) — DB CHECK constraint.", file=sys.stderr)
        sys.exit(1)

    # ── Market-day guard — skip weekends/holidays before any heavy work ───────
    scan_date_obj = datetime.now(ZoneInfo("America/New_York")).date()
    scan_date     = scan_date_obj.isoformat()
    try:
        is_trading, mkt_info = market_day_status(scan_date_obj)
    except RuntimeError as e:
        print(f"[guard] {e}", file=sys.stderr)
        sys.exit(1)
    if not is_trading:
        print(f"market closed today ({scan_date}), skipping scan — {mkt_info}",
              flush=True)
        sys.exit(0)
    print(f"[guard] trading day ({scan_date}) — {mkt_info}; proceeding", flush=True)

    # ── Load universe ────────────────────────────────────────────────────────
    try:
        with open(args.universe) as f:
            universe = json.load(f)
        sectors = universe.get("sectors", {})
    except Exception as e:
        print(f"error: could not load universe {args.universe}: {e}", file=sys.stderr)
        sys.exit(1)
    if not sectors:
        print(f"error: universe {args.universe} has no sectors", file=sys.stderr)
        sys.exit(1)

    scan_timestamp = datetime.now(timezone.utc).isoformat()

    total_tickers = sum(len(t) for t in sectors.values())
    print("=" * 80, flush=True)
    print(f"SECTOR SCAN  slot={slot}  source={source}  date={scan_date}"
          f"{'  [DRY-RUN]' if args.dry_run else ''}", flush=True)
    print(f"  {len(sectors)} sectors, {total_tickers} tickers  |  "
          f"weeks {weeks_range}  min_premium=${min_premium:.2f}  "
          f"min_p_profit={min_pp:.2f}  sleep={sleep_s}s"
          f"{f'  limit/sector={args.limit_per_sector}' if args.limit_per_sector else ''}",
          flush=True)
    print("=" * 80, flush=True)

    # ── Run-wide context (fetched once) ──────────────────────────────────────
    vix = _yf_last_close("^VIX")
    spy = _yf_last_close("SPY")
    print(f"Market context: vix={vix}  spy={spy}", flush=True)
    days_to_fomc, days_to_cpi, days_to_macro = load_macro_proximity(scan_date_obj)

    # Target expirations (filtered to [weeks_min, weeks_max]) — built once.
    target_fridays = get_next_fridays(weeks_max)
    week_exps = [
        (i + 1, fri.strftime("%Y-%m-%d"))
        for i, fri in enumerate(target_fridays)
        if weeks_min <= (i + 1) <= weeks_max
    ]

    supabase = None if args.dry_run else _make_supabase()

    run_started = time.time()
    summary = []           # per-sector recap for the end-of-run print
    ml_written = 0
    runs_written = 0
    total_skipped = 0

    def base_run_row(sector):
        """Common sector_scan_runs columns; status-specific fields added later."""
        return {
            "source":          source,
            "scan_date":       scan_date,
            "scan_timestamp":  scan_timestamp,
            "sector":          sector,
            "min_net_premium": float(min_premium),
            "min_p_profit":    float(min_pp),
            "weeks_range":     weeks_range,
        }

    # Memoized per-ticker earnings lookup — each distinct logged ticker (best or
    # runner-up) is fetched at most once per run. Macro proximity is run-wide
    # (already fetched once above), so building runner-up rows adds no Massive
    # calls and at most a few cached yfinance earnings reads.
    _earnings_cache = {}

    def earnings_days(ticker):
        if ticker not in _earnings_cache:
            _earnings_cache[ticker] = _days_to_earnings(ticker, scan_date_obj)
        return _earnings_cache[ticker]

    def build_ml_row(t, is_best, sector):
        """Build one ml_dataset row from an already-scanned triplet `t`."""
        price = price_by_ticker.get(t["ticker"])
        exp_date = datetime.strptime(t["expiration"], "%Y-%m-%d").date()
        dte = (exp_date - scan_date_obj).days
        d_earn = earnings_days(t["ticker"])
        return {
            "source":         source,
            "scan_date":      scan_date,
            "scan_timestamp": scan_timestamp,
            "sector":         sector,
            "ticker":         t["ticker"],
            "is_best_in_sector": is_best,
            "expiration":     t["expiration"],
            "weeks_to_expiration": int(t["week"]),
            "days_to_expiration":  int(dte),
            "leg_a_strike":   float(t["leg_a_strike"]),
            "leg_a_prem":     float(t["leg_a_prem"]),
            "leg_a_delta":    float(t["leg_a_delta"]),
            "leg_b_strike":   float(t["leg_b_strike"]),
            "leg_b_prem":     float(t["leg_b_prem"]),
            "leg_b_delta":    float(t["leg_b_delta"]),
            "leg_c_strike":   float(t["leg_c_strike"]),
            "leg_c_prem":     float(t["leg_c_prem"]),
            "leg_c_delta":    float(t["leg_c_delta"]),
            "net_premium":    float(t["net_premium"]),
            "spread_width":   float(t["spread_width"]),
            "score":          float(t["score"]),
            "p_max_profit":   float(t["p_max_profit"]),
            "underlying_price_at_scan": float(price) if price is not None else None,
            # fair_value feature removed 2026-07 (it always equaled spot — see
            # CLAUDE.md). Column kept for schema stability, written as null.
            "fair_value":     None,
            "moneyness_a":    (round(price / t["leg_a_strike"], 6)
                               if price and t["leg_a_strike"] else None),
            "vix":            vix,
            "spy_price":      spy,
            "days_to_earnings":   d_earn,
            "days_to_next_fomc":  days_to_fomc,
            "days_to_next_cpi":   days_to_cpi,
            "days_to_next_macro": days_to_macro,
            "earnings_before_expiry": (d_earn is not None and d_earn <= dte),
            "outcome_filled": False,
            "notes":          "sector scan (manual)",
        }

    def commit_run(run_row, ml_rows=None):
        """Write one sector's row(s). Returns best ml_id (or None). Honors --dry-run."""
        nonlocal runs_written, ml_written
        sector = run_row["sector"]
        if args.dry_run:
            extra = (f" + {len(ml_rows)} ml_dataset row(s) "
                     f"[best={ml_rows[0]['ticker']}]" if ml_rows else "")
            print(f"  [dry-run] sector_scan_runs: {sector} "
                  f"status={run_row['status']}{extra}", flush=True)
            return None
        if ml_rows:
            ml_id = write_picked(supabase, run_row, ml_rows, source, scan_date, sector)
            runs_written += 1
            ml_written += len(ml_rows)
            return ml_id
        write_nonpicked(supabase, run_row, source, scan_date, sector)
        runs_written += 1
        return None

    # ── Per-sector loop ──────────────────────────────────────────────────────
    for s_idx, (sector, tickers) in enumerate(sectors.items(), 1):
        sector_start = time.time()
        if args.limit_per_sector:
            tickers = tickers[:args.limit_per_sector]
        n = len(tickers)
        print(f"\n[{s_idx}/{len(sectors)}] {sector}  ({n} ticker{'s' if n != 1 else ''})",
              flush=True)

        # status='no_tickers' — sector empty in the universe.
        if n == 0:
            print("  no tickers — status=no_tickers", flush=True)
            row = base_run_row(sector)
            row.update(status="no_tickers", tickers_scanned=0, tickers_skipped=0,
                       contracts_evaluated=0, setups_qualified=0,
                       elapsed_ms=int((time.time() - sector_start) * 1000))
            commit_run(row)
            summary.append((sector, "no_tickers", None, None, 0, 0, 0,
                            int((time.time() - sector_start) * 1000)))
            continue

        try:
            sector_triplets = []
            scanned = skipped = evaluated_total = 0
            price_by_ticker = {}

            for t_idx, ticker in enumerate(tickers, 1):
                result = scan_one_ticker(ticker, week_exps, min_premium, min_pp)
                if result is None:
                    skipped += 1
                    total_skipped += 1
                    time.sleep(sleep_s)
                    continue
                triplets, evaluated, price = result
                scanned += 1
                evaluated_total += evaluated
                sector_triplets.extend(triplets)
                price_by_ticker[ticker] = price
                best_here = max((t["score"] for t in triplets), default=None)
                tag = f"best score={best_here:.4f}" if best_here is not None else "no setups"
                print(f"    [{t_idx}/{n}] {ticker:6s} ${price:>9.2f}  "
                      f"{len(triplets):>3d} setup(s)  ({tag})", flush=True)
                time.sleep(sleep_s)

            elapsed_ms = int((time.time() - sector_start) * 1000)

            # status='none_qualified' — sector scanned but 0 setups passed.
            if not sector_triplets:
                print(f"  0 setups qualified — status=none_qualified "
                      f"({scanned} scanned, {skipped} skipped)", flush=True)
                row = base_run_row(sector)
                row.update(status="none_qualified", tickers_scanned=scanned,
                           tickers_skipped=skipped, contracts_evaluated=evaluated_total,
                           setups_qualified=0, elapsed_ms=elapsed_ms)
                commit_run(row)
                summary.append((sector, "none_qualified", None, None,
                                scanned, skipped, 0, elapsed_ms))
                continue

            # status='picked' — rank, then select the top-N DISTINCT setups
            # (best + runners-up) from the already-scanned in-memory results.
            # PURE selection: zero additional Massive/network calls — we just
            # take more rows from `ranked`, which scan_ticker already produced.
            ranked = sorted(sector_triplets, key=lambda t: t["score"], reverse=True)
            selected = select_top_n(ranked, top_n)   # selected[0] is the global best
            best = selected[0]

            # One ml_dataset row per selected setup; only index 0 is the best.
            ml_rows = [build_ml_row(t, i == 0, sector) for i, t in enumerate(selected)]

            row = base_run_row(sector)
            row.update(status="picked", best_ticker=best["ticker"],
                       best_score=float(best["score"]),
                       tickers_scanned=scanned, tickers_skipped=skipped,
                       contracts_evaluated=evaluated_total,
                       setups_qualified=len(ranked), elapsed_ms=elapsed_ms)
            commit_run(row, ml_rows=ml_rows)

            n_runners = len(ml_rows) - 1
            print(f"  PICKED {best['ticker']} {best['expiration']} "
                  f"score={best['score']:.4f}  (logged {len(ml_rows)} setups: "
                  f"1 best + {n_runners} runner-up(s) across "
                  f"{len({m['ticker'] for m in ml_rows})} ticker(s); "
                  f"{len(ranked)} qualified, {scanned} scanned, {skipped} skipped)",
                  flush=True)
            summary.append((sector, "picked", best["ticker"], float(best["score"]),
                            scanned, skipped, len(ranked), elapsed_ms))

        except Exception as e:  # noqa: BLE001 — sector failed; record + continue
            import traceback
            traceback.print_exc()
            elapsed_ms = int((time.time() - sector_start) * 1000)
            print(f"  ERROR scanning {sector}: {e} — status=error", flush=True)
            row = base_run_row(sector)
            row.update(status="error", error_message=str(e)[:1000],
                       elapsed_ms=elapsed_ms)
            try:
                commit_run(row)
            except Exception as e2:  # noqa: BLE001
                print(f"  [warn] failed to write error run row for {sector}: {e2}",
                      flush=True)
            summary.append((sector, "error", None, None, 0, 0, 0, elapsed_ms))

    # ── End-of-run summary ───────────────────────────────────────────────────
    total_elapsed = time.time() - run_started
    by_status = {}
    picks = 0
    print("\n" + "=" * 80, flush=True)
    print(f"SECTOR SCAN SUMMARY  slot={slot}  source={source}  date={scan_date}"
          f"{'  [DRY-RUN]' if args.dry_run else ''}", flush=True)
    print("-" * 80, flush=True)
    for sector, status, best_t, best_s, scanned, skipped, qualified, ems in summary:
        by_status[status] = by_status.get(status, 0) + 1
        if status == "picked":
            picks += 1
            pick = f"{best_t:6s} score={best_s:.4f}"
        else:
            pick = "—"
        print(f"  {sector:22s} {status:14s} {pick:24s} "
              f"({scanned} scanned, {skipped} skipped, {qualified} qualified, "
              f"{ems/1000:.1f}s)", flush=True)
    print("-" * 80, flush=True)
    status_str = " | ".join(f"{k}: {v}" for k, v in sorted(by_status.items()))
    print(f"  {len(summary)} sectors  |  {status_str}", flush=True)
    print(f"  picks logged: {picks}  |  total tickers skipped: {total_skipped}  |  "
          f"total elapsed: {total_elapsed:.1f}s", flush=True)
    if args.dry_run:
        print("  [DRY-RUN] no rows written.", flush=True)
    else:
        print(f"  ml_dataset rows written: {ml_written}  |  "
              f"sector_scan_runs rows written: {runs_written}", flush=True)
    print("=" * 80, flush=True)


if __name__ == "__main__":
    main()
