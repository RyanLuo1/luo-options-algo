-- Probability-gate experiment source tags (prespecified single run,
-- 2026-09-16) — run once in the Supabase SQL Editor BEFORE
-- `replay_scan.py --v2 --source-tag backtest5 --min-pp 0 --write`.
--
-- Adds backtest5_open / backtest5_close (income strategy, dual gate,
-- min_p_profit = 0). Same pattern as backtest2/3/4; earlier corpora
-- untouched.

alter table ml_dataset drop constraint if exists ml_dataset_source_check;
alter table ml_dataset add constraint ml_dataset_source_check
  check (source in ('live_open', 'live_close', 'backtest',
                    'backtest_open', 'backtest_close',
                    'backtest2_open', 'backtest2_close',
                    'backtest3_open', 'backtest3_close',
                    'backtest4_open', 'backtest4_close',
                    'backtest5_open', 'backtest5_close'));

alter table sector_scan_runs drop constraint if exists sector_scan_runs_source_check;
alter table sector_scan_runs add constraint sector_scan_runs_source_check
  check (source in ('live_open', 'live_close', 'backtest',
                    'backtest_open', 'backtest_close',
                    'backtest2_open', 'backtest2_close',
                    'backtest3_open', 'backtest3_close',
                    'backtest4_open', 'backtest4_close',
                    'backtest5_open', 'backtest5_close'));
