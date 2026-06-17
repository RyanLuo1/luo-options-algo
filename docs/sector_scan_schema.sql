-- ============================================================================
-- sector_scan_runs — one record per sector, per scan slot, per day
-- ============================================================================
-- Purpose: the COMPLETE record of what happened in every sector on every scan,
-- INCLUDING the sectors that produced no trade and the ones that errored.
--
-- Mirrors the existing scan_runs / scan_results split:
--   scan_runs     : metadata for EVERY scan (even zero-result ones)
--   scan_results  : the actual setups
-- Here:
--   sector_scan_runs : metadata for every sector scan (qualified / empty / failed)
--   ml_dataset       : the actual best-pick setups (only when one exists)
--
-- Why this table exists — it answers questions ml_dataset alone cannot:
--   * "Was this sector scanned today, or skipped?"        -> a row exists or not
--   * "Did it find nothing, or did the scan crash?"       -> status column
--   * "How thin were conditions in Energy this week?"     -> evaluated/qualified counts
-- Silently skipping empty sectors would erase all of this. Always write a row.
-- ============================================================================

create table if not exists sector_scan_runs (

    -- ---- identity --------------------------------------------------------
    id                  uuid primary key default gen_random_uuid(),
    created_at          timestamptz not null default now(),

    source              text not null
        check (source in ('backtest', 'live_open', 'live_close')),
    scan_date           date not null,
    scan_timestamp      timestamptz not null,
    sector              text not null,

    -- ---- what happened ---------------------------------------------------
    status              text not null
        check (status in (
            'picked',        -- a best setup was found and logged to ml_dataset
            'none_qualified',-- scan ran fine, but 0 setups cleared the filters
            'no_tickers',    -- the sector had no eligible tickers to scan (e.g. >$100B filter empty)
            'error'          -- the scan failed (Massive timeout, exception, etc.)
        )),

    tickers_scanned     integer not null default 0,   -- how many names in this sector were attempted
    tickers_skipped     integer not null default 0,   -- names that errored/timed out individually
    contracts_evaluated integer not null default 0,   -- total option contracts considered
    setups_qualified    integer not null default 0,   -- triplets that passed all filters

    -- ---- the pick (only when status = 'picked') --------------------------
    best_ticker         text,                          -- the winning ticker
    best_score          numeric,                       -- its score (for quick glance/ranking)
    ml_dataset_id       uuid references ml_dataset(id),-- link to the full logged setup
    -- ^ the ONE place these two tables connect: a 'picked' run points at the
    --   ml_dataset row it produced. ml_dataset itself stays free of back-refs.

    -- ---- diagnostics -----------------------------------------------------
    elapsed_ms          integer,                       -- how long this sector's scan took
    error_message       text,                          -- populated when status = 'error'

    -- ---- input snapshot (what filters were in effect) --------------------
    min_net_premium     numeric,
    min_p_profit        numeric,
    weeks_range         text,                          -- e.g. 'W1-W12'

    notes               text
);

-- ---- indexes -------------------------------------------------------------
create index if not exists idx_ssr_scan_date on sector_scan_runs (scan_date);
create index if not exists idx_ssr_sector    on sector_scan_runs (sector);
create index if not exists idx_ssr_status    on sector_scan_runs (status);
create index if not exists idx_ssr_source    on sector_scan_runs (source);

-- ---- de-dup guard --------------------------------------------------------
-- Exactly one record per (source, date, slot-via-source, sector). Since
-- live_open / live_close are encoded in `source`, this enforces one row per
-- sector per slot per day. Re-running won't duplicate (upsert on this key).
create unique index if not exists uniq_ssr_run
    on sector_scan_runs (source, scan_date, sector);

-- ---- RLS -----------------------------------------------------------------
-- System-generated research/ops data, not user-owned. Lock to service role.
alter table sector_scan_runs enable row level security;
-- (No public policies => only the service role key writes/reads.)

-- ============================================================================
-- HOW THE TWO TABLES WORK TOGETHER (per sector, per slot, per day)
-- ============================================================================
--   status = 'picked'         -> 1 sector_scan_runs row  +  1 ml_dataset row
--                                (run.ml_dataset_id links them)
--   status = 'none_qualified' -> 1 sector_scan_runs row  +  0 ml_dataset rows
--   status = 'no_tickers'     -> 1 sector_scan_runs row  +  0 ml_dataset rows
--   status = 'error'          -> 1 sector_scan_runs row  +  0 ml_dataset rows
--                                (error_message explains what broke)
--
-- So a full day = up to 20 sectors x 2 slots = up to 40 sector_scan_runs rows,
-- of which the 'picked' ones each have a matching ml_dataset setup. Your
-- end-of-day report reads sector_scan_runs for the date and shows every sector
-- with either its best pick (joined from ml_dataset) or its status.
-- ============================================================================
--
-- NOTE: this references ml_dataset(id), so create ml_dataset FIRST, then this.
-- ============================================================================