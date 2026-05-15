-- ─────────────────────────────────────────────────────────────────────────────
-- Luo Capital — One-time migration: outcome_type relabel
--
-- The original outcome_type enum was assignment-based ('expired_max_profit',
-- 'expired_partial', …) which turned out to be misleading: it conflated the
-- credit-only zone (S ≤ K_A, no spread captured) with the capped zone
-- (S ≥ K_B, full spread + credit). The new enum is payoff-zone-based.
--
-- Order matters: existing rows still hold old labels, so we have to drop the
-- old CHECK, relabel the rows, and only then install the new CHECK — otherwise
-- the new constraint fails to validate against rows it doesn't recognize yet.
--
-- This script is idempotent — safe to run on any environment regardless of
-- whether the constraint currently exists or has been swapped already.
--
-- Apply once in the Supabase SQL Editor *after* you've created the schema
-- via docs/trade_outcomes_schema.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Drop the existing CHECK constraint (if any) ──────────────────────────
-- `if exists` lets this run cleanly on:
--   - first install (no constraint yet — no-op),
--   - re-run after a previous successful migration (drops the just-installed one),
--   - partially-applied state (drops whichever variant happens to be there).

alter table public.trade_outcomes
  drop constraint if exists trade_outcomes_outcome_type_check;

-- ── 2. Reclassify every existing row using the new logic ────────────────────
-- With the CHECK gone, this UPDATE can write the new label values onto rows
-- that still carry old ones (e.g. 'expired_max_profit') without rejection.
-- Order matches the Python classifier in scripts/backfill_outcomes.py so the
-- two paths produce identical labels on the same data:
--   breakeven  → loss  → credit_only  → sweet_spot  → capped  → partial(fallback)

update public.trade_outcomes o
set outcome_type = case
    when abs(o.realized_pnl) < 0.05                            then 'expired_breakeven'
    when o.realized_pnl < 0                                    then 'expired_loss'
    when o.stock_price_at_expiration <= t.leg_a_strike         then 'expired_credit_only'
    when o.stock_price_at_expiration  < t.leg_b_strike         then 'expired_sweet_spot'
    when o.stock_price_at_expiration >= t.leg_b_strike         then 'expired_capped'
    else 'expired_partial'
  end
from public.tradebook t
where o.tradebook_id = t.id;

-- ── 3. Install the new CHECK constraint ─────────────────────────────────────
-- Validates against every existing row at install time. Step 2 guaranteed
-- they all carry values from the new enum, so this succeeds. Re-runs hit
-- step 1's drop first, so we never try to add the same constraint twice.

alter table public.trade_outcomes
  add constraint trade_outcomes_outcome_type_check
  check (outcome_type in (
    'expired_credit_only',
    'expired_sweet_spot',
    'expired_capped',
    'expired_partial',
    'expired_breakeven',
    'expired_loss',
    'pending'
  ));
