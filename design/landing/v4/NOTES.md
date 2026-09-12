# v4 — Friendly Data

Data as decoration, made gentle. A light cool ground with a faint dot grid, white panels, one bright blue that does all the pointing, and rounded line charts as the illustration language. Every category wears a pill. This is the direction with the most natural answer for the app's tables: the results table is already a product component here, not a marketing prop.

## Color tokens

| Token | Hex | Role |
|---|---|---|
| `--ground` | `#F3F6FA` | Page background (cool, light) |
| `--dot` | `#D3DDEC` | Dot-grid ink, 1px dots on a 26px grid, behind everything |
| `--panel` | `#FFFFFF` | Cards, table, dashboard surfaces |
| `--line` | `#DCE4F0` | Panel borders, table header rule |
| `--line-soft` | `#EAF0F8` | Row separators inside tables |
| `--ink` | `#101828` | Headings, primary text, numbers |
| `--ink-2` | `#475467` | Secondary text (navy-tinted, never gray-on-color) |
| `--ink-3` | `#5B6B85` | Tertiary labels, chart axis text (≥4.5:1 on white and tints) |
| `--accent` | `#2467E0` | Buttons, rank #1, focus ring, active tab underline (white text on it: 5.1:1) |
| `--accent-hover` | `#1B55C2` | Hover state for filled accent |
| `--accent-text` | `#1B55C2` | Accent as small text on tints (pills, chips: 5.8:1 on `--tint`) |
| `--accent-line` | `#2E7CF6` | Chart strokes and gauge fill (graphic, 3:1 rule) |
| `--tint` | `#E4EEFF` | Pill fill, selection highlight, gauge track |
| `--tint-2` | `#F0F5FF` | Tab bar well, hero slot fill, rank chip |
| `--tint-3` | `#F7FAFF` | Leg cards, table header, row hover, quiet panels |
| Free pill | `#E3F6EE` / `#0F6B47` | The only green; reserved for "Free" and "graded" |

Rule: one accent. Blue means "act here" or "this line is the book". Green appears only on the Free/graded pill. Red is not in the system; loss and downside are expressed in words and plain dollars, not color.

## Type

- Display: **Gabarito** 700 (600 for h3, tab labels, pill text). Fallback: Avenir Next, Segoe UI, system-ui.
- Body: **Public Sans** 400/500/600. Fallback: Helvetica Neue, Arial, system-ui.
- Scale (rem): 0.72 chip · 0.85 pill/label · 0.92 small · 1.0 body-sm · 1.0625 (17px) body · 1.2 lead · 1.25 h3 · 1.7 stat · 2.0 gauge value · 2.4 quote tile · h2 `clamp(1.8rem, 3.2vw, 2.6rem)` · h1 `clamp(2.4rem, 5.4vw, 4.4rem)`.
- Headings: line-height 1.08, tracking −0.02em, `text-wrap: balance`. Body line-height 1.6. Measure 68ch.
- Numbers: always `.num` (tabular figures) — strikes, credits, percentages, collateral, dates.

## Spacing scale

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128` px (`--s1`…`--s10`). Sections use 96 (64 under 720px). Section heads sit 48 above their content; h2 has 16 below. Panel padding 24–32. Table cells 14 × 24. Tight groups use 6–12; separation between groups uses 24+.

## Radius rule

One radius: **16px** (`--r`) on every panel, tile, leg card, preview, tab bar, and hero frame. Nested surfaces step down by 4–6px (`calc(var(--r) - 4px)`) so inner corners sit concentric. Pills, chips, rank badges, buttons, and focus rings are **999px**. Nothing else is rounded.

## Charts and labels

- Charts are authored inline SVG: 4–5px strokes, round caps and joins, white-filled node circles at strikes, a dashed `--line` baseline for break-even, axis labels in `--ink-2` at 11–12px.
- The gauge is a half-arc: track in `--tint`, fill in `--accent-line`, `pathLength` normalized to 264 so percent = dashoffset.
- Pills label every category: dates, weeks, Free/Paid, P(profit) cells, sample-data disclosures. Pills never carry more than three words.
- Dot grid is page-level only; panels are always flat white so data reads cleanly.

## Depth and motion

- Shadow: `0 10px 30px rgba(16,24,40,.06), 0 2px 6px rgba(16,24,40,.04)` on panels only.
- Signature motion: the sample-setup dashboard reveals once on scroll — the payoff curve draws itself (stroke-dashoffset, 1.4s, exponential ease-out), the 53% arc fills, stat values rise 6px. Nothing else animates beyond 180ms hover transitions. `prefers-reduced-motion` renders the final state immediately.

## Browser surfaces

Selection `--tint` on `--ink`; focus-visible 3px `--accent` ring, offset 3px; scrollbar thumb `#B9C8E0` on `--ground`.

## Lifting into the app

Table: white panel, `--tint-3` header, `--line-soft` row rules, hover `--tint-3`, rank badge (accent on row 1), pill for probability, right-aligned tabular numerics. Setup card: ticker + pills header, three leg tiles on `--tint-3`, payoff SVG, stat tiles with the gauge as the one large number. Both are already built as real components in `index.html`.

Hero image slot: the framed 16/9 panel in the hero; swap the placeholder div for an `<img>` with `object-fit: cover` and a 12px radius. No layout change.
