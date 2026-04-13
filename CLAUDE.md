# Options Wheel Strategy — Algorithm Project

## Overview
This project builds an options screening algorithm that identifies the best risk/reward opportunities across a watchlist of stocks. We sell options one side at a time (either calls or puts, never both simultaneously on the same stock). The system scrapes options chain data, calculates a ratio for each data point, ranks them, and signals which option to sell if it meets our criteria.

The project has two interfaces: a Python CLI for terminal output and PDF export, and a web UI (Flask + React) for interactive scanning.

---

## Watchlist (Default 10 Stocks)
$GEV, $PLTR, $APP, $AVGO, $META, $MU, $NVDA, $TSLA, $AMD, $TSM

The ticker universe is fully customizable — the web UI accepts manual input or pulls live holdings from Robinhood.

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

- **Delta** = absolute value of the option's delta, computed via Black-Scholes using implied volatility from the options chain
- **Why delta instead of % strike distance**: Delta is a superior risk denominator because it incorporates implied volatility, time to expiration, and the probability of the option expiring worthless — all factors that % strike distance ignores. A higher ratio under V2 means more premium collected per unit of actual directional risk.
- **Black-Scholes inputs**: stock price (S), strike (K), time to expiration in years (T), implied volatility (sigma), risk-free rate (4.5%)
- **IV filter**: data points with IV ≤ 0.01 are excluded — yfinance returns placeholder values (e.g. 0.00001) when the market is closed; these are rejected
- **Delta threshold**: data points with delta < 0.05 are excluded entirely
- **Deduplication**: when multiple % distances snap to the same actual strike for the same ticker, side, and expiration, only the lowest Dist % is kept as the most accurate representation of that contract
- Requires live market data during market hours to produce valid IV and delta values

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
- `get_next_fridays(n)` — finds the next N Friday expiration targets
- `black_scholes_delta(S, K, T, sigma, side)` — computes call or put delta using Black-Scholes and scipy
- `find_closest_strike(strikes, target)` — snaps a target price to the nearest available chain strike
- `get_midpoint(row)` — returns bid/ask midpoint, falls back to last price
- `fetch_ticker_data(ticker, weeks=4)` — fetches current price and matches N weekly expirations
- `build_rows(ticker, price, expirations, distances=None)` — builds a row for every ticker/expiration/distance combination; distances defaults to `DISTANCES` if None
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
- **Routes:**
  - `GET /api/status` — fast health check; returns market open/closed, last run time
  - `GET /api/holdings` — fetches open stock positions from Robinhood; returns 503 if unavailable
  - `GET /api/events` — returns cached macro events (FOMC, CPI, PPI, NFP, earnings)
  - `POST /api/run` — runs a full scan and returns ranked results
- `/api/run` request body (all optional):
  - `tickers`: list of strings — leading `$` is stripped automatically
  - `distances`: list of floats in decimal form (e.g. `[0.02, 0.05, 0.10]`); validated 0.01–0.50; defaults to `DISTANCES`
  - `weeks`: integer 1–12; defaults to 4
- `/api/run` response includes: `ranked`, `macro_events`, `duplicates_removed`, `market_open`, `run_at`, `tickers_used`, `tickers_skipped`, `tickers_source`, `distances_used`, `weeks_used`, `total_ranked`
  - `POST /api/run_v3` — runs a V3 Call Spread Risk Reversal scan and returns ranked triplets
- `/api/run_v3` request body (all optional):
  - `tickers`: list of strings — leading `$` is stripped automatically
  - `weeks`: integer 1–12; defaults to 12
  - `min_premium`: float ≥ 0; minimum net credit in dollars; defaults to 5.00
  - `min_p_profit`: float 0–1; minimum P(max profit); defaults to 0.50
- `/api/run_v3` response includes: `ranked`, `total_evaluated`, `tickers_used`, `tickers_skipped`, `market_open`, `run_at`, `weeks_used`, `min_premium_used`, `min_p_profit_used`

### `server/robinhood.py`
- Handles Robinhood authentication via `robin_stocks`; credentials loaded from `.env`
- `get_holdings()` — returns sorted list of uppercase ticker symbols for all open positions
- `get_holdings_detail()` — returns list of dicts with ticker, shares, and average cost
- Login is cached per process (MFA only required on first run with `store_session=True`)

### `v3_screener.py`
- V3 Call Spread Risk Reversal screener — available as both a standalone CLI and via the web UI (`/api/run_v3`)
- Run with `python3 v3_screener.py` or with optional arguments (see below)
- Imports `get_next_fridays`, `black_scholes_delta`, and `get_midpoint` from `options_screener.py` — no duplication
- `scan_ticker(ticker, price, week_exps, fair_value, min_premium, min_p_profit=None)` — accepts `min_p_profit` as a parameter so the web API can override it per-request (defaults to module-level `MIN_P_MAX_PROFIT = 0.50` when None)

**Strategy (3 legs):**
- **Leg A**: Buy ATM call (delta 0.45–0.55) — pay premium
- **Leg B**: Sell OTM call (delta 0.20–0.35, strike > Leg A) — collect premium; strike targeted near fair value when available
- **Leg C**: Sell OTM put (delta 0.15–0.25, strike < current price) — collect premium
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
- `--weeks 6` — scan W1–W6 only (default: 12, max: 12)
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

The header contains a V2 / V3 toggle. Switching modes calls `clearAll()` to wipe existing results and resets stale state. Each mode has its own controls and staleness tracking.

### Key components

- **`App.jsx`** — root component; owns all scan state and control logic
  - **Shared:** ticker text input (comma/space separated; blank = use Robinhood holdings)
  - **V2 mode controls:** Dist % pill input (type a number e.g. `7`, press Enter/comma to add; default pills: 3%, 5%, 7%, 10%, 15%) + Weeks +/− control (1–12, default 4)
  - **V3 mode controls:** Weeks +/− control (1–12, default 12) + Min Premium $ input (default 5.00) + Min P(Profit)% input (default 50)
  - **Client-side filtering:** removing a distance or ticker pill instantly hides matching rows without a new API call; same for V3 ticker pills
  - **Staleness detection (per mode):** Run Scan button turns amber "⚠ Rescan needed" when controls diverge from last scan's params. V2: new dist added, weeks changed, new ticker typed. V3: weeks changed, min premium changed, min P(profit) changed, new ticker typed. Removing pills is NOT stale (client-side handled).
  - `handleModeChange(newMode)` — calls `clearAll()`, switches mode
  - `handleRun()` — dispatches to `runScan` (V2) or `runV3Scan` (V3) based on current mode
- **`Header.jsx`** — branding, V2/V3 mode toggle (indigo = V2 active, violet = V3 active), market open/closed badge, Run Scan button (indigo = fresh, amber = stale, gray = loading); toggle and run button disabled during loading
- **`RankedTable.jsx`** — V2 sortable ranked results table with liquidity flags (volume < 10 red, OI < 100 red); metadata bar shows algorithm version, distances used, weeks used, duplicates removed
- **`V3Table.jsx`** — V3 sortable ranked results table (15 columns: Rank, Ticker, Expiration, Wk, Leg A Strike, Leg A Prem, Leg B Strike, Leg B Prem, Leg C Strike, Leg C Prem, Net Prem, Spread Width, Score, P(Profit)%, Fair Value)
  - Leg A Prem: `text-sky-400` (you pay); Leg B & C Prem: `text-emerald-400` (you collect); Net Prem: white bold; Score: emerald bold
  - Row colors: red bg when P(profit) is between minPP and minPP+10% (borderline); yellow bg when fair value unavailable; alternating gray otherwise
  - Metadata bar shows: algorithm, weeks, min premium, min P(profit)%, triplets ranked, total evaluated
- **`Holdings.jsx`** — dismissible ticker pills shown after a scan; removing a pill instantly filters that ticker from the table
- **`MacroEvents.jsx`** — displays upcoming FOMC, CPI, PPI, NFP dates
- **`useOptionsData.js`** — custom hook managing all API calls and result state
  - `runScan({ tickers, distances, weeks })` — POSTs to `/api/run`, stores in `result`
  - `runV3Scan({ tickers, weeks, minPremium, minPProfit })` — POSTs to `/api/run_v3`, stores in `v3Result`
  - `clearAll()` — wipes both `result` and `v3Result` and clears any error; called on mode switch
  - Exposes V3 fields: `v3Ranked`, `v3TickersUsed`, `v3TickersSkipped`, `v3WeeksUsed`, `v3MinPremiumUsed`, `v3MinPProfitUsed`, `v3TotalEvaluated`, `v3HasResult`
  - `marketOpen` and `lastRun` derived from whichever result is available (result → v3Result → status)

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

## Development Rules
- Never commit or push to git unless explicitly instructed to do so

---

## Notes
- Strike prices are calculated as current stock price ± % strike distance
- Expirations snap to the nearest available Friday expiration for each target week
- Algorithm versions: V1 = baseline (% strike distance), V2 = delta-adjusted ratio, V3 = call spread risk reversal; both V2 and V3 are available in the web UI via mode toggle
- This project is being designed with scalability in mind (more stocks, more frequent data, better algorithms later)
