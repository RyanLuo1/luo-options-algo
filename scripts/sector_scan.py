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

This is a STANDALONE job. It reuses screener.scan_ticker / get_fair_value and the
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
from screener import scan_ticker, get_fair_value  # noqa: E402

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
    (triplets, evaluated, price, fair_value) on success, or None if the ticker
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

            fair_value = get_fair_value(ticker)
            triplets, evaluated = scan_ticker(
                ticker, price, week_exps, fair_value,
                min_premium, min_p_profit=min_p_profit,
            )
            return triplets, evaluated, price, fair_value
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


def write_picked(supabase, run_row, ml_row, source, scan_date, sector):
    """Persist a 'picked' sector: run row + its ml_dataset row, linked. Returns ml_id."""
    # 1. Upsert run row with the link cleared so any prior ml row is freed.
    run_row = {**run_row, "ml_dataset_id": None}
    supabase.table("sector_scan_runs").upsert(run_row, on_conflict=RUN_CONFLICT).execute()
    # 2. Drop any stale ml row(s) for this slot (now unreferenced).
    _delete_ml(supabase, source, scan_date, sector)
    # 3. Insert the fresh best-in-sector row.
    resp = supabase.table("ml_dataset").insert(ml_row).execute()
    ml_id = resp.data[0]["id"] if resp.data else None
    # 4. Point the run row at it.
    if ml_id:
        supabase.table("sector_scan_runs").update({"ml_dataset_id": ml_id}) \
            .eq("source", source).eq("scan_date", scan_date).eq("sector", sector) \
            .execute()
    return ml_id


def write_nonpicked(supabase, run_row, source, scan_date, sector):
    """Persist a non-picked sector (none_qualified / no_tickers / error)."""
    run_row = {**run_row, "ml_dataset_id": None}
    supabase.table("sector_scan_runs").upsert(run_row, on_conflict=RUN_CONFLICT).execute()
    # Clear any stale pick from a previous 'picked' run of this slot.
    _delete_ml(supabase, source, scan_date, sector)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Daily sector scan (manual) — Luo Capital",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--slot", required=True, choices=["open", "close"],
                        help="scan slot; sets source to live_open / live_close")
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
    parser.add_argument("--universe", default=os.path.join(_PROJECT_ROOT, "data", "universe.json"))
    parser.add_argument("--dry-run", action="store_true",
                        help="scan but write nothing to Supabase")
    args = parser.parse_args()

    slot        = args.slot
    source      = args.source or f"live_{slot}"
    weeks_max   = max(1, min(12, args.weeks_max))
    weeks_min   = max(1, min(weeks_max, args.weeks_min))
    min_premium = args.min_premium
    min_pp      = args.min_p_profit
    sleep_s     = args.sleep
    weeks_range = f"W{weeks_min}-W{weeks_max}"

    if source not in ("live_open", "live_close", "backtest"):
        print(f"error: source must be live_open | live_close | backtest "
              f"(got {source!r}) — DB CHECK constraint.", file=sys.stderr)
        sys.exit(1)

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

    scan_date_obj  = datetime.now(ZoneInfo("America/New_York")).date()
    scan_date      = scan_date_obj.isoformat()
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

    def commit_run(run_row, ml_row=None):
        """Write one sector's row(s). Returns ml_id (or None). Honors --dry-run."""
        nonlocal runs_written, ml_written
        sector = run_row["sector"]
        if args.dry_run:
            print(f"  [dry-run] sector_scan_runs: {sector} status={run_row['status']}"
                  + (f" + ml_dataset {ml_row['ticker']} {ml_row['expiration']}"
                     if ml_row else ""), flush=True)
            return None
        if ml_row is not None:
            ml_id = write_picked(supabase, run_row, ml_row, source, scan_date, sector)
            runs_written += 1
            ml_written += 1
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
                triplets, evaluated, price, _fv = result
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

            # status='picked' — rank and take the single best setup in sector.
            ranked = sorted(sector_triplets, key=lambda t: t["score"], reverse=True)
            best = ranked[0]
            best_price = price_by_ticker.get(best["ticker"])
            exp_date = datetime.strptime(best["expiration"], "%Y-%m-%d").date()
            dte = (exp_date - scan_date_obj).days
            d_earn = _days_to_earnings(best["ticker"], scan_date_obj)
            earnings_before_expiry = (d_earn is not None and d_earn <= dte)
            moneyness_a = (round(best_price / best["leg_a_strike"], 6)
                           if best_price and best["leg_a_strike"] else None)
            fv = best.get("fair_value")

            ml_row = {
                "source":         source,
                "scan_date":      scan_date,
                "scan_timestamp": scan_timestamp,
                "sector":         sector,
                "ticker":         best["ticker"],
                "is_best_in_sector": True,
                "expiration":     best["expiration"],
                "weeks_to_expiration": int(best["week"]),
                "days_to_expiration":  int(dte),
                "leg_a_strike":   float(best["leg_a_strike"]),
                "leg_a_prem":     float(best["leg_a_prem"]),
                "leg_a_delta":    float(best["leg_a_delta"]),
                "leg_b_strike":   float(best["leg_b_strike"]),
                "leg_b_prem":     float(best["leg_b_prem"]),
                "leg_b_delta":    float(best["leg_b_delta"]),
                "leg_c_strike":   float(best["leg_c_strike"]),
                "leg_c_prem":     float(best["leg_c_prem"]),
                "leg_c_delta":    float(best["leg_c_delta"]),
                "net_premium":    float(best["net_premium"]),
                "spread_width":   float(best["spread_width"]),
                "score":          float(best["score"]),
                "p_max_profit":   float(best["p_max_profit"]),
                "underlying_price_at_scan": float(best_price),
                "fair_value":     float(fv) if fv is not None else None,
                "moneyness_a":    moneyness_a,
                "vix":            vix,
                "spy_price":      spy,
                "days_to_earnings":   d_earn,
                "days_to_next_fomc":  days_to_fomc,
                "days_to_next_cpi":   days_to_cpi,
                "days_to_next_macro": days_to_macro,
                "earnings_before_expiry": earnings_before_expiry,
                "outcome_filled": False,
                "notes":          "sector scan (manual)",
            }

            row = base_run_row(sector)
            row.update(status="picked", best_ticker=best["ticker"],
                       best_score=float(best["score"]),
                       tickers_scanned=scanned, tickers_skipped=skipped,
                       contracts_evaluated=evaluated_total,
                       setups_qualified=len(ranked), elapsed_ms=elapsed_ms)
            commit_run(row, ml_row=ml_row)

            print(f"  PICKED {best['ticker']} {best['expiration']} "
                  f"score={best['score']:.4f}  ({len(ranked)} qualified, "
                  f"{scanned} scanned, {skipped} skipped)", flush=True)
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
