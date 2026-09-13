---
target: Tradebook (web/src/pages/TradebookPage.jsx)
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/binkmaster/Desktop/Luo Capital/web/src/pages/TradebookPage.jsx"
target_fingerprint: "sha256:3cdcaa9faacb6041117db7ba75f0942fafa96de469afdb3289a307f1a9e5c102"
target_path: /Users/binkmaster/Desktop/Luo Capital/web/src/pages/TradebookPage.jsx
timestamp: 2026-09-13T04-37-41Z
slug: web-src-pages-tradebookpage-jsx
---
Method: dual-agent (A: design review sub-agent · B: detector/browser sub-agent). Seeded account: one open (from a real scan), one grading-pending, two graded (capped win, loss). Local build at http://127.0.0.1:5002/tradebook, 1440×900 and 1100×900.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Grading-pending panel still shows a "Chance of max profit 51%" gauge on an expired trade |
| 2 | Match System / Real World | 4 | Per-contract dollars, zone words, "you own 100 MU at an effective $849.15" |
| 3 | User Control and Freedom | 3 | Selection resets after the editor round-trip; no undo after a confirmed delete |
| 4 | Consistency and Standards | 3 | Read-only editor prints P(max) for a settled trade; "Spread width 5" is unit-less |
| 5 | Error Prevention | 3 | Grading-pending trades are editable with replace-on-save |
| 6 | Recognition Rather Than Recall | 2 | Editor chains open on deep-ITM strikes; the saved strike is ~1,200px down each column |
| 7 | Flexibility and Efficiency | 3 | "Back to default" and Keep unmount under focus, dropping focus to body |
| 8 | Aesthetic and Minimalist Design | 2 | 313px table beside an 1,109px panel at 1440; panel is 1.9 viewports tall at 1100 |
| 9 | Error Recovery | 3 | Save-then-delete failure leaves the duplicate the brief says never survives |
| 10 | Help and Documentation | 3 | The 13-word default-order sentence does documentation work in a header slot |
| **Total** | | **29/40** | Solid, with two structural gaps |

## Design Specificity Verdict
Authored for this product: Put / Call / Call strikes, zone labels in words, the settlement sentence, the caption "sum of per-contract outcomes, not a portfolio return". The trade editor's chain cards are the one category-interchangeable region.

Deterministic scan: 0 findings across TradebookPage.jsx, TradebookTable.jsx, SetupPanel.jsx, PayoffCurve.jsx, TradePage.jsx, useTradebook.js (also 0 with --no-config). Overlay (injection succeeded, 4 views): nested-cards on the PayoffCurve frame (inset tile by design, false positive), cramped-padding on the editor's three chain frames (edge-to-edge scrolling tables, by design), first-viewport-column-overflow at 1100 (panel column 189% of viewport vs table 39%) — real. No horizontal overflow at 1440/1100; Bricolage Grotesque + Figtree loaded; 0 unnamed buttons.

## Priority Issues
- [P1] Graded state's answer (settlement sentence, Realized P&L) is below the fold (y≈1190 at 1440×900) after legs, curve and five stat cards. Fix: move the Outcome sentence + Realized card under the head in graded/pending states; Realized is the single hi tile; demote Credit. (`SetupPanel.jsx`) — /impeccable layout
- [P1] Editor chains open at scrollTop 0 on delta-0.84 calls; the saved strike is ~1,200px down. Fix: scrollIntoView the aria-current row on load, or filter each chain to the leg's delta band with "Show all". (`TradePage.jsx` LegColumn) — /impeccable harden
- [P2] Grading-pending trades are editable and show a live P(max) gauge; replacing one deletes the row the nightly backfill is about to grade. Fix: read-only for any non-open status; neutral "Grade pending" tile instead of the gauge; "View in editor" label. (`TradePage.jsx:37`, `SetupPanel.jsx`, `TradebookPage.jsx`) — /impeccable harden
- [P2] Payoff-curve labels crowd the top-right (breakeven, max, settled/spot marker within ~140px); a settled price below xMin clamps to the edge with no hint. Fix: breakeven on the x-axis at its price; off-chart arrow when clamped. (`PayoffCurve.jsx`) — /impeccable polish
- [P3] Layout fights the content: short table beside tall dashboard, ~1,300px empty ground at 1100, gauge caption wraps to three lines. Fix: panel min 26rem so the grid keeps two columns; drop the table min-height; sticky panel with own scroll. (`TradebookPage.jsx`) — /impeccable adapt

## Persona Red Flags
- Alex (keyboard): selection resets after editor round-trip; Keep / Back to default drop focus to body; chain rows not focusable; third header click resets sort (undocumented).
- Jordan (first-timer, back after expiry): pending state is the least-designed — stale 51% gauge, "nightly backfill" jargon, editor offers to replace a dead trade.
- Retail trader checking last month: Zone hides at 1100 so "−$570" loses "Loss" until clicked; Max profit/Breakeven in present tense on settled trades; no "captured X% of max".

## Minor Observations
"Open" label vs "1 open · 1 grading" sub; adjacent dashes in P&L/Zone on open rows; "/ct" in the sort note; editor metrics stale after a chain click with no signal; pending tooltip hover-only in the table; Delete uses the loss color for chrome; provenance timestamp local time, no zone; curve aria-label omits the marker; seeded pending row has MU-scale strikes on AMD.

## Questions to Consider
- Should a graded trade have a different panel shape (sentence, realized card, then the setup folded below)?
- Should "Open in editor" filter each chain to the leg's delta band by default?
- Is "captured X% of max" the honest per-trade grade this page is missing, or the first step toward the gated Performance figures?
