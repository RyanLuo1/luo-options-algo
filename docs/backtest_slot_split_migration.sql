-- backtest_slot_split_migration.sql
--
-- Splits the backtest source value by slot: 'backtest' → 'backtest_open' /
-- 'backtest_close', mirroring the live convention (live_open / live_close).
--
-- WHY: the de-dup keys are slot-blind for backtest rows. uniq_ssr_run is
-- (source, scan_date, sector) and uniq_ml_dataset_observation keys on source
-- the same way — for live rows the slot lives INSIDE source (live_open /
-- live_close), but both replay slots shared source='backtest', so a
-- both-slots replay's close pass deleted/replaced the open pass's rows
-- (write_picked's cleanup deletes on (source, scan_date, sector)). Once
-- source carries the slot, the existing keys become slot-aware exactly as
-- they already are for live. NO index/key changes are needed — this is a
-- CHECK-constraint change plus a code-side change (replay_scan.py now writes
-- backtest_open / backtest_close; deployed in the same commit as this file).
--
-- TRANSITION NOTE — plain 'backtest' is KEPT in the allowed set, for two
-- reasons: (1) a replay started on pre-split code may still be mid-run when
-- this migration is applied — its inserts must not start failing mid-write;
-- (2) dropping it costs nothing to defer. No code writes plain 'backtest'
-- after this commit, and the only rows that ever carried it (the 2026-07-28
-- machinery-exercise smoke of the stale week 07-20 → 07-24) are deleted as
-- part of this migration's rollout (step 2 below, done by the assistant via
-- the service role — not in this SQL — after the smoke run completes).
-- A future tightening migration can drop 'backtest' from both CHECKs once
-- no rows carry it:  select count(*) from ml_dataset where source='backtest';
--
-- ROLLOUT SEQUENCE (this file is step 1):
--   1. Run this SQL in the Supabase SQL Editor (safe while a pre-split
--      replay is still running — old and new values are both legal).
--   2. Delete legacy plain-'backtest' rows (ml_dataset + sector_scan_runs).
--   3. Re-run a two-slot replay of one stale day and verify both slots'
--      rows are retained and per-slot re-runs replace correctly.
--
-- Idempotent: re-running drops and re-adds the same constraints.

-- ── 1. Drop the existing CHECK constraints on source ─────────────────────────
-- The DDL declared them inline/unnamed, so find them by definition rather
-- than guessing Postgres's auto-generated names.
do $$
declare c record;
begin
  for c in
    select conname, conrelid::regclass::text as tbl
    from pg_constraint
    where contype = 'c'
      and conrelid in ('ml_dataset'::regclass, 'sector_scan_runs'::regclass)
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

-- ── 2. Re-add with the slot-split value set ──────────────────────────────────
alter table ml_dataset
  add constraint ml_dataset_source_check
  check (source in ('live_open', 'live_close',
                    'backtest_open', 'backtest_close',
                    'backtest'));          -- legacy, transitional — see header

alter table sector_scan_runs
  add constraint sector_scan_runs_source_check
  check (source in ('live_open', 'live_close',
                    'backtest_open', 'backtest_close',
                    'backtest'));          -- legacy, transitional — see header

-- ── 3. Verify ────────────────────────────────────────────────────────────────
select conrelid::regclass as "table", conname, pg_get_constraintdef(oid)
from pg_constraint
where contype = 'c'
  and conrelid in ('ml_dataset'::regclass, 'sector_scan_runs'::regclass)
  and pg_get_constraintdef(oid) ilike '%source%';
