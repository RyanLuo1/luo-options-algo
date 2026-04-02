# Options Wheel Strategy — Algorithm Project

## Overview
This project builds an options screening algorithm that identifies the best risk/reward opportunities across a watchlist of stocks. We sell options one side at a time (either calls or puts, never both simultaneously on the same stock). The system scrapes options chain data, calculates a ratio for each data point, ranks them, and signals which option to sell if it meets our criteria.

---

## Watchlist (10 Stocks)
$GEV, $PLTR, $APP, $AVGO, $META, $MU, $NVDA, $TSLA, $AMD, $TSM

---

## The Matrix
For each stock, we evaluate the following 40 data points:

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

- **Columns** = strike distance from current stock price: 3%, 5%, 7%, 10%, 15%
- **Rows** = expiration timeframe (1, 2, 3, 4 weeks out) for both calls and puts
- **Total data points per stock**: 40
- **Total data points across all 10 stocks**: 400

---

## The Algorithm (V1 — Baseline)
```
Ratio = (Premium Collected / Stock Price) / % Strike Distance
```

- **% Strike Distance** = decimal form of OTM distance (0.03, 0.05, 0.07, 0.10, 0.15)
- Simple proxy for risk — how far OTM the strike is

---

## The Algorithm (V2 — Current)
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
- Calculate the ratio for all 400 data points
- Apply delta threshold (≥ 0.05) and deduplication before ranking
- Rank all remaining data points from highest to lowest ratio
- The top-ranked entries are the trade signals
- Signal output includes: rank, ticker, side, expiration, week, dist %, delta, strike, premium, stock price, and ratio

---

## Signal Criteria
- A data point is actionable if it ranks highly enough (threshold TBD as we test)
- Only one side (call or put) is traded per stock at a time

---

## File Structure

### `options_screener.py`
- Defines the watchlist (`TICKERS`) and strike distances (`DISTANCES`)
- `get_next_fridays(n)` — finds the next N Friday expiration targets
- `black_scholes_delta(S, K, T, sigma, side)` — computes call or put delta using Black-Scholes and scipy
- `find_closest_strike(strikes, target)` — snaps a target price to the nearest available chain strike
- `get_midpoint(row)` — returns bid/ask midpoint, falls back to last price
- `fetch_ticker_data(ticker)` — fetches current price and matches 4 weekly expirations
- `build_rows(ticker, price, expirations)` — builds a row for every ticker/expiration/distance combination, including call and put actual strike, premium, and computed delta
- `print_ticker_table(ticker, rows)` — prints per-ticker matrix showing target strike, actual strike, and premium for calls and puts
- `fetch_all_rows(verbose)` — iterates all tickers, returns full list of rows; used as the data source for `ratio_ranker.py`

### `ratio_ranker.py`
- Imports `fetch_all_rows` from `options_screener.py`
- `calculate_ratios(all_rows)` — computes V2 ratio for every valid call and put, applies delta threshold (≥ 0.05), deduplicates by (Ticker, Side, Expiration, Strike) keeping lowest Dist %, and returns ranked list + duplicate count
- `print_ranked_table(ranked_rows, duplicates_removed)` — prints the full ranked table with algorithm metadata in the header; column order is Rank, Ticker, Side, Expiration, Wk, Dist, Delta, Strike, Premium, Stock Price, Volume, OI, Ratio, | Earnings
- Volume values below 10 are highlighted red; OI values below 100 are highlighted red; header notes: `Liquidity: Volume < 10 flagged red, OI < 100 flagged red`
- Run directly with `python3 ratio_ranker.py` to fetch data and print rankings

### `event_filter.py`
- Fetches and caches earnings dates and macro events for use in the ranked output
- `fetch_earnings_dates()` — uses `yf.Ticker(ticker).calendar` to get the next earnings date for each of the 10 tickers
- `fetch_fomc_dates()` — scrapes the Federal Reserve website for upcoming FOMC decision dates within the next 4 weeks
- `fetch_bls_dates(event_name, url)` — scrapes the BLS website for upcoming CPI, PPI, and NFP (Employment Situation) release dates within the next 4 weeks
- `load_events()` — fetches all earnings and macro data once and stores in module-level cache; called once at startup in `ratio_ranker.py`
- `get_event_flags(ticker, expiration_date)` — checks if any earnings or macro events (FOMC, CPI, PPI, NFP) fall between today and the expiration date; returns a formatted string like `EARNINGS 4/23`, `FOMC 4/22`, `EARNINGS 4/23, FOMC 4/22`, or `CLEAR`
- ForexFactory blocks scraping (403); FOMC sourced from federalreserve.gov, CPI/PPI/NFP from bls.gov

### `report.py`
- Full end-to-end PDF report generator — run with `python3 report.py`
- Calls `load_events()`, `fetch_all_rows()`, `calculate_ratios()`, and `print_ranked_table()` in sequence
- Captures printed output from both the screener and ranker using `io.StringIO` stdout redirection
- Strips ANSI color codes from captured output before writing to PDF
- PDF structure: title page (run date, market status, macro events) → Section 1 (per-ticker screener output) → Section 2 (ranked options table)
- Both data sections rendered in monospace `Courier` font to preserve table alignment
- Handles page breaks automatically via ReportLab Platypus
- Output filename: `luo_capital_report_YYYY-MM-DD_HHMM.pdf`, saved in the project folder


### `test_v2.py`
- Standalone tests for the V2 algorithm
- Tests Black-Scholes delta sanity (values between 0–1, deeper OTM = lower delta)
- Tests IV filter logic (None, NaN, zero, placeholder, threshold boundary)
- Tests ratio math correctness and directional properties

---

## Build Phases

### Phase 1 (Current)
- Single scrape at market open
- Free/scraped options data via yfinance (Yahoo Finance)
- Output: ranked table printed to terminal/CLI and exportable to PDF
- Language: Python

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
- Expirations are the nearest weekly options expiration 1, 2, 3, and 4 weeks out from run date
- Algorithm will be improved iteratively — V1 is the baseline, V2 is current
- This project is being designed with scalability in mind (more stocks, more frequent data, better algorithms later)
