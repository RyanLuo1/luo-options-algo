---
version: 1
slug: "web-src-pages-tradebookpage-jsx"
primary_target: "web/src/pages/TradebookPage.jsx"
related_targets: ["web/src/pages/TradePage.jsx","web/src/components/lc/SetupPanel.jsx"]
---

# Shape — Tradebook page (`/tradebook`), the second free tab inside the four-tab shell

Status: APPROVED 2026-09-13 with one change (★ edits must not duplicate the ledger — replace-on-save). Re-skin plus whatever the critique finds; logic unchanged. Visual authority: DESIGN.md (v1 world); the Screener (`/app`) is the sibling surface and every shared component is reused, not rebuilt.

## 1. Job and audience
The same trader, back at the desk after saving setups: "what's open, what's coming due, what did the graded ones do". Operate mode. Free tab.

## 2. Outcome and proof
Primary task: read the book at a glance, open a trade to see its dashboard, delete or re-open one in the editor. Proof carried: every graded trade shows a signed realized P&L per contract and the payoff zone it settled in, from the nightly grading; every open trade shows where the stock is now against its strikes. Honesty rules: no win rate, nothing annualized, no portfolio return; Performance is the paid tab.

## 3. Selected direction
Inherit the Screener's world and composition exactly: the same `AppShell` (top bar, tab strip with Tradebook active, plan pill, market badge), the same table treatment, the same `SetupPanel` as the detail panel in a second state. Structural thesis: one shell, one table, one dashboard, two states. Focal moment: selecting a graded trade turns the dashboard's worst-case slot into the settlement sentence.

## 4. Scope and boundaries
- Target: `web/src/pages/TradebookPage.jsx` (rebuilt on `components/lc/`), `SetupPanel.jsx` (gains a `settlement` prop), `App.jsx` (accepts a `rerun` router state), the trade editor (`TradePage.jsx`) re-skinned on the tokens with a read-only mode for graded trades.
- Untouched: the tradebook API (`/api/tradebook/save`, insert-only), the DB schema, `backfill_outcomes.py`, the grading classification. Reads stay direct supabase-js queries under the existing row-level policies: `tradebook` (own rows), `trade_outcomes` (own rows, by `tradebook_id`), `scan_runs` + `scan_results` (own rows, by `scan_id` / `result_id`) — **no API addition is needed for provenance**. Live spot for open trades comes from the existing `GET /api/chart?ticker=&timeframe=1D` (`current_price`, yfinance, cached 60s), best-effort.
- ★ Mobile / sub-1100 widths are out of scope, same as the Screener; recorded as the same follow-up design problem.
- Anti-goals: no win rate, no annualized figures, no returns claims, no color-only meaning, no `window.confirm`.

## 5. States and ranges
- **Empty:** "No trades yet — save one from the Screener" with a Go-to-Screener action.
- **Loading:** the table skeleton dims; a slim strip reads "Loading your trades…".
- **Error:** the Screener's dismissable error strip ("Couldn't load your trades. Try again."); the last good list stays if there was one.
- **Open:** expiration ≥ today (ET); status pill "Open · 12d"; the dashboard shows the live spot marker (or "spot unavailable").
- **Grading pending (important):** expiration < today ET and no `trade_outcomes` row yet → status pill "Grading pending" with the caption "Grades after the next close" (the backfill runs at 18:30 ET on trading days). Never a stale "Open" on an expired trade. Sorted with the open trades (they are the most urgent).
- **Graded:** a `trade_outcomes` row exists → status "Graded · Oct 17"; realized P&L per contract, signed, in the profit/loss pair; zone label in plain language: `expired_capped` → "Capped · max profit", `expired_sweet_spot` → "Sweet spot", `expired_credit_only` → "Kept the credit", `expired_breakeven` → "Breakeven", `expired_loss` → "Loss zone · put assigned", `expired_partial` → "Partial". Never color alone: the sign is always printed.
- **Ranges:** 0 to a few hundred trades (50 a page, "Show more"); trades saved before provenance existed (`scan_id` null) show "Saved before scan history" in place of the provenance pill; P&L from −$99,999 to +$99,999 in tabular figures.
- **Editor entry:** an open trade opens the editor pre-filled with "Save as new trade" + "Replace the original" (checked); a graded trade opens it **read-only** (chains and Save hidden; a note "This trade has expired and been graded").

## 6. Interaction and layout
- **Shell:** `AppShell` with `activeTab="tradebook"`; the Screener tab routes to `/app`; Picks/Performance open the same teasers.
- **Summary strip** (above the table, one white card, three figures): "N open" (pending included, shown as "N open · M grading"), "N graded", "Total realized P&L: +$X" signed in the profit/loss pair, captioned exactly "sum of per-contract outcomes, not a portfolio return". Nothing else.
- **Table** (the Screener's treatment, `RankedTable`'s row grammar): Status · Ticker · Expires ("Oct 17 · W5 · 34d", or "Oct 17 · settled" once graded) · Put / Call / Call · Credit /ct · Collateral · Realized P&L /ct (signed; "—" while open, "pending" while grading) · Zone (plain-language label) · Saved (date). Per-contract dollars throughout. Default order ★: open trades first, nearest expiration on top (grading-pending rows join them, oldest first), then graded, newest expiration first. Column sorts are overrides with "Back to default"; ↑/↓ select, Enter opens the editor, same keyboard model as the Screener. Selected row = violet-soft fill + violet marker.
- **Detail panel** = `SetupPanel`, one component, two states: (open) the existing dashboard with the live spot marker; (graded) the settlement price replaces the spot marker on the curve ("settled 1,012.40"), the stat cards keep credit / max / collateral / breakeven, the P(max) gauge is replaced by a "Realized P&L" card in the profit/loss pair, and the worst-case slot becomes the settlement sentence: "Settled at $1,012.40 — you kept the full credit ($540)" / "…captured the full spread ($2,040, max profit)" / "…lost $960 (put assigned at 860)". Actions: **Open in editor** (secondary; read-only for graded), **Rerun this scan** (secondary, from provenance), **Delete** as a two-step confirm role: "Delete" → "Confirm delete" (ink confirm button) + "Keep" (secondary); the row disappears with a toast "Deleted MU Oct 17 · 860 / 1025 / 1030".
- **Provenance:** a pill "From your scan · Sep 12 21:34 · rank 7 of 83" (scan_runs.created_at, scan_results.rank, scan_runs.total_passed) with the Rerun action, which navigates to `/app` with router state `{ rerun: { tickers, weeksMin, weeksMax, minPremium, minPProfit } }`; the Screener prefills its controls from it and runs.
- **Responsive:** 1440 → 1100 as the Screener; below 1100 out of scope.

## 7. Constraints and open decisions (decided here, for approval)
- ★ Edit semantics (approved change): "Open in editor" pre-fills the editor. The editor's action is **"Save as new trade"** with a checked-by-default **"Replace the original"** option. Checked: insert the corrected row and, on success, delete the original (two calls under the existing insert/delete policies, no API change) — the original never survives a replace, and the summary strip never counts an edit twice. Unchecked: both rows remain and the panel says so. Graded trades open read-only.
- ★ "Clear all" is removed; delete is per row with the confirm step.
- ★ Provenance shows the scan and offers to rerun it.
- Profit/loss pair (DESIGN.md) is used only on realized P&L and the settlement card; open trades carry no P&L color.
- Editor re-skin: tokens only, same three-column chain layout, same Recalculate / Save behaviour, `Toast` replaced by the Screener's toast pattern.
- Tests: extend `web/tests/e2e/` with `tradebook.mjs` — save from the Screener → appears first as open → edit with replace on (open count unchanged, original row gone) → edit without replace (both rows present, panel says so) → delete with confirm → graded and grading-pending states render from seeded rows (service key; cleaned up) → summary figures match → provenance pill and Rerun work. The Screener suite stays green.
- Builder must not invent: win rates, returns, "portfolio" language, pricing.

## Build order (verified at each step, committed at boundaries)
(a) shell + route with the tab active · (b) summary strip with the exact caption · (c) table: row grammar, default order, column sorts with "Back to default", keyboard selection · (d) SetupPanel graded state: settlement marker, Realized P&L card replacing the gauge, the three settlement sentences · (e) states: empty with Go-to-Screener, loading, error strip, grading-pending · (f) actions: Open in editor (read-only for graded), Rerun this scan, two-step Delete with Keep and a named toast, no Clear all · (g) provenance pill from the user's scan rows, "Saved before scan history" fallback · (h) the editor re-skinned on tokens with replace-on-save. Local review URL for the user; no deploy until their word.
