# Luo Capital — Options Screening Platform

A full-stack platform that scans the options market for **Call Spread Risk Reversal** setups, ranks them with a delta-based scoring model, and presents the best opportunities through a fast, professional trading interface.

Live at **[luo-capital.com](https://luo-capital.com)**.

---

## What this does

Luo Capital evaluates tens of thousands of options contracts per scan across a configurable watchlist, identifies every valid Call Spread Risk Reversal structure, and ranks them by a delta-based model so the strongest risk-adjusted setups surface first. Instead of manually building three-leg trades across dozens of strikes and expirations, you run a scan and get a ranked list of the best structures available right now — each with its premium, payoff zones, probability of profit, and full leg breakdown.

The platform also tracks realized outcomes for setups over time, building a dataset for performance analysis and, eventually, a machine-learning ranking layer.

---

## The strategy: Call Spread Risk Reversal

A **risk reversal** is a bullish options structure that finances upside exposure by selling downside risk. In its classic form, a trader buys an out-of-the-money call and sells an out-of-the-money put — using the premium collected from the put to pay for the call. The position behaves much like owning the stock, but is often entered for little cost or even a net credit.

The **Call Spread Risk Reversal** refines this into a three-leg, defined-structure trade:

- **Leg A — Buy a call** (the long leg you pay for)
- **Leg B — Sell a higher-strike call** (caps the upside, but collects premium)
- **Leg C — Sell an out-of-the-money put** (collects premium, and obligates you to buy the stock if it falls below the put strike)

Legs A and B together form a **call debit spread** — a bullish position with a defined maximum profit. Leg C, the short put, collects additional premium that offsets the cost of the spread, frequently turning the whole structure into a **net credit** at entry. The result is a trade that pays you to put it on, profits as the stock rises into the spread, and only takes on real downside if the stock falls below a level you've already decided is an acceptable price to own it.

**The payoff has four zones, defined by the strikes:**

| Where the stock finishes | Outcome |
|---|---|
| Below the short put strike (Leg C) | Put assigned — you're obligated to buy the stock; this is the loss zone |
| Between the put and the long call (Leg C → Leg A) | Both shorts expire worthless — you keep the entry credit |
| Between the two calls (Leg A → Leg B) | The sweet spot — you capture the spread plus the credit |
| Above the short call strike (Leg B) | Capped — maximum profit, flat above this point |

The trade rewards a stock that rises moderately into the spread, tolerates one that drifts sideways (you keep the credit), and exposes you only on a meaningful decline — at a strike you selected because you'd be comfortable owning the stock.

---

## How the platform works

**Scanning.** For each ticker on the watchlist, the engine pulls the full options chain — strikes, premiums, implied volatility, open interest, and Greeks — and constructs every valid Call Spread Risk Reversal across the expirations in range. Each candidate is filtered and scored.

**The scoring model.** Setups are ranked on a delta-based framework that builds on the option Greeks supplied by the data provider:

- **Net premium** — the credit collected at entry (Leg B + Leg C − Leg A) must clear a configurable threshold. This is the cash that hits your account when you open the trade.
- **Probability of profit** — derived from option deltas, which approximate the market-implied probability of finishing in the money. The model estimates the chance that both short legs (the call and the put) expire worthless, i.e. that the stock lands in the safe band.
- **Score** — net premium relative to spread width, a credit-to-risk ratio that favors setups collecting the most credit per unit of width.

**The interface.** Results are presented as a ranked, scannable table; selecting any setup opens a detail panel with the full leg breakdown (strikes, premiums, deltas), the payoff structure, and an integrated price chart with volume and RSI. A per-ticker filter lets you focus on a single name, and a collapsible controls drawer keeps the configuration out of the way so the data stays front and center.

---

## Why it's efficient

- **Exhaustive, not manual.** The engine evaluates tens of thousands of strike-and-expiration combinations per scan — far more than any trader could assemble by hand — and only surfaces the ones that pass the premium and probability filters.
- **Ranked by risk-adjusted quality.** You don't sift through a wall of contracts; the best structures rise to the top automatically, scored on credit-per-risk rather than raw payout.
- **Built for the data realities.** Options chains, Greeks, and historical aggregates come from a dedicated options-data provider; live quotes, intraday bars, and market context are sourced separately to work around plan-level entitlements and a shared rate limit. The split keeps scans fast and reliable without overpaying for data.
- **Outcome tracking baked in.** Every scan and every result is logged, and expired trades are scored for realized P&L and capture efficiency — so performance is measured, not guessed.

---

## How to take advantage of it

1. **Set your universe and filters.** Open the controls drawer, enter a watchlist (or use the default), and set the expiration range, minimum net premium, and minimum probability of profit.
2. **Run a scan.** The engine evaluates the full chain for every ticker and returns a ranked list of qualifying setups.
3. **Review the best setups.** The top of the table is the highest-scoring structure. Each row shows the credit collected and the maximum profit.
4. **Inspect a setup.** Click any row to open the detail panel — full three-leg breakdown, payoff zones, and the price chart for that ticker. Use the per-ticker filter to focus on a single name.
5. **Track outcomes.** Saved trades flow into the outcomes pipeline, which reports win rate, total and average P&L, and capture efficiency as positions expire.

> **Note on capital.** Because Leg C is a short put, executing these trades requires cash-secured collateral roughly equal to the put strike per contract. The platform surfaces the structure and its math; position sizing and collateral are the trader's responsibility.

---

## Tech stack

- **Backend** — Python, Flask, Gunicorn behind Nginx
- **Frontend** — React, Vite, Tailwind CSS, TradingView charting widgets
- **Data** — dedicated options-data provider (chains, Greeks, IV) + a separate source for live quotes and market context
- **Database** — Supabase (Postgres) with row-level security
- **Infrastructure** — AWS EC2

---

## What's next

- **Performance analytics.** As closed-trade volume grows, dashboards for win rate by score decile, probability-of-profit calibration, and P&L across volatility regimes — turning the outcome log into insight about where the strategy's edge actually lives.
- **Machine-learning ranking layer.** A gradient-boosted model (XGBoost / LightGBM) trained on logged setup features — leg deltas, net premium, days to expiration, moneyness, IV rank, market context, and macro-event proximity — with realized P&L as the label. The goal is an **ML score shown alongside the existing algorithmic score**, surfacing where a learned model and the heuristic agree or diverge, rather than replacing the transparent rules-based ranking.
- **Backtesting.** Replaying the strategy across historical options chains to validate the scoring model against out-of-sample data and accelerate the ML training set beyond forward-tracked outcomes.
- **Live position tracking.** Mark-to-market for open trades and an in-app outcomes dashboard.

---

## Disclaimer

This is a personal research and trading tool. Nothing here is financial advice. Options trading involves substantial risk of loss, including assignment risk on short legs. Use at your own discretion.
