-- ─────────────────────────────────────────────────────────────────────────────
-- Luo Capital — Scan History Schema (V3 only)
--
-- Captures every V3 scan execution and every triplet produced, including ones
-- the user never saves to tradebook. This is the foundational dataset for
-- future ML work (e.g. predicting which triplets actually convert to profit).
--
-- V2 is intentionally not logged — it is a baseline ranker, not the
-- proprietary strategy.
--
-- Run in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- pgcrypto provides gen_random_uuid(); enable if not already on.
create extension if not exists pgcrypto;

-- ── Table: scan_runs ────────────────────────────────────────────────────────
-- One row per V3 scan execution.

create table if not exists public.scan_runs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  created_at          timestamptz not null default now(),

  -- Inputs
  tickers_requested   text[]  not null default '{}',  -- what the user typed (may be empty)
  tickers_used        text[]  not null default '{}',  -- actually scanned (after default fallback)
  tickers_skipped     text[]  not null default '{}',  -- couldn't get data for these
  weeks_min           int     not null,
  weeks_max           int     not null,
  min_premium         numeric not null,
  min_p_profit        numeric not null,

  -- Outputs
  total_evaluated     int     not null default 0,     -- raw count before filters
  total_passed        int     not null default 0,     -- triplets that survived filters

  -- Context
  market_open         boolean,
  elapsed_ms          int,
  error_message       text,                            -- null on success
  vix                 numeric,                         -- market context (best-effort)
  spy_price           numeric                          -- market context (best-effort)
);

-- ── Table: scan_results ─────────────────────────────────────────────────────
-- One row per V3 triplet, linked to scan_runs.

create table if not exists public.scan_results (
  id              uuid primary key default gen_random_uuid(),
  scan_id         uuid not null references public.scan_runs(id) on delete cascade,
  created_at      timestamptz not null default now(),

  rank            int     not null,
  ticker          text    not null,
  expiration      date    not null,
  week_num        int     not null,

  leg_a_strike    numeric not null,
  leg_a_premium   numeric not null,
  leg_a_delta     numeric not null,
  leg_b_strike    numeric not null,
  leg_b_premium   numeric not null,
  leg_b_delta     numeric not null,
  leg_c_strike    numeric not null,
  leg_c_premium   numeric not null,
  leg_c_delta     numeric not null,

  net_premium     numeric not null,
  spread_width    numeric not null,
  score           numeric not null,
  p_max_profit    numeric not null,
  fair_value      numeric,                              -- null when FV unavailable
  fv_available    boolean not null default false,

  was_saved       boolean not null default false        -- flipped server-side when saved to tradebook
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index if not exists scan_runs_user_created_idx
  on public.scan_runs (user_id, created_at desc);

create index if not exists scan_results_ticker_idx
  on public.scan_results (ticker);

create index if not exists scan_results_was_saved_idx
  on public.scan_results (was_saved);

-- (scan_results.scan_id index is created automatically by the FK constraint.)

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.scan_runs    enable row level security;
alter table public.scan_results enable row level security;

-- Users may SELECT only their own scan_runs.
drop policy if exists "scan_runs select own" on public.scan_runs;
create policy "scan_runs select own"
  on public.scan_runs
  for select
  using (auth.uid() = user_id);

-- Users may INSERT only their own scan_runs.
drop policy if exists "scan_runs insert own" on public.scan_runs;
create policy "scan_runs insert own"
  on public.scan_runs
  for insert
  with check (auth.uid() = user_id);

-- Users may SELECT only scan_results linked to their own scan_runs.
drop policy if exists "scan_results select own" on public.scan_results;
create policy "scan_results select own"
  on public.scan_results
  for select
  using (
    exists (
      select 1 from public.scan_runs r
      where r.id = scan_results.scan_id and r.user_id = auth.uid()
    )
  );

-- Users may INSERT scan_results only against their own scan_runs.
drop policy if exists "scan_results insert own" on public.scan_results;
create policy "scan_results insert own"
  on public.scan_results
  for insert
  with check (
    exists (
      select 1 from public.scan_runs r
      where r.id = scan_results.scan_id and r.user_id = auth.uid()
    )
  );

-- No UPDATE / DELETE policies — was_saved flips happen server-side via the
-- service role, and we treat scan history as write-once. Server-side
-- archival happens later, also via the service role.

-- ── Tradebook linkage columns ───────────────────────────────────────────────
-- Link saved trades back to the exact scan and triplet they came from.
-- Nullable because old tradebook rows have no scan provenance.

alter table public.tradebook
  add column if not exists scan_id   uuid references public.scan_runs(id),
  add column if not exists result_id uuid references public.scan_results(id);

create index if not exists tradebook_scan_id_idx   on public.tradebook (scan_id);
create index if not exists tradebook_result_id_idx on public.tradebook (result_id);
