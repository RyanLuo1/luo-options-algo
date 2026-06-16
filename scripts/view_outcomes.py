#!/usr/bin/env python3
"""
scripts/view_outcomes.py — read-only report of every row in `trade_outcomes`.

Usage:
    python3 scripts/view_outcomes.py

No arguments. Reads SUPABASE_URL + SUPABASE_SERVICE_KEY from `.env` (loaded
transitively by `options_screener`). Performs zero writes — safe to run any
time to see current results, including immediately after a backfill.

If the `rich` library is installed, profitable trades print green and losing
trades print red. Otherwise everything prints in plain text; the script
still works.
"""

import os
import sys
from collections import Counter

# Project root on path so `options_screener`'s import-time load_dotenv()
# populates SUPABASE_URL / SUPABASE_SERVICE_KEY for us.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _PROJECT_ROOT)

import options_screener  # noqa: F401, E402 — import for load_dotenv() side effect

from supabase import create_client  # noqa: E402

# Optional pretty output. The script must work whether or not rich is installed.
try:
    from rich.console import Console
    _console = Console()
    _HAS_RICH = True
except ImportError:
    _console = None
    _HAS_RICH = False


SUPABASE_URL         = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env",
          file=sys.stderr)
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _emit(text, style=None):
    """Print with rich color if available, plain text otherwise."""
    if _HAS_RICH and style:
        _console.print(text, style=style, highlight=False)
    else:
        print(text)


def _pnl_style(pnl_contract):
    """Sign-based color — used for aggregate stats (totals, averages)."""
    if pnl_contract > 0:
        return "green"
    if pnl_contract < 0:
        return "red"
    return "dim"


# Outcome-zone color used for per-trade lines. Three positive-P&L zones print
# green (credit-only / sweet-spot / capped), the two near-zero buckets print
# yellow (partial / breakeven), losses red, pending dim.
_OUTCOME_STYLE = {
    'expired_capped':      'green',
    'expired_sweet_spot':  'green',
    'expired_credit_only': 'green',
    'expired_partial':     'yellow',
    'expired_breakeven':   'yellow',
    'expired_loss':        'red',
    'pending':             'dim',
}


def _outcome_style(outcome_type):
    return _OUTCOME_STYLE.get(outcome_type, 'dim')


def _format_capture(row, *, warn=False):
    """
    "67.2%", " n/a ", "    —" — the captured-fraction string for one row.

    Capture efficiency measures how much of the *available profit* was harvested,
    so it's only meaningful for profitable trades. For any losing or flat trade
    (P&L ≤ 0) we print an em-dash rather than a (negative, meaningless) percent —
    a "−221%" capture reads like a bug and isn't a real concept.

    Clamps the displayed value at 100% so an anomalous data point doesn't print
    e.g. "captured 142.0%". Aggregate stats in the summary keep raw values so
    such anomalies still surface in totals.

    When `warn=True`, a stderr line fires only when the raw ratio exceeds
    1.001 (0.1% tolerance). The clamp itself still kicks in at exactly 100% so
    a row that came in at $3,305.00000001 / $3,305 prints "100.0%", but the
    warning stays quiet — floating-point rounding shouldn't look like an
    anomaly. Anything beyond 0.1% over-cap is treated as real and worth flagging.
    """
    max_p = row['max_potential']
    if max_p <= 0:
        return "  n/a"
    if row['pnl_contract'] <= 0:                 # capture is undefined for losses
        return "    —"
    ratio = row['pnl_contract'] / max_p          # raw fraction (1.0 == exactly max profit)
    pct   = ratio * 100.0
    if pct > 100.0:
        if warn and ratio > 1.001:
            print(f"warning: capture > 100% for {row['ticker']} {row['expiration']} "
                  f"(pnl=${row['pnl_contract']:.2f}, max=${max_p:.2f}) — "
                  f"clamping display at 100%", file=sys.stderr)
        pct = 100.0
    return f"{pct:5.1f}%"


def main():
    # Two flat queries → Python-side join. Smaller mental load than relying on
    # PostgREST's embedded-relation syntax, and the dataset is small enough that
    # an in-memory dict join is trivially fast.
    outcomes_resp = supabase.table('trade_outcomes').select('*').execute()
    outcomes = outcomes_resp.data or []

    if not outcomes:
        _emit("No outcomes yet. Run `python3 scripts/backfill_outcomes.py` to populate.", "yellow")
        return

    trades_resp = supabase.table('tradebook').select('*').execute()
    trades_by_id = {t['id']: t for t in (trades_resp.data or [])}

    # Stitch: each outcome carries the trade context (ticker, entry credit,
    # expiration date) needed to render a useful line.
    rows = []
    for o in outcomes:
        t = trades_by_id.get(o['tradebook_id'])
        if t is None:
            # FK cascade should make this impossible; flag rather than crash.
            print(f"warning: outcome {o['id']} references missing tradebook "
                  f"row {o['tradebook_id']}", file=sys.stderr)
            continue

        entry_credit = float(t['net_premium'])              # per-share, matches option quotes

        # Spread width MUST be derived from the SAME leg strikes the realized-P&L
        # formula uses (leg_b_strike − leg_a_strike), NOT the stored spread_width
        # column. The realized P&L (backfill_outcomes.compute_outcome) credits
        # leg_a_value = max(0, S − K_A), which in the sweet-spot/capped zones rises
        # all the way to K_B − K_A. If the stored spread_width is stale/mismatched
        # and SMALLER than the actual K_B − K_A (some AAOI rows had spread_width
        # = 10.00 while K_B − K_A was wider), the max denominator
        # (credit + spread_width) understates the true peak and the realized P&L
        # can exceed it — the impossible "P&L > max" / capture > 100% symptom.
        # Recomputing from strikes keeps the max on the exact same basis as the
        # P&L numerator, so realized P&L ≤ max holds for every outcome_type.
        try:
            spread_width = float(t['leg_b_strike']) - float(t['leg_a_strike'])
        except (KeyError, TypeError, ValueError):
            # Legacy row missing strikes — fall back to the stored column.
            sw = t.get('spread_width')
            spread_width = float(sw) if sw is not None else 0.0

        # Theoretical max P&L occurs when the underlying closes exactly at
        # Leg B strike: long call captures the full spread (K_B − K_A), both
        # shorts expire worthless. (credit + spread_width) × 100 → per-contract.
        max_potential = (entry_credit + spread_width) * 100.0

        rows.append({
            'ticker':         t['ticker'],
            'expiration':     t['expiration'],
            'entry_credit':   entry_credit,
            'spread_width':   spread_width,
            'stock_close':    float(o['stock_price_at_expiration']),
            'pnl_contract':   float(o['pnl_per_contract']),  # raw payoff × 100, matches brokerage
            'max_potential':  max_potential,
            'outcome_type':   o['outcome_type'],
        })

    if not rows:
        _emit("No outcomes joinable to tradebook rows.", "yellow")
        return

    # Most recent expiration first.
    rows.sort(key=lambda r: r['expiration'], reverse=True)

    # Column widths driven by actual data so 3- and 4-char tickers line up.
    ticker_w = max(4, max(len(r['ticker']) for r in rows))

    _emit("")
    _emit("─" * 88, "dim")
    _emit(f"Trade Outcomes  ({len(rows)} row{'s' if len(rows) != 1 else ''})", "bold")
    _emit("─" * 88, "dim")

    for r in rows:
        capture_str = _format_capture(r, warn=True)
        line = (
            f"{r['ticker']:<{ticker_w}}  {r['expiration']}  "
            f"credit=${r['entry_credit']:>6.2f}  "
            f"spread=${r['spread_width']:>5.2f}  "
            f"→  S=${r['stock_close']:>8.2f}  "
            f"P&L=${r['pnl_contract']:+9.2f}  "
            f"(max=${r['max_potential']:+9.2f}, captured {capture_str})  "
            f"({r['outcome_type']})"
        )
        _emit(line, _outcome_style(r['outcome_type']))

    # ── Summary ─────────────────────────────────────────────────────────────
    total_pnl       = sum(r['pnl_contract']  for r in rows)
    total_max       = sum(r['max_potential'] for r in rows)
    wins            = sum(1 for r in rows if r['pnl_contract'] > 0)
    n               = len(rows)
    win_rate        = wins / n * 100 if n else 0.0
    avg_pnl         = total_pnl / n if n else 0.0

    # "Average capture per trade" is the mean of per-trade capture ratios — and
    # capture is only meaningful for *winning* trades (see _format_capture). A
    # loss has no fraction-of-profit-harvested, and averaging in a large negative
    # (e.g. a −221% loss) would corrupt the stat. So restrict to wins (pnl > 0).
    # Uses *raw* ratios (no 100% clamp) so an over-cap anomaly still surfaces here
    # instead of being silently capped. Trades with max <= 0 can't contribute.
    win_capture_ratios = [
        r['pnl_contract'] / r['max_potential']
        for r in rows if r['pnl_contract'] > 0 and r['max_potential'] > 0
    ]
    avg_capture     = sum(win_capture_ratios) / len(win_capture_ratios) * 100 \
                      if win_capture_ratios else 0.0

    # Aggregate capture efficiency (total P&L ÷ total max) is left as-is — it is
    # correct because a loss properly reduces the total-P&L numerator. total_max
    # is a sum of (credit + spread) × 100 terms, each positive by construction,
    # so the denominator stays positive and the ratio degrades sensibly on losses.
    capture_eff     = total_pnl / total_max * 100 if total_max > 0 else 0.0

    best  = max(rows, key=lambda r: r['pnl_contract'])
    worst = min(rows, key=lambda r: r['pnl_contract'])

    counts = Counter(r['outcome_type'] for r in rows)

    _emit("")
    _emit("─" * 88, "dim")
    _emit("Summary", "bold")
    _emit("─" * 88, "dim")
    _emit(f"  Total trades              : {n}")
    _emit(f"  Win rate                  : {win_rate:.1f}%")
    _emit(f"  Total P&L (per contract)  : ${total_pnl:+,.2f}",
          _pnl_style(total_pnl))
    _emit(f"  Total max potential       : ${total_max:+,.2f}")
    if total_max > 0:
        _emit(f"  Capture efficiency        : {capture_eff:.1f}%  "
              f"(${total_pnl:+,.0f} / ${total_max:,.0f} max)")
    else:
        _emit("  Capture efficiency        : n/a  (no positive max potential)")
    _emit(f"  Average per trade         : ${avg_pnl:+,.2f}",
          _pnl_style(avg_pnl))
    _emit(f"  Avg capture per trade (wins): {avg_capture:.1f}%  "
          f"({len(win_capture_ratios)} win{'s' if len(win_capture_ratios) != 1 else ''})")
    _emit(f"  Best trade                : {best['ticker']:<{ticker_w}}  "
          f"{best['expiration']}  ${best['pnl_contract']:+,.2f}",
          "green")
    _emit(f"  Worst trade               : {worst['ticker']:<{ticker_w}}  "
          f"{worst['expiration']}  ${worst['pnl_contract']:+,.2f}",
          "red" if worst['pnl_contract'] < 0 else "dim")

    _emit("")
    _emit("  Breakdown by outcome_type:", "bold")
    # Quality order — best zone first, worst last. Colored to match the
    # per-trade lines so the eye can sweep a single column for the summary.
    for key in ('expired_capped',
                'expired_sweet_spot',
                'expired_credit_only',
                'expired_partial',
                'expired_breakeven',
                'expired_loss',
                'pending'):
        if key in counts:
            _emit(f"    {key:<22}: {counts[key]}", _outcome_style(key))
    _emit("")


if __name__ == '__main__':
    main()
