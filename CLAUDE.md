# Options Wheel Strategy — Algorithm Project

## Overview
This project builds an options screening algorithm that identifies the best risk/reward opportunities across a watchlist of stocks. We sell options one side at a time (either calls or puts, never both simultaneously on the same stock). The system scrapes options chain data, calculates a ratio for each data point, ranks them, and signals which option to sell if it meets our criteria.

The project has two interfaces: a Python CLI for terminal output and PDF export, and a web UI (Flask + React) for interactive scanning.

---

## Data Provider Responsibilities

The project intentionally uses **two** data providers with a clear division of responsibility. Understanding this split is critical when touching anything that fetches stock prices, options chains, or chart data.

### Massive (Options Starter plan, $30/month) — options data + historical stocks

- All option chains: strikes, premiums, delta, IV, volume, open interest
- Pre-calculated Greeks for every contract (no need to compute Black-Scholes ourselves)
- Historical stock aggregates: daily and hourly bars from **yesterday and earlier**
- Technical indicators (`get_rsi`) on historical timespans
- This is why V3 scans and most chart timeframes (5D, 1M, 3M, 6M, 1Y) work — they all rely on data the Options plan includes

### yfinance (free) — fills the gap Massive's Options plan doesn't cover

- **Today's current stock price** (intraday during market hours, today's close after hours)
- **Today's intraday bars** (the Massive Options plan returns `NOT_AUTHORIZED` for any aggregate dated today — see below)
- **Indices**: the VIX (yfinance symbol `^VIX`) and any other index data the Options plan blocks
- **Market-context inputs for scan logging**: SPY today's close and VIX today's close, logged into `scan_runs.spy_price` and `scan_runs.vix` so we can correlate scan output with market regime later (`server/app.py` → `_get_market_context()`)
- **Fundamentals**: forward/trailing EPS, P/E ratios, `targetMeanPrice`, earnings dates — used by V3's fair-value chain in `v3_screener.get_fair_value`
- **V3 stock price input**: the per-ticker price fed to `scan_ticker()` comes from `yf.Ticker(ticker).history(period="1d")["Close"].iloc[-1]`

### Why the split exists

Massive sells stocks data and options data as **separate** subscriptions. The $30/month Options plan grants:

- ✅ Today's options data (real-time-ish, ~15-minute delay)
- ✅ Historical stock data (yesterday and back)
- ❌ Today's stock data — any aggregate dated today, **even after market close** (requires the Stocks plan, +$30/month)
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

The ticker universe is fully customizable — the web UI accepts manual input, and an empty input falls back to the default watchlist above.

---

## The Matrix
For each stock, we evaluate data points across distances and expirations:

| | 3% | 5% | 7% | 10% | 15% |
|---|---|---|---|---|---|
| **Calls (4 week)** | ratio | ratio | ratio | ratio | ratio |
| **Calls (3 week)** | ratio | ratio | ratio | ratio | ratio |
| **Calls (2 week)** | ratio | ratio | ratio | ratio | ratio |
| **Calls (1 week)** | ratio | ratio | ratio | ratio | ratio |
| **Puts (1 week)** | ratio | ratio | ratio | ratio | ratio |
| **Puts (2 week)** | ratio | ratio | ratio | ratio | ratio |
| **Puts (3 week)** | ratio | ratio | ratio | ratio | ratio |
| **Puts (4 week)** | ratio | ratio | ratio | ratio | ratio |

- **Columns** = strike distance from current stock price: customizable, default 3%, 5%, 7%, 10%, 15%
- **Rows** = expiration timeframe: customizable number of weeks out, default 4, configurable 1–12
- **Total data points per stock**: (distances) × (weeks) × 2 sides — default 40
- **Total data points across all 10 stocks**: default 400 (scales with custom distances/weeks)

---

## The Algorithm (V1 — Baseline)
```
Ratio = (Premium Collected / Stock Price) / % Strike Distance
```

- **% Strike Distance** = decimal form of OTM distance (0.03, 0.05, 0.07, 0.10, 0.15)
- Simple proxy for risk — how far OTM the strike is

---

## The Algorithm (V2 — Ratio Ranker, active in web UI)
```
Ratio = (Premium Collected / Stock Price) / Delta
```

- **Delta** = absolute value of the option's delta, provided pre-calculated by Massive (options data source)
- **Why delta instead of % strike distance**: Delta is a superior risk denominator because it incorporates implied volatility, time to expiration, and the probability of the option expiring worthless — all factors that % strike distance ignores. A higher ratio under V2 means more premium collected per unit of actual directional risk.
- **IV filter**: data points with IV ≤ 0.01 are excluded — Massive returns None or near-zero IV when the market is closed; these are rejected
- **Delta threshold**: data points with delta < 0.05 are excluded entirely
- **Deduplication**: when multiple % distances snap to the same actual strike for the same ticker, side, and expiration, only the lowest Dist % is kept as the most accurate representation of that contract
- Requires live market data during market hours to produce valid IV and delta values
- Data source: Massive (formerly Polygon.io) with ~15-minute delay; stock price still fetched via yfinance

---

## Ranking
- Calculate the ratio for all data points
- Apply delta threshold (≥ 0.05) and deduplication before ranking
- Rank all remaining data points from highest to lowest ratio
- The top-ranked entries are the trade signals
- Signal output includes: rank, ticker, side, expiration, week, dist %, delta, strike, premium, stock price, volume, OI, ratio, and earnings/macro event flags

---

## Signal Criteria
- A data point is actionable if it ranks highly enough (threshold TBD as we test)
- Only one side (call or put) is traded per stock at a time

---

## File Structure

### `options_screener.py`
- Defines the watchlist (`TICKERS`) and default strike distances (`DISTANCES = [0.03, 0.05, 0.07, 0.10, 0.15]`)
- `massive_client` — module-level Massive `RESTClient` initialized from `MASSIVE_API_KEY` env var; imported by `server/app.py`
- `get_next_fridays(n)` — finds the next N Friday expiration targets
- `find_closest_strike(strikes, target)` — snaps a target price to the nearest available chain strike
- `get_midpoint(row)` — retained for backward compatibility; not used in the Massive data path
- `fetch_ticker_data(ticker, weeks=4)` — fetches current price via yfinance (only remaining yfinance call); returns `(price, expirations)` where expirations are the next N target Fridays as `YYYY-MM-DD` strings
- `build_rows(ticker, price, expirations, distances=None)` — calls Massive `list_snapshot_options_chain` for calls and puts per expiration (±20% strike range); delta and IV come from Massive; premium from `o.day.close`; distances defaults to `DISTANCES` if None
- `_build_strike_dict(contracts)` — filters Massive contracts missing Greeks, IV ≤ 0.01, or no day.close; returns strike → contract dict
- `_log_massive_error(ticker, exp, side, err)` — logs Massive errors; distinguishes auth failures (401/403) from other errors
- `print_ticker_table(ticker, rows)` — prints per-ticker matrix showing target strike, actual strike, and premium for calls and puts
- `fetch_all_rows(verbose, tickers=None, distances=None, weeks=4)` — iterates all tickers, returns full list of rows; all params are fully customizable

### `ratio_ranker.py`
- Imports `fetch_all_rows` from `options_screener.py`
- `calculate_ratios(all_rows)` — computes V2 ratio for every valid call and put, applies delta threshold (≥ 0.05), deduplicates by (Ticker, Side, Expiration, Strike) keeping lowest Dist %, and returns ranked list + duplicate count
- `print_ranked_table(ranked_rows, duplicates_removed)` — prints the full ranked table with algorithm metadata in the header; column order is Rank, Ticker, Side, Expiration, Wk, Dist, Delta, Strike, Premium, Stock Price, Volume, OI, Ratio, | Earnings
- Volume values below 10 are highlighted red; OI values below 100 are highlighted red
- Run directly with `python3 ratio_ranker.py` to fetch data and print rankings

### `event_filter.py`
- Fetches and caches earnings dates and macro events for use in the ranked output
- `fetch_earnings_dates()` — uses `yf.Ticker(ticker).calendar` to get the next earnings date for each ticker
- `fetch_fomc_dates(weeks=4)` — scrapes the Federal Reserve website for upcoming FOMC decision dates within the next N weeks
- `fetch_bls_dates(event_name, url, weeks=4)` — scrapes the BLS website for upcoming CPI, PPI, and NFP release dates within the next N weeks
- `load_events(weeks=4)` — fetches all earnings and macro data and stores in module-level cache; re-fetches automatically when called with a different `weeks` value than the previous call
- `get_event_flags(ticker, expiration_date)` — returns a string like `EARNINGS 4/23`, `FOMC 4/22`, or `CLEAR`
- ForexFactory blocks scraping (403); FOMC sourced from federalreserve.gov, CPI/PPI/NFP from bls.gov

### `report.py`
- Full end-to-end PDF report generator — run with `python3 report.py`
- Calls `load_events()`, `fetch_all_rows()`, `calculate_ratios()`, and `print_ranked_table()` in sequence
- Captures printed output using `io.StringIO` stdout redirection; strips ANSI color codes before writing to PDF
- PDF structure: title page (run date, market status, macro events) → Section 1 (per-ticker screener output) → Section 2 (ranked options table)
- Both data sections rendered in monospace `Courier` font; handles page breaks via ReportLab Platypus
- Output filename: `luo_capital_report_YYYY-MM-DD_HHMM.pdf`, saved in the project folder

### `server/app.py`
- Flask API server; run with `python3 server/app.py` from the project root
- Serves the built React app from `web/dist` (single server for API + frontend)
- `static_folder=None` — Flask's built-in static serving is disabled; all file serving goes through the catch-all route
- `app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0` — disables Flask's file cache so rebuilds are picked up immediately
- `index.html` is served with explicit `no-store, no-cache` headers; JS/CSS assets (content-hashed by Vite) are served without special headers
- **Routes:**
  - `GET /api/status` — fast health check; returns market open/closed, last run time
  - `GET /api/events` — returns cached macro events (FOMC, CPI, PPI, NFP, earnings)
  - `POST /api/run` — runs a full scan and returns ranked results
  - `POST /api/run_v3` — runs a V3 Call Spread Risk Reversal scan and returns ranked triplets (V3 scans are logged to `scan_runs`/`scan_results` — see Scan History below)
  - `POST /api/tradebook/save` — server-side tradebook insert; attributes user_id from JWT, links to source scan, flips `was_saved=true` on `scan_results`
  - `GET /api/chain` — returns a filtered options chain for a ticker/expiration/side with BS delta computed
- `/api/run` request body (all optional):
  - `tickers`: list of strings — leading `$` is stripped automatically
  - `distances`: list of floats in decimal form (e.g. `[0.02, 0.05, 0.10]`); validated 0.01–0.50; defaults to `DISTANCES`
  - `weeks`: integer 1–12; defaults to 4
- `/api/run` response includes: `ranked`, `macro_events`, `duplicates_removed`, `market_open`, `run_at`, `tickers_used`, `tickers_skipped`, `distances_used`, `weeks_used`, `total_ranked`
- `/api/run_v3` request body (all optional):
  - `tickers`: list of strings — leading `$` is stripped automatically
  - `weeks_min`: integer 1–12; defaults to 1; must be ≤ `weeks_max`
  - `weeks_max`: integer 1–12; defaults to 12
  - `min_premium`: float ≥ 0; minimum net credit in dollars; defaults to 5.00
  - `min_p_profit`: float 0–1; minimum P(max profit); defaults to 0.50
- `/api/run_v3` response includes: `ranked`, `macro_events`, `total_evaluated`, `tickers_used`, `tickers_skipped`, `market_open`, `run_at`, `weeks_min_used`, `weeks_max_used`, `min_premium_used`, `min_p_profit_used`, `elapsed_ms`, `scan_id` (uuid; null if logging failed or no auth), and each `ranked[i]` entry carries a `result_id` (uuid; null on logging failure)
- `/api/chain` query params: `ticker` (str), `expiration` (YYYY-MM-DD), `side` ('call' or 'put')
  - Fetches chain via Massive `list_snapshot_options_chain`; delta and IV are pre-calculated by Massive
  - Filters to 0.05 ≤ delta ≤ 0.85 and IV > 0.01; premium from `o.day.close`
  - Returns JSON array sorted by strike ascending; each entry: `strike`, `premium`, `delta`, `volume`, `oi`, `iv`

### `/api/chart` endpoint (added in `server/app.py`)

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

**Why 1D uses yfinance** — Massive's $30/mo Options plan returns `NOT_AUTHORIZED` for any stock aggregate dated today, regardless of market state. Without yfinance, 1D would always show *yesterday's* bars even mid-session. yfinance fills exactly that gap. The Massive 1D path remains in the code as a fallback for the rare case yfinance also fails (unknown ticker, Yahoo outage); it returns the most recent **non-today** session by bucketing a 7-day hourly window by ET date and picking the max, same as before.

**5D still uses Massive 1-hour bars** — that timeframe is bars from yesterday and earlier (today's hourly slot is replaced by 1D), so Massive's historical stock data is sufficient.

**Header price is always yfinance** (`current_price`, `prev_close`, `change_pct`) — for every timeframe. This guarantees the displayed price matches what V3 actually uses for its scan (yfinance current-day quote), so users never see a chart header showing yesterday's $802 while V3 scanned at today's $775. yfinance is queried via `yf.Ticker(ticker).history(period='2d')`; if that fails, the endpoint falls back to the last bar's close in the bars array (which yields yesterday's close for non-1D timeframes).

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

The frontend (`StockChart.jsx` `ChartHeader`) shows a small italic amber "Showing {Mon DD}" label next to the change percentage when `session_is_today === false`, so users know the chart isn't real-time. Date parsing uses `new Date(y, m-1, d)` rather than `new Date('YYYY-MM-DD')` to avoid the UTC midnight shift bug.

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

### Scan History — `scan_runs` / `scan_results` (V3-only)

Every V3 scan execution is logged to Supabase so we can train ML models on real algorithm output later. **V2 is intentionally excluded** — it is a baseline ranker, not the proprietary strategy, and logging it would just pollute the training set. Logging is **best-effort**: if the Supabase write fails (network, schema mismatch, missing service key, no auth token), the scan response is unaffected and a warning is printed to stderr — the contract is that logging must **never** break the scan response.

**Tables** (full DDL in `docs/scan_history_schema.sql`):
- `scan_runs` — one row per V3 execution: inputs (tickers requested/used/skipped, weeks_min/max, min_premium, min_p_profit), outputs (total_evaluated, total_passed), context (market_open, elapsed_ms, vix, spy_price), and `error_message` (nullable; populated when the scan threw)
- `scan_results` — one row per produced triplet, linked via `scan_id`. Mirrors the V3 triplet shape (legs, strikes, deltas, premiums, score, P(max profit), fair value) plus `rank`, `was_saved` boolean, and `created_at`
- RLS: users may only SELECT/INSERT their own rows. `was_saved` is only updatable via the service role (no user UPDATE policy)

**Write path** — `log_scan_run()` in `server/app.py` is called from `/api/run_v3` on **both** success and exception paths:
- Success: inserts `scan_runs` row with `error_message=NULL` and a batch insert into `scan_results` for every ranked triplet (chunked at 200 rows per request). Returns `(scan_id, result_ids)` parallel to the ranked list, and the endpoint decorates each response triplet with its `result_id`.
- Failure: inserts a `scan_runs` row with `error_message` populated, `tickers_used=[]`, `ranked=[]`, and `total_passed=0` so the failure itself is captured for future analysis (e.g. "scans error more often around earnings"). 400-level validation errors are NOT logged — only execution-time exceptions.

**Auth** — `/api/run_v3` calls `verify_token(request)` to extract `user_id` from the Supabase JWT. If no token is present or verification fails, `user_id` is None and `log_scan_run()` returns `(None, [])` without writing. Scans still succeed for unauthenticated callers; they just aren't logged. The frontend (`useOptionsData.js`) attaches `Authorization: Bearer <session.access_token>` on V3 scan requests.

**Market context** — at the top of each scan, `_get_market_context()` fetches last-close VIX (via Massive ticker `I:VIX`) and SPY price (via Massive `SPY`). Both are best-effort — failures log to stderr and store `None`. Result is cached for 60 seconds across scans in a process-local dict to avoid hammering Massive on back-to-back runs.

**Scan provenance linkage** — saved trades carry their origin:
- `/api/run_v3` returns `scan_id` at top level and `result_id` per ranked entry
- Frontend (`useOptionsData.js`) exposes `v3ScanId`; each row in `v3Ranked` already includes its `result_id`
- Saving via the V3 table dropdown (`App.jsx saveToTradebook`) or the trade editor (`TradePage.jsx handleSave`) posts to `/api/tradebook/save` with `{scan_id, result_id, trade}`
- The server inserts into `tradebook` (filling `user_id` from the JWT — clients cannot spoof it) and then flips `was_saved=true` on the matching `scan_results` row (best-effort; a failure here does NOT undo the save)
- `scan_id` and `result_id` are **nullable** on the `tradebook` table — older saves predate logging, and saves made without auth still work without linkage

**Endpoint contract reminder** — `/api/tradebook/save` requires a valid JWT (returns 401 otherwise) and ignores any client-supplied `user_id`/`id`/`scan_id`/`result_id` inside the `trade` payload — those are taken from the top-level JSON fields and from the verified user.

### `v3_screener.py`
- V3 Call Spread Risk Reversal screener — available as both a standalone CLI and via the web UI (`/api/run_v3`)
- Run with `python3 v3_screener.py` or with optional arguments (see below)
- Imports `get_next_fridays` and `massive_client` from `options_screener.py` — no duplicate client initialization
- `scan_ticker(ticker, price, week_exps, fair_value, min_premium, min_p_profit=None)` — uses Massive for options chains; delta comes pre-calculated; accepts `min_p_profit` as a parameter so the web API can override it per-request (defaults to module-level `MIN_P_MAX_PROFIT = 0.50` when None)
- `_parse_massive_contracts(raw)` — filters and normalizes Massive snapshot objects; applies IV ≤ 0.01 and volume < 20 exclusions; returns list of `{strike, premium, delta, volume}` dicts
- `week_exps` is built directly from `get_next_fridays()` target Fridays as `(week_num, YYYY-MM-DD)` tuples — no yfinance expiration matching needed

**Strategy (3 legs):**
- **Leg A**: Buy ATM call (delta 0.40–0.60) — pay premium
- **Leg B**: Sell OTM call (delta 0.20–0.40, strike > Leg A) — collect premium; strike targeted near fair value when available
- **Leg C**: Sell OTM put (delta 0.15–0.30, strike < current price) — collect premium
- **Goal**: Net Premium = (Leg B + Leg C) − Leg A ≥ $5.00 (credit only)

**Fair value fallback chain** (for Leg B targeting):
1. `forwardEps × forwardPE` from `yf.Ticker(ticker).info`
2. `trailingEps × trailingPE`
3. `targetMeanPrice` (analyst consensus)
4. `None` — Leg B selected by delta range only

**Filters applied per leg:**
- IV ≤ 0.01 → excluded (placeholder values from closed market)
- Volume < 20 → excluded
- Delta must fall within each leg's specified range
- Net premium < `--min-premium` → triplet skipped immediately
- P(max profit) = (1 − Leg B delta) × (1 − Leg C delta) < 0.50 → triplet skipped

**Scoring:** `score = net_premium / spread_width` where `spread_width = Leg B strike − Leg A strike`

**Output columns:** Rank, Ticker, Expiration, Wk, Leg A Strike, Leg A Pm, Leg B Strike, Leg B Pm, Leg C Strike, Leg C Pm, Net Prem, Spd Width, Score, P(Profit)%, Fair Value

**Highlighting:**
- Yellow rows: fair value unavailable, Leg B chosen by delta only
- Red rows: P(max profit) between 50–55% (borderline)

**CLI arguments:**
- `--tickers NVDA META` — override default watchlist
- `--weeks 6` — maximum weekly expiration (default: 12, max: 12)
- `--weeks-min 3` — minimum weekly expiration (default: 1)
- `--min-premium 3.00` — override the $5.00 minimum net credit

### `test_v2.py`
- Standalone tests for the V2 algorithm
- Tests Black-Scholes delta sanity (values between 0–1, deeper OTM = lower delta)
- Tests IV filter logic (None, NaN, zero, placeholder, threshold boundary)
- Tests ratio math correctness and directional properties

---

## Web UI (`web/`)

Built with Vite + React + Tailwind CSS. Source in `web/src/`, built output in `web/dist/` (served by Flask, gitignored).

**To rebuild after frontend changes:** `cd web && npm run build`

### Mode toggle

The header contains a V2 / V3 toggle. Switching modes **preserves** both modes' scan results and controls — only the displayed mode changes. Each mode owns independent state (`ranked` / `v3Ranked`, its own control inputs, its own staleness check) that is already persisted to sessionStorage, so the user can flip back and forth without losing data. The **Clear** button (in the Header) is the only explicit reset path; mode toggling itself never destroys data.

### Authentication (Supabase)

Auth is handled via `@supabase/supabase-js`. The client is initialized in `web/src/lib/supabase.js` using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `web/.env`.

- **`web/src/lib/supabase.js`** — exports the `supabase` client singleton
- **`web/src/hooks/useAuth.js`** — exports `useAuth()` hook returning `{ user, session, loading }` via `getSession` + `onAuthStateChange`
- **`web/src/pages/LoginPage.jsx`** — dark-themed login/signup page at `/login`; redirects to `/` if already logged in; uses `supabase.auth.signInWithPassword` / `supabase.auth.signUp`
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
  - `mode` (`v2` | `v3`)
  - `tickerInput` (raw text in the Tickers input)
  - `activeTickers`, `v3ActiveTickers` (post-filter ticker pills)
  - `distPills`, `weeks` (V2 controls)
  - `v3WeeksMin`, `v3WeeksMax`, `v3MinPremium`, `v3MinPProfit` (V3 numeric controls)
  - `v3MinPremiumStr`, `v3MinPProfitStr` (raw input strings — preserve partial typing like `4.`)
  - `selectedChartTicker`, `chartTimeframe`, `chartExpanded` (StockChart selection / view state)
- **`luo-capital-screener-results`** — `{ result, v3Result }` from `useOptionsData`, written when either changes. Preserves the full ranked tables, `tickers_used`, `weeks_min_used`/`weeks_max_used`, etc.

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

The screener page (`App.jsx` route `/`) is locked to viewport height so the Header, MacroEvents, control bar, Holdings pills, and the table's metadata + legend bars always stay in view. Only the table body scrolls.

The chain that makes this work:

1. **`App.jsx` outer div** — `h-screen overflow-hidden flex flex-col`. Locks the page to 100vh; nothing escapes vertically.
2. **`<main>`** — `flex-1 min-h-0 overflow-hidden flex flex-col`. Takes the remaining vertical space and is itself a flex column so its child can flex-grow.
3. **`RankedTable.jsx` / `V3Table.jsx` outer div** — `flex-1 min-h-0 flex flex-col overflow-hidden`. Fills `<main>` and contains the metadata bar (with `shrink-0`), legend (with `shrink-0`), and the scroll wrapper.
4. **Scroll wrapper inside the table component** — `flex-1 min-h-0 overflow-auto`. Both axes scroll: vertical for long row lists, horizontal for wide tables.
5. **Sticky column headers** — `<th>` elements (not `<thead>` or `<tr>`) carry `sticky top-0 z-10 bg-gray-900 border-b border-gray-700`. Sticky must be on the cell, not the row, because `border-collapse: collapse` prevents `<tr>`-level sticky from working reliably across browsers. `bg-gray-900` is required so scrolled rows don't show through; the border-bottom on each `<th>` forms the divider line beneath the sticky header.

**`min-h-0` is load-bearing** — without it on flex children, the default `min-height: auto` makes them refuse to shrink below their content size, defeating the overflow chain. Add it on every flex child in this stack.

Empty / loading states (`EmptyState`, `LoadingSpinner`, `RankedTable.jsx` no-data branch, `V3Table.jsx` no-data branch) all use `flex-1 min-h-0` so they fill the available space and center properly instead of hugging the top of `<main>`.

This pattern is scoped to the screener route. Other pages (`/trade`, `/tradebook`, `/login`) use natural document flow.

### Key components

- **`App.jsx`** — screener page only (not a router/layout); owns all scan state, chart state, and control logic
  - Owns `selectedChartTicker`, `chartTimeframe`, `chartExpanded`. A `useEffect` auto-selects the rank-1 ticker when a new scan completes (or when the current selection is no longer in the results); depends on `[mode, ranked, v3Ranked, selectedChartTicker]` — the **raw** scan arrays (stable refs from `useOptionsData`), never the derived/filtered arrays which change identity every render.
  - Calls `useChartData(selectedChartTicker, chartTimeframe)` and passes the result to both StockChart slots so toggling expand doesn't refetch.
  - Renders the compact StockChart inside the control bar (right side, `flex-1 min-w-[320px]`); when `chartExpanded` is true, the table area in `<main>` is replaced by the expanded StockChart.
  - **Shared:** ticker text input (comma/space separated; blank = default watchlist `options_screener.TICKERS`)
  - **V2 mode controls:** Dist % pill input (type a number e.g. `7`, press Enter/comma to add; default pills: 3%, 5%, 7%, 10%, 15%) + Weeks +/− control (1–12, default 4)
  - **V3 mode controls:** Weeks range slider (dual-handle, 1–12, default min=1, max=12) + Min Premium $ input (default 5.00) + Min P(Profit)% input (default 50)
    - **Weeks slider** (`components/WeeksRangeSlider.jsx`): two stacked native `<input type="range">` elements, each capturing one thumb. Track + active fill drawn as divs underneath. Thumb appearance is styled in `index.css` under `input[type="range"].dual-thumb` (cross-browser webkit/moz). Display shows `Weeks {min} – {max}` below.
    - **Min Premium $ / Min P(Profit) %** are **free-text** inputs (`type="text"` with `inputMode="decimal"`/`numeric`). The user can clear and type any value (incl. partial decimals like `4.`). Each has a paired raw-string state (`v3MinPremiumStr`, `v3MinPProfitStr`) and a numeric state (`v3MinPremium`, `v3MinPProfit`). On every keystroke the string updates; the numeric value updates only when the input parses as valid (premium: any non-negative number; P(profit): integer 1–99). Invalid input shows a **red border** but does NOT block typing. On blur, P(profit) is clamped into [1, 99] and premium reverts to the last valid value if invalid. The `+` / `−` buttons next to each input bump the numeric value (premium by ±0.50, P(profit) by ±1) and re-sync the string.
  - **Client-side filtering:** removing a distance or ticker pill instantly hides matching rows without a new API call; same for V3 ticker pills
  - **Staleness detection (per mode):** Run Scan button turns amber "⚠ Rescan needed" when controls diverge from last scan's params. V2: new dist added, weeks changed, new ticker typed. V3: weeks_min changed, weeks_max changed, min premium changed, min P(profit) changed, new ticker typed. Removing pills is NOT stale (client-side handled).
  - `handleModeChange(newMode)` — switches mode only; both V2 and V3 results are preserved across the toggle
  - `handleRun()` — dispatches to `runScan` (V2) or `runV3Scan` (V3) based on current mode
  - Does not contain any `<Routes>` or `<Route>` — routing is entirely in `main.jsx`
- **`Header.jsx`** — route-aware header (uses `useLocation`); rendered independently by each page component:
  - `/` (screener): branding + V2/V3 toggle + Tradebook nav tab + market badge + Clear button + Run Scan button + last run
  - **Clear button** (subtle gray-outline, sits immediately left of Run Scan) calls `onClear` from props. App.jsx's `handleClear` resets every persisted control to its default (`tickerInput=''`, `activeTickers=[]`, `distPills=DEFAULT_DISTANCES`, `weeks=4`, V3 controls back to `1/12/5.00/0.50`, chart back to `null/'1M'/false`), calls `clearAll()` to wipe scan results, and calls `clearScreenerSession()` to flush sessionStorage. The persist effects then immediately re-write the defaults back, so sessionStorage ends up containing the default-state snapshot rather than being empty.
  - `/tradebook`: minimal header with ← Back to Screener button + "Tradebook" label
  - `/trade`: minimal header with ← Back to Screener button + "Trade Editor" label
  - All navigation uses `useNavigate` (no `<Link>` or `<a>` tags)
- **`Toast.jsx`** — fixed bottom-right toast notification; accepts `message` and `visible` props; fades in/out over 0.3s; used in App (after saving from V3 dropdown) and TradePage (after Save to Tradebook)
- **`RankedTable.jsx`** — V2 sortable ranked results table with liquidity flags (volume < 10 red, OI < 100 red); metadata bar shows algorithm version, distances used, weeks used, duplicates removed. Row click calls `onRowSelect(row)` to update the chart ticker.
- **`V3Table.jsx`** — V3 sortable ranked results table (15 columns: Rank, Ticker, Expiration, Wk, Leg A Strike, Leg A Prem, Leg B Strike, Leg B Prem, Leg C Strike, Leg C Prem, Net Prem, Spread Width, Score, P(Profit)%, Fair Value). Row click both opens the Save/Edit dropdown **and** calls `onRowSelect(row)` so App can update the chart ticker — same click does both.
  - Leg A Prem: `text-sky-400` (you pay); Leg B & C Prem: `text-emerald-400` (you collect); Net Prem: white bold; Score: emerald bold
  - Row colors: red bg when P(profit) is between minPP and minPP+10% (borderline); yellow bg when fair value unavailable; alternating gray otherwise
  - Metadata bar shows: algorithm, weeks range (`W{min} – W{max}` or `W{n}` if equal), min premium, min P(profit)%, triplets ranked, total evaluated
- **`Holdings.jsx`** — dismissible ticker pills shown after a scan; removing a pill instantly filters that ticker from the table
- **`MacroEvents.jsx`** — displays upcoming FOMC, CPI, PPI, NFP dates
- **`pages/TradePage.jsx`** — trade editor at `/trade`; receives triplet via router state; renders its own `<Header />`
  - Three-column layout: Leg A (long call), Leg B (short call), Leg C (short put)
  - Fetches call and put chains from `/api/chain` on mount; back-fills volume/OI for initial selected strikes
  - User clicks a chain row to change the selected contract for that leg (highlighted with indigo ring)
  - Summary bar above columns shows Net Premium, Spread Width, Score, P(Profit)% — updates only on Recalculate
  - Save to Tradebook inserts into Supabase `tradebook` table; shows Toast for 3s
- **`pages/TradebookPage.jsx`** — tradebook at `/tradebook`; fetches from Supabase on mount, deletes via Supabase; renders its own `<Header />`
  - Table columns: Date Saved, Ticker, Expiration, Leg A/B/C Strike, Net Premium, Score, P(Profit)%
  - Each row has a × delete button; "Clear all" button at top right
  - Trades fetched with `.order('saved_at', { ascending: false })` — most recent first
- **`StockChart.jsx`** — three stacked Recharts `ComposedChart` panels (price candlesticks, volume bars, RSI line with 30/70 reference lines). Two variants:
  - **Compact** (default): fixed `h-[200px]`, lives in the screener control bar to the right of the inputs cluster (control bar grows to ~200px tall to fit it).
  - **Expanded**: `flex-1`, takes over the table area in `<main>` until the user clicks the close button (`×`). The table is hidden while expanded.

  All three charts share `syncId="luo-chart"` so the cursor lines up across panels in expanded mode. Color palette: bullish candles `green-500` (#22c55e), bearish candles `red-500` (#ef4444), volume `gray-700` (#374151), RSI `violet-400` (#a78bfa), RSI 30/70 references `red-500` at 35% opacity (dashed). Header shows ticker, current price, % change vs prior close, a timeframe `<select>` (`1D`/`5D`/`1M`/`3M`/`6M`/`1Y`), and the expand/close toggle.

  **Candlestick implementation** — Recharts has no native candlestick, so the price panel uses `<Bar dataKey="candleRange" shape={Candlestick}>` where each data point is preprocessed with `candleRange: [low, high]`. Recharts treats a 2-element array dataKey as a range bar, so the shape callback receives `(x, y, width, height)` spanning the full wick: `y` = high pixel, `y + height` = low pixel. Open and close pixels are interpolated within that range via `y + height * (high - v) / (high - low)`. The body is a `<rect>` between openY and closeY, ~70% of the bar width and centered; the wick is a `<line>` at the bar's horizontal center spanning low → high. Color: green if `close >= open`, red otherwise. Doji (open == close) gets a 1px-tall body so it stays visible. The price `<YAxis>` uses an explicit domain of `[min(low), max(high)]` (~3% padding) computed via `useMemo` so wicks never get clipped — `'auto'` would only consider the dataKey values and clip the range bars.

- **`useChartData.js`** — fetches `/api/chart` for `(ticker, timeframe)`. **Lifted to App.jsx** (not used inside StockChart) so the same data feeds both the compact and expanded variants without re-fetching when the user toggles expand. Caches by `ticker|timeframe` key in a `useRef(new Map())` and ignores out-of-order responses with a `latestKeyRef`.

- **`useOptionsData.js`** — custom hook managing all API calls and result state
  - `runScan({ tickers, distances, weeks })` — POSTs to `/api/run`, stores in `result`
  - `runV3Scan({ tickers, weeksMin, weeksMax, minPremium, minPProfit })` — POSTs to `/api/run_v3`, stores in `v3Result`
  - `clearAll()` — wipes both `result` and `v3Result` and clears any error; called on mode switch
  - Exposes V3 fields: `v3Ranked`, `v3TickersUsed`, `v3TickersSkipped`, `v3WeeksMinUsed`, `v3WeeksMaxUsed`, `v3MinPremiumUsed`, `v3MinPProfitUsed`, `v3TotalEvaluated`, `v3HasResult`
  - `marketOpen` and `lastRun` derived from whichever result is available (result → v3Result → status)
  - **Important:** all empty-array fallbacks use a module-level `const EMPTY = []` instead of inline `?? []`. Inline `[]` creates a new reference every render, which causes `useEffect([tickersUsed])` in App to fire every render → infinite setState loop → navigation broken. Never change these back to inline `[]`.

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
- Single scrape at market open via CLI or web UI
- Free/scraped options data via yfinance (Yahoo Finance)
- Output: ranked table in terminal, exportable to PDF, or interactive web UI
- Language: Python (backend) + React (frontend)

### Phase 2 (Future)
- Scrape every 5 minutes using a paid data provider
- More automated signal delivery to users
- Alert system when a data point meets criteria

---

## Production Deployment

- **Host:** AWS EC2 t3.small, Ubuntu 24.04, us-east-2 (Ohio)
- **Server IP:** 3.131.232.204 (Elastic IP — permanent)
- **Domain:** https://luo-capital.com (registered via Namecheap, DNS A records pointing to Elastic IP)
- **SSL:** Let's Encrypt via Certbot, auto-renews, expires 2026-07-13

### Stack
- **Nginx** reverse proxy on port 80/443 → forwards to Gunicorn on port 5001
- **Gunicorn** with 2 workers, 120s timeout, runs `server.app:app`
- **systemd service:** `luocapital.service` — auto-starts on boot, auto-restarts on crash
- **Python venv:** `/home/ubuntu/luo-options-algo/venv`

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
- Strike prices are calculated as current stock price ± % strike distance
- Expirations snap to the nearest available Friday expiration for each target week
- Algorithm versions: V1 = baseline (% strike distance), V2 = delta-adjusted ratio, V3 = call spread risk reversal; both V2 and V3 are available in the web UI via mode toggle
- This project is being designed with scalability in mind (more stocks, more frequent data, better algorithms later)
- **Removed (2026-04):** Robinhood holdings integration. The unofficial `robin-stocks` API was blocked and the integration had been non-functional since deployment. `server/robinhood.py`, the `/api/holdings` endpoint, the `robin-stocks` dependency, and all `ROBINHOOD_*` env vars were deleted. An empty Tickers input now falls back to the default watchlist (`options_screener.TICKERS`) instead.
