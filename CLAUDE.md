# Options Wheel Strategy — Algorithm Project

## Overview
This project builds an options screening algorithm that identifies the best risk/reward opportunities across a watchlist of stocks. We sell options one side at a time (either calls or puts, never both simultaneously on the same stock). The system scrapes options chain data, calculates a ratio for each data point, ranks them, and signals which option to sell if it meets our criteria.

---

## Watchlist (10 Stocks)
$GEV, $PLTR, $APP, $AVGO, $META, $MU, $NVDA, $TSLA, $AMD, $TSM

---

## The Matrix
For each stock, we evaluate the following 32 data points:

| | 5% | 7% | 10% | 12% |
|---|---|---|---|---|
| **Calls (4 week)** | ratio | ratio | ratio | ratio |
| **Calls (3 week)** | ratio | ratio | ratio | ratio |
| **Calls (2 week)** | ratio | ratio | ratio | ratio |
| **Calls (1 week)** | ratio | ratio | ratio | ratio |
| **Puts (1 week)** | ratio | ratio | ratio | ratio |
| **Puts (2 week)** | ratio | ratio | ratio | ratio |
| **Puts (3 week)** | ratio | ratio | ratio | ratio |
| **Puts (4 week)** | ratio | ratio | ratio | ratio |

- **Columns** = strike distance from current stock price: 5%, 7%, 10%, 12%
- **Rows** = expiration timeframe (1, 2, 3, 4 weeks out) for both calls and puts
- **Total data points per stock**: 32
- **Total data points across all 10 stocks**: 320

---

## The Algorithm (V1)
For each data point:

```
Ratio = (Premium Collected / Stock Price) / % Strike Distance
```

- **Premium Collected** = the option premium for that specific strike and expiration
- **Stock Price** = current price of the stock
- **% Strike Distance** = 0.05, 0.07, 0.10, or 0.12

A **higher ratio** indicates more premium relative to how far out-of-the-money the strike is — meaning better value for the risk taken.

---

## Ranking
- Calculate the ratio for all 320 data points
- Rank all data points from highest to lowest ratio
- The top-ranked entries are the trade signals
- Signal output includes: stock ticker, side (call or put), strike price, expiration date, premium, and ratio

---

## Signal Criteria
- A data point is actionable if it ranks highly enough (threshold TBD as we test)
- Only one side (call or put) is traded per stock at a time

---

## Build Phases

### Phase 1 (Current)
- Single scrape at market open
- Free/scraped options data (e.g. Yahoo Finance)
- Output: ranked table printed to terminal/CLI
- Language: Python

### Phase 2 (Future)
- Scrape every 5 minutes using a paid data provider
- More automated signal delivery to users
- Alert system when a data point meets criteria

---

## Notes
- Strike prices are calculated as current stock price ± % strike distance
- Expirations are the nearest weekly options expiration 1, 2, 3, and 4 weeks out from run date
- Algorithm will be improved iteratively — V1 is the baseline ratio formula above
- This project is being designed with scalability in mind (more stocks, more frequent data, better algorithms later)
