-- Screener modes (2026-09-15). Run once in the Supabase SQL editor.
-- Existing rows are income by default. The server writes the column only for
-- non-income rows, so both inserts keep working whether or not this has run.
alter table scan_runs
  add column mode text not null default 'income'
  check (mode in ('income','upside'));

alter table tradebook
  add column mode text not null default 'income'
  check (mode in ('income','upside'));
