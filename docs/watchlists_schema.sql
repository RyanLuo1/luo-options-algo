-- docs/watchlists_schema.sql
-- Per-user named watchlists for the screener's scan-tickers input (@name syntax).
--
-- Mirrors the `tradebook` security model exactly — per-user rows, RLS scoped to
-- the owner via `auth.uid() = user_id`. The one addition vs. tradebook is an
-- explicit `with check` clause: tradebook rows are inserted server-side with the
-- service-role key (which bypasses RLS), whereas watchlists are created/edited
-- DIRECTLY from the browser supabase-js client, so the INSERT/UPDATE path must
-- be RLS-checked. (`for all ... using` already reuses `using` as the check, but
-- we state it explicitly for clarity.)
--
-- Run once in the Supabase SQL Editor. Idempotent.

create extension if not exists pgcrypto;

create table if not exists watchlists (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users,   -- owner (same as tradebook)
    name        text not null,                         -- stored lowercase, no spaces, no leading '@'
    tickers     text[] not null default '{}',          -- list of symbols (matches scan_runs.tickers_* arrays)
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    -- A user can't have two watchlists with the same name. Names are stored
    -- lowercase by the app, so this also enforces case-insensitive uniqueness
    -- (@Semis and @semis are the same watchlist).
    unique (user_id, name)
);

alter table watchlists enable row level security;

-- Same policy shape as tradebook ("Users can only access their own trades"),
-- with an explicit with-check for the client-side insert/update path.
create policy "Users can only access their own watchlists" on watchlists
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
