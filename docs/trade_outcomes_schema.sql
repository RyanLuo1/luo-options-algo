-- ─────────────────────────────────────────────────────────────────────────────
-- Luo Capital — Trade Outcomes Schema
--
-- One row per tradebook entry whose expiration date has passed, with the
-- realized P&L computed from the closing stock price on the expiration date
-- and the V3 call-spread-risk-reversal payoff formulas.
--
-- This is the foundational labeled dataset for future ML work — every saved
-- trade gets an outcome once its expiration passes, computed deterministically.
--
-- Populated by `scripts/backfill_outcomes.py` (idempotent — re-runs only
-- touch tradebook rows that don't already have an outcome).
--
-- Run in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ── Table: trade_outcomes ───────────────────────────────────────────────────

create table if not exists public.trade_outcomes (
  id            uuid primary key default gen_random_uuid(),
  tradebook_id  uuid not null unique references public.tradebook(id) on delete cascade,
  user_id       uuid not null         references auth.users(id)     on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Outcome classification — payoff-zone-based. See scripts/backfill_outcomes.py
  -- for the rules. Labels reflect *where the stock landed* relative to the four
  -- payoff zones (K_C < K_A < K_B), not which legs got assigned, because
  -- assignment alone is misleading — the capped zone above K_B assigns the
  -- short call but is also where absolute max profit is realized.
  --
  --   expired_capped       — S >= K_B, P&L > 0 (max profit; short call assigned)
  --   expired_sweet_spot   — K_A < S < K_B, P&L > 0 (long call ITM, no assignments)
  --   expired_credit_only  — S <= K_A, P&L > 0 (no spread captured, kept the credit)
  --   expired_partial      — defensive fallback for any unclassified positive P&L
  --   expired_breakeven    — |P&L| < $0.05
  --   expired_loss         — P&L < 0
  --   pending              — reserved for future mid-life / early-close logic
  outcome_type  text not null check (outcome_type in (
                   'expired_credit_only',
                   'expired_sweet_spot',
                   'expired_capped',
                   'expired_partial',
                   'expired_breakeven',
                   'expired_loss',
                   'pending'
                 )),

  -- Inputs to the P&L calculation
  stock_price_at_expiration numeric not null,
  leg_a_value      numeric not null,  -- max(0, S - leg_a_strike) — long call payoff
  leg_b_liability  numeric not null,  -- max(0, S - leg_b_strike) — owed on short call
  leg_c_liability  numeric not null,  -- max(0, leg_c_strike - S) — owed on short put

  -- Outputs
  realized_pnl      numeric not null, -- net_premium + leg_a_value − leg_b_liability − leg_c_liability
  pnl_per_contract  numeric not null, -- realized_pnl * 100 (one contract = 100 shares)

  calculated_at timestamptz not null default now(),
  notes         text                  -- e.g. 'auto-backfilled', 'manually edited'
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index if not exists trade_outcomes_user_created_idx
  on public.trade_outcomes (user_id, created_at desc);

create index if not exists trade_outcomes_outcome_type_idx
  on public.trade_outcomes (outcome_type);

-- (trade_outcomes.tradebook_id has a unique constraint, which creates an
--  index automatically — no separate index needed.)

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.trade_outcomes enable row level security;

-- Users may SELECT only their own outcomes. Match on the row's user_id
-- (faster than joining tradebook on every read, and the column is denormalized
-- specifically to support this).
drop policy if exists "trade_outcomes select own" on public.trade_outcomes;
create policy "trade_outcomes select own"
  on public.trade_outcomes
  for select
  using (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policies for users — writes happen server-side
-- via the service role (backfill script, or future endpoints). Recomputing or
-- correcting outcomes must go through the service role too.
