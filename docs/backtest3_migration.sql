-- Universe-expansion replay source tags (prespecified single run,
-- 2026-09-12) — run once in the Supabase SQL Editor BEFORE
-- `replay_scan.py --v2 --source-tag backtest3 --write`.
--
-- Adds backtest3_open / backtest3_close to the source CHECK constraints.
-- Same pattern as backtest2: de-dup keys include source, so they become
-- v3-aware automatically; earlier corpora untouched.

alter table ml_dataset drop constraint if exists ml_dataset_source_check;
alter table ml_dataset add constraint ml_dataset_source_check
  check (source in ('live_open', 'live_close', 'backtest',
                    'backtest_open', 'backtest_close',
                    'backtest2_open', 'backtest2_close',
                    'backtest3_open', 'backtest3_close'));

alter table sector_scan_runs drop constraint if exists sector_scan_runs_source_check;
alter table sector_scan_runs add constraint sector_scan_runs_source_check
  check (source in ('live_open', 'live_close', 'backtest',
                    'backtest_open', 'backtest_close',
                    'backtest2_open', 'backtest2_close',
                    'backtest3_open', 'backtest3_close'));
