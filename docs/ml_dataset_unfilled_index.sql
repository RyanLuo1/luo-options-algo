-- Backfill performance index (2026-09-29) — run once in the Supabase SQL
-- Editor.
--
-- Why: the nightly ml-outcome backfill crashed on statement timeouts
-- (57014) at fetch_unfilled_rows() once the backtest2–5 corpora grew
-- ml_dataset to ~450k rows — there is no index serving
-- `outcome_filled = false AND expiration < today ORDER BY id`, so live
-- shadow labeling silently froze (stuck at 28 labeled rows, Sep 24–29).
--
-- A PARTIAL index over only the unfilled rows keeps it tiny (the filled
-- majority is excluded) and makes the nightly query instant forever.

create index if not exists idx_ml_dataset_unfilled
  on ml_dataset (expiration, id)
  where outcome_filled = false;
