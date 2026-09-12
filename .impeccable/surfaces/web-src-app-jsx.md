---
version: 1
slug: "web-src-app-jsx"
primary_target: "web/src/App.jsx"
related_targets: ["web/src/components/Header.jsx","web/src/components/ResultsTable.jsx","web/src/components/SetupDetail.jsx"]
---

# Shape — Screener page (`/app`), the free tab inside the four-tab shell

Status: APPROVED 2026-09-12 with four refinements (folded in below, marked ★). Visual authority: DESIGN.md (v1 world).

## 1. Job and audience
An options trader at a laptop during market hours. Operate mode. Job: run a scan on their tickers, compare the ranked setups, open one, save it or hand it to the editor, then place it at their broker. Free plan today; Picks and Performance are visible but locked.

## 2. Outcome and proof
Primary action: Run Scan. Success: within one screen the trader can rank, compare, and decide without hunting. Proof carried by the page: every row is priced at the transactable side (credit shown = credit collectable), and the detail panel shows probability, collateral, breakeven, and the worst case in plain dollars. Score stays hidden; the credit-as-share-of-max bar renders it instead.

## 3. Selected direction
The landing page's world, applied to a working screen. Structural thesis: one shell, one action, one detail panel. Focal moment: selecting a row makes the setup dashboard (the landing's "What one setup looks like") light up with that row's legs, curve, and numbers. Implementation consequence: the Screener is rebuilt on DESIGN.md tokens, not restyled; the TradingView embed leaves the Screener (still reachable from the trade editor).

## 4. Scope and boundaries
- Target: `web/src/App.jsx` and its components, plus a new app shell (top bar + tab strip) that Tradebook will adopt next.
- Fidelity: production screen, desktop 1440 → 1100. ★ Sub-1100 widths are a follow-up design problem (see §6).
- In scope: shell, tab strip with locked-tab teaser panels, inline controls bar, scanning chips, ranked table, setup-dashboard detail panel with Save / Open in editor, all states.
- Untouched: `/api/run` contract and scoring; watchlist syntax and CRUD; sessionStorage persistence; the trade editor and tradebook pages (they inherit the shell later, not now); login page.
- Anti-goals: no dark theme; no price chart on the Screener; no icon-grid feature rows; no pricing or plan names on teasers; no color-only meaning anywhere.

## 5. States and ranges
- First run (no scan yet): a calm empty panel in the results area: what a scan does, three example tickers as clickable chips, the `@watchlist` hint, a "create a watchlist" link. No developer text.
- Loading: the previous table and panel stay mounted at 60% opacity; a slim progress strip under the controls bar reads "Scanning 3 of 10 tickers"; Run Scan shows "Scanning…" and is disabled; sort and selection survive.
- Error: a dismissable rose strip above the results; previous results remain. Copy names the problem and the recovery ("The scan service didn't respond. Your last results are still shown. Try again.") — never the port number.
- No results: cause-specific: market closed (quotes are placeholders, "try during market hours") vs. thresholds too strict (offer "lower min credit to $3") vs. every ticker skipped (list them with the real reason: no chain / no live price / unknown symbol).
- Market closed: a quiet ground-deep banner above the table; scanning still allowed.
- Ranges: 1 to 100 tickers; 0 to ~5,000 rows (render 50, "Show 50 more"); skipped tickers 0 to all; setups per ticker 0 to hundreds; event flags 0 to 2 per row.
- Missing spot price: strike ladder shows "spot unavailable", nothing else breaks.
- Stale: any control change after a scan flips Run Scan to "Rescan needed" (label + violet ring; still lime).

## 6. Interaction and layout
- **Shell (top bar):** wordmark left; the landing's tab strip centered: Screener · Tradebook · Picks (lock, Paid pill) · Performance (lock, Paid pill); right: market OPEN/CLOSED text badge, plan pill ("Free"), Log out. Locked tab click opens a teaser panel in the content area: one paragraph of what the tab is, a sample component (Picks: a two-row picks ledger; Performance: the book-vs-SPY sketch with no ordering between the lines), "Paid · not available yet". No price, no upsell button.
- **Controls bar:** one row of white cards: Tickers input (with `@watchlist`, inline error/hint beneath, "Manage watchlists" link), Weeks range (dual slider), Min credit (★ label "Minimum credit · $ per contract", default $500 per contract = the validated $5/share rule; the boundary divides by 100 for the API), Min P(max profit) (stepper, %), Run Scan (the page's one lime action). Enter in any field runs; ⌘/Ctrl+Enter runs from anywhere; `/` focuses tickers.
- **Scanning chips:** one chip per ticker with a count of qualifying setups; single click filters to that ticker (accent state), click again clears; × removes; keyboard-reachable buttons, not spans.
- **Results (left, ~58%):** one white card. Columns: Rank · Ticker · Expires (Oct 17 · W5 · 34d) · Put / Call / Call · Credit · Max profit (number plus a metric bar; ★ the bar is a swappable metric component: `metric` fn + `label` props, not a formula in the cell — Screener passes credit ÷ max (the incumbent ranking), Picks can later pass ROC with no re-layout) · P(max) · Collateral · flags (earnings / FOMC pills when present). Per-contract dollars everywhere, "/ct" once in the header. ★ Default order is the scanner's rank (the hidden score). A user column sort is an override with a visible "Back to ranked" affordance; the override persists across rescans of the same scan context (same tickers and thresholds), but the first state after any fresh scan context is always the algorithm's order. Money columns sort descending first. Row click and ↑/↓ move selection; Enter opens the editor.
- **Detail panel (right, ~42%):** the setup dashboard: ticker + spot + pills (expiry, weeks, DTE, flags), three leg tiles (bought = white/violet ring, sold = lime/ink ring convention), the payoff curve with a spot marker and the four zones labelled, stat cards (credit, max profit, P(max) gauge, collateral, breakeven), the worst-case line. Actions: **Save to Tradebook** (ink-filled confirm button, disabled while saving, no double insert) and **Open in editor** (secondary). Toast names the saved trade and links to the Tradebook; save errors appear in the panel, not over the toast.
- **Responsive:** the full layout holds from 1440 down to 1100. ★ Below 1100 (tablet and phone widths) is OUT OF SCOPE for this pass and recorded as a follow-up design problem, not a squeeze: no phone layout is designed here; the page may simply require ≥1100 until that pass.

## 7. Constraints and open decisions (decided here, for approval)
- **Profit / loss pair:** profit ink `#1F7A4D` on tint `#DDF3E6`; loss ink `#C8325A` on tint `#FBE3E9`. Both ≥ 4.5:1 on white, both distinct from violet and lime. Used only for realized or projected P&L (Tradebook outcomes, Performance, the payoff curve's loss zone). Never color alone: every P&L value carries a sign, and zones carry a label.
- **Inputs:** white field, 1.5px `--line` border, 12px radius (radius/2), 44px tall, label above (ink-2, .85rem, 600), helper or error line beneath; focus = 3px violet ring, 3px offset; steppers keep the − / + buttons; all numerics tabular.
- **Error / disabled / loading:** error = loss-ink border + loss-ink line beneath, same ring on focus; disabled = ground-deep fill, ink-3 text, no shadow; loading = control keeps its size, label changes, results dim rather than unmount.
- **Selected row:** violet-soft row fill, the rank badge turns violet with a white numeral, ticker in ink 700. No left border. Hover = ground tint. Borderline-probability rows are marked by a small quiet "borderline" pill beside P(max), not a tint.
- **New button role:** "confirm" (ink fill, white text) for in-panel commits like Save, so lime stays the single page action. To be added to DESIGN.md at build.
- **Units:** the UI is per-contract everywhere; the API stays per-share (`min_premium` converted at the boundary).
- Builder must not invent: pricing, plan names beyond Free/Paid, performance numbers, teaser copy that promises returns.
- Accessibility: every interactive element is a button or link; the tab strip is a `tablist`; live regions for progress, toast, and errors; the P(max) gauge has a text value.

## Build order (each step verified before the next, committed at boundaries)
(a) DESIGN.md/tokens gain the four decided tokens + the "confirm" role · (b) shell: top bar, tab strip, plan pill, market badge, locked-tab teasers (number-free, "Paid · not available yet") · (c) controls bar with keyboard behaviors and "Rescan needed" · (d) scanning chips · (e) ranked table with sort/selection/keyboard nav and the metric-bar component · (f) detail panel: dashboard driven by selection, payoff curve with spot marker and labelled zones, Save (double-insert-safe) + Open in editor + toast · (g) all states.

## Verification before report
Frontend tests pass or are updated with reasons; local e2e: fresh login → scan a watchlist → sort → select → save → toast → Tradebook shows it; impeccable critique re-run vs the 17/40 baseline with each of the four P1s explicitly closed or not; screenshots at 1440 and 1100. No deploy: local review first.

## Follow-ups recorded
- Sub-1100 / phone layout for the Screener (design problem, separate pass).
- Tradebook adopts the shell in the next pass.
- Per-ticker scan progress needs an API change (`/api/run` is one request); this pass shows an honest indeterminate strip ("Scanning N tickers · elapsed").
