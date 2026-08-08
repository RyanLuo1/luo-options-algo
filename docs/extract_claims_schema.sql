-- Extraction claims manifest — fleet coordination for the B2 year-stream and
-- the daily catch-up cron (RANKER_SPEC Phase B2). Run once in the Supabase
-- SQL Editor.
--
-- WHY SUPABASE (not S3-object claims): the Massive flatfiles bucket is
-- read-only to us and we operate no S3 bucket of our own; every machine
-- already carries the service-role Supabase client, and Postgres gives real
-- atomicity (unique PK + conditional UPDATE) instead of S3's eventual-
-- consistency dance.
--
-- Semantics (scripts/extract_claims.py):
--   claim:    INSERT (date, worker, status='claimed') — a unique-violation
--             means someone else holds it; a conditional UPDATE takes over
--             claims whose heartbeat is older than the stale threshold
--             (crash-safe reclaim).
--   working:  the holder refreshes heartbeat_at periodically.
--   done:     status='done' after extract + validation PASS (terminal).
--   failed:   status='failed' + error note; reclaimable immediately.
create table if not exists extract_claims (
  date          date primary key,
  status        text not null check (status in ('claimed', 'done', 'failed')),
  worker        text not null,          -- hostname:pid
  claimed_at    timestamptz not null default now(),
  heartbeat_at  timestamptz not null default now(),
  finished_at   timestamptz,
  parquet_bytes bigint,
  note          text
);

alter table extract_claims enable row level security;
-- no public policies: service-role only, same posture as ml_dataset
