# Call Spread Risk Reversal — Options Algorithm Project

## Overview
This project builds an options screening algorithm that identifies the best risk/reward **call spread risk reversal** opportunities across a watchlist of stocks. The system pulls options-chain data, constructs a three-leg structure per ticker/expiration, scores each candidate, ranks them, and signals which trades meet our credit and probability criteria.

The platform is **single-strategy**: every scan runs the Call Spread Risk Reversal screener. It is delivered through a web UI (Flask + React) for interactive scanning, with the same screener also runnable as a standalone Python CLI (`screener.py`).

> **History:** Earlier baselines V1 (% strike-distance ranker) and V2 (delta-adjusted single-leg ranker) have been removed (see Changelog). The proprietary risk reversal strategy is now the sole algorithm.

**Learned Ranker Roadmap** — `docs/RANKER_SPEC.md` (Draft v2) specifies the ML re-ranker project in phases A–E: (A) Black-Scholes IV/delta module, (B) flat-file backtester (extract + replay), (C) descriptive analytics, (D) LightGBM ranker, (E) shadow mode. **Phase A complete (gate passed 2026-07-26 — `lib/bs.py`). B1a extraction worker built (`scripts/extract_quotes.py`); overlap re-extraction with the fixed extractor in progress. B1b replay module built (`scripts/replay_scan.py`, dry-run verified) — its 5-day smoke run and the replay-vs-live agreement gate are PENDING: the smoke waits on green extract verdicts, the gate waits on the clean week (07-27→07-31; runnable once Friday's flat file publishes Saturday ~11 AM ET). B2 year-scale stream NOT started.** Each phase has an exit gate; read the spec before touching anything ranker-related.

---

## Data Provider Responsibilities

The project intentionally uses **two** data providers with a clear division of responsibility. Understanding this split is critical when touching anything that fetches stock prices, options chains, or chart data.

### Massive (Options Advanced plan, $199/month) — options data + historical stocks

> **Upgraded 2026-07** from Options Starter ($30/mo). The Advanced plan adds **real-time options data** (the 15-min delay is gone), **quotes** (`last_quote`: bid, ask, sizes, midpoint, timestamp), and **5+ years of history**. All option pricing now comes from live bid/ask quotes — see "Pricing convention" under The Strategy.

- All option chains: strikes, **live bid/ask quotes**, delta, IV, volume, open interest
- Pre-calculated Greeks for every contract (no need to compute Black-Scholes ourselves)
- Historical stock aggregates: daily and hourly bars from **yesterday and earlier**
- Technical indicators (`get_rsi`) on historical timespans
- This is why scans and most chart timeframes (5D, 1M, 3M, 6M, 1Y) work — they all rely on data the Options plan includes

### yfinance (free) — fills the gap Massive's Options plan doesn't cover

- **Today's current stock price** (intraday during market hours, today's close after hours)
- **Today's intraday bars** (the Massive Options plan returns `NOT_AUTHORIZED` for any aggregate dated today — see below)
- **Indices**: the VIX (yfinance symbol `^VIX`) and any other index data the Options plan blocks
- **Market-context inputs for scan logging**: SPY today's close and VIX today's close, logged into `scan_runs.spy_price` and `scan_runs.vix` so we can correlate scan output with market regime later (`server/app.py` → `_get_market_context()`)
- **Fundamentals**: earnings dates (via `event_filter.py`). (EPS / P/E ratios / `targetMeanPrice` were used by the removed fair-value feature — see Changelog)
- **Stock price input**: the per-ticker price fed to `scan_ticker()` comes from `yf.Ticker(ticker).history(period="1d")["Close"].iloc[-1]`

### Why the split exists

Massive sells stocks data and options data as **separate** subscriptions. The Options Advanced plan ($199/month) grants:

- ✅ Today's options data — **real-time**, including live `last_quote` bid/ask on every contract (verified: quote timestamps run to the 16:00:00 ET close, `timeframe='REAL-TIME'`)
- ✅ Historical stock data (yesterday and back), now 5+ years deep
- ❌ Today's stock data — any aggregate dated today, **even after market close** (requires a separate Stocks plan). The `underlying_asset` block inside option snapshots still reports `timeframe='DELAYED'` — the stock side remains outside the plan
- ❌ Indices data of any kind — VIX, SPX, etc. (the `I:` ticker prefix returns `NOT_AUTHORIZED`)

yfinance scrapes Yahoo Finance's public quotes and fills these gaps for free. Treat it as a narrow-purpose fallback for **today's stock data and indices** — everything else uses Massive. yfinance has no SLA, no rate-limit guarantees, and can break when Yahoo changes their HTML; that's acceptable for the data it covers (current price + a few day bars + VIX) but would be a poor fit for the bulk options data Massive serves.

### Practical implications when editing code

- If you add a new endpoint that needs **today's** stock price, bars, or any index value (VIX, SPX, etc.), call yfinance, not Massive
- If you add a new endpoint that needs **historical** bars or any options data, call Massive
- When yfinance is the primary path, always have a graceful "yfinance failed → return None" branch and let the caller decide on a fallback. Never let a yfinance failure 500 the endpoint
- The `/api/chart` endpoint is the canonical example: 1D bars and the header price (current/prev/change_pct) come from yfinance; 5D+ bars and RSI come from Massive; Massive's last bar is the fallback for header price when yfinance is down
- `_get_market_context()` is the canonical indices example: SPY and VIX both come from yfinance, cached 60s. There is no Massive fallback — Massive can't access either field on the Options plan, so a yfinance failure simply logs `None` into `scan_runs.spy_price` / `scan_runs.vix`

---

## Watchlist (Default 10 Stocks)
$GEV, $PLTR, $APP, $AVGO, $META, $MU, $NVDA, $TSLA, $AMD, $TSM

The ticker universe is fully customizable — the web UI accepts manual input (bare tickers or an `@watchlist`). **Empty input in the web UI no longer scans** (it shows a hint, see Named Watchlists); the default 10-stock list above is now created as a normal named watchlist and referenced with `@`. (The `screener.py` CLI and `/api/run` still fall back to this default list when no tickers are passed — backend behavior is unchanged.)

---

## The Strategy — Call Spread Risk Reversal

For each ticker we evaluate weekly expirations (default weeks 1–12) and attempt to build a **three-leg** structure designed to collect a net credit while keeping defined directional exposure:

- **Leg A — Buy ATM call** (delta 0.40–0.60): pay premium
- **Leg B — Sell OTM call** (delta 0.20–0.40, strike > Leg A; candidates nearest current spot are tried first): collect premium
- **Leg C — Sell OTM put** (delta 0.15–0.30, strike < current price): collect premium

**Goal:** `Net Premium = (Leg B + Leg C) − Leg A ≥ min_premium` (default $5.00, credit only).

### Pricing convention — conservative / transactable (2026-07)

Leg premiums come from the **live quote**, priced on the side of the book we'd actually transact on:

- **Legs we SELL** (short call B, short put C): priced at the **bid** — what we'd actually receive
- **Leg we BUY** (long call A): priced at the **ask** — what we'd actually pay

So `net_premium = B_bid + C_bid − A_ask` is the credit we could actually collect. Scores are structurally lower than under the old last-trade pricing — that's correct, not a regression. **History:** premiums used to come from `day.close` (last trade), which can be hours stale; a diagnostic found it violated call-price monotonicity on ~36% of adjacent MU strike pairs (higher strike priced above lower — phantom credits up to $249), which is what inflated pre-migration scores. Under bid/ask pricing those violations are zero.

### Filters (per leg / per triplet)
- IV ≤ 0.01 → excluded (placeholder values from a closed market)
- **Liquidity guard:** no live two-sided quote (`bid > 0` and `ask > 0`, `ask ≥ bid`) → excluded — no quote = not tradeable
- **Spread guard:** `(ask − bid) / mid > MAX_SPREAD_PCT` (default **0.15**, i.e. 15% of the quote midpoint; constant in `screener.py`) → excluded — a quote that wide makes the price meaningless. Chosen from a survey of MU: delta-eligible legs run median 4–7% / p90 6–12% of mid, all ≤ 15%, so liquid names lose nothing while illiquid chains (e.g. GEV, APP) are correctly cut
- Volume < 20 → excluded. (Now partly redundant: its original job — proxying for a fresh last-trade price — is handled by the quote guards. It still excludes quoted-but-untraded contracts, e.g. many far-week Leg B candidates with fine two-sided quotes. Kept deliberately; revisit if far-week coverage feels thin)
- Delta must fall within each leg's specified range
- **Monotonicity sanity check (belt-and-suspenders):** any pairing where `leg_b_prem ≥ leg_a_prem` (higher-strike call priced at or above lower-strike call) is rejected and logged to stderr. With B at bid and A at ask this should never fire — a hit means a crossed/degenerate quote
- Net premium < `min_premium` → triplet skipped
- P(max profit) `= (1 − Leg B delta) × (1 − Leg C delta) < min_p_profit` (default 0.50) → triplet skipped

### Scoring & ranking
- `score = net_premium / spread_width`, where `spread_width = Leg B strike − Leg A strike`
- All passing triplets across all tickers/expirations are ranked by `score` descending; the top entries are the trade signals
- Signal output per triplet: rank, ticker, expiration, week, the three leg strikes/premiums/deltas, net premium, spread width, score, P(max profit), plus earnings/macro event flags

### Fair value — removed (2026-07)

There used to be a "fair value" feature (a `forwardEps × forwardPE` → `trailingEps × trailingPE` → `targetMeanPrice` fallback chain from yfinance) that "targeted" Leg B near fair value. **It was a no-op**: Yahoo derives `forwardPE` as `price ÷ forwardEps`, so `forwardEps × forwardPE` algebraically reconstructs the current spot price — fair value always equaled spot to the penny (verified across the whole watchlist). Leg B "fair-value targeting" was therefore always spot-relative targeting, and — since the scan evaluates *every* Leg B candidate anyway — the sort only affected iteration order, never which setups were produced. The feature was removed to make the code honest: Leg B candidates now sort by proximity to spot explicitly, and no fair value is computed, returned, or displayed. Removal was verified behavior-neutral (identical setups on identical chain data). See the Changelog entry for what happened to the DB columns.

See the [`screener.py`](#screenerpy) section for the full implementation.

---

## File Structure

### `options_screener.py`
Shared utilities module — holds the small set of helpers the screener depends on. (After the V2 removal it no longer contains any ranking/matrix logic.)
- `TICKERS` — the default watchlist; imported by `server/app.py` and `event_filter.py`
- `massive_client` — module-level Massive `RESTClient` initialized from `MASSIVE_API_KEY` env var; imported by `server/app.py` and `screener.py` (the single client for the whole project)
- `get_next_fridays(n)` — finds the next N Friday expiration targets; used by `screener.py` and `server/app.py`
- `find_closest_strike(strikes, target)` — snaps a target price to the nearest available chain strike

### `lib/bs.py`
Black-Scholes IV solver + delta for the learned-ranker backtest (`docs/RANKER_SPEC.md` Phase A). The backtester can't use Massive Greeks (not served historically), so it recomputes delta from historical quote mids via this module. Stdlib-only (no numpy/scipy).
- `implied_vol(option_type, price, spot, strike, dte_years, r=None)` — solves BS IV from a price (feed it the quote mid). Newton with guaranteed-convergence bisection fallback (price is monotone in vol, bracket [1e-4, 5.0]). **Returns `None` whenever the solve is ill-posed** — price at/below intrinsic, above the no-arb upper bound, non-positive inputs, expired — never a fabricated number.
- `delta(option_type, spot, strike, dte_years, r, iv)` — signed BS delta (calls +, puts −); the screener convention is `abs()`.
- **V1 approximations (documented in the module docstring):** constant `RISK_FREE_RATE = 0.045` (no term structure); European exercise with **no dividend adjustment**.
- Tests: `python3 -m unittest tests.test_bs` (parity, known values, IV round-trip grid, edge cases).
- **Validation status: Phase A gate PASSED 2026-07-26** — 907 contracts across MU/AAPL/JPM/XOM/KO in/near the leg delta windows, quote-guard-filtered, Friday-close quotes vs same-moment Massive snapshot Greeks: |Δ_ours − Δ_massive| median **0.0021**, p95 **0.0201**, max 0.057 (bar: ≤ 0.02 / ≤ 0.05). Residual error concentrates exactly where the no-dividend approximation predicts: dividend payers (KO, JPM) at long DTE near-ATM (calls overstated, put |Δ| understated). Non-payer MU: median 0.0018, max 0.016. A dividend adjustment is the known fix if the bar ever tightens.

### `event_filter.py`
- Fetches and caches earnings dates and macro events for use in the ranked output
- `fetch_earnings_dates()` — uses `yf.Ticker(ticker).calendar` to get the next earnings date for each ticker
- `fetch_fomc_dates(weeks=4)` — scrapes the Federal Reserve website for upcoming FOMC decision dates within the next N weeks
- `fetch_bls_dates(event_name, url, weeks=4)` — scrapes the BLS website for upcoming CPI, PPI, and NFP release dates within the next N weeks
- `load_events(weeks=4)` — fetches all earnings and macro data and stores in module-level cache; re-fetches automatically when called with a different `weeks` value than the previous call
- `get_event_flags(ticker, expiration_date)` — returns a string like `EARNINGS 4/23`, `FOMC 4/22`, or `CLEAR`
- ForexFactory blocks scraping (403); FOMC sourced from federalreserve.gov, CPI/PPI/NFP from bls.gov

### `server/app.py`
- Flask API server; run with `python3 server/app.py` from the project root
- Serves the built React app from `web/dist` (single server for API + frontend)
- `static_folder=None` — Flask's built-in static serving is disabled; all file serving goes through the catch-all route
- `app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0` — disables Flask's file cache so rebuilds are picked up immediately
- `index.html` is served with explicit `no-store, no-cache` headers; JS/CSS assets (content-hashed by Vite) are served without special headers
- **Routes:**
  - `GET /api/status` — fast health check; returns market open/closed, last run time
  - `GET /api/events` — returns cached macro events (FOMC, CPI, PPI, NFP, earnings)
  - `POST /api/run` — runs a Call Spread Risk Reversal scan and returns ranked triplets (scans are logged to `scan_runs`/`scan_results` — see Scan History below). This is the sole scan endpoint.
  - `POST /api/tradebook/save` — server-side tradebook insert; attributes user_id from JWT, links to source scan, flips `was_saved=true` on `scan_results`
  - `GET /api/chain` — returns a filtered options chain for a ticker/expiration/side with live `bid`/`ask`/`mid` quotes (same liquidity guards as the scanner; see below)
- `/api/run` request body (all optional):
  - `tickers`: list of strings — leading `$` is stripped automatically
  - `weeks_min`: integer 1–12; defaults to 1; must be ≤ `weeks_max`
  - `weeks_max`: integer 1–12; defaults to 12
  - `min_premium`: float ≥ 0; minimum net credit in dollars; defaults to 5.00
  - `min_p_profit`: float 0–1; minimum P(max profit); defaults to 0.50
- `/api/run` response includes: `ranked`, `by_ticker`, `macro_events`, `total_evaluated`, `tickers_used`, `tickers_skipped`, `tickers_with_results`, `market_open`, `run_at`, `weeks_min_used`, `weeks_max_used`, `min_premium_used`, `min_p_profit_used`, `elapsed_ms`, `scan_id` (uuid; null if logging failed or no auth), and each `ranked[i]` entry carries a `result_id` (uuid; null on logging failure) plus `underlying_price`
- **`underlying_price`** — the live yfinance current price used for that ticker's scan (`price` fed to `scan_ticker()`), attached to every `ranked` entry and therefore to each `by_ticker[i].best`. Threaded through from the price already fetched per ticker during the scan — **no new API calls**. Added to the response copies only; the logged `ranked` list and `scan_results` rows are unaffected. (Was used by the per-ticker overview cards' payoff-zone "now" marker; that strip has since been removed from the UI — see below — but the field remains for any future consumer.)
- **`by_ticker`** / **`tickers_with_results`** — a per-ticker grouping of the results. It is **purely a reorganization** of the flat `ranked` list (same already-scored/ranked triplets — no recomputation): one entry per ticker that produced ≥1 qualifying triplet, each `{ ticker, best, count }` where `best` is that ticker's single highest-score triplet object (same shape as a `ranked` entry, including its `result_id`) and `count` is how many qualifying triplets the ticker produced. Ordered by `best.score` descending. `tickers_with_results` is `len(by_ticker)`. **No longer consumed by the UI** — these powered the per-ticker overview card strip, which was removed (the screener now drives selection purely from the ranked-table rows). The fields are still returned by `/api/run` (cheap, may feed future features); the flat `ranked` list remains the source for the detail table.
- `/api/chain` query params: `ticker` (str), `expiration` (YYYY-MM-DD), `side` ('call' or 'put')
  - Fetches chain via Massive `list_snapshot_options_chain`; delta and IV are pre-calculated by Massive
  - Filters to 0.05 ≤ delta ≤ 0.85, IV > 0.01, **and the same quote guards the scanner applies** (live two-sided quote; spread ≤ `MAX_SPREAD_PCT` of mid, imported from `screener.py`) — so the editor shows the same tradeable universe the scan drew from
  - Returns JSON array sorted by strike ascending; each entry: `strike`, `bid`, `ask`, `mid`, `delta`, `volume`, `oi`, `iv`. There is **no `premium` field** anymore — the frontend picks the transactable side per leg (buy → `ask`, sell → `bid`; see TradePage)

### `/api/chart` endpoint (added in `server/app.py`)

> **Status (2026-06):** the screener UI **no longer calls this endpoint** — the detail-zone chart was replaced by the TradingView Advanced Chart embed (`web/src/components/TradingViewChart.jsx`), which fetches its own data from TradingView. The old Recharts chart (`StockChart.jsx`) and its `useChartData.js` hook were deleted from the frontend. The endpoint (and its cache) is deliberately **left intact** in case it's needed elsewhere or later; everything below describes its still-working behavior.

`GET /api/chart?ticker=MU&timeframe=1M` — returns OHLCV bars + RSI series for the stock chart in the screener.

**Bar source depends on the timeframe** (see `Data Provider Responsibilities` above for the rationale):

| Timeframe | Bar source       | Notes                                              |
|-----------|------------------|----------------------------------------------------|
| `1D`      | **yfinance**     | `period='5d' interval='1h'`, filtered to latest ET date; Massive fallback if yfinance fails |
| `5D`      | Massive `list_aggs` | 1-hour bars over a 7-day window |
| `1M`      | Massive `list_aggs` | 1-day bars over 35 days |
| `3M`      | Massive `list_aggs` | 1-day bars over 95 days |
| `6M`      | Massive `list_aggs` | 1-day bars over 190 days |
| `1Y`      | Massive `list_aggs` | 1-day bars over 370 days |

**Why 1D uses yfinance** — Massive's Options Advanced plan ($199/mo) returns `NOT_AUTHORIZED` for any stock aggregate dated today, regardless of market state (today's stock data is excluded from the Options plan family at every tier — it requires a separate Stocks plan). Without yfinance, 1D would always show *yesterday's* bars even mid-session. yfinance fills exactly that gap. The Massive 1D path remains in the code as a fallback for the rare case yfinance also fails (unknown ticker, Yahoo outage); it returns the most recent **non-today** session by bucketing a 7-day hourly window by ET date and picking the max, same as before.

**5D still uses Massive 1-hour bars** — that timeframe is bars from yesterday and earlier (today's hourly slot is replaced by 1D), so Massive's historical stock data is sufficient.

**Header price is always yfinance** (`current_price`, `prev_close`, `change_pct`) — for every timeframe. This guarantees the displayed price matches what the scan actually uses (yfinance current-day quote), so users never see a chart header showing yesterday's $802 while the scan ran at today's $775. yfinance is queried via `yf.Ticker(ticker).history(period='2d')`; if that fails, the endpoint falls back to the last bar's close in the bars array (which yields yesterday's close for non-1D timeframes).

RSI is fetched via `massive_client.get_rsi(ticker, timespan=…, window=14)` with `series_type="close"`. RSI is **best-effort** — if the call fails, the endpoint still returns bars with `rsi: []` rather than failing. Bars without `close` or `timestamp` are filtered out.

**Cache** — every successful response is stored in a per-process in-memory dict `_chart_cache` keyed by `(ticker, timeframe)`. TTLs:

| Timeframe | TTL  | Reason |
|-----------|------|--------|
| `1D`, `5D` |  60 s | intraday — refresh-friendly |
| `1M`, `3M`, `6M`, `1Y` | 300 s | daily bars — barely change minute-to-minute |

A cache hit returns the stored JSON without making any outbound calls — for non-1D timeframes that saves both Massive `list_aggs` and `get_rsi`; for 1D and the header price it also saves the yfinance fetches. Failed requests are **not** cached, so the next call retries fresh. Scope is **per-worker** under gunicorn — each worker has its own dict; that's fine since the data only changes slowly. `GET /api/chart_cache_stats` exposes `{entries, hits, misses, ttl, keys: [...]}` for verification.

**RSI is best-effort** — wrapped in its own `try/except`. If RSI fails (rate limit, auth, timeout, malformed payload) the endpoint logs `[chart] RSI fetch failed for {ticker} {tf}: {err}` and returns the bars with `rsi: []` rather than 500-ing the whole request. The bars fetch must succeed for the response to be considered successful (and cacheable).

**1D — most recent session** — when timeframe is `1D`, the endpoint first calls `_fetch_1d_bars_yfinance(ticker)` which runs `yf.Ticker(ticker).history(period='5d', interval='1h')`, normalizes the index to ET, picks the max calendar date present, and returns that session's bars. During market hours / after the close this is today; on weekends and holidays it's the most recent trading day. If yfinance returns an empty frame or raises, the endpoint falls back to Massive's single 7-day hourly window, buckets by ET date, and picks the max — same logic as before. The Massive path is what existed before yfinance was wired in; it's kept because Massive's `list_aggs` is reliable for *historical* data and serves as a safety net (an earlier walk-back implementation tripped Massive's weekend rate limit, which returns auth-flavored 429s — the single-call window avoids that). Returns 404 only if both yfinance and the Massive fallback come back empty. The `today` reference is `datetime.now(ZoneInfo("America/New_York")).date()` so the server's local timezone doesn't affect what counts as "today". Other timeframes use a rolling window from Massive that already absorbs closed days.

The response carries two extra fields **only for 1D**:
- `session_date` — `YYYY-MM-DD` of the session actually returned (or `null` for non-1D)
- `session_is_today` — `true` if `session_date` matches today's ET date, `false` if the fallback fired (or `null` for non-1D)

The frontend consumer of these fields (`StockChart.jsx` `ChartHeader`, which showed a "Showing {Mon DD}" label when `session_is_today === false`) has been removed along with the rest of the Recharts chart; the fields remain in the response for any future consumer.

Response:
```json
{
  "ticker": "MU", "timeframe": "1M",
  "current_price": 487.92, "prev_close": 480.15, "change_pct": 1.62,
  "session_date": null, "session_is_today": null,
  "bars": [{"timestamp": 1234567890000, "open": …, "high": …, "low": …, "close": …, "volume": …}, …],
  "rsi":  [{"timestamp": 1234567890000, "value": 65.4}, …]
}
```

`current_price` / `prev_close` come from the last two bars; if there's only one bar, `change_pct` is 0. Returns 404 if no bars are returned for the ticker/timeframe.

### Scan History — `scan_runs` / `scan_results`

Every scan execution is logged to Supabase so we can train ML models on real algorithm output later. Logging is **best-effort**: if the Supabase write fails (network, schema mismatch, missing service key, no auth token), the scan response is unaffected and a warning is printed to stderr — the contract is that logging must **never** break the scan response.

**Tables** (full DDL in `docs/scan_history_schema.sql`):
- `scan_runs` — one row per scan execution: inputs (tickers requested/used/skipped, weeks_min/max, min_premium, min_p_profit), outputs (total_evaluated, total_passed), context (market_open, elapsed_ms, vix, spy_price), and `error_message` (nullable; populated when the scan threw)
- `scan_results` — one row per produced triplet, linked via `scan_id`. Mirrors the triplet shape (legs, strikes, deltas, premiums, score, P(max profit)) plus `rank`, `was_saved` boolean, and `created_at`. (The `fair_value`/`fv_available` columns still exist but are written as `null`/`false` since the fair-value removal — see Changelog)
- RLS: users may only SELECT/INSERT their own rows. `was_saved` is only updatable via the service role (no user UPDATE policy)

**Write path** — `log_scan_run()` in `server/app.py` is called from `/api/run` on **both** success and exception paths:
- Success: inserts `scan_runs` row with `error_message=NULL` and a batch insert into `scan_results` for every ranked triplet (chunked at 200 rows per request). Returns `(scan_id, result_ids)` parallel to the ranked list, and the endpoint decorates each response triplet with its `result_id`.
- Failure: inserts a `scan_runs` row with `error_message` populated, `tickers_used=[]`, `ranked=[]`, and `total_passed=0` so the failure itself is captured for future analysis (e.g. "scans error more often around earnings"). 400-level validation errors are NOT logged — only execution-time exceptions.

**Auth** — `/api/run` calls `verify_token(request)` to extract `user_id` from the Supabase JWT. If no token is present or verification fails, `user_id` is None and `log_scan_run()` returns `(None, [])` without writing. Scans still succeed for unauthenticated callers; they just aren't logged. The frontend (`useOptionsData.js`) attaches `Authorization: Bearer <session.access_token>` on scan requests.

**Market context** — at the top of each scan, `_get_market_context()` fetches last-close VIX (via Massive ticker `I:VIX`) and SPY price (via Massive `SPY`). Both are best-effort — failures log to stderr and store `None`. Result is cached for 60 seconds across scans in a process-local dict to avoid hammering Massive on back-to-back runs.

**Scan provenance linkage** — saved trades carry their origin:
- `/api/run` returns `scan_id` at top level and `result_id` per ranked entry
- Frontend (`useOptionsData.js`) exposes `scanId`; each row in `ranked` already includes its `result_id`
- Saving via the detail panel's **Save** action (`SetupDetail` → `App.jsx saveToTradebook(selectedSetup)`) or the trade editor (`TradePage.jsx handleSave`) posts to `/api/tradebook/save` with `{scan_id, result_id, trade}`
- The server inserts into `tradebook` (filling `user_id` from the JWT — clients cannot spoof it) and then flips `was_saved=true` on the matching `scan_results` row (best-effort; a failure here does NOT undo the save)
- `scan_id` and `result_id` are **nullable** on the `tradebook` table — older saves predate logging, and saves made without auth still work without linkage

**Endpoint contract reminder** — `/api/tradebook/save` requires a valid JWT (returns 401 otherwise) and ignores any client-supplied `user_id`/`id`/`scan_id`/`result_id` inside the `trade` payload — those are taken from the top-level JSON fields and from the verified user.

### Trade Outcomes — `trade_outcomes` (realized P&L on expired trades)

`trade_outcomes` stores the realized P&L for every saved tradebook entry once its expiration date has passed. Paired with `scan_runs` / `scan_results`, this is the **foundational labeled dataset for future ML work**: every triplet the algorithm produced (saved or not) is linked to a scan, and every saved triplet that has expired is linked to a deterministic outcome.

**Table** — full DDL in `docs/trade_outcomes_schema.sql`. One row per tradebook entry, enforced by `unique (tradebook_id)`. Fields: `outcome_type` (`expired_capped` | `expired_sweet_spot` | `expired_credit_only` | `expired_partial` | `expired_breakeven` | `expired_loss` | `pending` — see the classification table below), `stock_price_at_expiration`, the three leg-payoff numbers, `realized_pnl`, `pnl_per_contract`, and a `notes` column (defaulted to `'auto-backfilled'` by the script). RLS lets users SELECT only their own rows via the denormalized `user_id` column; INSERT / UPDATE / DELETE are service-role only.

**Payoff formulas** — at expiration with stock close `S`:
- Leg A (long call):  `leg_a_value     = max(0, S − leg_a_strike)`   (value to us)
- Leg B (short call): `leg_b_liability = max(0, S − leg_b_strike)`   (owed by us)
- Leg C (short put):  `leg_c_liability = max(0, leg_c_strike − S)`   (owed by us)
- `realized_pnl     = entry_net_premium + leg_a_value − leg_b_liability − leg_c_liability`
- `pnl_per_contract = realized_pnl × 100`  (one option contract represents 100 shares)

**Outcome classification** — *payoff-zone-based*, not assignment-based. An earlier scheme labeled trades by which legs got assigned, but assignment alone is misleading: the capped zone above K_B assigns the short call **and** that's exactly where the trade hits its theoretical max profit, so "any short assigned" doesn't mean "partial outcome". Labels now reflect **where the underlying landed** relative to the four strikes (`K_C < K_A < K_B`).

First match wins — order is load-bearing and matches the SQL `case` block in `docs/trade_outcomes_relabel_migration.sql`:

| # | Label                  | Condition                                  | Meaning                                                                  |
|---|------------------------|--------------------------------------------|--------------------------------------------------------------------------|
| 1 | `expired_breakeven`    | `abs(realized_pnl) < 0.05`                 | Within 5¢ of flat either way                                             |
| 2 | `expired_loss`         | `realized_pnl < 0`                         | Negative P&L — usually put assignment below `K_C` exceeded the credit    |
| 3 | `expired_credit_only`  | `S ≤ K_A` AND `pnl > 0`                    | All calls expired worthless; kept the entry credit; no spread captured   |
| 4 | `expired_sweet_spot`   | `K_A < S < K_B` AND `pnl > 0`              | Long call ITM, no short assignments — the structurally ideal zone        |
| 5 | `expired_capped`       | `S ≥ K_B` AND `pnl > 0`                    | Both calls ITM, short call assigned, full spread captured — **max profit** |
| 6 | `expired_partial`      | (fallback)                                 | Defensive catch-all; unreachable when the above conditions are exhaustive |

`'pending'` is reserved for future use (e.g. mid-life early-close logic) and is never written by the auto-backfill today.

**Migration note** — existing rows written under the old labels are reclassified by `docs/trade_outcomes_relabel_migration.sql`. Run it once in the Supabase SQL Editor; it's idempotent (drops the old CHECK constraint, adds the new one, then runs an `UPDATE … FROM tradebook` with the same `case` order as the Python classifier so the two paths can never disagree).

**Auto-backfill — `scripts/backfill_outcomes.py`**:
- Run with `python3 scripts/backfill_outcomes.py` from the project root (no arguments). Reads `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `MASSIVE_API_KEY` from `.env` (loaded transitively via `options_screener`'s `load_dotenv()`).
- Finds tradebook rows with `expiration < today_ET` that don't yet have an outcome.
- Fetches the closing stock price on the expiration date **yfinance-first** (daily bars, `auto_adjust=False`, 7-day backward window so holiday-shifted expirations resolve to the nearest prior trading day), with **Massive `list_aggs` as the unchanged fallback** — same window semantics on both paths, shared by both backfills via `fetch_close_price()`. Changed 2026-08-24 because the REST path 429s on recent expirations; validated before shipping (80 sampled (ticker, expiration) pairs across two draws reproduced the stored REST-derived price to the penny and the identical `outcome_type`, 80/80). The originally-approved "local day_aggs first" design was impossible: our extract day_aggs are OPRA **options** aggregates (no underlying closes), and `us_stocks_sip`/`us_indices` flat files return 403 on our plan (see the pending note in Notes).
- Computes the four values + outcome_type per the formulas above, inserts to `trade_outcomes` with `notes='auto-backfilled'`.
- Prints one line per trade and a summary: `Backfilled N trades. Win rate: X%. Total P&L: $Y. Average per trade: $Z.`
- **CLI output is in per-contract dollars** (i.e. `pnl_per_contract`, which is raw payoff × 100). Brokerage statements quote dollars at this scale — `[backfill] GEV 2026-05-01: P&L=$+1026.00` rather than the per-share `$+10.26`. The database stores **both**: `realized_pnl` (per-share, matches option quote prices) and `pnl_per_contract` (per-contract, matches brokerage P&L). When tradebook later tracks contract quantity, the CLI multiplies by `qty` on top of the × 100; the DB columns remain unit-fixed.
- **Idempotent** — re-runs only touch rows that don't already have an outcome (pre-filtered against the existing outcomes set, plus the unique constraint on `tradebook_id` acts as a safety net). A clean re-run prints `No new trades to backfill, exiting cleanly.`
- **Error handling** — a missing stock price or insert failure logs a warning and continues to the next trade; the script never crashes on a single bad row.

**When to re-run** — the natural cadence is once per Friday close (or first thing Monday) after the week's options expire. A future task may schedule this via cron or a Supabase Edge Function; today it's a manual run.

**Read-only viewer — `scripts/view_outcomes.py`**:
- Run with `python3 scripts/view_outcomes.py` from the project root (no arguments). Reads `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` from `.env`.
- Performs **zero writes** — safe to run any time, including immediately after a backfill or when nothing has been backfilled yet (prints a hint pointing at the backfill script in that case).
- Fetches `trade_outcomes` and `tradebook` as two flat queries and joins in Python (the dataset is small, and this avoids depending on PostgREST's embedded-relation schema cache).
- Renders one line per outcome, sorted by expiration descending (most recent first):
  ```
  GEV  2026-05-01  credit=$ 10.26  spread=$ 5.00  →  S=$ 1062.95  P&L=$+1026.00  (max=$+1526.00, captured  67.2%)  (expired_credit_only)
  ```
  All dollar values are **per-contract** (× 100), matching brokerage-statement scale and the backfill script's CLI output. `credit` and `spread` come from `tradebook` (`net_premium`, `spread_width`), `S` and `P&L` come from `trade_outcomes`. `max` is computed at render time as `(entry_credit + spread_width) × 100` — the theoretical peak P&L when the underlying closes exactly at Leg B strike (long call captures the full spread; both shorts expire worthless). `captured` is `pnl_per_contract / max × 100`, clamped at 100% on display so an anomalous row prints `100.0%` rather than `142.0%`; a single stderr line tags the ticker / expiration whenever the clamp fires. If `max <= 0` (shouldn't happen in this strategy — both terms are positive by construction), the column prints `n/a`.
- Summary footer: total trades, win rate, total P&L, **total max potential**, **capture efficiency** (`total P&L ÷ total max`), average per trade, **average capture per trade** (mean of per-trade ratios), best and worst trade (ticker + expiration + dollar), and a breakdown by `outcome_type` in best-to-worst order. Aggregate stats use **raw** per-trade ratios (no clamp) so any data anomaly surfaces in the totals instead of being silently capped.
- **Color** — if `rich` is importable, per-trade lines are colored by `outcome_type` (not by P&L sign). The three positive-P&L zones (`expired_capped`, `expired_sweet_spot`, `expired_credit_only`) print green; `expired_partial` and `expired_breakeven` print yellow; `expired_loss` prints red; `pending` is dim. Aggregate stats in the summary (total P&L, average per trade) keep sign-based coloring. The outcome-type breakdown table reuses the per-trade color map so the eye can sweep a single column. If `rich` isn't installed the script still works in plain text. Installing it is optional: `pip install rich` (not in `server/requirements.txt` since it's only used by this local CLI).

### Script summary

| Script                              | Effect      | Use when                                              |
|-------------------------------------|-------------|-------------------------------------------------------|
| `scripts/build_universe.py`         | Writes JSON | Periodically — regenerate `data/universe.json` (sector → large-cap tickers) |
| `scripts/sector_scan.py`            | **Writes**  | Scheduled/manual (per slot) — scan every sector, log top-N picks to `ml_dataset` / `sector_scan_runs` |
| `scripts/view_sector_scans.py`      | Read-only   | Any time — review a day's sector scans (status + picks per sector/slot) |
| `scripts/run_sector_scan.sh`        | Wrapper     | Cron only — runs `sector_scan.py` per slot with ET-time/DST gating + logging |
| `scripts/extract_quotes.py`         | Writes files| Per trading day — stream the OPRA quotes flat file → `data/extracts/DATE.parquet` (gitignored) |
| `scripts/extract_catchup.sh`        | Wrapper     | **Legacy — unscheduled** former Mac launchd catch-up wrapper; kept for reference (see Scheduled Automation) |
| `scripts/ec2_extract_catchup.sh`    | Wrapper     | EC2 cron (14:05 ET Tue–Sat, ET-gated dual UTC lines, flock) — extract+validate as flat files publish → `/home/ubuntu/logs/extract_catchup.log` |
| `scripts/replay_scan.py`            | **Writes**  | B1b backtest replay — scan a historical (date, slot) from extracts → `ml_dataset` `source='backtest_open'/'backtest_close'` (default dry-run; `--write` to persist) |
| `scripts/run_ml_backfill.sh`        | Wrapper     | **Legacy — unscheduled** former Mac launchd nightly-backfill wrapper; kept for reference (see Scheduled Automation) |
| `scripts/ec2_ml_backfill.sh`        | Wrapper     | EC2 cron (18:30 ET Mon–Fri, ET-gated dual UTC lines) — nightly `backfill_ml_outcomes.py` → `/home/ubuntu/logs/ml_backfill.log` |
| `scripts/validate_extract.py`       | Read-only   | After an extraction — integrity + REST cross-check + ml_dataset comparison |
| `scripts/backfill_outcomes.py`      | **Writes**  | After options expire — populates `trade_outcomes` (tradebook trades) |
| `scripts/backfill_ml_outcomes.py`   | **Writes**  | After options expire — fills `ml_dataset` outcome columns (sector-scan setups) |
| `scripts/view_outcomes.py`          | Read-only   | Any time — inspect / report on existing outcomes      |

### Universe Builder — `scripts/build_universe.py` → `data/universe.json`

Produces the **sector → large-cap-ticker map** that the daily sector scan reads. It is a **standalone, periodically-run** script — **NOT** invoked on every scan, and it does **not** touch Massive, scan options, or change the app. Run it occasionally (e.g. monthly, or when index membership / market caps shift) to refresh the universe the sector scan consumes.

- Run with `python3 scripts/build_universe.py` from the project root. Optional flags: `--limit N` (only evaluate the first N candidates — for a quick smoke test), `--sleep S` (seconds between tickers, default `0.25`), `--threshold DOLLARS` (market-cap floor, default `100000000000` = $100B), and `--out PATH` (output path, default `data/universe.json`). The latter two are how alternate universes are built (e.g. the extraction universe via `--threshold 75000000000 --out data/universe_extract.json`).
- **Candidate pool:** the **S&P 500 constituent list, scraped from Wikipedia** (`List_of_S&P_500_companies`, the `id="constituents"` table). Nearly every US company over $100B is in the index, so it's a stable, reproducible starting universe. Wikipedia share-class dots are normalized to yfinance dashes (`BRK.B` → `BRK-B`). The Wikipedia fetch is retried with backoff; the source URL is recorded in the output metadata.
- **Per-ticker enrichment:** `sector` and `marketCap` come from `yf.Ticker(t).info` (yfinance, not Massive — this is reference data, not options/historical bars). Tickers are **grouped by whatever sector string yfinance returns** — no custom taxonomy. yfinance's native strings are the GICS-style sectors: `Technology`, `Financial Services`, `Healthcare`, `Consumer Cyclical`, `Consumer Defensive`, `Energy`, `Industrials`, `Basic Materials`, `Real Estate`, `Utilities`, `Communication Services`. (These are yfinance's labels and differ slightly from the canonical GICS names — e.g. `Financial Services` not "Financials", `Healthcare` not "Health Care" — and we keep yfinance's exactly.)
- **Filter:** keep only tickers with `marketCap > $100,000,000,000` ($100B).
- **Resilience:** yfinance is slow/flaky across hundreds of tickers. Each `.info` lookup is **retried twice with backoff**; a ticker that still fails (network error, missing `sector`, missing `marketCap`) is **logged to stderr and skipped, never fatal**. Requests are paced by `--sleep`. An unexpected/empty sector string is logged as an outlier (but the ticker is still kept). The summary footer reports counts for each skip reason (below threshold / no sector / no cap / fetch error). Favors correctness over speed.
- **Output — `data/universe.json`** (`data/` is created if missing):
  ```json
  {
    "metadata": {
      "generated_at": "2026-06-16T...Z",
      "source": "S&P 500 constituents via Wikipedia (https://...)",
      "threshold": 100000000000,
      "threshold_label": "$100B market cap",
      "candidates_evaluated": 503,
      "total_tickers": 84,
      "sector_count": 11
    },
    "sectors": { "Technology": ["AAPL", "AMD", "AVGO", ...], "Financial Services": ["JPM", "V", ...], ... }
  }
  ```
  Tickers within each sector and the sectors themselves are sorted for stable diffs. The script prints a full sector → ticker summary (each sector with its count and tickers) plus the skip-reason counts.

### Daily Sector Scan — `scripts/sector_scan.py` → `ml_dataset` / `sector_scan_runs`

Reads the sector universe (`data/universe.json`), runs the existing Call Spread Risk Reversal scan on **every ticker in every sector** (~118 names, far more than the app's usual 10), and logs the **top-N distinct setups per sector** (the best + runners-up — see "Top-N runners-up" below) as systematic, **unbiased** output to two Supabase tables. This is the forward-looking feed for the ML training set (kept entirely separate from the discretionary `tradebook` / `trade_outcomes`). **Runs automatically twice per trading day on EC2** (see "Scheduling (production, EC2)" below) and can also be run by hand.

- Run from the project root: `python3 scripts/sector_scan.py --slot open` (or `--slot close`).
  - `--slot {open,close}` (**required**) sets `source` to `live_open` / `live_close`. The DB has **no `slot` column** — the slot is encoded into `source`.
  - `--source` overrides source (default `live_<slot>`; allowed writer values are `live_open` | `live_close` | `backtest_open` | `backtest_close`). Plain `backtest` remains legal in the DB as a legacy transitional value but **no writer uses it** — the script rejects it with a pointer to `docs/backtest_slot_split_migration.sql` (see the slot-split note under Backtest Replay). The backtest sources are written by `scripts/replay_scan.py`.
  - Filters use the app defaults but are CLI-overridable: `--weeks-min` (1), `--weeks-max` (12), `--min-premium` (5.00), `--min-p-profit` (0.50).
  - `--sleep` (0.15s) paces between tickers; `--limit-per-sector N` scans only the first N tickers per sector (testing); `--universe PATH` points at a different universe file; `--dry-run` scans but writes nothing.
- **Reuses** `screener.scan_ticker` and the Massive client — it does **not** change the app, the algorithm, the tradebook, or `trade_outcomes`. It injects a dedicated Massive `RESTClient` (15s read timeout, 3 retries) into `screener.massive_client` so scan calls fail fast under load (no edit to `screener.py`).

**Flow (per sector):** loop the sector's tickers (using the JSON's yfinance sector keys verbatim — `Financial Services`, `Healthcare`, etc.), scan each, collect all qualifying triplets, rank by score, then select the **top-N distinct setups** (default 5; `--top-n`). Then write exactly one `sector_scan_runs` row per sector, by status:
- `picked` → insert the **top-N setups** into `ml_dataset` — the #1 with `is_best_in_sector = true`, the runners-up with `false`. Every row is a full, identical-shape record (all legs, metrics, `underlying_price_at_scan`, `moneyness_a`, market context `vix`/`spy_price`, event proximity `days_to_earnings`/`days_to_next_fomc`/`days_to_next_cpi`/`days_to_next_macro` + `earnings_before_expiry`, `weeks_to_expiration`/`days_to_expiration`, `scan_date`/`scan_timestamp`, `sector`, `source`). The `sector_scan_runs` row is unchanged in meaning — it still represents the sector's **best** pick: `best_ticker`, `best_score`, and `ml_dataset_id` link to the **`is_best_in_sector=true`** row (never a runner-up), plus `tickers_scanned`/`tickers_skipped`/`contracts_evaluated`/`setups_qualified`/`elapsed_ms` and the input filters (`min_net_premium`, `min_p_profit`, `weeks_range` text like `W1-W12`).
- `none_qualified` → sector scanned fine but 0 setups passed filters → run row only.
- `no_tickers` → sector had no tickers in the universe → run row only.
- `error` → the sector scan threw unexpectedly → run row with `error_message`; the run continues to the next sector (one bad sector never aborts the whole run).

**Resilience (mandatory at ~118 tickers):** per-request Massive timeout (15s, fail fast); per-ticker retry/backoff with 429/rate-limit detection (mirrors `backfill_outcomes.py`); a ticker that still times out/errors after retries is logged, counted in `tickers_skipped`, and **skipped** (never kills the sector or run); requests paced by `--sleep`; output is line-buffered + flushed so a long run shows live progress. Market context (`vix`/`spy` via yfinance) and macro proximity (FOMC/CPI/PPI/NFP via `event_filter`, 26-week look-ahead) are fetched **once per run**; `days_to_earnings` is memoized per ticker (each distinct logged ticker — best or runner-up — fetched at most once).

**Top-N runners-up (`--top-n`, default `DEFAULT_TOP_N=5`)** — `ml_dataset` logs the best **plus runners-up** per sector, not just the winner, so a future model sees weak/marginal setups (negative examples) and can learn the boundary between good and weak — instead of only the biased slice the algorithm already liked. Key properties:
  - **No extra Massive/network cost.** Runners-up are selected purely from the in-memory `ranked` list that `scan_ticker` already produced — choosing the top-N instead of the top-1 adds **zero** Massive calls (verified: a trimmed run made **256** option-chain calls at both `--top-n 5` and `--top-n 1`), just more cheap DB inserts. (The only per-row external lookup, `days_to_earnings`, is memoized.)
  - **Distinct, not clones.** A per-ticker cap (`MAX_PER_TICKER=2`) stops one high-volume name (e.g. MU's ~9,900 near-identical adjacent-strike setups) from filling the quota — the top-N spreads across the sector's strongest tickers. A thin sector whose only qualifying setups share a ticker still logs them (e.g. 2× COST); a sector with `<N` qualifying setups logs only what exists (no padding).
  - **Flagging.** Exactly **one** `is_best_in_sector=true` per sector/slot (the global #1); runners-up are `false`. `sector_scan_runs.ml_dataset_id` always points at the `true` row.
  - Tunable: `--top-n` (CLI) and the `MAX_PER_TICKER` constant in `sector_scan.py`.

**De-dup / idempotency** — unique indexes are `uniq_ssr_run (source, scan_date, sector)` and `uniq_ml_dataset_observation (source, scan_date, sector, ticker, expiration, leg_a/b/c_strike)`. Re-running the same slot **replaces** rather than duplicating or accumulating. Because `sector_scan_runs.ml_dataset_id → ml_dataset(id)` has no `ON DELETE`, each write path first upserts the run row with `ml_dataset_id = NULL` (releasing any prior reference), then deletes **all** stale `ml_dataset` rows for the slot/sector (old best **and** runners-up), then (if `picked`) batch-inserts the fresh N-row set and points the run row at the `is_best_in_sector=true` row — so re-runs and status transitions (e.g. `picked` → `none_qualified`) leave no orphan runners-up. (Verified: a sector with 13 ml rows across two `--top-n 5` re-runs stayed at 13, not 26.)

**Auth** — uses `SUPABASE_SERVICE_KEY` (both tables have RLS enabled with **no public policies**; only the service role can read/write). DDL: `docs/ml_dataset_schema.sql` and `docs/sector_scan_schema.sql` (create `ml_dataset` first — `sector_scan_runs` FKs into it). The `outcome_*` columns on `ml_dataset` are populated **later** by `scripts/backfill_ml_outcomes.py` (see its section below — a sibling of `backfill_outcomes.py` that writes here, not to `trade_outcomes`); `sector_scan.py` leaves them null (`outcome_filled = false`).

**End-of-run summary** prints every sector with its status and best pick (or status reason), total picks logged, total tickers skipped, total elapsed, and rows written. **Runtime note:** a full default run (all 11 sectors × all tickers × weeks 1–12, two Massive calls per ticker-expiration) is on the order of tens of minutes; a trimmed validation run (3 tickers/sector, weeks 4–9) is ~50s. (A full production run on the EC2 box measured ~2.5 min.)

**Market-day guard (in-script)** — at the top of a scan (before any context fetch or DB write) `sector_scan.py` checks the **NYSE calendar** via **`pandas_market_calendars`** (pinned `==5.4.0` in `server/requirements.txt`; **new dependency** — must be `pip install`ed into the server venv after pulling, it does NOT auto-install). If today isn't a US equity trading day it prints `market closed today (YYYY-MM-DD), skipping scan` and `exit(0)` without scanning/writing. **Weekends and NYSE holidays skip; half-days / early closes count as trading days** (logged as `early close HH:MM`). The guard protects **manual runs too**, not just cron. If the library is missing it exits non-zero with a clear install message rather than guessing. Test it without scanning via `--check-market-day [YYYY-MM-DD]` (defaults to today), which prints the trading-day decision and exits — e.g. `--check-market-day 2026-11-26` → `CLOSED` (Thanksgiving), `--check-market-day 2026-11-27` → `TRADING DAY — early close 13:00`. To refresh holiday rules, bump the pinned `pandas_market_calendars` version.

**Scheduling (production, EC2)** — the scan runs automatically **twice per trading day**: `--slot open` at ~10:00 AM ET (≈30 min after the 09:30 open) and `--slot close` at ~3:30 PM ET (≈30 min before the 16:00 close). The data is real-time (Options Advanced plan; it was 15-min delayed under Options Starter — pre-2026-07 rows captured ~15-min-old prices). Cron invokes `scripts/run_sector_scan.sh <open|close>`, a wrapper that handles cwd, the venv python, logging, and the DST gate. **DST handling without `CRON_TZ`:** the EC2 box is UTC and its cron build doesn't support `CRON_TZ`, and changing the server timezone would affect the live app. So each slot is scheduled at **both** its EDT and EST UTC times (4 cron lines), and the wrapper gates on the **actual Eastern-time clock** (`TZ=America/New_York`), proceeding only inside the slot's ET window (open 09:45–10:30, close 15:15–15:45). Exactly one of each slot's two fires runs per day in either DST period — **no twice-a-year edits, no server-TZ change**. ET→UTC reference: EDT (UTC−4) → open 14:00 / close 19:30 UTC; EST (UTC−5) → open 15:00 / close 20:30 UTC. The crontab uses `1-5` (Mon–Fri); the in-script guard handles holidays. Pass a second arg `force` to the wrapper to bypass the time gate for manual/off-hours testing (the market-day guard still applies).

**Logging & resilience** — the wrapper appends all stdout+stderr (with UTC `START`/`END rc=…` timestamps) to `/home/ubuntu/luo-options-algo/logs/sector_scan.log`. The log is **size-capped in the wrapper** (rotates to `.log.1` past 5 MB → ~10 MB max; no system logrotate needed). The wrapper always `exit 0` so a failed scan is logged but never mails cron or blocks the next run (cron invocations are independent regardless). `options_screener.load_dotenv()` finds `.env` because the wrapper `cd`s to the project root first; the explicit venv-python path covers cron's minimal env/PATH.

**Crontab (ubuntu user, `crontab -e`):**
```cron
# Luo Capital sector scan — UTC schedule; run_sector_scan.sh gates on real ET time (DST-safe).
# open  slot -> 10:00 ET : 14:00 UTC (EDT) + 15:00 UTC (EST)
0 14 * * 1-5 /home/ubuntu/luo-options-algo/scripts/run_sector_scan.sh open
0 15 * * 1-5 /home/ubuntu/luo-options-algo/scripts/run_sector_scan.sh open
# close slot -> 15:30 ET : 19:30 UTC (EDT) + 20:30 UTC (EST)
30 19 * * 1-5 /home/ubuntu/luo-options-algo/scripts/run_sector_scan.sh close
30 20 * * 1-5 /home/ubuntu/luo-options-algo/scripts/run_sector_scan.sh close
```
A full scan is ~2.5–4.5 min sustained and **shares the Massive rate limit with the live app** (luo-capital.com); 10:00 AM and 3:30 PM ET deliberately avoid the open/close volatility spikes.

**Server install step (after a `git pull` that includes this dependency):**
```bash
cd /home/ubuntu/luo-options-algo
git pull
venv/bin/pip install -r server/requirements.txt   # installs pandas_market_calendars==5.4.0
venv/bin/python scripts/sector_scan.py --check-market-day   # sanity-check the guard
```

### Sector Scan Review — `scripts/view_sector_scans.py` (read-only)

Read-only report over `sector_scan_runs` + `ml_dataset` — the sector-scan analogue of `view_outcomes.py`. Prints a clean per-day, per-slot summary of what the daily sector scan produced. Performs **zero writes**; safe to run any time.

- Run with `python3 scripts/view_sector_scans.py` (defaults to **today**, ET). `--date YYYY-MM-DD` views a specific day; `--slot open|close` restricts to one slot (default: show all slots present). Reads `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` from `.env` — the **service-role** key is required (both tables are RLS-locked with no public policies).
- **Per slot** (open and close are distinct observations via `source` = `live_open` / `live_close`; any `backtest`-source rows for the day render as their own section): a header with the slot, **market context (VIX/SPY)** and the filter snapshot (min premium / min P / weeks), then **one row per sector** that has a `sector_scan_runs` record that day — status-colored (green=picked, dim=none_qualified, yellow=no_tickers, red=error). Each row shows the **diagnostic counts** `scan / skip / qual` (tickers_scanned / tickers_skipped / setups_qualified) so you can see how competitive a pick was (AMAT out of 8080 qualified vs LLY out of 2). For `picked` sectors the pick detail is **joined from `ml_dataset` via `run.ml_dataset_id`** — ticker, expiration, `W{weeks_to_expiration}`, score, per-contract net premium (`net_premium × 100`), max profit (`(net_premium + spread_width) × 100`), and P(profit). Non-picked rows show the reason; `error` rows show the (truncated) `error_message`. Rows are ordered picks-first (by score desc), then none_qualified / no_tickers / error.
- **Market context note:** `vix`/`spy_price` live on `ml_dataset` (not `sector_scan_runs`), so context is read from the slot's picked rows; if a slot has no picks it shows `n/a`.
- **Per-slot summary:** status counts (picked / none_qualified / no_tickers / error), picks logged, total tickers scanned, total skipped, total elapsed (Σ `elapsed_ms`). When both slots are present a closing line compares picks-by-slot (open vs close are different observations).
- **Edge cases handled:** a date with no scans → friendly `No sector scans found for {date}` (also when a `--slot` filter matches nothing); a `picked` run whose `ml_dataset` row is missing/unlinked is flagged (`⚠ pick detail missing`) rather than crashing; bad `--date` format errors out cleanly. Uses `rich` for color when importable; falls back to plain text otherwise (`soft_wrap` prevents rich from reflowing the fixed-width rows).

### ML Outcome Backfill — `scripts/backfill_ml_outcomes.py`

Fills the `outcome_*` columns on **`ml_dataset`** for rows whose expiration has passed. It is the **sibling of `scripts/backfill_outcomes.py`** — same payoff math, same resilience — but it writes to `ml_dataset`'s own outcome columns and **never touches `trade_outcomes`, `tradebook`, `sector_scan.py`, or the scan algorithm**. The two datasets stay entirely separate: `tradebook`/`trade_outcomes` = discretionary trades; `ml_dataset` = the systematic sector-scan feed.

- Run with `python3 scripts/backfill_ml_outcomes.py` from the project root (no arguments). Reads `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MASSIVE_API_KEY` from `.env` (loaded transitively via `options_screener`). Service-role key required — `ml_dataset` is RLS-locked with no public policies.
- **Shared machinery, not mirrored** — it imports `compute_outcome()` (the Call Spread Risk Reversal payoff formulas + payoff-zone classification) and `fetch_close_price()` (Massive close fetch with retry/backoff, 429 detection, and the per-`(ticker, date)` memo cache) **directly from `backfill_outcomes.py`**, so the two backfills can never diverge. Same six `expired_*` outcome labels, same classification order.
- **Scope** — processes **ALL** unfilled expired rows, winners **and** runners-up (no `is_best_in_sector` filter). Runners-up exist precisely so a model can learn what weaker setups do; they get labels too.
- **Columns written**: `outcome_type`, `stock_price_at_expiration`, `realized_pnl` (per share), `pnl_per_contract` (× 100), `max_profit_per_contract`, `capture_pct`, `outcome_filled = true`, `outcome_filled_at = now()`.
- **`max_profit_per_contract` = `(net_premium + (leg_b_strike − leg_a_strike)) × 100`** — the spread is **derived from the strikes**, NOT read from the stored `spread_width` column, so realized P&L and max profit always share the same basis (the convention fixed in `view_outcomes.py`).
- **`capture_pct`** = `pnl_per_contract / max_profit_per_contract` stored as a **fraction (0–1)**, and **NULL when `realized_pnl ≤ 0`** — capture efficiency only means something for winning trades (matches the corrected `view_outcomes.py` convention). Also NULL defensively if max ≤ 0.
- **Price fetching** — memoized per `(ticker, expiration)`: the many rows sharing a pair (all the MU setups expiring the same Friday, winners and runners-up alike) collapse to one Massive lookup each (e.g. first production run: 141 rows → 30 distinct lookups). Pre-fetch pass over unique pairs, then a longer-delay retry pass for failures, then a process pass that reads only from the cache — same three-pass structure as `backfill_outcomes.py`.
- **Rate-limit resilience** — a `(ticker, date)` that still fails after all retries causes its rows to be **skipped with a log line and left unfilled** for a later run; the script never crashes or writes a partial outcome. Recent expirations can 429 until Massive treats them as historical (typically a day) — skipping is correct; just re-run later. (Observed in practice: a first run filled 108/141 with 4 pairs rate-limited; a re-run 20 minutes later recovered all 33 remaining rows.)
- **Idempotent** — only rows with `outcome_filled = false` are considered, and the UPDATE also matches `.eq('outcome_filled', False)` so a concurrent/duplicate run is a no-op on already-filled rows. Re-runs never recompute or change filled values; rows whose expiration hasn't passed are left alone. A run with nothing expired prints `No expired unfilled rows to backfill … exiting cleanly` without touching Massive.
- **Output** — one progress line per filled row (`[ml-backfill] {sector} {ticker} {expiration} S=… P&L=… ({outcome_type}) [best|runner-up]`, per-contract dollars), then a summary: rows processed / filled (split best vs runners-up) / skipped (by reason), distinct price lookups (+ failures), win rate, total & average P&L, breakdown by `outcome_type`, and how many rows remain unfilled.
- **When to re-run** — same cadence as `backfill_outcomes.py`: after each Friday's expirations (or Monday). Not yet scheduled; manual run today.

### Quote Extraction Worker — `scripts/extract_quotes.py` (RANKER_SPEC Phase B-extract)

Streams a trading day's OPRA quotes flat file (~100–160 GB compressed) from Massive S3 and writes a compact per-day extract for the backtest replay. Full schema + parameter rationale: **`docs/extract_schema.md`**. Key facts:

- **Parameters (spec open question #5, resolved 2026-07-26):** three DST-correct ET windows (`open` 09:30–10:05, `midday` 12:45–13:00, `close` 15:00–15:35); last **10** quotes per contract per window (right-aligned — `q10_*` is always the newest = the replay's slot quote) + summary stats; day-level counters per contract. One-sided quotes captured faithfully (guards are the replay's job).
- **Extraction universe = `data/universe_extract.json`** — the $75B S&P superset (~169 names; built via `build_universe.py --threshold 75000000000 --out data/universe_extract.json`), a superset of the scan's $100B universe so future point-in-time corrections are replay-side filters, not re-extractions.
- **⚠ Flat-file layout discovery (2026-07-26):** quotes_v1 day files are a **concatenation of internally-sorted partitions** — NOT one global alphabetical pass (partition 1 of 2026-07-24 runs A→BAC but is missing AMAT/AMD/AMZN; they appear later). The extractor therefore streams to physical EOF (never early-exits) and merges per-contract state in a dict across partitions. `day_aggs_v1` files ARE globally sorted. Any future flat-file consumer must respect this.
- **Performance (measured, this Mac):** network-bound at ~5–7 MB/s per S3 stream (S3 throughput varies; probes saw up to 18); CPU is ~26 s/GB worst-case (52 s user per 2 GB in the densest stretch) via run-based galloping + binary-searched window slices — only in-window rows of universe contracts are parsed. Run multiple dates in parallel to use the pipe; EC2 sizing for the B2 year-stream should assume CPU is NOT the bottleneck below ~50 MB/s per worker. **Per-stream throughput decays over a connection's lifetime** (measured 16–18 MB/s at open → 2.3 MB/s after ~21 h; limits are per-connection, not per-account) — use `--reconnect-every-gb 8` to proactively recycle the connection via the ResumableBody resume path.
- **Memory (chunked writer, 2026-08-05):** the endgame streams flushed rows through an incremental pyarrow `ParquetWriter` in ~100k-row batches (schema pinned in `_extract_schema()` — identical columns/dtypes to the original single-shot writer, more row groups). Peak memory = the per-contract state dict (~1.7 GB at ~320k contracts; must persist to EOF because of partition recurrence — never flush at underlying boundaries) + one batch. The old build-everything-then-`pd.concat` endgame peaked ~6.9 GB total-vm and OOM-killed the 2 GB EC2 box three times (2026-08-04/05); the extractor now fits EC2's 2 GB + 4 GB swap and logs its peak RSS on the DONE line.
- Output `data/extracts/DATE.parquet` (+ verbatim `day_aggs/DATE.csv.gz`) — **gitignored data**; immutable; re-runs skip existing dates (resumable). `--limit-gb N` smoke-tests to a `.partial.parquet` that is never treated as complete.
- **Validation:** `scripts/validate_extract.py --date DATE` — duplicate/bounds integrity, REST `list_quotes` exact-match cross-check (nanosecond standard), and the ml_dataset leg-premium comparison (staleness quantification for pre-2026-07-27 dates; the true live-overlap agreement gate for quote-priced cron days after the EC2 deploy).

### Backtest Replay — `scripts/replay_scan.py` (RANKER_SPEC Phase B1b)

Replays the sector scan for a historical (date, slot) from the local extracts, writing `ml_dataset`/`sector_scan_runs` with **`source='backtest_open'` / `'backtest_close'`** (slot-split, mirroring `live_open`/`live_close`). **Default is dry-run; `--write` persists.** Same-code-path design (zero duplicated filter/scoring logic):

> **Slot-split source (2026-07-28, `docs/backtest_slot_split_migration.sql`):** the de-dup keys (`uniq_ssr_run (source, scan_date, sector)` and `uniq_ml_dataset_observation (source, …)`) are slot-blind unless the slot lives inside `source`. The replay originally wrote plain `'backtest'` for both slots, so a both-slots run's close pass deleted/replaced the open pass's rows. The migration adds `backtest_open`/`backtest_close` to both CHECK constraints (no index changes needed — the existing keys become slot-aware, exactly as live). Plain `'backtest'` remains legal in the DB as a legacy transitional value but **no writer uses it**; a future migration can drop it once no rows carry it.

- `screener.scan_ticker` gained two backward-compatible params: `chain_provider` (callable returning parsed contract dicts; defaults to the live Massive snapshot via the extracted `_live_chain_provider`) and `as_of` (valuation date for time-to-expiry; defaults to today). Liquidity guards are shared via `screener.passes_quote_guards`; `options_screener.get_next_fridays` gained `as_of` for point-in-time weekly targets. Live behavior is unchanged by default — regression-verified.
- The replay's provider serves each contract's newest in-window quote (`q10`) from the extract, computes delta via `lib/bs.py` from the quote mid (ill-posed IV solve → contract excluded, the replay analogue of the live IV-placeholder filter), and applies the same volume≥20 filter from the stored day_aggs. Slot quote = last NBBO ≤ 10:05/15:35 ET — mirrors the live cron's 0–4-min scan band; documented approximation, never lookahead.
- Selection + writes share `sector_scan.py`'s `select_top_n` / `write_picked` / `write_nonpicked` (same de-dup/re-run cleanup semantics).
- **Point-in-time context:** per-ticker/SPY spot from Massive minute aggs at the slot (success-only disk cache `data/extracts/spot_cache.json`; paced + retried — recent dates 429 until Massive tiers them historical); VIX from yfinance ^VIX 60m bars (raises if missing — no silent substitution); days-to-earnings from yfinance `earnings_dates` (the historical table, NOT `.calendar` which leaks the present); FOMC/CPI/PPI/NFP from the published annual schedules — valid only near-present, so the replay **refuses dates > 14 days back** until historical schedule reconstruction exists (documented TODO for the year-scale backtest).

### `screener.py`
- Call Spread Risk Reversal screener — available as both a standalone CLI and via the web UI (`/api/run`)
- Run with `python3 screener.py` or with optional arguments (see below)
- Imports `get_next_fridays` and `massive_client` from `options_screener.py` — no duplicate client initialization
- `scan_ticker(ticker, price, week_exps, min_premium, min_p_profit=None)` — uses Massive for options chains; delta comes pre-calculated; accepts `min_p_profit` as a parameter so the web API can override it per-request (defaults to module-level `MIN_P_MAX_PROFIT = 0.50` when None). Prices each leg on its transactable side at candidate-segmentation time (`premium = ask` for Leg A, `= bid` for Legs B/C) and applies the monotonicity sanity check (reject + stderr-log any `leg_b_prem ≥ leg_a_prem` pairing)
- `_parse_massive_contracts(raw)` — filters and normalizes Massive snapshot objects; applies IV ≤ 0.01, the two-sided-quote + `MAX_SPREAD_PCT` (0.15 of mid) guards, and volume < 20 exclusions; returns list of `{strike, bid, ask, mid, delta, volume}` dicts (no role-priced `premium` yet — `scan_ticker` assigns that per leg)
- `week_exps` is built directly from `get_next_fridays()` target Fridays as `(week_num, YYYY-MM-DD)` tuples — no yfinance expiration matching needed

**Strategy (3 legs):**
- **Leg A**: Buy ATM call (delta 0.40–0.60) — pay premium
- **Leg B**: Sell OTM call (delta 0.20–0.40, strike > Leg A) — collect premium; candidates nearest spot tried first
- **Leg C**: Sell OTM put (delta 0.15–0.30, strike < current price) — collect premium
- **Goal**: Net Premium = (Leg B + Leg C) − Leg A ≥ $5.00 (credit only)

**Leg B ordering:** candidates are sorted by proximity to the current spot price (nearest first). (This was formerly "fair-value targeting" — removed as a no-op, see the Fair value section above.)

**Filters applied per leg:**
- IV ≤ 0.01 → excluded (placeholder values from closed market)
- No live two-sided quote (bid > 0 and ask > 0) → excluded (not tradeable)
- Bid-ask spread > `MAX_SPREAD_PCT` (0.15) of the quote midpoint → excluded
- Volume < 20 → excluded
- Delta must fall within each leg's specified range
- Leg B premium (bid) ≥ Leg A premium (ask) → pairing rejected + stderr log (monotonicity sanity check)
- Net premium < `--min-premium` → triplet skipped immediately
- P(max profit) = (1 − Leg B delta) × (1 − Leg C delta) < 0.50 → triplet skipped

**Scoring:** `score = net_premium / spread_width` where `spread_width = Leg B strike − Leg A strike`

**Output columns:** Rank, Ticker, Expiration, Wk, Leg A Strike, Leg A Pm, Leg B Strike, Leg B Pm, Leg C Strike, Leg C Pm, Net Prem, Spd Width, Score, P(Profit)%

**Highlighting:**
- Red rows: P(max profit) between 50–55% (borderline)

**CLI arguments:**
- `--tickers NVDA META` — override default watchlist
- `--weeks 6` — maximum weekly expiration (default: 12, max: 12)
- `--weeks-min 3` — minimum weekly expiration (default: 1)
- `--min-premium 3.00` — override the $5.00 minimum net credit

## Web UI (`web/`)

Built with Vite + React + Tailwind CSS. Source in `web/src/`, built output in `web/dist/` (served by Flask, gitignored).

**To rebuild after frontend changes:** `cd web && npm run build`

### Single-strategy screener

There is no mode toggle — the screener loads straight into the Call Spread Risk Reversal table. All scan state lives in one place (`ranked`, its control inputs, its staleness check) and is persisted to sessionStorage so it survives in-session navigation. The **Clear** button (in the Header) is the explicit reset path.

### Authentication (Supabase)

Auth is handled via `@supabase/supabase-js`. The client is initialized in `web/src/lib/supabase.js` using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `web/.env`.

- **`web/src/lib/supabase.js`** — exports the `supabase` client singleton
- **`web/src/hooks/useAuth.js`** — exports `useAuth()` hook returning `{ user, session, loading }` via `getSession` + `onAuthStateChange`
- **`web/src/pages/LoginPage.jsx`** — dark-themed **split-screen** auth page at `/login` serving **both sign-in and public sign-up** via a `mode` toggle (`'signin'` | `'signup'`); redirects to `/` if already logged in. **⚠ Supabase-side public signups are disabled (personal research project) — the UI signup path is dead-ended pending removal.** **Left half:** vertically-centered form — Luo Capital lockup, a mode-aware heading ("Welcome back." / "Create your account.") + subline, Email + Password fields (password has a Show/Hide toggle, UI-only), and a muted `© 2026 · Luo Capital` footer. **Right half:** a darker brand panel with an SVG-only candlestick motif (slate wicks, profit/loss bodies, faint grid, faint purple radial glow) whose candles drift slowly via the `.candle-a/b/c` keyframes in `index.css` (~6–8s, honors `prefers-reduced-motion`); a centered `Luo Capital / Options Screener` lockup sits over it. No WebGL / video / external images. **Responsive:** the right panel is `hidden lg:block`, so narrow screens show the full-width centered form only.
  - **Mode toggle** — a small centered link under the form switches modes: `New here? Create an account` ↔ `Already have an account? Sign in` (`switchMode()` clears error/notice and the confirm field). The accent-purple primary button reads **Sign in** or **Create account** accordingly.
  - **Sign-up flow (public)** — in `'signup'` mode the form adds a **Confirm password** field; `handleSubmit` validates `password === confirmPw` client-side (inline `Passwords do not match.` on mismatch, no submit) before calling the **existing** `supabase.auth.signUp({ email, password })` path (surfaced, not rewritten). **The post-signUp branch is session-aware so the UI is correct regardless of the Supabase "Confirm email" setting:**
    - **Session returned** (confirmation **off** → Supabase logs the user in immediately) → route straight into the screener like a normal sign-in; **no** "check your email" notice.
    - **No session** (confirmation **on** → must verify) → the user is **not** logged in; the page switches back to `'signin'`, clears the password fields, and shows the on-brand notice `Check your email to confirm your account, then sign in.`
    This "just works" if **"Confirm email"** (Supabase dashboard → **Authentication → Providers/Email**) is toggled on later — no code change needed.
  - **Auth logic unchanged** — still uses `supabase.auth.signInWithPassword` / `supabase.auth.signUp` and the existing `useAuth`; routes into the screener on a successful sign-in.
  - **Inline states** (loss-red `error` for failures; an on-brand `notice` band, `border-accent/40 bg-accent/10`, for confirmation/info):
    - Mismatched passwords → `error`, no submit.
    - Email already registered → friendly `An account with this email already exists — sign in instead.` (detected from Supabase's `already registered/exists` error message **and** from the obfuscated `data.user.identities.length === 0` response Supabase returns when confirmations are on, to defeat enumeration).
    - Weak password / other Supabase signUp errors → surfaced inline via `error` (Supabase's own message).
    - Unconfirmed-email sign-in → `notice` telling them to check their inbox (detected via `error.code === 'email_not_confirmed'` / message match), not a generic error.
    - Existing failed-sign-in still renders as inline `text-loss`.
  - All styling uses the design tokens (`bg-base`, `bg-surface-raised`, `border-subtle`, `text-primary/secondary/tertiary`, `bg-accent`/`text-accent`, `text-loss`).
- **`ProtectedRoute`** (in `main.jsx`) — wraps routes requiring auth; redirects to `/login` if `user` is null after loading
- **Header logout** — "Log out" button in the screener header calls `supabase.auth.signOut()` then navigates to `/login`
- **`server/app.py`** — loads `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from `.env` (project root); exports `verify_token(req)` helper that validates JWT from `Authorization: Bearer <token>` header using the Supabase Python client's `auth.get_user(token)`

### Routing

React Router v7 (`react-router-dom`) with `createBrowserRouter` + `RouterProvider`. All routes are defined in `main.jsx` — **not** in `App.jsx`. This is the correct v7 pattern; nesting `<Routes>` inside a component that is itself a route element causes a double-router conflict where URL changes but page content never switches.

- `/login` → `<LoginPage />` — public; redirects to `/` if already authenticated
- `/` → `<ProtectedRoute><App /></ProtectedRoute>` — screener page
- `/trade` → `<ProtectedRoute><TradePage /></ProtectedRoute>` — trade editor (navigate here with router state `{ triplet }`)
- `/tradebook` → `<ProtectedRoute><TradebookPage /></ProtectedRoute>` — saved trades

Each page component renders its own `<Header />`. Header detects the current path via `useLocation` and renders the appropriate variant.

### State persistence (sessionStorage)

Screener state survives in-session navigation (e.g. screener → `/trade` → back) so users don't lose their work when editing a triplet. Two `sessionStorage` keys, both managed via `web/src/lib/sessionState.js`:

- **`luo-capital-screener-state`** — App.jsx control state, written via a single `useEffect` whose deps include every persisted field. Persisted fields:
  - `tickerInput` (raw text in the Tickers input)
  - `activeTickers` (post-filter ticker pills)
  - `weeksMin`, `weeksMax`, `minPremium`, `minPProfit` (numeric controls)
  - `minPremiumStr`, `minPProfitStr` (raw input strings — preserve partial typing like `4.`)
  - `selectedSetup` (explicit table-row override; `null` → panel shows the current view's rank-1 default)
  - `tickerFilter` (per-ticker results filter set by double-clicking a scanning chip; `null` = no filter)
  - `drawerOpen` (left controls-drawer open/closed — remembered for the session; defaults `false` on first load)
- **`luo-capital-screener-results`** — `{ result }` from `useOptionsData`, written when it changes. Preserves the full ranked table, `tickers_used`, `weeks_min_used`/`weeks_max_used`, etc.

Hydration uses lazy `useState` init via `useMemo(loadScreenerState, [])`. **Do not** read sessionStorage outside `useMemo` / lazy init or you'll re-read on every render.

**Important — the activeTickers sync useEffects in App.jsx:**
```js
const lastTickersUsedRef = useRef(tickersUsed)  // primed with initial value
useEffect(() => {
  if (tickersUsed !== lastTickersUsedRef.current) {
    setActiveTickers(tickersUsed)
    lastTickersUsedRef.current = tickersUsed
  }
}, [tickersUsed])
```
The naive `useEffect(() => setActiveTickers(tickersUsed), [tickersUsed])` would overwrite the persisted `activeTickers` on mount because the hydrated `result` produces a fresh `tickers_used` array reference. Priming the ref with `tickersUsed`'s initial value makes the first post-mount effect a no-op (refs match). New scans still sync correctly because `setResult` produces a new object and a new array reference.

**Logout** clears both keys via `clearScreenerSession()` (called in `Header.handleLogout` before `supabase.auth.signOut()`). Closing the tab clears them automatically (sessionStorage default).

### Layout — viewport-locked screener with internal table scroll

The screener page (`App.jsx` route `/`) is locked to viewport height so the Header, the slim scanning-chips row, and the table's metadata bar always stay in view. Only the table body scrolls. The scan **filter** controls live in a **collapsible left drawer** (closed by default — see `ControlsDrawer.jsx`), opened by the `⚙ Controls` trigger in the header; the scan-**Tickers** input and Run Scan both live in the header. The table legend is **collapsed by default** (toggled from the metadata bar). The macro-events band has been **removed from the UI** (the macro data is still in the scan response — see below).

Two zones stack vertically inside the locked page: **controls** (`shrink-0`) and the **detail zone** (`<main>`, `flex-1`). The detail zone is a horizontal flex row of **two columns**:
- **Left column** (`w-[35rem] shrink-0`, ~38% on a typical laptop) — **`SetupDetail` stacks ABOVE the ranked table**. SetupDetail is a `shrink-0` band on top; below it a `flex-1 min-h-0` wrapper holds the `ResultsTable`, which scrolls within its own area. The 35rem width is the table's natural column sum (33rem) plus ~2rem trailing padding after Max Profit.
- **Right column** (`flex-1 min-w-[360px]`) — the **TradingView chart alone**, filling all remaining width and the **full height** of the zone (no card strip above it anymore), so the price / volume / RSI panes all have room.

When the chart is fullscreen (`isChartFull`), the left column is not rendered and the chart fills the whole zone. (The per-ticker overview card strip that used to sit above this zone was **removed** — selection is now driven purely by clicking a table row.)

The chain that makes this work:

1. **`App.jsx` outer div** — `h-screen overflow-hidden flex flex-col`. Locks the page to 100vh; nothing escapes vertically.
2. **`<main>`** — `flex-1 min-h-0 overflow-hidden flex flex-col`. Takes the remaining vertical space; when there are results its child is a `flex-1 min-h-0 flex gap-3 p-3` **row** (table + chart panel), each column a `min-h-0` flex child so both can size independently.
3. **`ResultsTable.jsx` outer div** — `flex-1 min-h-0 flex flex-col overflow-hidden`. Fills its table column and contains the metadata bar (with `shrink-0`), legend (with `shrink-0`), and the scroll wrapper.
4. **Scroll wrapper inside the table component** — `flex-1 min-h-0 overflow-auto`. Both axes scroll: vertical for long row lists, horizontal for wide tables.
5. **Sticky column headers** — `<th>` elements (not `<thead>` or `<tr>`) carry `sticky top-0 z-10 bg-gray-900 border-b border-gray-700`. Sticky must be on the cell, not the row, because `border-collapse: collapse` prevents `<tr>`-level sticky from working reliably across browsers. `bg-gray-900` is required so scrolled rows don't show through; the border-bottom on each `<th>` forms the divider line beneath the sticky header.

**`min-h-0` is load-bearing** — without it on flex children, the default `min-height: auto` makes them refuse to shrink below their content size, defeating the overflow chain. Add it on every flex child in this stack.

Empty / loading states (`EmptyState`, `LoadingSpinner`, `ResultsTable.jsx` no-data branch) all use `flex-1 min-h-0` so they fill the available space and center properly instead of hugging the top of `<main>`.

This pattern is scoped to the screener route. Other pages (`/trade`, `/tradebook`, `/login`) use natural document flow.

### Key components

- **`App.jsx`** — screener page only (not a router/layout); owns all scan state, chart state, and control logic
  - **Row-driven per-setup detail model.** A single state atom drives the detail panel: `selectedSetup` (an explicit table-row override — `null` = use the rank-1 default). Everything else is **derived**:
    - `baseRanked` = `ranked` filtered by the Holdings `activeTickers` (the scan-set chips); `tableRows` = `baseRanked` further filtered to `tickerFilter` (the double-click chip filter, if set), re-ranked `1..N`.
    - `displayedSetup` = `selectedSetup ?? baseRanked[0]` (the overall rank-1) → feeds `SetupDetail`; `chartTicker = displayedSetup?.ticker` feeds the chart; `selectedKey` (matches `ResultsTable.rowKey`) highlights its row.
  - **Behavior:** on a new scan a `useEffect` (primed `lastRankedRef`) resets `selectedSetup` AND `tickerFilter` to `null` → the detail panel + chart **default to the overall rank-1 setup**, with the rank-1 row highlighted. `selectRow(row)` (row click) sets `selectedSetup` → SetupDetail and the chart switch to that specific setup (this still works **within** an active ticker filter). `toggleTickerFilter(ticker)` (chip double-click) toggles the single-ticker results filter on/off/switch and clears the row override → the table + chart/detail filter to that ticker and default to its rank-1; the chip gets the accent highlight. Removing a scanning chip (`×`) that is the current override / filter clears it (falls back to overall rank-1).
  - App also owns `chartFull` (default `false`, not persisted) — the chart's `⤢` button expands it to **fill the whole detail zone** (the left column is hidden via `isChartFull = chartFull && !!chartTicker`), and `⤡` collapses it back to the two-column layout. `chartFull` resets to `false` on a new scan and on Clear.
  - The detail-zone chart is the **TradingView Advanced Chart embed** (`TradingViewChart.jsx`), driven by `toTvSymbol(chartTicker)` — App fetches no chart data from our backend. `selectedSetup`, `tickerFilter`, and `drawerOpen` are persisted to sessionStorage.
  - **Controls live in a collapsible LEFT drawer** (`ControlsDrawer.jsx`), **closed by default** on load so the results (table + detail + chart) get full width. The `⚙ Controls` trigger in the header toggles it (`onToggleControls` / `controlsOpen` props on `Header`); the drawer slides in from the left over a click-to-close backdrop. `drawerOpen` is remembered for the session and **auto-closes when a scan runs** (`handleRun` sets it `false`) so the user drops into results. **Run Scan stays in the header**, not in the drawer, so re-scans don't require opening it. The three filter fields — Weeks range, Min Net Premium, Min P(Profit) — are stacked vertically and full-width inside the drawer; pressing Enter in any field also runs the scan. **The scan-Tickers input lives in the header center, not the drawer** (see Header below) — it drives the same `tickerInput` state, so removing it from the drawer changed nothing about parsing or the chips row.
    - **Weeks slider** (`components/WeeksRangeSlider.jsx`): two stacked native `<input type="range">` elements, each capturing one thumb. Track + active fill drawn as divs underneath. Thumb appearance is styled in `index.css` under `input[type="range"].dual-thumb` (cross-browser webkit/moz). The current `{min}–{max}` value sits to the right of the slider inside the contained field.
    - **Min Premium $ / Min P(Profit) %** are **free-text** inputs (`type="text"` with `inputMode="decimal"`/`numeric`) rendered as **unified steppers** (`−` button · borderless input · `+` button) inside one `bg-surface-raised` rounded field. The user can clear and type any value (incl. partial decimals like `4.`). Each has a paired raw-string state (`minPremiumStr`, `minPProfitStr`) and a numeric state (`minPremium`, `minPProfit`). On every keystroke the string updates; the numeric value updates only when the input parses as valid (premium: any non-negative number; P(profit): integer 1–99). Invalid input turns the **field border `border-loss`** (red) but does NOT block typing. On blur, P(profit) is clamped into [1, 99] and premium reverts to the last valid value if invalid. The `+` / `−` buttons bump the numeric value (premium by ±0.50, P(profit) by ±1) and re-sync the string. All field state/handlers are owned by `App.jsx` and threaded into `ControlsDrawer` as props (lifted state — the drawer is pure presentation).
  - **Client-side filtering:** removing a scanning chip (`×`) instantly hides that ticker's rows, and double-clicking a chip filters to a single ticker — both without a new API call
  - **Staleness detection:** Run Scan button turns amber "⚠ Rescan needed" when controls diverge from last scan's params: weeks_min changed, weeks_max changed, min premium changed, min P(profit) changed, or a new ticker typed. Removing pills is NOT stale (client-side handled).
  - `handleRun()` — calls `runScan` with the current controls
  - Does not contain any `<Routes>` or `<Route>` — routing is entirely in `main.jsx`
- **`Header.jsx`** — route-aware header (uses `useLocation`); rendered independently by each page component:
  - `/` (screener): a **contained surface panel** (`bg-surface`, rounded, `border-subtle`) laid out as **three zones via `justify-between`**: **left** = branding lockup (`Luo Capital / Options Screener`, `flex-shrink-0`); **center** = the scan-**Tickers** text input (`flex-1 min-w-0`, `max-w-md`); **right** = the action cluster (`flex-shrink-0`) — market badge → **`⚙ Controls`** (toggles the left controls drawer; `onToggleControls` prop, accent border when `controlsOpen`) → Clear → **Run Scan** (the `bg-accent` primary, amber when stale) → Tradebook → a divided, muted `Last run {timestamp}` + `Log out`. The center **Tickers** input (relocated from the controls drawer) is bound to App's `tickerInput`/`setTickerInput` (placeholder `Enter tickers or a @watchlist to scan`) and **Enter runs the scan** (`onRun`), identical to the Run Scan button. It accepts bare tickers **and `@watchlist` references** (see Named Watchlists below) — resolution happens in `App.handleRun` before the scan. **There is no implicit blank-input default** — empty input (blank / whitespace / separators only) does NOT scan; it shows the inline hint *"Enter one or more tickers or a @watchlist to scan."* (the default 10-stock list is now just a user-created named watchlist like any other). On a resolution error (e.g. unknown `@name`) the header shows the same **inline error** under the input (`tickersError` prop, `text-loss`, absolutely positioned so header height doesn't shift; red input border) and the scan does NOT run; the error/hint clears as soon as the input changes. An adjacent **info tooltip** (inline-SVG "Info" icon — no icon dependency; muted `text-tertiary`) sits just right of the input and, on **hover and keyboard focus** (`group-hover` + `group-focus-within`), shows an on-brand dark popover: *"Enter tickers separated by commas or spaces (NVDA, META). Use @name to scan a saved watchlist (e.g. @semis). Manage watchlists in Controls."* Lockup + controls are `flex-shrink-0` so they keep their space; the center input shrinks first on narrow windows. (Earlier iterations briefly put a TradingView ticker tape in this center space, then left it empty; it now holds the Tickers input.)
  - **Clear button** (`bg-surface-raised` + `border-subtle`, in the action cluster) calls `onClear` from props. App.jsx's `handleClear` resets every persisted control to its default (`tickerInput=''`, `activeTickers=[]`, controls back to `weeksMin=1/weeksMax=12/minPremium=5.00/minPProfit=0.50`, chart fullscreen back to `false`), calls `clearAll()` to wipe scan results, and calls `clearScreenerSession()` to flush sessionStorage. The persist effects then immediately re-write the defaults back, so sessionStorage ends up containing the default-state snapshot rather than being empty.
  - `/tradebook`: minimal header with ← Back to Screener button + "Tradebook" label
  - `/trade`: minimal header with ← Back to Screener button + "Trade Editor" label
  - All navigation uses `useNavigate` (no `<Link>` or `<a>` tags)
- **`ControlsDrawer.jsx`** — the scan **filter** controls (Weeks range, Min Net Premium, Min P(Profit)) in a panel that **slides in from the left**, over a click-to-close backdrop. **The scan-Tickers input is NOT here** — it lives in the header center (see Header). **Closed by default** (`drawerOpen` defaults `false`); opened by the header's `⚙ Controls` trigger; auto-closes when a scan runs. Run Scan is **not** in here (it stays in the header). Pure presentation — every value/handler is owned by `App.jsx` and threaded through props. Enter in any filter field calls `onRun`. The drawer also renders **`WatchlistManager.jsx`** (the named-watchlists management UI — see Named Watchlists below).
- **`WatchlistManager.jsx`** — named-watchlists CRUD UI rendered inside the controls drawer: lists the user's watchlists (`@name`, ticker count + preview), with inline create (name + tickers) / edit / delete. Local form state only; persistence + in-app state live in `App.jsx` via the `onCreate`/`onUpdate`/`onDelete` callbacks (create/update return `{ error }` on failure, falsy on success → form clears). Uses the drawer's design tokens.
- **`Toast.jsx`** — fixed bottom-right toast notification; accepts `message` and `visible` props; fades in/out over 0.3s; used in App (after saving from the detail panel's Save action) and TradePage (after Save to Tradebook)
- **`ResultsTable.jsx`** — scannable ranked list of **5 decision columns only**: Rank, Ticker, Expiration (with `W{week}` muted inline), **Net Premium** (collected credit, per contract `net_premium × 100`, `text-profit`, `+$2,044`), **Max Profit** (`(net_premium + spread_width) × 100`, `text-profit`). **Score and P(Profit)% are NOT shown** — score remains the backend sort order (rows arrive sorted by it; default sort key `rank`) but appears nowhere in the table; P(profit), the leg breakdown, and spread width all live in the detail panel (`SetupDetail`). The row objects still carry all that data; it's just not rendered in the table. There is **no legend** and **no score bar** (both removed).
  - **No row dropdown / no inline expansion.** Clicking a row calls `onRowSelect(row)` → App's `selectRow` (sets `selectedSetup`), which drives the whole detail panel (chart + `SetupDetail`). Save / open-editor actions live in `SetupDetail`.
  - **Selected-row highlight:** the row matching `selectedKey` (App derives it from the displayed setup to match `rowKey`) gets a distinct bg + a `border-accent` left marker on the Rank cell, so it's obvious which row the panel is showing (on a fresh scan that's the rank-1 row).
  - **Column layout:** the table uses **`table-fixed`** with a `<colgroup>` that pins each column to its `width` (Rank 3 / Ticker 3.5 / Expiration 8 / Net Premium 7.5 / Max Profit 7.5 rem — sized to fit the narrower ~38% table), plus a trailing **spacer `<col>` (no width)** that absorbs ALL leftover space. So the 5 columns sit at fixed widths grouped on the left — identifiers (Rank, Ticker, Expiration — `whitespace-nowrap`) **left-aligned**, numerics (Net Premium, Max Profit) **right-aligned** — with **no stretching and no dead gaps** between them, regardless of panel width (the spacer holds the empty space on the right). This is the robust fix for the auto-layout spacer occasionally letting columns expand.
  - Row background signals (kept): red bg when P(profit) is borderline (between minPP and minPP+10%); alternating gray otherwise; selected overrides all. (The yellow no-fair-value signal was removed with the fair-value feature.)
  - Metadata bar shows: algorithm, weeks range, min premium, min P(profit)%, triplets ranked, total evaluated. No legend toggle / no "click a row" hint (removed).
- **`SetupDetail.jsx`** — the rich detail block for the selected setup, rendered as a compact `shrink-0` **band at the top of the LEFT column**, stacked **above the ranked table** (the table's `flex-1` wrapper fills the height below it). Shows: setup stats (collected / max profit / score 2 dp / P(profit) 1 dp) in a wrapping row, the **full three-leg breakdown** (`leg` / strike / prem / delta per leg, color-coded per convention — **Leg A long call = sky** (you pay), **Leg B short call & Leg C short put = profit token** (you collect)), spread width, and the **Save** / **Open in editor ›** actions (wired to App's `saveToTradebook(displayedSetup)` / `handleEdit(displayedSetup)`). It renders for the `displayedSetup` (rank-1 default, or the row-selected one). Pure presentation; tokens only; per-contract dollars are `× 100`.
- **Per-ticker overview section** — ⚠️ **removed.** A horizontal strip of "top-pick" cards ("Best per ticker") used to sit between the controls and `<main>`, one card per ticker driven by a `by_ticker[i]` entry. It was deleted entirely: the page no longer renders the strip, the `OverviewCard.jsx` component file was deleted, the `byTicker`/`overviewCards` derivation and the `cardFilter` / scroll-helper state were dropped from `App.jsx`, and the `.no-scrollbar` CSS utility (added only for the strip) was removed from `index.css`. Selection is now driven purely by ranked-table row clicks. (`/api/run` still returns `by_ticker` — see that section — but nothing consumes it.)
- **`Holdings.jsx`** — the "Scanning:" ticker chips, rendered in their **own slim visible row** (a thin `bg-surface` panel) just above the results area — **not** in the controls drawer. Two interactions per chip: the **`×`** button removes that ticker from the scan set (`onRemove`, instantly hides its rows; `e.stopPropagation()` so it never triggers the filter); **double-clicking the chip body** toggles the per-ticker results filter (`onToggleFilter`) — the filtered chip gets the **accent highlight** and the table + chart/detail narrow to that one ticker (defaulting to its rank-1). Double-click again to clear, or a different chip to switch. Only one ticker filtered at a time (`activeFilter` prop drives the highlight).
- **Macro events — ⚠️ removed from the UI.** The macro-events pill band, its toggle, and the `MacroEvents.jsx` component file were all deleted (the component had been unimported since the macro UI was removed). **Backend is untouched** — `event_filter.py`, the macro/earnings computation, and the `macro_events` field in the `/api/run` response all remain fully intact (the data is retained for future ML model training); `useOptionsData` still exposes `macroEvents`, it's just not consumed by `App.jsx`. The `GET /api/events` endpoint is also unchanged.
- **`pages/TradePage.jsx`** — trade editor at `/trade`; receives triplet via router state; renders its own `<Header />`
  - Three-column layout: Leg A (long call), Leg B (short call), Leg C (short put)
  - Fetches call and put chains from `/api/chain` on mount; back-fills volume/OI for initial selected strikes
  - **Each leg column prices on its transactable side of the quote**: Leg A's chain shows (and selects) the **Ask**, Legs B/C show the **Bid** — matching the scanner's pricing convention exactly. `ChainTable`/`LegColumn` take `priceKey` ('ask'|'bid') + `priceLabel` props; `onSelect` stores `c.ask` / `c.bid` into `selected.premium`, so recalculated metrics and tradebook saves stay on the same basis as scan output
  - User clicks a chain row to change the selected contract for that leg (highlighted with indigo ring)
  - Summary bar above columns shows Net Premium, Spread Width, Score, P(Profit)% — updates only on Recalculate
  - Save to Tradebook inserts into Supabase `tradebook` table; shows Toast for 3s
- **`pages/TradebookPage.jsx`** — tradebook at `/tradebook`; fetches from Supabase on mount, deletes via Supabase; renders its own `<Header />`
  - Table columns: Date Saved, Ticker, Expiration, Leg A/B/C Strike, Net Premium, Score, P(Profit)%
  - Each row has a × delete button; "Clear all" button at top right
  - Trades fetched with `.order('saved_at', { ascending: false })` — most recent first
- **`TradingViewChart.jsx`** — the **contextual chart panel in the detail zone** (right of the ranked table, below `SetupDetail`): a **TradingView Advanced Chart embed** (dark theme, daily candles, Volume + RSI study panes). It replaced the homegrown Recharts chart (`StockChart.jsx` + `useChartData.js`, both deleted — the `/api/chart` backend endpoint was left intact, see its section above).
  - **Embed mechanics:** uses TradingView's **official embed script** (`https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js`), NOT the unmaintained `react-tradingview-widget` npm package. A `useEffect` keyed on `symbol` clears the container div and re-injects the script with the config JSON as its text content — so switching tickers tears down the old widget and creates a fresh one (no stacked widgets); the cleanup function clears the container on unmount.
  - **Config:** `autosize: true` (iframe fills the panel — the wrapper is `flex-1 min-h-0` so it has a real height), `interval: "D"`, `theme: "dark"`, `style: "1"` (candles), `studies: ["STD;Volume", "STD;RSI"]` (fall back to `["Volume@tv-basicstudies", "RSI@tv-basicstudies"]` if the STD; ids ever stop rendering), `hide_side_toolbar: true`, `allow_symbol_change: false`, `calendar: false`. `backgroundColor`/`gridColor` are the raw hex behind `--bg-surface` (#1E293B) / `--border-subtle` (#334155) — duplicated as constants because the embed config can't read CSS custom properties; keep them in sync with `index.css`.
  - **Symbol mapping:** TradingView needs exchange-prefixed symbols. `toTvSymbol(ticker)` (exported) builds `EXCHANGE:TICKER` from `EXCHANGE_MAP` — `GEV` and `TSM` (NYSE; TSM is an NYSE-listed ADR, GEV is GE Vernova on NYSE) — everything else in the watchlist (`PLTR`, `APP`, `AVGO`, `META`, `MU`, `NVDA`, `TSLA`, `AMD`) is NASDAQ (PLTR moved NYSE → NASDAQ in Nov 2022). Unknown tickers default to `NASDAQ:`.
  - **Chrome:** a slim header keeps the `⤢ / ⤡` fullscreen-within-detail-zone toggle (`fullscreen` + `onToggleFull` props, same `chartFull` state in App as before). Below the widget sits the **TradingView copyright/attribution link — required by their embed terms, do not remove it**.
  - There is no timeframe `<select>` and no header price anymore — the widget has its own interval controls and price display, and the old `chartTimeframe` state/persistence was removed from App.


- **`useOptionsData.js`** — custom hook managing all API calls and result state
  - `runScan({ tickers, weeksMin, weeksMax, minPremium, minPProfit })` — POSTs to `/api/run` (forwarding the Supabase JWT for scan logging), stores in `result`
  - `clearAll()` — wipes `result` and clears any error; called by the Clear button
  - Exposes fields: `ranked`, `tickersUsed`, `tickersSkipped`, `weeksMinUsed`, `weeksMaxUsed`, `minPremiumUsed`, `minPProfitUsed`, `totalEvaluated`, `hasResult`, `scanId`, `macroEvents`
  - `marketOpen` and `lastRun` derived from whichever is available (result → status)
  - **Important:** all empty-array fallbacks use a module-level `const EMPTY = []` instead of inline `?? []`. Inline `[]` creates a new reference every render, which causes `useEffect([tickersUsed])` in App to fire every render → infinite setState loop → navigation broken. Never change these back to inline `[]`.

### Named Watchlists — `watchlists` table + `@name` scan syntax

Per-user named watchlists let a user save a set of tickers under a name (e.g. `semis` → NVDA, AMD, MU, AVGO) and scan it by typing **`@semis`** in the header tickers input. Full DDL in **`docs/watchlists_schema.sql`** (run once in the Supabase SQL Editor).

- **Table `watchlists`**: `id uuid pk`, `user_id uuid references auth.users not null`, `name text` (stored **lowercase**, no spaces, no leading `@`), `tickers text[]`, `created_at`, `updated_at`, **`unique (user_id, name)`**. RLS enabled, **mirroring the `tradebook` security model** — `for all using (auth.uid() = user_id)` — plus an explicit `with check (auth.uid() = user_id)` because watchlists are created/edited **directly from the browser** supabase-js client (tradebook inserts go through the service role, which bypasses RLS; watchlist writes don't, so the insert/update path must be RLS-checked). A user only ever sees/edits their own rows.
- **Loading / CRUD** (`App.jsx`, mirrors the `TradebookPage` client pattern): on `useAuth()` `user`, `watchlists` is loaded via `.from('watchlists').select('*').eq('user_id', user.id).order('name')` (RLS also scopes it). `createWatchlist`/`updateWatchlist`/`deleteWatchlist` write via supabase-js and update the in-app `watchlists` state immediately so `@`-resolution sees changes with no reload. Create/update return `{ error }` (falsy on success).
- **Name rules** (`lib/watchlists.js` `validateWatchlistName`): non-empty, no leading `@`, **no spaces**, letters/digits/`_`/`-` only, ≤ 32 chars. Names are **case-insensitive** — normalized to lowercase on save (`normalizeWatchlistName`), so `@Semis` and `@semis` are the same watchlist (and `unique(user_id, name)` enforces case-insensitive uniqueness). Duplicate names are rejected inline (and on the DB `23505` as a fallback).
- **`@`-resolution** (`lib/watchlists.js` `resolveScanTickers`, called by `App.handleRun` **before** `runScan`): the raw input is tokenized on commas/spaces (as before); each token starting with `@` is expanded to that watchlist's tickers (case-insensitive lookup against the loaded `watchlists`), bare tokens are literal tickers, and the union is **deduped**. Mixing works (`@semis, TSLA, @core` → both lists + TSLA, deduped). An unknown `@name` returns an error → the header shows it inline and the **scan does not run**. **Empty input does NOT scan** — there is no implicit default-watchlist fallback; `handleRun` shows the inline hint *"Enter one or more tickers or a @watchlist to scan."* and returns without calling `runScan` (the old default 10-stock list is now just a named watchlist the user creates and references with `@`). **The scan engine/`/api/run` interface is unchanged** — it just receives the resolved ticker list. The pure helpers live in `lib/watchlists.js` (dependency-free, unit-testable).

### Supabase — Tradebook Table

Tradebook is stored in Supabase table `tradebook`. Required schema (create in Supabase dashboard):

```sql
create table tradebook (
  id            bigserial primary key,
  user_id       uuid references auth.users not null,
  ticker        text not null,
  expiration    date not null,
  saved_at      timestamptz not null default now(),
  leg_a_strike  float,
  leg_a_premium float,
  leg_a_delta   float,
  leg_b_strike  float,
  leg_b_premium float,
  leg_b_delta   float,
  leg_c_strike  float,
  leg_c_premium float,
  leg_c_delta   float,
  net_premium   float,
  spread_width  float,
  score         float,
  p_max_profit  float,
  fair_value    float
);

alter table tradebook enable row level security;

create policy "Users can only access their own trades" on tradebook
  for all using (auth.uid() = user_id);
```

Leg columns are flat (not JSONB): `leg_a_strike`, `leg_a_premium`, `leg_a_delta` (and same for b/c). The insert payload must match this flat structure exactly.

Two scan-provenance columns were added later (see `docs/scan_history_schema.sql`): `scan_id uuid references scan_runs(id)` and `result_id uuid references scan_results(id)`. Both are **nullable** — saves made before scan history existed (or saves made without auth) carry NULL for both. The frontend no longer inserts to `tradebook` directly; saves go through `POST /api/tradebook/save`, which sets `user_id` from the JWT and writes the linkage columns server-side.

---

## Build Phases

### Phase 1 (Current)
- On-demand Call Spread Risk Reversal scan via the web UI (or the `screener.py` CLI)
- Options + historical stock data via Massive; today's stock price + indices via yfinance
- Output: interactive ranked table in the web UI, with scans logged to Supabase for future ML
- Language: Python (backend) + React (frontend)

### Phase 2 (Future)
- Scrape every 5 minutes using a paid data provider
- More automated signal delivery to users
- Alert system when a data point meets criteria

---

## Scheduled Automation (who runs what, where)

**ALL scheduled automation lives on EC2 (cron). The Mac is interactive-only** — no launchd/cron jobs. (Decided 2026-08-03: macOS TCC denies cron AND launchd agents Full Disk Access for files under `~/Desktop`, so Mac scheduled jobs silently never ran; both `com.luocapital.*` LaunchAgents are permanently unloaded — the plists may still sit in `~/Library/LaunchAgents/` but nothing is bootstrapped. Do not re-load them; schedule on EC2 instead.)

| Job | Scheduler | Schedule | Script | Log (EC2) |
|---|---|---|---|---|
| Live sector scan (open slot) | EC2 cron | ~10:00 ET Mon–Fri (dual UTC lines, ET-gated wrapper) | `scripts/run_sector_scan.sh open` | `~/luo-options-algo/logs/sector_scan.log` |
| Live sector scan (close slot) | EC2 cron | ~15:30 ET Mon–Fri (dual UTC lines, ET-gated wrapper) | `scripts/run_sector_scan.sh close` | same |
| Catch-up quote extraction | EC2 cron | 14:05 ET Tue–Sat (dual UTC lines 18:05/19:05, ET-gated wrapper; flat files publish ~11 AM ET) | `scripts/ec2_extract_catchup.sh` | `/home/ubuntu/logs/extract_catchup.log` |
| Nightly ml_dataset outcome backfill | EC2 cron | 18:30 ET Mon–Fri (dual UTC lines 22:30/23:30, ET-gated wrapper) | `scripts/ec2_ml_backfill.sh` | `/home/ubuntu/logs/ml_backfill.log` |

**B2 year-stream fleet (temporary infrastructure, 2026-08):** a claims-coordinated extraction fleet (`scripts/b2_worker.py`) runs on a dedicated on-demand EC2 box streaming the historical year of quote flat files into its local `data/extracts/`. The Mac mirrors those extracts via rsync at each daily check-in (log: `~/Library/Logs/luocapital/mac_mirror_sync.log`). ⚠ **TERMINATION PRECONDITION: the fleet box must NEVER be terminated until the Mac mirror is verified complete against the `extract_claims` manifest — file count AND per-file sizes matching `parquet_bytes` for the FULL completed range.** The extracts are the only data on that box that isn't instantly recoverable (re-streaming costs weeks); the manifest comparison — not rsync's exit code — is the proof we hold what the fleet banked.

All four wrappers share the same pattern: UTC box without `CRON_TZ` → cron fires at both the EDT and EST UTC times, the wrapper gates on the real ET clock, exactly one fire proceeds per day; always `exit 0`; size-capped logs. The extraction wrapper additionally holds a `flock` (multi-hour runs must not overlap) and skips if < 5 GB free on `/`. The extractor needs `boto3` + `pyarrow` in the EC2 venv and the `MASSIVE_S3_*` keys in the EC2 `.env` (both present since 2026-08-03). **EC2 S3 throughput caveat:** files.massive.com serves ~3 MB/s per stream to EC2 — a single day-file (~130–180 GB) takes many hours; the daily one-file cadence absorbs this, and the flock makes a long run safe. Extracts accumulate on EC2 under `data/extracts/` (~65–70 MB/day + day_aggs); rsync down to the Mac when a replay needs them. The Mac's legacy wrappers (`scripts/extract_catchup.sh`, `scripts/run_ml_backfill.sh`) remain in the repo for reference but are unscheduled everywhere.

---

## Production Deployment

- **Host:** AWS EC2 t3.small, Ubuntu 24.04, us-east-2 (Ohio)
- **Server IP:** 3.131.232.204 (Elastic IP — permanent)
- **Domain:** https://luo-capital.com (registered via Namecheap, DNS A records pointing to Elastic IP)
- **SSL:** Let's Encrypt via Certbot — auto-renews (no manual expiry tracking needed)

### Stack
- **Nginx** reverse proxy on port 80/443 → forwards to Gunicorn on port 5001
- **Gunicorn** with 2 workers, 120s timeout, runs `server.app:app`
- **systemd service:** `luocapital.service` — auto-starts on boot, auto-restarts on crash
- **Python venv:** `/home/ubuntu/luo-options-algo/venv`
- **cron (ubuntu user):** the daily **sector scan** runs twice per trading day via `scripts/run_sector_scan.sh` (open ~10:00 ET, close ~3:30 PM ET), logging to `logs/sector_scan.log`. See the "Scheduling (production, EC2)" notes under the sector-scan section for the crontab, DST handling, and the market-day guard. New deploys that touch `server/requirements.txt` must re-run `venv/bin/pip install -r server/requirements.txt` (the scan needs `pandas_market_calendars`).

### Environment files on server
- `/home/ubuntu/luo-options-algo/.env` — `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MASSIVE_API_KEY`
- `/home/ubuntu/luo-options-algo/web/.env` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

### Deployment workflow
```bash
# On your Mac — push to GitHub
git commit -m 'your message' && git push

# SSH into server
ssh -i ~/Downloads/luo-capital-key.pem ubuntu@3.131.232.204

# Pull latest code
cd ~/luo-options-algo
git pull

# If frontend changed — rebuild React
cd web && npm run build && cd ..

# If Python dependencies changed
source venv/bin/activate
pip install -r server/requirements.txt

# Restart the app
sudo systemctl restart luocapital
```

---

## Development Rules
- Never commit or push to git unless explicitly instructed to do so

---

## Notes
- The platform runs a single algorithm: the Call Spread Risk Reversal screener (`screener.py`, served by `/api/run`)
- **Changed (2026-08-24) — expiration closes are yfinance-first in both outcome backfills.** `fetch_close_price()` in `backfill_outcomes.py` (shared by `backfill_ml_outcomes.py`) now tries yfinance daily bars before Massive REST (which 429s on recent expirations); the Massive path is unchanged as fallback. Validated 80/80 sampled pairs identical (price to the penny + outcome label) against existing REST-derived labels before shipping.
- **⚠ Discovery (2026-08-24) — stocks/indices flat files are NOT entitled.** `us_stocks_sip/*` and `us_indices/*` on the Massive flat-files bucket return 403 Forbidden with our keys (options flat files serve fine; keys list the bucket, so this is an entitlement wall, not auth). This **falsifies RANKER_SPEC open question #7's assumption** ("entitled to stocks minute_aggs back to 2014") — the plan to source B2 year-scale replay spot from stocks flat files needs a re-decision (candidates: yfinance historical bars, a Stocks-plan add-on, or another provider). **Explicitly pending; do not start the B2 replay's spot work until resolved.**
- **Changed (2026-07) — quote-based pricing migration.** Upgraded Massive to Options Advanced ($199/mo: real-time, bid/ask quotes, 5+ yr history) and moved all option pricing from `day.close` (last trade — stale, no-arb-violating) to live quotes: sell legs at the bid, buy leg at the ask (see "Pricing convention" under The Strategy). Added the two-sided-quote and `MAX_SPREAD_PCT` liquidity guards and the B≥A monotonicity sanity check. Touched: `screener.py` (`_parse_massive_contracts` + `scan_ticker`), `server/app.py` (`/api/chain` now returns `bid`/`ask`/`mid`, no `premium`), `web/src/pages/TradePage.jsx` (per-leg Ask/Bid columns); `scripts/sector_scan.py` inherits via `scan_ticker`. Scoring formula, payoff math, and filter thresholds unchanged. **⚠ ML-data comparability:** all `scan_results` / `ml_dataset` / `tradebook` rows logged **before** this change are last-trade-priced and systematically overstate credits (phantom no-arb credits, e.g. scores >10 on MU) — treat pre-migration `ml_dataset` rows as a **pilot dataset**, not comparable to post-migration rows. Expect post-migration qualified counts and scores to be much lower (validation run on the default 10: 3,879 → 1,720 qualified, top score 10.33 → 6.02) and illiquid names (GEV, APP) to qualify rarely or never — that's the guards working.
- **Removed (2026-07) — the fair-value feature (it was a no-op).** `get_fair_value()` computed `forwardEps × forwardPE` from yfinance, but Yahoo derives `forwardPE` as `price ÷ forwardEps`, so the product algebraically reconstructs the current spot price — "fair value" always equaled spot to the penny (verified across the whole watchlist). Leg B "fair-value targeting" was therefore always spot-relative, and since the scan evaluates every Leg B candidate regardless of order, the sort never even changed which setups were produced. Removed: `get_fair_value()`, the `fair_value` param on `scan_ticker()` (Leg B now sorts by proximity to `price` explicitly), the `fair_value`/`fv_available` triplet fields, the CLI's Fair Value column + yellow highlight, and every frontend display (SetupDetail's fair-value line, ResultsTable's yellow no-FV row signal, TradePage's FV badge and save-payload field). **DB columns kept, written as null**: `scan_results.fair_value`/`fv_available`, `ml_dataset.fair_value`, and `tradebook.fair_value` all remain in the schema (no schema churn) and are written `null`/`false` going forward — existing rows lose nothing since their stored fair_value always equaled the underlying spot anyway. Removal verified behavior-neutral: old and new scan logic produce identical setups (including order) on identical cached chain data across all 10 default tickers. (A naive before/after wall-clock diff shows tiny differences — Massive recomputes greeks continuously as time-to-expiry shrinks, so 6th-decimal delta drift flips borderline contracts across the delta windows; that drift exists between any two scans and is unrelated to this change.)
- Leg strikes are targeted by delta range (Leg B candidates ordered nearest-to-spot first); expirations snap to the nearest available Friday expiration for each target week
- This project is being designed with scalability in mind (more stocks, more frequent data, better algorithms later)
- **Renamed (2026-06):** the scan endpoint `/api/run_v3` → `/api/run` (handler `run_v3()` → `run()`). With V2 gone the `/api/run` name was free again, and the `_v3` suffix was just leftover technical debt. Backend route, frontend fetch URL (`useOptionsData.js`), startup banner, and docs all moved together. There is no compatibility alias — the old `/api/run_v3` path now 404s.
- **Removed (2026-06):** V1 and V2 algorithms. The platform was refocused on the proprietary Call Spread Risk Reversal strategy as its sole offering. The baseline V1 (% strike-distance ranker) and V2 (delta-adjusted single-leg ranker) were retired: deleted `ratio_ranker.py`, `report.py` (V2 PDF generator), and `test_v2.py`; removed the old V2 `/api/run` endpoint; trimmed `options_screener.py` to the shared helpers V3 still uses (`TICKERS`, `massive_client`, `get_next_fridays`, `find_closest_strike`); and removed the web UI's V2/V3 mode toggle (including `RankedTable.jsx` and all V2 state in `useOptionsData.js`/`App.jsx`) so the screener now loads straight into the risk reversal table. The `scan_runs`/`scan_results` tables were already V3-only by design — no schema changes, existing data left intact.
- **Removed (2026-04):** Robinhood holdings integration. The unofficial `robin-stocks` API was blocked and the integration had been non-functional since deployment. `server/robinhood.py`, the `/api/holdings` endpoint, the `robin-stocks` dependency, and all `ROBINHOOD_*` env vars were deleted. The backend (`/api/run` / `screener.py` CLI) falls back to the default watchlist (`options_screener.TICKERS`) when no tickers are passed. (As of the named-watchlists feature the **web UI no longer sends empty input** — blank input shows a hint and doesn't scan — but this backend default is unchanged for direct API/CLI callers.)
