#!/usr/bin/env python3
"""
scripts/backfill_outcomes.py — compute realized P&L for expired tradebook
trades and persist one row per trade to the `trade_outcomes` table.

Usage:
    python3 scripts/backfill_outcomes.py

No arguments. Reads SUPABASE_URL + SUPABASE_SERVICE_KEY + MASSIVE_API_KEY
from the project's `.env` (loaded transitively via `options_screener`).

Idempotent — re-runs only touch tradebook rows that don't yet have an outcome
(enforced both by a unique constraint on trade_outcomes.tradebook_id and by a
pre-filter against the existing outcomes set so we don't waste Massive calls).
"""

import os
import sys
import time
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo

# Add project root to path so we can import the existing Massive client and
# its `load_dotenv()` side effect (options_screener calls it at import time,
# which makes SUPABASE_URL / SUPABASE_SERVICE_KEY available too).
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _PROJECT_ROOT)

from options_screener import massive_client  # noqa: E402  — env load on import

import yfinance as yf  # noqa: E402

from supabase import create_client  # noqa: E402

SUPABASE_URL         = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env",
          file=sys.stderr)
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ── Massive stock-close fetch ────────────────────────────────────────────────

# Process-local cache so multiple trades sharing a (ticker, expiration_date)
# only hit Massive once. Keyed by (ticker, "YYYY-MM-DD"); value is the close
# price or None when every retry attempt failed. The retry pass at the end
# of main() looks for None entries here.
_price_cache = {}


def _is_rate_limit_error(exc):
    """Heuristic — Massive surfaces 429s with these substrings somewhere in str(exc)."""
    msg = str(exc).lower()
    return any(s in msg for s in (
        '429', 'rate limit', 'too many requests', 'rate_limit', 'ratelimit',
    ))


def _fetch_with_retry(ticker, expiration_date, *, delays):
    """
    Fetch one (ticker, date) close from Massive. Retries on any exception
    (rate-limit, transient 5xx, network blip) using the supplied delay
    schedule. Returns the close price or None after exhausting retries.

    `delays` is a tuple of sleeps between attempts. len(delays) + 1 attempts
    total — e.g. delays=(2, 5) means: try, sleep 2s, try, sleep 5s, try, give up.
    """
    from_date = (expiration_date - timedelta(days=7)).strftime("%Y-%m-%d")
    to_date   = expiration_date.strftime("%Y-%m-%d")
    max_attempts = len(delays) + 1

    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            aggs = list(massive_client.list_aggs(
                ticker, 1, "day", from_date, to_date, limit=10,
            ))
            valid = [a for a in aggs if a.close is not None and a.timestamp is not None]
            if not valid:
                return None
            valid.sort(key=lambda a: a.timestamp)
            return round(float(valid[-1].close), 4)
        except Exception as e:
            last_err = e
            if attempt < max_attempts:
                wait = delays[attempt - 1]
                tag  = "rate-limited" if _is_rate_limit_error(e) else "errored"
                print(f"  ⟳ {ticker} {expiration_date}: {tag}, "
                      f"retrying in {wait}s (attempt {attempt}/{max_attempts}): {e}",
                      file=sys.stderr)
                time.sleep(wait)

    print(f"  ! Massive fetch failed for {ticker} {expiration_date} after "
          f"{max_attempts} attempts: {last_err}", file=sys.stderr)
    return None


def _fetch_close_yfinance(ticker, expiration_date):
    """
    Primary close source (2026-08-24): Yahoo's daily close on
    `expiration_date`, or the most recent prior trading day within the same
    7-day backward window the Massive path uses. Free of Massive's REST rate
    limits, which 429 on recent expirations. Returns None on any failure —
    the caller falls back to the Massive REST path, whose behavior is
    unchanged.

    (The originally-approved source — our local day_aggs flat-file extracts —
    can't serve this: those files are OPRA *options* aggregates with no
    underlying closes, and the us_stocks_sip flat files 403 on our plan.
    Validated instead against the existing REST-derived labels: 45/45 sampled
    (ticker, expiration) pairs reproduced stock_price_at_expiration to the
    penny and the identical outcome_type.)
    """
    try:
        hist = yf.Ticker(ticker).history(
            start=expiration_date - timedelta(days=7),
            end=expiration_date + timedelta(days=1),   # yf end is exclusive → bars ≤ expiration
            auto_adjust=False, actions=False,
        )
        if hist.empty:
            return None
        return round(float(hist["Close"].iloc[-1]), 4)
    except Exception as e:
        print(f"  ⟳ {ticker} {expiration_date}: yfinance close failed ({e}) "
              f"— falling back to Massive REST", file=sys.stderr)
        return None


def fetch_close_price(ticker, expiration_date, *, delays=(2, 5), use_cache=True):
    """
    Return the close on `expiration_date`, or the most recent prior trading
    day if that exact date had no bar (holiday, half-day, etc.). Returns
    None when every retry attempt failed.

    Cached by (ticker, date) — repeats during the same run never re-fetch.
    Pass `use_cache=False` to force a fresh attempt (the retry pass in main()
    uses this to re-try entries previously cached as None).

    Source order (2026-08-24): yfinance first (no Massive rate limits — the
    REST path 429s on recent expirations), Massive REST as fallback. Both
    use the same 7-day backward window, which absorbs holiday-shifted
    expirations without extra logic.
    """
    key = (ticker, expiration_date.strftime("%Y-%m-%d"))
    if use_cache and key in _price_cache:
        return _price_cache[key]
    price = _fetch_close_yfinance(ticker, expiration_date)
    if price is None:
        price = _fetch_with_retry(ticker, expiration_date, delays=delays)
    _price_cache[key] = price
    return price


# ── P&L math ─────────────────────────────────────────────────────────────────

def compute_outcome(trade, stock_close):
    """
    Apply the call-spread-risk-reversal payoff formulas:
        Leg A (long call) :  max(0, S - leg_a_strike)        # value to us
        Leg B (short call):  max(0, S - leg_b_strike)        # liability
        Leg C (short put) :  max(0, leg_c_strike - S)        # liability
    Realized P&L = entry net credit + leg_a_value − leg_b_liability − leg_c_liability

    Outcome classification is *payoff-zone-based*, not assignment-based — an
    earlier scheme that fired 'max_profit' whenever both shorts were worthless
    conflated the credit-only zone with the capped zone. Now we label by
    where S landed:

        breakeven    — |pnl| < $0.05
        loss         — pnl < 0
        credit_only  — S ≤ K_A, pnl > 0  (no spread captured)
        sweet_spot   — K_A < S < K_B, pnl > 0  (long call ITM, no assignments)
        capped       — S ≥ K_B, pnl > 0  (full spread captured, short call assigned)
        partial      — defensive fallback (unreachable when conditions are exhaustive)

    Order is load-bearing — see docs/trade_outcomes_relabel_migration.sql for
    the matching SQL `case` block.
    """
    S = float(stock_close)
    leg_a_strike = float(trade['leg_a_strike'])
    leg_b_strike = float(trade['leg_b_strike'])
    leg_a_value     = max(0.0, S - leg_a_strike)
    leg_b_liability = max(0.0, S - leg_b_strike)
    leg_c_liability = max(0.0, float(trade['leg_c_strike']) - S)

    realized_pnl     = float(trade['net_premium']) + leg_a_value - leg_b_liability - leg_c_liability
    pnl_per_contract = realized_pnl * 100  # one option contract = 100 shares

    if abs(realized_pnl) < 0.05:
        outcome_type = 'expired_breakeven'
    elif realized_pnl < 0:
        outcome_type = 'expired_loss'
    elif S <= leg_a_strike:
        outcome_type = 'expired_credit_only'
    elif S <  leg_b_strike:
        outcome_type = 'expired_sweet_spot'
    elif S >= leg_b_strike:
        outcome_type = 'expired_capped'
    else:
        outcome_type = 'expired_partial'  # unreachable; kept defensively

    return {
        'outcome_type':              outcome_type,
        'stock_price_at_expiration': round(S, 4),
        'leg_a_value':               round(leg_a_value, 4),
        'leg_b_liability':           round(leg_b_liability, 4),
        'leg_c_liability':           round(leg_c_liability, 4),
        'realized_pnl':              round(realized_pnl, 4),
        'pnl_per_contract':          round(pnl_per_contract, 2),
    }


# ── Orchestration ────────────────────────────────────────────────────────────

def main():
    today_et = datetime.now(ZoneInfo("America/New_York")).date()

    trades_resp = supabase.table('tradebook').select('*').execute()
    trades = trades_resp.data or []

    outcomes_resp = supabase.table('trade_outcomes').select('tradebook_id').execute()
    processed = {row['tradebook_id'] for row in (outcomes_resp.data or [])}

    candidates = []
    for t in trades:
        if t['id'] in processed:
            continue
        try:
            exp_date = date.fromisoformat(t['expiration'])
        except (TypeError, ValueError):
            print(f"  ! Skipping {t.get('ticker')} id={t.get('id')}: "
                  f"invalid expiration {t.get('expiration')!r}", file=sys.stderr)
            continue
        if exp_date < today_et:
            candidates.append((t, exp_date))

    if not candidates:
        print("No new trades to backfill, exiting cleanly.")
        return

    print(f"Found {len(candidates)} expired trade(s) to process.")

    # ── Pre-fetch pass: one Massive call per unique (ticker, date) pair ──────
    # Many candidates share an expiration (e.g. multiple GEV trades expiring
    # the same Friday). Fetching each unique combo once eliminates redundant
    # API calls outright, which was the main rate-limit trigger.
    unique_keys = sorted(
        {(t['ticker'], exp_date) for t, exp_date in candidates},
        key=lambda k: (k[1], k[0]),
    )
    print(f"\nFetching close prices for {len(unique_keys)} unique "
          f"(ticker, date) pair(s)...")
    for ticker, exp_date in unique_keys:
        fetch_close_price(ticker, exp_date)  # populates _price_cache
        time.sleep(0.2)  # gentle pacing between calls

    # ── Retry pass: re-attempt anything still cached as None ────────────────
    # Uses longer delays this time on the theory that a rate-limit ceiling
    # has been reset by now.
    failed = [k for k, v in _price_cache.items() if v is None]
    if failed:
        print(f"\nRetrying {len(failed)} failed fetch(es) with longer delays...")
        for tkr, date_str in failed:
            exp_date = date.fromisoformat(date_str)
            fetch_close_price(tkr, exp_date, delays=(5, 10), use_cache=False)
            time.sleep(0.5)

    # ── Process pass: every candidate just reads from the cache ─────────────
    print()
    successes = 0
    wins      = 0
    total_pnl = 0.0

    for trade, exp_date in candidates:
        ticker      = trade['ticker']
        stock_close = _price_cache.get((ticker, exp_date.strftime("%Y-%m-%d")))
        if stock_close is None:
            print(f"  ! Skipping {ticker} {exp_date}: no stock price found "
                  f"(rate-limited or unavailable after all retries)")
            continue

        outcome = compute_outcome(trade, stock_close)

        try:
            supabase.table('trade_outcomes').insert({
                'tradebook_id': trade['id'],
                'user_id':      trade['user_id'],
                **outcome,
                'notes':        'auto-backfilled',
            }).execute()
        except Exception as e:
            # Unique-constraint conflict (raced with another backfill run) is
            # the only "expected" insert failure — log and move on.
            print(f"  ! Insert failed for {ticker} {exp_date}: {e}", file=sys.stderr)
            continue

        # Displaying per-contract dollar values (raw payoff × 100). When
        # tradebook tracks contract quantity, multiply by qty here.
        pnl_contract = outcome['pnl_per_contract']
        print(f"[backfill] {ticker} {exp_date}: S=${stock_close:>8.2f}  "
              f"P&L=${pnl_contract:+9.2f}  ({outcome['outcome_type']})")

        successes += 1
        total_pnl += pnl_contract
        if pnl_contract > 0:
            wins += 1

    if successes == 0:
        print("\nNo trades backfilled.")
        return

    win_rate = wins / successes * 100
    avg_pnl  = total_pnl / successes
    print(f"\nBackfilled {successes} trades. "
          f"Win rate: {win_rate:.1f}%. "
          f"Total P&L: ${total_pnl:+.2f}. "
          f"Average per trade: ${avg_pnl:+.2f}.")


if __name__ == '__main__':
    main()
