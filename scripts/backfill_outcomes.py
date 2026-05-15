#!/usr/bin/env python3
"""
scripts/backfill_outcomes.py — compute realized P&L for expired V3 tradebook
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
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo

# Add project root to path so we can import the existing Massive client and
# its `load_dotenv()` side effect (options_screener calls it at import time,
# which makes SUPABASE_URL / SUPABASE_SERVICE_KEY available too).
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _PROJECT_ROOT)

from options_screener import massive_client  # noqa: E402  — env load on import

from supabase import create_client  # noqa: E402

SUPABASE_URL         = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env",
          file=sys.stderr)
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ── Massive stock-close fetch ────────────────────────────────────────────────

def fetch_close_price(ticker, expiration_date):
    """
    Return the close on `expiration_date`, or the most recent prior trading
    day if that exact date had no bar (holiday, half-day, etc.). Returns
    None on any failure.

    Massive's $30 Options plan includes historical stock aggregates (yesterday
    and earlier), so this call works for any past expiration. The 7-day
    backward window absorbs holiday-shifted expirations without extra logic.
    """
    from_date = (expiration_date - timedelta(days=7)).strftime("%Y-%m-%d")
    to_date   = expiration_date.strftime("%Y-%m-%d")
    try:
        aggs = list(massive_client.list_aggs(
            ticker, 1, "day", from_date, to_date, limit=10,
        ))
    except Exception as e:
        print(f"  ! Massive fetch failed for {ticker} {expiration_date}: {e}",
              file=sys.stderr)
        return None

    valid = [a for a in aggs if a.close is not None and a.timestamp is not None]
    if not valid:
        return None
    valid.sort(key=lambda a: a.timestamp)
    return round(float(valid[-1].close), 4)


# ── P&L math ─────────────────────────────────────────────────────────────────

def compute_outcome(trade, stock_close):
    """
    Apply the V3 call-spread-risk-reversal payoff formulas:
        Leg A (long call) :  max(0, S - leg_a_strike)        # value to us
        Leg B (short call):  max(0, S - leg_b_strike)        # liability
        Leg C (short put) :  max(0, leg_c_strike - S)        # liability
    Realized P&L = entry net credit + leg_a_value − leg_b_liability − leg_c_liability
    """
    S = float(stock_close)
    leg_a_value     = max(0.0, S - float(trade['leg_a_strike']))
    leg_b_liability = max(0.0, S - float(trade['leg_b_strike']))
    leg_c_liability = max(0.0, float(trade['leg_c_strike']) - S)

    realized_pnl     = float(trade['net_premium']) + leg_a_value - leg_b_liability - leg_c_liability
    pnl_per_contract = realized_pnl * 100  # one option contract = 100 shares

    # Order matters: max-profit (both shorts worthless) takes precedence over
    # any other classification, since by construction net_premium > 0 in V3
    # so a max-profit outcome is always also a positive-pnl outcome.
    if leg_b_liability == 0 and leg_c_liability == 0:
        outcome_type = 'expired_max_profit'
    elif realized_pnl < 0:
        outcome_type = 'expired_loss'
    elif abs(realized_pnl) < 0.05:
        outcome_type = 'expired_breakeven'
    else:
        outcome_type = 'expired_partial'

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

    print(f"Found {len(candidates)} expired trade(s) to process.\n")

    successes = 0
    wins      = 0
    total_pnl = 0.0

    for trade, exp_date in candidates:
        ticker      = trade['ticker']
        stock_close = fetch_close_price(ticker, exp_date)
        if stock_close is None:
            print(f"  ! Skipping {ticker} {exp_date}: no stock price found")
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
