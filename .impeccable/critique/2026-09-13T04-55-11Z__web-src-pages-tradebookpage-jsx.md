---
target: Tradebook (web/src/pages/TradebookPage.jsx)
total_score: 33
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/binkmaster/Desktop/Luo Capital/web/src/pages/TradebookPage.jsx"
target_fingerprint: "sha256:82c388eca6e6f5a94fb2b8ee3790800e42179d9be6da6c607d664777c2278fe2"
target_path: /Users/binkmaster/Desktop/Luo Capital/web/src/pages/TradebookPage.jsx
timestamp: 2026-09-13T04-55-11Z
slug: web-src-pages-tradebookpage-jsx
---
Method: dual-agent re-run (A: design review sub-agent · B: detector/browser sub-agent), after commit b696a64 (graded panel answer-first with the setup folded; chains anchor on the saved strike; expired trades read-only with a Grade-pending tile). Seeded account, 1440×900 and 1100×900.

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Shell shows "Market — / No scan yet" on a page with no scan |
| 2 | Match System / Real World | 4 | solid |
| 3 | User Control and Freedom | 3 | Editor round-trip resets selection to row 1; at 1100 the editor opens mid-page |
| 4 | Consistency and Standards | 3 | Read-only editor prints P(max) 51% and unit-less "Spread width 5" for settled trades |
| 5 | Error Prevention | 4 | Expired trades read-only; two-step Delete names what goes |
| 6 | Recognition Rather Than Recall | 4 | Chains anchor on the saved strike; fold summary carries strikes/credit/max |
| 7 | Flexibility and Efficiency | 3 | "Back to default" drops focus to body |
| 8 | Aesthetic and Minimalist Design | 3 | Graded panel 435px; open panel 1,223px at 1440 beside a 313px table |
| 9 | Error Recovery | 3 | Save-then-delete failure explains but offers no retry |
| 10 | Help and Documentation | 3 | Pending tooltip title-only; order sentence in the header slot |
| **Total** | | **33/40** | Two structural gaps closed |

## Design Specificity Verdict
Authored for this product. Detector: 0 findings on the six files. Overlay (6 captures): nested-cards on the payoff frame (intentional inset), first-viewport-column-overflow at 1100 (deferred), cramped-padding on the editor chain frames (by design); four self-flags / closed-fold text findings are false positives. Settlement sentence bottom 456px, fold summary 560px in a 900px viewport; all three chain rows centered; no overflow; fonts loaded; 0 unnamed buttons.

## Previous priority issues
1 graded answer below the fold — CLOSED. 2 chains deep-ITM — CLOSED. 3 pending editable + gauge — CLOSED. 4 curve label crowding — REMAINS (deferred by owner). 5 layout — PARTLY (graded compact; open still tall).

## Priority Issues
- [P1] Open/pending panels bury their actions (y≈1,322 at 1440). Fix: sticky panel with own scroll, or the action row under the head. (`TradebookPage.jsx`, `SetupPanel.jsx`) — /impeccable layout
- [P1] Editor round-trip loses place: scroll offset carries into /trade (at 1100 it opens on the Sell put column); Back reselects row 1. Fix: scrollTo(0,0) on mount; pass source id back and seed selectedKey from router state. (`TradePage.jsx`, `TradebookPage.jsx`) — /impeccable harden
- [P2] Read-only editor contradicts the panel: P(max) and Spread width for a settled trade, no outcome. Fix: swap P(max) for Realized P&L / Grade pending; "5 pts"; settlement sentence in the note bar. (`TradePage.jsx`) — /impeccable clarify
- [P2] Pending panel restates one fact six times. Fix: drop the "Expired {date}" pill and the actions caption when expired. (`SetupPanel.jsx`, `TradebookPage.jsx`) — /impeccable distill
- [P3] Focus/status leaks: Back to default drops focus; third header click silently resets sort; empty market cluster; loss sentence omits what you now hold. — /impeccable polish

## Persona Red Flags
Alex: selection reset after Back; chain rows not focusable. Jordan: pending state honest but anxious; "Saved before scan history" is jargon. Retail trader: at 1100 the loss row is a bare "−$570"; no capture-of-max (by the brief).

## Minor Observations
Fold summary wraps at 1100; fold state resets via an open row; "Open 2" vs "1 open · 1 grading"; provenance time has no zone; Delete uses the loss color for chrome; seeded pending row has MU-scale strikes on AMD.

## Questions to Consider
- Should the open state be the graded shape in reverse ("where it stands today" first, legs and curve folded)?
- Is "View in editor" for expired trades worth a route at all?
- Is the book's unit the trade or the structure (two MU trades share strikes at different expirations)?
