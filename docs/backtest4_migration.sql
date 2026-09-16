-- Upside-variant replay source tags (prespecified single run, 2026-09-15)
-- — run once in the Supabase SQL Editor BEFORE
-- `replay_scan.py --variant upside --write`.
--
-- Adds backtest4_open / backtest4_close to the source CHECK constraints.
-- Same pattern as backtest2/3; earlier corpora untouched.

alter table ml_dataset drop constraint if exists ml_dataset_source_check;
alter table ml_dataset add constraint ml_dataset_source_check
  check (source in ('live_open', 'live_close', 'backtest',
                    'backtest_open', 'backtest_close',
                    'backtest2_open', 'backtest2_close',
                    'backtest3_open', 'backtest3_close',
                    'backtest4_open', 'backtest4_close'));

alter table sector_scan_runs drop constraint if exists sector_scan_runs_source_check;
alter table sector_scan_runs add constraint sector_scan_runs_source_check
  check (source in ('live_open', 'live_close', 'backtest',
                    'backtest_open', 'backtest_close',
                    'backtest2_open', 'backtest2_close',
                    'backtest3_open', 'backtest3_close',
                    'backtest4_open', 'backtest4_close'));
