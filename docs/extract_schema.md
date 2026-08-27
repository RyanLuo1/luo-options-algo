# Quote Extract Schema — `data/extracts/YYYY-MM-DD.parquet`

Produced by `scripts/extract_quotes.py` (RANKER_SPEC Phase B-extract). One
parquet file per trading day, **immutable once written** (the worker skips
existing dates; delete a file to force re-extraction). The matching raw
`day_aggs_v1` file is stored verbatim at
`data/extracts/day_aggs/YYYY-MM-DD.csv.gz` (per-contract daily OHLCV —
contract discovery + the historical volume≥20 filter for the replay).

Extracts are **data, not code** — `data/extracts/` is gitignored.

## Extraction parameters (spec open question #5 — resolved 2026-07-26)

- **Windows (ET, DST-correct per date):** `open` 09:30–10:05, `midday`
  12:45–13:00, `close` 15:00–15:35. The +5-min tails past the 10:00/15:30
  slots let the replay match the live cron's actual scan minutes. `midday` is
  frozen optionality — extracted, unused by the replay for now.
- **Universe:** `data/universe_extract.json` — the **$75B superset** (~169
  S&P 500 names), deliberately wider than the scan's $100B
  `data/universe.json` (118) so future point-in-time universe corrections are
  replay-side filters, not re-extractions. The replay applies the real >$100B
  logic itself.
- **Per contract per window:** the last 10 quote updates (full rows) +
  summary stats. **Per contract per day:** counters only.
- One-sided quotes (a side's price/size = 0) are kept in the last-10 rows and
  counted in `update_count`, but excluded from spread/mid stats. Eligibility
  is the replay's guards' decision — the extractor captures faithfully.

## Row identity

| column | type | meaning |
|---|---|---|
| `date` | str | trading date `YYYY-MM-DD` |
| `underlying` | str | OCC root, exact-parsed (MU ≠ MUR ≠ adjusted MU1) |
| `contract` | str | full OCC ticker, e.g. `O:MU260501C00460000` |
| `window` | str | `open` \| `midday` \| `close` \| `day` |

One row per (contract, window) that had ≥1 quote update; plus one
`window='day'` counters row per contract seen anywhere in the stream.

## Window rows (`window` ≠ `day`)

**Replay-critical fields** (what B-replay prices legs from):

| column | type | meaning |
|---|---|---|
| `q10_bid`, `q10_bid_size` | float/int | **the newest quote in the window** — bid side |
| `q10_ask`, `q10_ask_size` | float/int | — ask side |
| `q10_ts` | int ns | its SIP timestamp (quote age vs the slot) |
| `last_ts` | int ns | same instant as `q10_ts` (kept for symmetry with `first_ts`) |
| `two_sided_count` | int | >0 required by the liquidity guard's spirit |

The q-block is **right-aligned**: `q10` is always the newest update; when
only k<10 updates occurred, `q1..q(10−k)` are **0-sentinels** (`q*_ts == 0`
marks an absent entry — never null: a null anywhere would make pandas cast
the column to float64, which silently destroys the low bits of nanosecond
timestamps > 2^53; discovered via REST cross-check mismatches on 2026-07-27).
`q1..q9` (same seven fields each: `_bid`, `_bid_size`, `_bid_exch`, `_ask`,
`_ask_size`, `_ask_exch`, `_ts`) are the preceding updates, oldest first.

**Future-feature bank** (not consumed by the replay; captured because a
re-stream of the year is the alternative):

| column | type | meaning |
|---|---|---|
| `update_count` | int | all quote updates in the window (incl. one-sided) |
| `spread_min/max/mean` | float | over two-sided updates only; null if none |
| `mid_open/high/low/close` | float | OHLC of (bid+ask)/2, two-sided only |
| `last_bid_size`, `last_ask_size` | int | sizes on the final update |
| `first_ts` | int ns | first update in the window |
| `q1..q9_*` | — | quote-history features (spread stability, quote age) |
| the whole `midday` window | — | unused by replay; future features |

## Day rows (`window` = `day`)

Counters accumulated across the entire session stream (no quotes stored
outside windows) — future-feature bank:

| column | type | meaning |
|---|---|---|
| `update_count` | int | total quote updates for the contract all day |
| `first_ts`, `last_ts` | int ns | first/last quote timestamp of the day |

On day rows, float stat columns (`spread_*`, `mid_*`) are null; all int
columns (`two_sided_count`, sizes, the whole q-block) are 0-sentinels — same
int64-preservation rationale as the q-block padding.

## Flat-file structure note (discovered 2026-07-26)

`quotes_v1` day files are a **concatenation of internally-sorted partitions**,
NOT one global alphabetical pass — root spans are interleaved across
partitions (the first partition of 2026-07-24 runs A→BAC but is missing
AMAT/AMD/AMZN entirely; they appear later). Consequences baked into the
extractor: it never exits early, streams to physical EOF, and merges
per-contract state across partitions (a contract recurring later adds to the
same state; window q-deques stay in stream order). `day_aggs_v1` files, by
contrast, ARE globally sorted.

## Coverage caveats (2026-08-27 audit — authoritative record: docs/private/UNIVERSE_GAP_LEDGER.md)

- **The 2026-08 universe gap:** extracts banked with the 2026-08-07
  `universe_extract.json` (which silently dropped 12 S&P mega-caps — ADI,
  BLK, CRM, HD, JPM, LOW, MCD, MDT, MRK, MU, WDC, XOM) lack those names
  entirely. Fixed 2026-08-27 (rebuilt universe + superset guard in
  `extract_quotes.py` + loud-failure `build_universe.py`); re-stream scope
  is a completion-runbook decision (CLAUDE.md).
- **Share-class symbology:** universe files store yfinance-style tickers
  (`BRK-B`); OPRA roots strip punctuation (`BRKB`). The exact-root match
  therefore never captures such names — BRK-B is absent from every extract
  of both eras. Fix candidate (pending decision): a yfinance→OPRA root map
  in `load_universe_roots()`.
- **Adjusted classes are deliberately excluded** (`O:MU1...`-style roots
  parse to different roots and carry non-standard deliverables). On a
  corporate-action day the ENTIRE standard chain can be adjusted away:
  2025-10-30 has zero plain `HON` (all 144 contracts trade as `HON1`; the
  standard chain relists 10-31). Replay coverage accounting must treat such
  dates as name-holidays, not extraction bugs.
