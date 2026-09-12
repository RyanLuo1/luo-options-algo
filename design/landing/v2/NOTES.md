# v2 — Illustrated & Playful

Flat illustration as the page language: every shape is a filled form with a 2px black outline, one corner radius everywhere, two brand colors plus black, white, and a soft ground. No shadows, no gradients, no blur. Depth comes from outlines and overlap, not lighting. Written as tokens so the app can adopt them directly.

## Palette

| Token | Hex | Role |
|---|---|---|
| `--ground` | `#F4F2F7` | Page background, panel insets, art backgrounds |
| `--paper` | `#FFFFFF` | Cards, buttons, table rows, overlay panel |
| `--ink` | `#111111` | All outlines, primary text, icon strokes |
| `--ink-soft` | `#4A4658` | Secondary text, table headers, small labels (≥ 7:1 on paper, 8:1 on ground) |
| `--violet` | `#8B6CFF` | Brand fill: hero band, probability bars, scrollbar, focus ring, filled shapes with no text |
| `--violet-deep` | `#5B3FD6` | Violet where white text sits on it (Paid pill, rank #1 badge, "Buy" badge, result line, closing panel). 6.3:1 with white |
| `--violet-tint` | `#E6DFFF` | Hover fill on ghost buttons, "isn't" list icon fill |
| `--lime` | `#D8F542` | Primary action fill, highlighted row / picked quote, headline highlight, "Sell" badges. Always with `--ink` text |
| `--lime-tint` | `#F1FBB3` | Reserved for soft lime surfaces (unused on this page) |

Rules: chartreuse means "the thing you act on or the thing that pays you". Violet is brand and structure. Never put white text on `--violet`; use `--violet-deep`. Money and probability are not color-coded; they are set in weight and tabular figures.

## Type

| Role | Face | Weight | Size | Notes |
|---|---|---|---|---|
| Display (h1) | Unbounded | 700 | `clamp(2rem, 4.6vw, 3.9rem)` | line-height 1.08, tracking -0.015em, balanced |
| Section (h2) | Unbounded | 700 | `clamp(1.65rem, 3.2vw, 2.5rem)` | |
| Sub-heading (h3) | Unbounded | 500 | 1.1–1.15rem | |
| Big numbers (credit, quote values) | Unbounded | 700 | 1.5–1.6rem | |
| Ticker symbols, rank badges | Unbounded | 700 | 0.9–1.6rem | |
| Body | Rubik | 400 | 17px / 1.55 | measure ≤ 64ch |
| Lead paragraph | Rubik | 400 | 1.125rem | `--ink-soft`, ≤ 62ch |
| UI labels, pills, table headers | Rubik | 500–600 | 0.8rem | |
| Buttons | Rubik | 600 | 1rem | |

Fallbacks: display `'Arial Black', 'Helvetica Neue', Arial, sans-serif`; body `'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`. All numerals use `font-variant-numeric: tabular-nums`.

## Spacing scale

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96` px (`--s-1` … `--s-24`). Section rhythm: 96px above a section, 64px below. Card padding 24px; overlay panel 44px (28px under 600px). More space above a heading than below it: h2 margin-bottom 16px, lead margin-bottom 32px. Container max-width 1180px with 24px side gutters.

## Radius rule

One radius: `--r: 20px` on every rounded element (cards, buttons, pills, badges, table row ends, art frames, scrollbar thumb, focus ring). Pills and small badges are shorter than 40px, so 20px renders them fully round; that is intentional, not a second radius.

## Outline / stroke rule

`--stroke: 2px` solid `--ink` on every container, button, pill, badge, and table row. Icon and illustration strokes are also 2px (3px inside the larger 4:3 story art, which is scaled down). `stroke-linecap: round; stroke-linejoin: round`. Dashed variants (`2px dashed`) mark "derived" content such as the worst-case line. No box-shadows anywhere.

## Components proven on this page

- Outlined card (`.card`), overlay panel, app-window frame with tabs
- Primary (lime) / ghost (paper) buttons with lift-on-hover
- Pills: neutral, lime (free), violet-deep (paid, with lock icon)
- Leg row (A/B/C badge · description · price)
- Setup card with credit block, 2×2 metric list, worst-case footer
- Leaderboard table: outlined rows with `border-spacing: 0 8px`, rank badges, #1 in lime, probability mini-bar
- "Is / Isn't" lists with authored check / cross icons

## Motion

One authored moment: the three "How it works" panels pop in sequence on scroll (translateY 18px + scale .97 → none, 0.5–0.6s, `cubic-bezier(.16,1,.3,1)`, 120ms stagger). Buttons lift 2px on hover with a slight overshoot. Everything is visible by default; motion only applies when JS runs and `prefers-reduced-motion` is not set.

## Hero image slot

Full-width band, aspect 16:7, `min-height: 300px` (200px under 900px). Currently a flat `--violet` field. Drop an `<img>` with `position:absolute; inset:0; object-fit:cover` (or a `background-image` with `background-size:cover`) into `.hero-band`; the overlaid white panel is positioned independently and nothing shifts.
