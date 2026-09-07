#!/usr/bin/env python3
"""
scripts/backfill_ml_outcomes.py — fill the outcome_* columns on `ml_dataset`
for rows whose expiration date has passed.

Usage:
    python3 scripts/backfill_ml_outcomes.py

No arguments. Reads SUPABASE_URL + SUPABASE_SERVICE_KEY + MASSIVE_API_KEY from
the project's `.env` (loaded transitively via `options_screener`).

Sibling of scripts/backfill_outcomes.py (tradebook → trade_outcomes), but this
one writes ml_dataset's OWN outcome columns and never touches trade_outcomes,
tradebook, or the scan pipeline. The two datasets stay entirely separate:
tradebook/trade_outcomes are discretionary trades; ml_dataset is the
systematic sector-scan feed.

Shared machinery — imported from backfill_outcomes so the two backfills can
never diverge:
  * compute_outcome()   — the Call Spread Risk Reversal payoff math + the
                          payoff-zone outcome classification
  * fetch_close_price() — Massive close-price fetch with retry/backoff,
                          429 detection, and a per-(ticker, date) memo cache

ml_dataset-specific conventions (per docs/ml_dataset_schema.sql):
  * ALL unfilled expired rows are processed — winners (is_best_in_sector=true)
    AND runners-up (false). Runners-up exist precisely so a model can learn
    what weaker setups do; they get labels too.
  * max_profit_per_contract = (net_premium + spread) * 100 where spread is
    DERIVED from leg_b_strike - leg_a_strike (never the stored spread_width
    column), so realized P&L and max profit share the same basis.
  * capture_pct = pnl / max as a fraction (0–1), and NULL when pnl ≤ 0 —
    capture efficiency only means something for winning trades (matches the
    corrected convention in view_outcomes.py).

Idempotent — only rows with outcome_filled = false are considered; filled rows
are never recomputed. Rows whose price can't be fetched (e.g. a too-recent
expiration Massive hasn't made historical yet) are skipped with a log line and
left unfilled for a later run.
"""

import os
import sys
import time
from datetime import datetime, date, timezone
from zoneinfo import ZoneInfo

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _PROJECT_ROOT)
sys.path.insert(0, os.path.join(_PROJECT_ROOT, 'scripts'))

# Importing backfill_outcomes loads .env (via options_screener), validates the
# Supabase env vars (exits with a clear error if missing), and exposes the
# shared payoff math + price-fetch cache. `_price_cache` is the module-level
# memo that fetch_close_price populates — we read it directly in the process
# pass, exactly like backfill_outcomes.main() does.
import backfill_outcomes as _bo  # noqa: E402
from backfill_outcomes import (  # noqa: E402
    compute_outcome, fetch_close_price, split_factor, supabase,
)

_PAGE = 1000  # PostgREST caps responses at 1000 rows; page past it


def fetch_unfilled_rows():
    """All ml_dataset rows with outcome_filled = false (paginated)."""
    rows, offset = [], 0
    while True:
        resp = (supabase.table('ml_dataset').select('*')
                .eq('outcome_filled', False)
                .order('id')
                .range(offset, offset + _PAGE - 1)
                .execute())
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < _PAGE:
            return rows
        offset += _PAGE


def count_unfilled():
    resp = (supabase.table('ml_dataset').select('id', count='exact')
            .eq('outcome_filled', False).limit(1).execute())
    return resp.count or 0


def build_update(row, stock_close):
    """
    Compute the ml_dataset outcome columns for one row.

    Payoff + classification come from the shared compute_outcome(); the
    per-contract max and capture ratio are ml_dataset-specific:
      max  = (net_premium + (K_B - K_A)) * 100   — strike-derived spread
      capture = pnl_per_contract / max            — NULL when pnl ≤ 0 or max ≤ 0

    The close is settled in the row's scan-date share basis (split_factor —
    a split between scan and expiration otherwise fabricates losses).
    """
    factor = split_factor(row['ticker'], date.fromisoformat(row['scan_date']),
                          date.fromisoformat(row['expiration']))
    if factor != 1.0:
        print(f"  [splits] {row['ticker']} {row['scan_date']}→"
              f"{row['expiration']}: ×{factor:g} split adjustment")
        stock_close = round(stock_close * factor, 4)
    outcome = compute_outcome(row, stock_close)

    spread_from_strikes = float(row['leg_b_strike']) - float(row['leg_a_strike'])
    max_per_contract = round((float(row['net_premium']) + spread_from_strikes) * 100, 2)

    capture_pct = None
    if outcome['realized_pnl'] > 0 and max_per_contract > 0:
        capture_pct = round(outcome['pnl_per_contract'] / max_per_contract, 4)

    return {
        'outcome_type':              outcome['outcome_type'],
        'stock_price_at_expiration': outcome['stock_price_at_expiration'],
        'realized_pnl':              outcome['realized_pnl'],
        'pnl_per_contract':          outcome['pnl_per_contract'],
        'max_profit_per_contract':   max_per_contract,
        'capture_pct':               capture_pct,
        'outcome_filled':            True,
        'outcome_filled_at':         datetime.now(timezone.utc).isoformat(),
    }


def main():
    today_et = datetime.now(ZoneInfo("America/New_York")).date()

    rows = fetch_unfilled_rows()
    print(f"Found {len(rows)} unfilled ml_dataset row(s).")

    candidates, not_expired, bad_rows = [], 0, 0
    for r in rows:
        try:
            exp_date = date.fromisoformat(r['expiration'])
        except (TypeError, ValueError):
            print(f"  ! Skipping id={r.get('id')}: invalid expiration "
                  f"{r.get('expiration')!r}", file=sys.stderr)
            bad_rows += 1
            continue
        if exp_date < today_et:
            candidates.append((r, exp_date))
        else:
            not_expired += 1

    if not candidates:
        print(f"No expired unfilled rows to backfill "
              f"({not_expired} not yet expired), exiting cleanly.")
        return

    print(f"{len(candidates)} expired row(s) to process "
          f"({not_expired} not yet expired, left alone).")

    # ── Pre-fetch pass: one Massive call per unique (ticker, date) pair ──────
    # Many rows share a pair (every MU setup expiring the same Friday, winners
    # and runners-up alike), so ~hundreds of rows collapse to far fewer calls.
    unique_keys = sorted(
        {(r['ticker'], exp_date) for r, exp_date in candidates},
        key=lambda k: (k[1], k[0]),
    )
    print(f"\nFetching close prices for {len(unique_keys)} unique "
          f"(ticker, date) pair(s)...")
    for ticker, exp_date in unique_keys:
        fetch_close_price(ticker, exp_date)  # populates the shared price cache
        time.sleep(0.2)

    # ── Retry pass: re-attempt anything still cached as None ────────────────
    failed = [k for k, v in _bo._price_cache.items() if v is None]
    if failed:
        print(f"\nRetrying {len(failed)} failed fetch(es) with longer delays...")
        for tkr, date_str in failed:
            fetch_close_price(tkr, date.fromisoformat(date_str),
                              delays=(5, 10), use_cache=False)
            time.sleep(0.5)
    lookups_failed = sum(1 for v in _bo._price_cache.values() if v is None)

    # ── Process pass: every candidate reads from the cache ──────────────────
    print()
    filled = 0
    filled_best = 0
    filled_runner = 0
    skipped_no_price = 0
    skipped_update_failed = 0
    wins = 0
    total_pnl = 0.0
    by_type = {}

    for row, exp_date in candidates:
        ticker = row['ticker']
        stock_close = _bo._price_cache.get((ticker, exp_date.strftime("%Y-%m-%d")))
        if stock_close is None:
            print(f"  ! Skipping {ticker} {exp_date}: no stock price found "
                  f"(rate-limited or not yet historical) — left unfilled")
            skipped_no_price += 1
            continue

        update = build_update(row, stock_close)

        try:
            # The extra outcome_filled=false match makes a concurrent/duplicate
            # run a no-op on rows another pass already filled.
            supabase.table('ml_dataset').update(update) \
                .eq('id', row['id']).eq('outcome_filled', False).execute()
        except Exception as e:
            print(f"  ! Update failed for {ticker} {exp_date} id={row['id']}: {e}",
                  file=sys.stderr)
            skipped_update_failed += 1
            continue

        role = 'best' if row.get('is_best_in_sector') else 'runner-up'
        pnl_pc = update['pnl_per_contract']
        print(f"[ml-backfill] {row.get('sector', '?'):<22} {ticker:<5} {exp_date}  "
              f"S=${stock_close:>8.2f}  P&L=${pnl_pc:+9.2f}  "
              f"({update['outcome_type']}) [{role}]")

        filled += 1
        if row.get('is_best_in_sector'):
            filled_best += 1
        else:
            filled_runner += 1
        total_pnl += pnl_pc
        if pnl_pc > 0:
            wins += 1
        by_type[update['outcome_type']] = by_type.get(update['outcome_type'], 0) + 1

    # ── Summary ──────────────────────────────────────────────────────────────
    print(f"\n{'─' * 68}")
    print(f"Rows processed:        {len(candidates)}")
    print(f"Rows filled:           {filled}  "
          f"(best-in-sector: {filled_best}, runners-up: {filled_runner})")
    print(f"Skipped — no price:    {skipped_no_price}")
    print(f"Skipped — update err:  {skipped_update_failed}")
    if bad_rows:
        print(f"Skipped — bad row:     {bad_rows}")
    print(f"Distinct price lookups: {len(unique_keys)} "
          f"({lookups_failed} failed after retries)")

    if filled:
        win_rate = wins / filled * 100
        avg_pnl = total_pnl / filled
        print(f"\nWin rate: {win_rate:.1f}%  "
              f"Total P&L: ${total_pnl:+,.2f}  "
              f"Average per row: ${avg_pnl:+.2f}  (per-contract dollars)")
        print("\nBy outcome type:")
        order = ['expired_capped', 'expired_sweet_spot', 'expired_credit_only',
                 'expired_partial', 'expired_breakeven', 'expired_loss']
        for ot in order:
            if ot in by_type:
                print(f"  {ot:<22} {by_type[ot]:>4}")
        for ot in sorted(set(by_type) - set(order)):
            print(f"  {ot:<22} {by_type[ot]:>4}")

    remaining = count_unfilled()
    print(f"\nRows still unfilled: {remaining} "
          f"(not yet expired, or awaiting a price on a later run)")


if __name__ == '__main__':
    main()
