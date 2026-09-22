---
name: Luo Capital
description: Soft fintech cards on a warm lilac ground — the trade as a stack of cards you can hold, priced at the real bid and ask.
colors:
  ground: "#F1EEF3"
  ground-deep: "#E6E1EB"
  card: "#FFFFFF"
  ink: "#15121A"
  ink-2: "#5A5266"
  ink-3: "#7E7590"
  line: "#E3DEE9"
  violet: "#6547E6"
  violet-soft: "#EEE9FF"
  lime: "#D4F53C"
  lime-hover: "#C8EE22"
  mini-bar-deep: "#D9D2E3"
  profit: "#1F7A4D"
  profit-tint: "#DDF3E6"
  loss: "#C8325A"
  loss-tint: "#FBE3E9"
  loss-ink: "#A8264B"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(2.6rem, 5.6vw, 4.6rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.025em"
    fontVariation: "'opsz' 96"
  headline:
    fontFamily: "Bricolage Grotesque, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(1.9rem, 3.4vw, 2.8rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.025em"
    fontVariation: "'opsz' 72"
  title:
    fontFamily: "Bricolage Grotesque, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.01em"
    fontVariation: "'opsz' 24"
  money:
    fontFamily: "Bricolage Grotesque, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "'tnum'"
  ticker:
    fontFamily: "Bricolage Grotesque, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  lede:
    fontFamily: "Figtree, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  body:
    fontFamily: "Figtree, Helvetica Neue, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  table:
    fontFamily: "Figtree, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "'tnum'"
  label:
    fontFamily: "Figtree, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: "0.01em"
  column-header:
    fontFamily: "Figtree, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: "0.03em"
  chart-label:
    fontFamily: "Figtree, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
rounded:
  base: "24px"
  half: "12px"
  half-plus: "18px"
  full: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
  s-8: "64px"
  s-9: "96px"
  s-10: "128px"
components:
  button-primary:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "14px 24px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.lime-hover}"
    textColor: "{colors.ink}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "14px 24px"
  button-secondary-hover:
    backgroundColor: "{colors.card}"
    textColor: "{colors.violet}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "10px 18px"
  button-ghost-hover:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
  pill:
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.violet}"
    rounded: "{rounded.base}"
    padding: "5px 12px"
    typography: "{typography.label}"
  pill-quiet:
    backgroundColor: "{colors.ground-deep}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.base}"
    padding: "5px 12px"
  pill-lime:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "5px 12px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "{spacing.s-6}"
  card-compact:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "{spacing.s-5}"
  kpi-tile:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "{spacing.s-4}"
  kpi-tile-hi:
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "{spacing.s-4}"
  leg-row:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "10px 14px"
  leg-tile:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.half-plus}"
    padding: "{spacing.s-4}"
  curve-box:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.half-plus}"
    padding: "{spacing.s-4}"
  stat-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "{spacing.s-4}"
  stat-card-hi:
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "{spacing.s-4}"
  tabbar:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.half-plus}"
    padding: "6px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.half}"
    padding: "12px 14px"
    typography: "{typography.title}"
  tab-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.half}"
    padding: "12px 14px"
  preview-tile:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.half-plus}"
    padding: "{spacing.s-4}"
  mini-mock:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.half}"
    padding: "12px"
    height: "96px"
  quote-side:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "16px 24px"
  quote-side-used:
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "16px 24px"
  step-badge:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.card}"
    rounded: "{rounded.base}"
    size: "36px"
  rank-marker:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    size: "26px"
  table-cell:
    textColor: "{colors.ink}"
    padding: "14px 12px"
    typography: "{typography.table}"
  table-row-hover:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.base}"
  table-row-selected:
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.ink}"
  rank-marker-selected:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.card}"
    rounded: "{rounded.base}"
    size: "26px"
  button-confirm:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card}"
    rounded: "{rounded.base}"
    padding: "14px 24px"
    typography: "{typography.body}"
  button-confirm-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.card}"
  button-disabled:
    backgroundColor: "{colors.ground-deep}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.base}"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.half}"
    padding: "0 14px"
    height: "44px"
    border: "1.5px solid {colors.line}"
    typography: "{typography.table}"
  input-error:
    border: "1.5px solid {colors.loss}"
    textColor: "{colors.ink}"
  input-disabled:
    backgroundColor: "{colors.ground-deep}"
    textColor: "{colors.ink-3}"
  field-label:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
  field-error-text:
    textColor: "{colors.loss}"
    typography: "{typography.label}"
  pill-profit:
    backgroundColor: "{colors.profit-tint}"
    textColor: "{colors.profit}"
    rounded: "{rounded.base}"
    padding: "5px 12px"
  pill-loss:
    backgroundColor: "{colors.loss-tint}"
    textColor: "{colors.loss}"
    rounded: "{rounded.base}"
    padding: "5px 12px"
---

# Design System: Luo Capital

## Overview

**Creative North Star: "The Card You Can Hold"**

Luo Capital's visual world treats an options trade as a physical object: three white cards you could pick up, turn over, and read the credit off the front. Everything sits on a pale, warm lilac-gray ground that is neither paper nor screen; white surfaces float above it on soft, downward-cast shadows; black ink does the talking; one flat violet draws the structure (links, labels, the "buy" leg, the payoff line); and one chartreuse is spent on exactly the thing we want the visitor to do. The density is deliberately low for a finance product: one focal point per section, generous section padding, a 66-character measure, and numbers set large in the display face so a $540 credit reads before a sentence does. It is calm on purpose, because the product's promise is that the number is real, and calm is how a real number looks.

This world was chosen as direction v1 ("Soft Fintech Cards") over four alternatives and then absorbed three components from the rejected v4 ("Friendly Data") direction, recolored into this palette: payoff-curve step cards, the tab-strip "What's inside" panel, and the setup dashboard with its drawn curve and probability gauge. Those are now native here, not borrowed. The old app frontend (dark slate, purple, JetBrains Mono) is superseded by this system and carries no authority.

Confirmed rejections, from the direction contract and the build: no dark terminal, no candlestick chaos, no dense tables above the fold, no gradients anywhere, no stock photography, no 3D blobs, no icon-grid feature rows, no purple-gradient SaaS, no fake proof.

**Key Characteristics:**
- Warm lilac-gray ground with white cards on soft offset shadows; black ink; two flat accents (violet for structure, lime for the one action); no gradients.
- One radius, 24px, on every outer surface; inner controls derive 12px and 18px from it.
- Bricolage Grotesque for headings, tickers, and money; Figtree for everything else; every figure tabular.
- The pay/collect convention runs through every component: bought leg = violet or white-with-violet-ring; sold legs = lime-with-ink-ring or muted ink.
- One authored entrance (the hero cards settle) and one scroll reveal (the curve draws, the gauge fills); everything else is a 150 to 250 ms ease and all of it is off under reduced motion.

## Colors

A restrained two-accent palette on tinted neutrals: violet does structure, chartreuse does the one action, and every gray is warmed from the ground's lilac hue rather than pulled from a neutral ramp.

### Primary
- **Structure Violet** (`violet`): the working accent. Links, pill text on its soft tint, column labels on highlighted tiles, the step-number badge, the "buy" leg label, the payoff curve stroke, the gauge fill, the focus ring, the scrollbar thumb, the "yes" check icon, and hover borders on secondary and ghost buttons. Text-safe on white (5.5:1) and on its own soft tint (4.9:1).
- **Violet Tint** (`violet-soft`): the highlight surface. The "used" quote side, the credit-collected KPI tile and stat card, the default pill background, the gauge track, and violet chips inside mini mocks. Never carries ink-2 text; its label color is always violet.

### Secondary
- **Action Lime** (`lime`): spent on the primary action and its echoes only. The Run-a-free-scan button, the rank-1 disc in the ranked table, the "Free" pill in the tab strip, the "graded" status chip in the Tradebook mini, and the sold-leg point fill on payoff curves. It is a signal that something is yours to take, not a decoration.
- **Action Lime, pressed** (`lime-hover`): the primary button's hover fill.

### Neutral
- **Lilac Ground** (`ground`): the page background, and the fill of every inset tile inside a white card (KPI tiles, leg rows, leg tiles, the tab bar, mini mocks, the quote's un-used side, table row hover).
- **Deep Ground** (`ground-deep`): the hero image slot, the quiet pill background, and muted chips. One step darker than the ground for panels that must read as "quiet, not interactive".
- **Card White** (`card`): every card, table, stat tile, active tab, preview tile, and the bought-leg point fill on curves. The step badge's numeral is also white.
- **Ink** (`ink`): primary text, the wordmark, tickers, money figures, and the ring around sold-leg points. Lime always carries ink text.
- **Ink Two** (`ink-2`): secondary text, captions, column headers, the "sell" leg label, pill-quiet text, nav links, and chart axis labels. Tinted from the ground hue: 7.5:1 on white, 6.4:1 on the ground.
- **Ink Three** (`ink-3`): icon tint only (the "isn't" cross icon). It fails AA as text on the ground and is never used as text.
- **Hairline** (`line`): 1px table rules, 1.5px outlines on secondary/ghost buttons, preview tiles and the curve box, and the dashed baseline in every payoff SVG.
- **Mini Bar Deep** (`mini-bar-deep`): a darker bar/dot fill used inside the mini mocks and as the dotted SPY comparison curve. It exists in the build as an untokenized literal `#D9D2E3` reused three times; promote it to a custom property before reusing it in the app.

### Named Rules
**The One Action Rule.** Lime appears only where the visitor can act or has been rewarded for acting: the primary button, the rank-1 marker, the Free pill, a graded/ok status chip, and the sold-leg point on a curve. It is never a background wash, never a border, never body text.

**The Pay/Collect Rule.** Anything the trader pays for is violet (the "Buy" label, the bought-leg curve point drawn white with a violet ring); anything the trader collects is ink or lime (the "Sell" label in ink-2, the sold-leg points drawn lime with an ink ring). The convention holds across the setup card, the leg tiles, the step cards, and the dashboard curve, so a reader learns it once.

**The Money Is Ink Rule.** Dollar figures, strikes, and percentages are set in ink, in the display face, with tabular figures. Money never borrows lime or violet, so the eye never confuses a value with an action or a status. (The build carries one exception, the "+ $540" result pill after the three steps; it is a rhetorical flourish on the marketing page, not a pattern for the app.)

**The Tinted Gray Rule.** No neutral gray anywhere. Every gray in the system is warmed toward the ground's lilac hue (`ink-2`, `ink-3`, `line`, `ground-deep`).

**The Profit / Loss Rule** (decided 2026-09-12 in the Screener shape). Profit is `profit` ink `#1F7A4D` on `profit-tint` `#DDF3E6`; loss is `loss` ink `#C8325A` on `loss-tint` `#FBE3E9`. Both clear 4.5:1 on white and read apart from violet (structure) and lime (action). They color only realized or projected P&L: Tradebook outcomes, the loss zone of a payoff curve, and the error state of a field (loss ink only). Never chrome, never a border on a card, never color alone: every P&L value carries a sign or a word, every zone a label. Borderline probability is a quiet pill, not a tint. **On the loss tint, text uses `loss-ink` `#A8264B`** (added 2026-09-13 in the login pass): `loss` on `loss-tint` measures 4.25:1, under the floor for small text, while `loss-ink` clears 5.67:1 there and 6.9:1 on white. `loss` stays the ink for P&L figures on white and for the error border of a field.

## Typography

**Display Font:** Bricolage Grotesque, variable, optical size 12–96 (with Helvetica Neue, Arial fallback)
**Body Font:** Figtree 400 / 500 / 600 (with Helvetica Neue, Arial fallback)
**Label/Mono Font:** none. Labels and figures use Figtree; there is no monospace face. Tabular alignment comes from `font-variant-numeric: tabular-nums`, not from a mono font.

**Character:** A chunky, slightly eccentric grotesque for the things a trader reads first (the headline, the ticker, the credit) over a plain, friendly sans for everything they read second. Headings are tight (line-height 1.05, tracking -0.025em, `text-wrap: balance`) and carry the face's optical-size axis explicitly (`opsz` 96 at h1, 72 at h2, 24 at h3). Money uses the display face at 800 with a small body-face caption beneath, so a figure looks like a headline and its unit looks like a footnote.

### Hierarchy
- **Display** (800, `clamp(2.6rem, 5.6vw, 4.6rem)`, 1.05, `opsz` 96): the hero headline only.
- **Headline** (700, `clamp(1.9rem, 3.4vw, 2.8rem)`, 1.05, `opsz` 72): section headings and the closing card's heading.
- **Title** (700, 1.3rem, 1.05, tracking -0.01em, `opsz` 24): card titles inside step cards, the "It is / It isn't" columns, tab labels (1rem), preview-tile titles (1.25rem).
- **Ticker** (display 800, tracking -0.01em): 1.25rem in the hero cluster, 1.6rem on the setup card, 2rem on the dashboard, 1.05rem at 700 in the ranked table's ticker column.
- **Money** (display 800, tracking -0.02em, line-height 1 to 1.1, tabular): 2.2rem for the hero credit (1.7rem on phones), 2rem for the quote value and the gauge figure, 1.7rem on stat cards, 1.6rem on KPI tiles, 1.35rem for leg-tile strikes. Always followed by a caption in the body face at 0.85 to 0.9rem in `ink-2`.
- **Lede** (400, 1.125rem, 1.6, `ink-2`, max-width 66ch or 38rem under a section heading): the sentence after a heading.
- **Body** (400, 17px base, 16px under 640px, 1.6): paragraphs; step-card body is 1rem, captions run 0.85 to 0.95rem in `ink-2`.
- **Table** (400, 0.95rem, tabular, nowrap): table cells; the credit column is 700, the ticker column is display 700 at 1.05rem.
- **Label** (600, 0.8rem, tracking 0.01em, sentence case): pill text and KPI keys; tab pills drop to 0.72rem and mini-mock chips to 0.66rem at 700.
- **Column header** (600, 0.78rem, tracking 0.03em, `ink-2`, sentence case): table `<th>`.
- **Chart label** (Figtree 600, 11px in step curves, 12px in the dashboard curve): strike labels under curve points in the leg's color; annotation labels ("+$540 credit") in violet; axis labels ("break even", strikes) in `ink-2` at 400.
- **Wordmark** (display 700, 1.15rem, tracking -0.01em) beside a 28px three-bar mark (violet, lime, ink rounded bars).

### Named Rules
**The Tabular Rule.** Every strike, credit, percentage, dollar figure, and date carries `.num` (`font-variant-numeric: tabular-nums; font-feature-settings: "tnum"`). Tables carry it on the `<table>` element so every cell inherits it. This is what keeps numeric columns aligned without a monospace face.

**The Caption Under Money Rule.** A money figure is never alone: it always has its unit or condition beneath it in the body face (`credit per contract`, `if NVDA is above $200`, `tied up while it's open`), smaller and in `ink-2`.

**The Sentence-Case Rule.** No uppercase labels, no eyebrows, no kickers. Column headers and pill labels are sentence case with at most 0.03em of tracking.

## Layout

A single centered container of 1180px (`width: min(100% - 48px, 1180px)`) with a 24px side gutter at every width. Sections stack vertically with 96px of block padding (64px under 640px); the hero uses 64px top / 96px bottom (32 / 64 under 980px). A section heading block is capped at 40rem: the h2, then 16px, then the lede (max 38rem), then 48px to content. More space sits above a heading than below it.

**Spacing scale.** Ten steps, `--s-1` through `--s-10`: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128px. In use: 6px and 10px appear as sub-scale gaps inside compact rows (leg-row gaps, tab-bar padding, pill gaps); card padding is 32 (24 under 640px and inside the hero cluster, 16 inside the cluster on phones); grid gaps are 24 between cards and 64 between the hero and proof columns; 48 between the two "It is / It isn't" columns.

**Grids as built.**
- Hero: `1.05fr 1fr`, gap 64, vertically centered. Right column is a 4:3 hero-image slot with the three-card cluster absolutely positioned over it (back card 62% wide at -5°, mid 58% at +3.5°, front 72% at 0°).
- Proof: `1fr 1fr`, gap 64, centered.
- Steps: three equal columns, gap 24.
- Dashboard: `1.15fr .85fr`, gap 24; the right column is a two-column stat grid with a full-width gauge card on top.
- Scan output: `24rem 1fr`, gap 24, top-aligned (setup card fixed width, table fluid).
- What's inside: one card holding a tab bar over four equal preview columns, gap 16.
- Honest notes: `1fr 1fr` inside one card, gap 48, padding 48.

**Breakpoints.** Three, in descending order:
- **≤ 980px**: hero, proof, and scan-output grids collapse to one column; steps stack; dashboard stacks (main card above stats) and the stat grid goes 4-up with the gauge spanning two; previews go 2-up; hero padding tightens to 32 / 64; the hero visual gains 16px of top margin.
- **≤ 760px**: nav links hide (brand and ghost button remain).
- **≤ 640px**: base type drops to 16px; section padding to 64; card padding to 24 (cluster cards to 16); the two back hero cards hide and the front card widens to 88% (its stat row hides; the credit drops to 1.7rem); leg tiles go one-up; stats go 2-up with the gauge full-width; the tab bar wraps two-up with text allowed to break; previews go one-up; the honest-notes card goes one column at 24 padding; the closing card pads 64 / 16.

**Tables** scroll horizontally inside their card (`overflow-x: auto`, `min-width: 560px` on the table) rather than breaking columns; the card clips overflow so row-hover corners stay inside the radius.

**Density.** Low by design on the marketing surface; the app should keep the same scale but drop to the compact steps (16 padding, 12 gaps, 0.95rem table type) for working screens, which the setup card, leg tiles, and ranked table already demonstrate.

## Elevation & Depth

Layered and lifted: depth is carried by soft, downward-offset, heavily blurred shadows in a lilac-tinted black, plus tonal insets (ground-colored tiles inside white cards). Shadows are never zero-offset halos and never hard. Inset tiles have no shadow at all; they read as recessed by being ground-colored on white. Outlined surfaces (preview tiles, the curve box, secondary and ghost buttons) rest flat with a 1.5px hairline and no shadow.

### Shadow Vocabulary
- **Rest** (`box-shadow: 0 16px 40px rgba(40, 30, 70, .10)`): every white card, stat card, and the active tab.
- **Hover** (`box-shadow: 0 22px 56px rgba(40, 30, 70, .14)`): step cards on hover, paired with a 2px lift (`translateY(-2px)`), 250ms ease.
- **Lift** (`box-shadow: 0 28px 64px rgba(40, 30, 70, .16)`): the front card of the hero cluster only, the one surface that sits above other cards.
- **Primary glow** (`box-shadow: 0 8px 20px rgba(160, 190, 20, .25)`, hover `0 12px 28px rgba(160, 190, 20, .32)`): the lime primary button, tinted toward the lime so the button looks lit rather than gray-shadowed.

### Named Rules
**The Soft Offset Rule.** Every shadow is offset downward (y ≥ 8px), blurred at least 2.5× its offset, and tinted `rgba(40, 30, 70, α)` with α between .10 and .16. No spread, no inset, no black.

**The Highlight Tile Rule.** A highlighted tile (`kpi.hi`, `dash-stat.hi`, `quote-side.used`) swaps its background to `violet-soft` and its label to violet, and drops its shadow (`box-shadow: none`). The "used" quote side adds a 2px inset violet outline. Highlight is a color change, never an added shadow.

## Shapes

One radius rule: **24px** (`--radius`) on every outer surface — cards, buttons, pills, KPI tiles, leg rows, the hero slot, the step badge and rank marker (which at 36px and 26px become full circles), the table's row-hover ends, and the focus ring. Nothing is squarer; nothing is rounder except the true pills inside mini mocks (999px bars, dots, and chips, which are miniature stand-ins, not real controls).

Two inner radii are derived, never chosen: **12px** (`radius / 2`) for a control nested inside a nested container (the tab inside the tab bar, the mini mock inside a preview tile), and **18px** (`radius / 2 + 6px`) for a container nested once inside a card (the tab bar, preview tiles, leg tiles, the curve box). Reading outward: card 24 → inner container 18 → control inside it 12.

Borders are hairlines: 1px `line` for table rules and the downside divider; 1.5px `line` for outlined surfaces (secondary and ghost buttons, preview tiles, curve box); 2px violet inset outline for the "used" quote side; 3px violet outline with 3px offset for focus. Payoff curves use round caps and round joins; curve points are circles (r=5 in step cards, r=6 in the dashboard) with a 3px ring.

Silhouette: the hero cluster is the signature shape — three cards fanned at -5°, +3.5°, 0° over a 4:3 slot. The brand mark repeats the stack as three rounded bars (violet, lime, ink) narrowing upward.

## Components

Tactile and calm: everything is a white card or a tile within one, buttons lift by 1px on hover, and nothing ever glows, pulses, or slides except the two authored moments.

### Buttons
- **Shape:** fully rounded (24px), 1.5px border (transparent on primary), inline-flex with an 8px gap for a trailing 18px inline-SVG arrow, Figtree 600 at 1rem, line-height 1.
- **Primary:** lime fill, ink text, 14px 24px padding, lime-tinted glow (see Elevation). Hover: `lime-hover` fill, deeper glow, `translateY(-1px)`; active returns to 0. One per viewport; it always reads "Run a free scan".
- **Secondary:** white fill, ink text, `line` border, same padding. Hover: border and text turn violet; the fill stays white.
- **Ghost:** transparent fill, ink text, `line` border, 10px 18px padding, 0.95rem. Used in the nav only. Hover: white fill, violet border.
- **Transitions:** transform, box-shadow, background-color, border-color at 180ms ease.
- **Focus:** 3px violet outline, 3px offset, 24px radius (global `:focus-visible`).

### Pills
- **Style:** inline-flex, 5px 12px padding, 0.8rem Figtree 600, tracking 0.01em, 24px radius, 6px internal gap.
- **Default:** `violet-soft` background, violet text — labels such as "Expires Oct 17" and "Sample setup · illustrative".
- **Quiet:** `ground-deep` background, `ink-2` text — secondary facts ("5 weeks").
- **Lime:** lime background, ink text — "Free" tags only, plus the one result-line flourish at 0.9rem / 8px 14px.
- **In tabs:** 2px 9px padding at 0.72rem.

### Cards / Containers
- **Corner Style:** 24px.
- **Background:** white.
- **Shadow Strategy:** Rest shadow at rest; step cards take the Hover shadow and a 2px lift on hover (250ms ease); the front hero card takes Lift.
- **Border:** none.
- **Internal Padding:** 32px (24px under 640px; 24px in the hero cluster and on the setup/table cards; 16px on the dashboard's stat cards and the What's-inside panel).
- **Inset tiles:** a card's interior tiles are `ground`-colored, shadowless, and 24px-rounded (KPI tiles at 16px padding, leg rows at 10px 14px). A tile that is the point of the card switches to `violet-soft` with violet labels.

### Inputs / Fields
**Decided in the app builds (2026-09-12/13).** White fill, 1.5px `line` border, **12px radius** (`rounded-lc-half`, `INPUT_CLASS` in `web/src/components/lc/format.js`), 44px tall in the app's controls and **48px at 16px type on the auth card** (no iOS zoom), Figtree at 0.95–1rem, ink text, `ink-2` placeholders (`ink-3` fails contrast). **Focus:** the global 3px violet ring, but inputs keep their own 12px radius (`.lc input:focus-visible`) rather than the 24px card radius. **Error:** 1.5px `loss` border plus `aria-invalid` and a message the field is `aria-describedby`; the message itself is `loss-ink` on `loss-tint` or `loss` on white. **Disabled:** `ground-deep` fill with `ink-2` text. Autofill is repainted white with ink text. A password field carries a Show / Hide text button inside its right edge (44px hit area, `aria-pressed`).

### Navigation
- **Landing header:** 24px block padding; brand lockup left (28px three-bar mark + "Luo Capital" in display 700 at 1.15rem); center links in Figtree 500 `ink-2`, hover violet, no underline, 32px gaps; a ghost "Run a free scan" button right. Links hide under 760px.
- **Tab strip (the app's navigation grammar):** a `ground` bar with 6px padding and an 18px radius holding equal-flex tabs; each tab is Bricolage 700 at 1rem, `ink-2`, 12px 14px padding, 12px radius. The active tab is white with ink text and the Rest shadow — a card sitting in a tray. Tabs wrap two-up under 640px at 10px 8px padding and 0.95rem, text allowed to break. This bar is literally the app shell: Screener · Tradebook.

### Preview Tile and Mini Mock
- **Preview tile:** white, 1.5px `line` border, 18px radius, 16px padding, vertical stack with 12px gaps: mini mock on top, title (display 700 at 1.25rem), then a 0.95rem `ink-2` paragraph. No shadow, no hover.
- **Mini mock:** a `ground` panel, 12px radius, 12px padding, 96px min-height, rows of 8px-gap items: 8px-tall 999px bars in `line` (a `short` bar is 40% wide; `ink` variant uses `mini-bar-deep`), 10px violet dots (`quiet` variant `mini-bar-deep`), 16px-tall chips at 0.66rem 700 in violet-on-`violet-soft` (`ok` = lime/ink, `mute` = `ground-deep`/`ink-2`).

### Setup Card (signature)
The hero cluster's front card and the "What a scan hands you" card are the same object at two densities. Header row: ticker (display 800) left, meta in `ink-2` at 0.85rem right (date · weeks · stock price). Credit: display 800 at 2.2rem (hero) with a body-face caption. Then either a 2×2 KPI grid (Credit collected highlighted `violet-soft`, Max profit, P(max profit), Collateral; keys 0.8rem 600, values display 800 at 1.6rem) or straight to the leg list. **Leg rows:** `ground` tiles, 24px radius, 8px 12px padding (10px 14px on the setup card), flex space-between, 0.9rem, 6px gaps; the leg label leads with "Buy" in violet 600 or "Sell" in `ink-2` 600, the price trails at 600 with its side ("$11.40 ask" / "$6.20 bid"); on the setup card a small `ink-2` 0.8rem caption sits under the label ("you pay the ask" / "you collect the bid"). **Downside block:** a 1px `line` top rule, 16px above and below, 0.92rem `ink-2` with ink 600 figures: breakeven and the worst case in plain dollars. Stat row (hero variant): 16px gaps, 0.9rem, `ink-2` keys with ink 600 values.

### Ranked Table (signature)
Inside a white card (24px 24px 12px padding, overflow hidden) with a label row above (a default pill left, an `ink-2` caption right). The table carries `.num`, 0.95rem, `min-width: 560px`, collapsed borders; cells 14px 12px, left-aligned, nowrap; numeric columns right-aligned (`.r`). Headers: 0.78rem 600 `ink-2`, 0.03em tracking, 1px `line` bottom rule. Rows: 1px `line` rule, none on the last. Rank column: `ink-2`, 3.5rem wide; the rank-1 rank is a 26px lime disc with ink 700. Ticker column: display 700 at 1.05rem. Credit column: 700. Strikes column: figures at 600 with `ink-2` slashes, ordered put / call / call. Row hover: cells fill `ground` and the first/last cells round their outer corners to 24px (150ms ease). A footnote below at 0.85rem `ink-2` explains units. Selected-row state is undefined (see open tokens).

### Step Card with Payoff Curve
A card laid out as a column with 16px gaps: a 36px violet circle badge (white display 700 numeral), title (8px above), a 1rem `ink-2` paragraph, and a payoff SVG pinned to the bottom (`margin-top: auto`, 12px top padding). Hover: Hover shadow and 2px lift.

**Payoff SVG conventions (all curves):**
- Step cards: `viewBox 0 0 240 120`; dashboard: `viewBox 0 0 600 230`. Width 100%, height auto.
- Baseline / breakeven: `line` stroke, 1.5px, dashed (`3 5` in steps, `4 6` in the dashboard).
- Curve: violet stroke, 4px in steps, 5px in the dashboard, round caps and joins, no fill.
- Points: r=5 (steps) / r=6 (dashboard), 3px ring. Bought leg = white fill, violet ring. Sold legs = lime fill, ink ring.
- Labels: Figtree 600 at 11px (steps) / 12px (dashboard), centered under the point, colored to the leg (violet for buy, ink for sell in steps; `ink-2` axis strikes in the dashboard). Annotations ("+$540 credit", "+$2,040 max") are violet 600; the axis caption ("break even") is `ink-2` 400, end-anchored.
- Curves are `aria-hidden` inside a labeled wrapper, or carry an `aria-label` describing the shape in words.

### Dashboard (signature): leg tiles, curve box, stat cards, gauge
- **Leg tile:** `ground`, 18px radius, 16px padding, column with 6px gaps: role (0.85rem 600 `ink-2`), strike (display 800 at 1.35rem, tabular), price with its side (0.92rem `ink-2`). Three across, gap 12; one-up under 640px.
- **Curve box:** 1.5px `line` border, 18px radius, 16px padding, holding the 600×230 curve; a caption row beneath at 0.85rem `ink-2`, space-between, 8px top margin ("Payoff at expiration, per contract" / "Stock price →").
- **Worst-case line:** 0.95rem `ink-2` with an ink 600 lead-in.
- **Stat card:** a white card at 16px padding, column with 6px gaps: label (0.85rem 600 `ink-2`), value (display 800 at 1.7rem, tabular), sub (0.9rem `ink-2`). The highlighted one (`hi`) is `violet-soft` with a violet label and no shadow.
- **Gauge card:** full-width in the stat grid, row layout with a 16px gap: a 112px-wide semicircle (`viewBox 0 0 120 70`, arc `M12 62 A48 48 0 0 1 108 62`, 12px stroke, round caps) with a `violet-soft` track and a violet fill using `pathLength="264"` and `stroke-dashoffset` = 264 × (1 − p); at 53% that is 124. Value at display 800 2rem.

### Motion
- **Hero settle (on load):** each cluster card animates `settle` for 900ms on `cubic-bezier(.16, 1, .3, 1)`, from opacity 0, `translateY(28px)` and 2° past its resting rotation, to rest; delays 50 / 180 / 320ms back → mid → front. The headline block's children `rise` 14px over 700ms on the same curve, staggered 0 / 80 / 160 / 240ms.
- **Dashboard reveal (on scroll):** the curve is drawn with `stroke-dasharray: 1000` from offset 1000 to 0 over 1.4s, and the gauge fills from offset 264 to 124 over 1.2s after a 300ms delay, both on the same curve, once, when the grid is 35% in view (IntersectionObserver adds `.is-in`, then disconnects).
- **Hover:** buttons 180ms, cards 250ms, table rows 150ms, all plain `ease`.
- **Reduced motion:** every animation lives inside `@media (prefers-reduced-motion: no-preference)`; under `reduce` the cards are already at rest, the curve and gauge render settled with no script needed, and the reveal script adds `.is-in` immediately (also when IntersectionObserver is missing). Smooth scrolling is on (`scroll-behavior: smooth`).

### Browser Surfaces
- `::selection`: lime background, ink text.
- `:focus-visible`: 3px violet outline, 3px offset, 24px radius.
- Scrollbar: violet thumb on `ground` track (`scrollbar-color`).
- Links: violet, 1.5px underline at 0.18em offset.

### Carrying this into the app
- **Screener** → the ranked table card (with a real selected-row state, to be defined), the setup card as the detail band, the leg rows with pay/collect captions, default pills for the scan-set chips and quiet pills for facts, the primary lime button for Run Scan (one per screen), ghost buttons for header actions, and the tab strip as the shell.
- **Tradebook** → the ranked table's structure plus a status chip column (the "graded" / "open" chips from the Tradebook mini are the seed), and the profit/loss pair once defined (open token).
- **Everywhere** → 24px outer radius with 18 / 12 derived inner radii; ground tiles inside white cards; money in ink, display 800, tabular, with a caption beneath.

### Copy conventions (decided 2026-09-15 in the Upside shape)
- **One collateral definition everywhere.** Collateral is the put strike × 100 — "the cash to secure the put". The Collateral column, the Income return-on-collateral gate (credit ÷ collateral), both metric bars (credit ÷ max profit in Income; max profit ÷ collateral in Upside), the Upside gate, Move-to-max, and the panel's Collateral card all read `collateralOf` in `web/src/components/lc/format.js`. No screen ever shows two collateral numbers for one trade; if a future figure needs a different denominator it gets its own name, not "collateral".
- **Probabilities say what they are.** "Chance the short legs expire worthless" is 1 − δ_B − δ_C (the stock between the put and the short call — you keep at least the credit); "Chance of max profit" is ≈ δ_B. The scanner's gate stays on the product (1 − δ_B)(1 − δ_C) and its control says "(approx.)". Never "P(max profit)" for the product.
- **Modes wear their name, not a verdict.** Upside rows and panels carry a quiet "Upside" pill (and the Tradebook labels Upside rows); no backtest claim or disclaimer sits near either mode (the calculator-only tag was retired 2026-09-16 as the Upside backtest neared completion). No lime ever sits near an Upside result.

### Inputs, states, and selection (decided 2026-09-12 in the Screener shape)

- **Input / field:** white field, 1.5px `line` border, 12px radius (`rounded.half`), 44px tall, 14px side padding, table type. Label above in `ink-2` at label size and weight; a helper or error line beneath at the same size. Focus is the system ring (3px violet, 3px offset). Steppers keep their − and + buttons inside the field; every numeric field is tabular.
- **Error:** the field border and the line beneath turn `loss` ink; the message names the problem and the recovery. The focus ring stays violet.
- **Disabled:** `ground-deep` fill, `ink-3` text, no shadow, default cursor. A disabled primary button keeps its size and drops lime for `ground-deep`.
- **Loading:** a control keeps its size and changes its label ("Scanning…"); results dim to 60% opacity rather than unmount, so sort and selection survive.
- **Selected row:** `violet-soft` row fill, the rank marker turns `violet` with a white numeral, the ticker stays ink at 700. No left border. Hover is the `ground` fill.
- **Confirm button:** a fourth button role for in-panel commits (Save to Tradebook): `ink` fill, white text, `ink-2` on hover, same radius and padding as primary. It exists so lime remains the page's single action.

## Do's and Don'ts

### Do:
- **Do** put every outer surface on the 24px radius and derive inner radii as 18px (`radius/2 + 6px`) and 12px (`radius/2`); never pick a third value.
- **Do** set every figure with `.num` (tabular-nums) and right-align numeric columns.
- **Do** set money in Bricolage Grotesque 800 with tracking -0.02em and a Figtree caption in `ink-2` beneath it.
- **Do** draw the bought leg white-with-violet-ring and the sold legs lime-with-ink-ring on every payoff curve, and label "Buy" in violet and "Sell" in `ink-2` on every leg list.
- **Do** highlight the tile that is the point of a card by switching it to `violet-soft` with violet labels and no shadow.
- **Do** keep shadows soft and offset downward in `rgba(40, 30, 70, .10–.16)`; outline flat surfaces with 1.5px `line` instead.
- **Do** house every animation inside `prefers-reduced-motion: no-preference` and render the settled state by default.
- **Do** use `ink-3` for icon tint only and `ink-2` for any secondary text.

### Don't:
- **Don't** use lime for anything but the primary action, the rank-1 marker, Free/graded chips, and sold-leg curve points; never as a wash, border, or figure color.
- **Don't** color a dollar figure violet or lime; money is ink.
- **Don't** use gradients, zero-offset halo shadows, hard shadows, or pure neutral grays.
- **Don't** set labels in uppercase, or add eyebrows or kickers above headings.
- **Don't** introduce a monospace face for numbers; tabular Figtree is the rule.
- **Don't** put a dark surface, a candlestick chart, or a dense table above the fold.
- **Don't** reuse lime, violet, or an ad-hoc green/red for profit and loss; the pair is an open system decision and must carry a text or sign cue when it lands.
- **Don't** reuse the untokenized `#D9D2E3` or `#fff` literals from the landing page's SVGs and mini mocks without first promoting them to custom properties (`mini-bar-deep`, `card`).
