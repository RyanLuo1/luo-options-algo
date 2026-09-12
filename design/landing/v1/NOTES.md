# v1 — Soft Fintech Cards

Design-system notes, written so the winner lifts straight into app tokens.

## Palette

| Token | Hex | Role |
|---|---|---|
| `--ground` | `#F1EEF3` | Page ground. Warm lilac-gray; the app's base background. |
| `--ground-deep` | `#E6E1EB` | Quiet panels, image slots, row hover on white. |
| `--card` | `#FFFFFF` | Every card, table, and raised surface. |
| `--ink` | `#15121A` | Primary text and the wordmark. |
| `--ink-2` | `#5A5266` | Secondary text, tinted from the ground hue (7.5:1 on white, 6.4:1 on ground). Never a neutral gray. |
| `--ink-3` | `#7E7590` | Icon tint only. Never body text (fails AA on the ground). |
| `--line` | `#E3DEE9` | Hairlines, table rules, ghost-button borders. |
| `--violet` | `#6547E6` | Structure: links, labels, badges, focus ring, "buy" leg. Text-safe on white (5.5:1) and on `--violet-soft` (4.9:1). |
| `--violet-soft` | `#EEE9FF` | Violet tint for highlighted panels (the "used" bid, the credit KPI). |
| `--lime` | `#D4F53C` | Primary action only: Run a free scan, the rank-1 marker, the "Free" pill. Nothing else. |
| `--lime-hover` | `#C8EE22` | Primary hover. |

Strategy: restrained. Two accents plus neutrals. Violet does structure, chartreuse does the one action. No gradients anywhere. In the app, profit/loss would need a further pair; propose keeping violet/lime as *action/structure* and introducing a tinted green and a tinted red for P&L only, never for chrome.

## Type

- Display: **Bricolage Grotesque** (variable, `opsz` 12–96). Weights 700 for headings and card titles, 800 for h1 and money figures. Fallback: Helvetica Neue, Arial.
- Body: **Figtree** 400 / 500 / 600. Fallback: Helvetica Neue, Arial.
- Base 17px (16px under 640px), line-height 1.6.
- Scale: h1 `clamp(2.6rem, 5.6vw, 4.6rem)` · h2 `clamp(1.9rem, 3.4vw, 2.8rem)` · h3 1.3rem · lede 1.125rem · body 1rem · table .95rem · labels/pills .78–.85rem.
- Headings: line-height 1.05, tracking -0.025em, `text-wrap: balance`.
- Numbers: `.num` sets `font-variant-numeric: tabular-nums`. Every strike, credit, percent, and dollar figure carries it.
- Money figures in cards use the display face at 800 (1.6–2.2rem) with a small body-face caption beneath.

## Spacing scale

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128` px (`--s-1` … `--s-10`).

- Card padding 32 (24 on phones, 24 inside the hero stack).
- Grid gaps 24 between cards, 64 between hero/proof columns.
- Section padding 96 top and bottom (64 on phones).
- Section heading block: h2 then 16 then lede then 48 to content. More space above a heading than below it.
- Container 1180px, side gutter 24px.
- Body measure 66ch.

## Radius rule

**One radius: 24px** (`--radius`). Cards, buttons, pills, KPI tiles, leg rows, the hero slot, step badges, and row-hover backgrounds all use it. Nothing rounder, nothing squarer. In the app, table cells and inputs would also take 24px on their outer containers; inner controls (checkbox, slider thumb) inherit it as a full pill.

## Shadow rule

Soft, offset, blurred; never a zero-offset halo.

- Rest: `0 16px 40px rgba(40,30,70,.10)`
- Hover: `0 22px 56px rgba(40,30,70,.14)`
- Lift (the front hero card): `0 28px 64px rgba(40,30,70,.16)`
- Primary button: `0 8px 20px rgba(160,190,20,.25)` (lime-tinted).
- Paid cards rest with no shadow and a 1.5px `--line` outline; they gain the rest shadow on hover.

## Components shown

- **Setup card**: ticker + expiry header, 2×2 KPI tiles (credit highlighted violet-soft), three leg rows on ground tint with "you pay the ask / you collect the bid" captions, breakeven and worst-case line under a hairline.
- **Ranked table**: inside a white card, hairline rules, tabular figures, rank-1 marked with a lime disc, row hover fills with the ground color and rounds its ends. Horizontal scroll under 560px.
- **Buttons**: primary (lime), secondary (white, line border → violet on hover), ghost (transparent, for the nav).
- **Pills**: violet-soft/violet default, ground-deep/ink-2 quiet, lime/ink for "Free".
- **Step cards with payoff curves** (borrowed from v4, recolored): each "How it works" card ends in a 240×120 SVG payoff line, violet 4px stroke with round caps, dashed `--line` baseline. Strike points: bought leg = white disc / violet ring; sold legs = lime disc / ink ring (same pay/collect convention as the setup card). Labels are Figtree 11px 600 in the leg's color.
- **Setup dashboard** (borrowed from v4, recolored; section "What one setup looks like", between the three steps and the scan output): a 1.15 / .85 two-column grid. Left, one white card: ticker + spot, pills for expiry / weeks / "illustrative", three ground-tint leg tiles (`radius/2 + 6px`; role · strike in display 800 · price with its side of the quote), a `1.5px --line` curve box holding the 600×230 payoff SVG (violet 5px line, dashed `--line` breakeven rule, bought-leg point white/violet, sold-leg points lime/ink, violet "+$540 credit" and "+$2,040 max" labels), and the worst-case line. Right, a 2-column stat grid of small white cards: a full-width gauge card (semicircle arc, violet-soft track, violet fill to 53%), then Credit collected (violet-soft `hi` card), Max profit, Collateral, Breakeven. Stacks to one column at 980 (stats go 4-up), legs and stats go 1 / 2-up at 640. Reveal: the curve draws and the gauge fills once when the grid scrolls into view (IntersectionObserver, `.is-in`); under reduced motion both render settled with no script needed.
- **Tab strip + previews** (borrowed from v4, recolored): one white card holds a pill-shaped tab bar on the ground tint (`radius/2 + 6px`; active tab white with the card shadow; Free pills lime, Paid pills quiet) over four preview tiles (`1.5px --line` border, `radius/2 + 6px`) each with a ground-tint "mini" mock (`radius/2`): violet dots and chips on violet-soft, `--line` bars, lime "graded" chips, a lock glyph in `--ink-3` for paid rows, and the Performance mini as two crossing curves (violet solid, `#D9D2E3` dotted) that end level. 4 → 2 → 1 columns at 980 / 640; tabs wrap two-up under 640. This is the app's navigation grammar: the tab bar is literally the app shell.

## Motion

One authored moment: on load, the three hero cards settle into their stack (translate 28px + 2° over-rotation → rest, `cubic-bezier(.16,1,.3,1)`, staggered 50/180/320 ms) while the headline block rises. Card and row hovers are 150–250 ms ease. Everything is disabled under `prefers-reduced-motion: reduce`.

## Browser surfaces

`::selection` lime on ink · `:focus-visible` 3px violet ring, 3px offset · `scrollbar-color` violet on ground · smooth scroll.

## Hero image slot

4:3, right column, `.hero-slot`, now an `<img>` carrying an authored flat SVG backdrop (source `hero.svg` beside this file; inlined as a URL-encoded data URI so the page stays self-contained — regenerate the URI from `hero.svg` after editing it, and never leave a raw `#` in the URI). The backdrop follows the slot's geometry: the card cluster covers the center, so all detail sits in the margins — three soft planes (white / violet-soft / violet at 14%) rising from bottom-left, a tile scatter (violet, lime, white, ink; radius 6–14) dissolving off the top-right, and three quiet tiles in the right strip. Ground `#E6E1EB`, no gradients, no text, decorative (`alt=""`). To swap in a raster later: same aspect, square corners (the page rounds them), `object-fit: cover` is already set, change only `src`. On phones the two back cards hide and the front card overhangs the slot's top edge by ~34px, reading as a card floating above the surface.
