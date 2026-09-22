# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are **external options traders** (confirmed 2026-09-12). The operator is one user among many, not the sole audience.

Situation: **at a desk, on a laptop, during US market hours**. The job is to run a scan, compare the ranked setups, inspect one, then either save it to the tradebook or open the trade editor to adjust strikes, and finally enter the trade at their broker. Density, scan speed, and keyboard-driven re-scans matter more than mobile layout; phone use is secondary and not a design target today.

Access model (**decided 2026-09-12**): **sign-up is open, unlisted, and unpromoted.** Anyone who reaches trigram.trade can create an account and use everything; nothing drives traffic there yet (robots disallow + noindex on the landing page until public launch). New accounts default to **plan = free** (entitlement lives in the auth user's `app_metadata.plan`; absence means free; only the service role can change it). **Nothing is gated today.** The plan claim and its helpers stay in code, dormant, for the membership gate.

## Information Architecture

**Decided 2026-09-22.** Trigram is a screener: **two calculator modes (Income · Upside) and a Tradebook.** That is the whole product.

- **Screener** (`/app`): the Call Spread Risk Reversal scan in Income or Upside mode, the ranked list, the setup dashboard, the trade editor (`/trade`).
- **Tradebook** (`/tradebook`): saved trades, graded at expiration.

**Picks and Performance are removed from the product** (they were a curated model book and its return chart, planned as a paid tier). No tab, no teaser, no landing card, no copy; `/picks` and `/performance` redirect to `/app`. The research behind them — the shadow logging in the live scanner, the model book, the findings in `docs/private/` — **continues untouched as internal work and never becomes a user-facing surface.**

**Commercial model:** a **flat membership for all features**, with the paywall built **last**. Until it ships, every feature is free to every account. **Copy that changes on paywall day** (nothing else on the public surfaces refers to a tier): the sign-up honesty line — "Free account. The screener and tradebook are yours — no card, no trial clock." — and the landing page's "free" language ("Run a free scan", "Free to use", "Both are yours with a free account", "The screener is free. No returns promised, no countdown."). They are true today and must be rewritten together when the membership gate ships.

**Public-launch gate** (checklist; nothing on it is started, and it exists so the list cannot drift):
- [ ] Massive business-tier conversation (data licensing for a public product)
- [ ] Legal review of the disclosures (risk statement, "not advice", options-specific language)
- [ ] Remove `robots.txt` Disallow and the landing page's `noindex, nofollow` meta (together)
- [ ] Pricing decided for the membership (flat, all features; the paywall is built last)

## Product Purpose

Trigram scans the options market for **Call Spread Risk Reversal** setups across a user-chosen ticker list, builds every valid three-leg structure per ticker and weekly expiration, filters to tradeable credit trades, scores them, and presents a ranked list. It replaces manually assembling three-leg trades across dozens of strikes and expirations.

Success for a user: in one scan they see the strongest available structures right now, understand each one's credit, max profit, probability, and legs at a glance, and can act on it (save or edit) without leaving the flow.

Longer-term purpose: every scan and every saved trade is logged so realized outcomes can be graded, building a labeled dataset for performance analysis and an eventual learned ranker.

## Positioning

- **One proprietary strategy, done thoroughly.** The platform is single-strategy by design: a three-leg Call Spread Risk Reversal (buy ATM call, sell OTM call above it, sell OTM put below spot) that is entered for a net credit. Generic screeners offer many strategies shallowly.
- **Transactable pricing, not last-trade fantasy.** Every leg is priced on the side of the book the user would actually hit (sell legs at bid, buy leg at ask) from real-time quotes, with liquidity guards (two-sided quote, spread at most 15% of mid, volume at least 20). Scores reflect credits a trader could actually collect.
- **Closed loop on outcomes.** Saved trades and systematic sector scans are graded at expiration with a deterministic payoff model, so the ranking is accountable to realized results rather than backtests alone.

## Operating Context

- **Live site:** https://trigram.trade (Flask + Gunicorn behind Nginx on AWS EC2; React SPA served from the same origin).
- **Routes:** `/` (public landing page, unlisted), `/login` (sign in / create account), `/app` (screener), `/trade` (three-leg trade editor with live chain tables), `/tradebook` (saved trades); `/picks` and `/performance` redirect to `/app`.
- **Screener flow:** tickers or an `@watchlist` typed in the header, filter controls (weeks range 1 to 12, minimum net premium, minimum P(max profit)) in a left drawer, results in a ranked table with a setup-detail band above it and a TradingView chart beside it. Removing a ticker chip or double-clicking one filters client-side without a rescan.
- **Data sources:** Massive (Options Advanced plan) for options chains, quotes, Greeks, and historical stock bars; yfinance for today's stock price, indices (VIX, SPY), and earnings dates; Supabase for auth and persistence.
- **Market rhythm:** a scan takes seconds to tens of seconds depending on ticker count; quotes are real-time during the session and placeholder-filtered when the market is closed. The header shows a market open/closed badge and last-run time.
- **Terminology users expect:** Leg A / Leg B / Leg C, net premium (credit), spread width, max profit, P(max profit), delta, bid/ask, expiration week (W1 to W12), the four payoff zones (loss, credit-only, sweet spot, capped).
- **Per-contract dollars:** the UI shows money multiplied by 100 (one contract equals 100 shares), matching brokerage statements. The database stores per-share values alongside.

## Capabilities and Constraints

Confirmed functionality:
- Ranked scan output with score, credit, max profit, probability, full leg breakdown, and event flags (earnings, FOMC, CPI, PPI, NFP).
- Named per-user watchlists with `@name` syntax.
- Trade editor with per-leg chain tables (ask for the bought leg, bid for the sold legs) and recalculated metrics.
- Tradebook persistence with scan provenance; realized outcomes computed at expiration.
- Session persistence of screener state across in-app navigation.

Constraints future work must respect:
- **Scoring, filters, and pricing are backend truth.** The UI never recomputes ranking; it renders what `/api/run` returns. Score itself is deliberately not shown in the results table (sort order only).
- **Massive rate limits are shared** with scheduled EC2 sector scans; the UI must not add background polling of options data.
- **Today's stock data and indices come from yfinance** and can fail silently; any display depending on them needs a graceful absent state.
- The frontend is Vite + React 19 + Tailwind 3.4 with semantic color tokens defined as CSS variables (`web/src/index.css`, wired in `web/tailwind.config.js`). Dark is the default theme; light exists only on `/login`.
- Public sign-up is open (Supabase: sign-ups enabled, email auto-confirm on, so a new account gets a session immediately); the login page's "Create Account" mode is the live path. Verified end-to-end 2026-09-12 with a fresh test account.

Undecided product facts (do not invent):
- Phase 2 signal delivery (alerts, scheduled scrapes) has no committed channel or cadence.
- The membership's price and terms (the model is decided: flat, all features, paywall last).

## Brand Commitments

Name: **Trigram** (renamed from Luo Capital 2026-09-22; “Luo Capital” remains the owning entity — maker's mark “Trigram by Luo Capital”). Product label used in the UI: **Options Screener**.

Visual authority (**decided 2026-09-12**): the landing page `design/landing/v1` ("Soft Fintech Cards": warm lilac ground, white 24px cards, violet structure, lime reserved for the one primary action, Bricolage Grotesque + Figtree) is the design system, recorded in `DESIGN.md` and `.impeccable/design.json`. The old app frontend (dark slate, purple accent, JetBrains Mono) is **superseded**, not binding, and is being replaced screen by screen. Existing assets: `web/public/favicon.svg`, `web/public/icons.svg`, `design/landing/v1/hero.svg`. No logo file beyond the favicon exists.

Practical conventions that any replacement should still solve for (functional, not stylistic): money and P&L must be visually distinguishable from action and status color; numeric columns must align (tabular figures).

## Evidence on Hand

- A working, deployed product with real scan output and real saved trades.
- Realized-outcome data in Supabase (`trade_outcomes`, `ml_dataset`) and a year-scale backtest corpus; research findings are private (`docs/private/`) and must not be quoted on public surfaces without the operator's approval.
- `README.md` contains an accurate plain-language explanation of the strategy and its four payoff zones, usable as source copy.
- **No** testimonials, customer logos, user counts, published performance claims, or pricing exist. Do not fabricate any.

## Product Principles

1. **Tradeable or nothing.** Every number shown is one the trader could act on at the quoted side of the book; never present a credit that can't be collected.
2. **Ranked list first, detail on demand.** The scan result is the product; the user should reach a decision from the table and detail band without hunting.
3. **Operator speed during the session.** Rescans, filters, and row selection must be fast and keyboard-friendly; nothing blocks the flow on secondary data.
4. **Honest about uncertainty and absence.** Market closed, missing quote, failed price fetch, or no qualifying setup are first-class states with clear explanations, not blank screens.
5. **Every action leaves a trail.** Scans and saves are logged for outcome grading; UI changes must not break provenance.

## Accessibility & Inclusion

No product-specific standard has been established. The audience is sighted traders at laptops; color must never be the sole carrier of profit versus loss or borderline versus safe (a labeled sign or text cue is required), because many traders are red/green color-vision deficient. Reduced-motion preferences are already honored on the login page and should stay honored.
