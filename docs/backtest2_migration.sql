-- v2 replay source tags (RANKER_SPEC §5b) — run once in the Supabase SQL
-- Editor BEFORE the first `replay_scan.py --v2 --write`.
--
-- Adds backtest2_open / backtest2_close to the source CHECK constraints on
-- ml_dataset and sector_scan_runs. The slot-aware de-dup keys
-- (uniq_ml_dataset_observation, uniq_ssr_run) include source, so they
-- become v2-aware automatically — no index changes. v1 rows are untouched;
-- thresholds only ever change BETWEEN corpora, never within one.

alter table ml_dataset drop constraint if exists ml_dataset_source_check;
alter table ml_dataset add constraint ml_dataset_source_check
  check (source in ('live_open', 'live_close', 'backtest',
                    'backtest_open', 'backtest_close',
                    'backtest2_open', 'backtest2_close'));

alter table sector_scan_runs drop constraint if exists sector_scan_runs_source_check;
alter table sector_scan_runs add constraint sector_scan_runs_source_check
  check (source in ('live_open', 'live_close', 'backtest',
                    'backtest_open', 'backtest_close',
                    'backtest2_open', 'backtest2_close'));
