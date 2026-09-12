# v3 — Calm Editorial

A well-designed explainer, not an app. Paper, ink, one warm accent, hairline rules instead of cards, numbers set like pull-quotes. Written as the design system the app inherits if this direction wins.

## Palette

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#F7F4EE` | Page ground. The only background color for content areas. |
| `--paper-deep` | `#EFE9DD` | Image placeholder and any recessed field (inputs at rest, table row hover may use ink at 3% instead). |
| `--ink` | `#1B1A17` | Primary text, strong rules, the black in the ladder. |
| `--ink-2` | `#5C5952` | Secondary text, captions, table headers, nav links. 7.4:1 on paper. |
| `--ink-3` | `#6E6A5F` | Tertiary text: figure captions, footer, small unit labels. 4.9:1 on paper (AA for body). |
| `--rule` | `rgba(27,26,23,0.18)` | Hairline rules between rows, columns, sections. |
| `--rule-strong` | `rgba(27,26,23,0.55)` | Secondary button border, scrollbar thumb. |
| `--accent` | `#D9930D` | Saffron fill: primary button, spot tick on the ladder, selection highlight, profit-zone tint at 14% alpha. Never used for text. |
| `--accent-ink` | `#8F5A00` | Saffron as text: key numbers, "Sell" legs, step numerals, the Paid tag. 5.3:1 on paper. |
| `--accent-soft` | `rgba(217,147,13,0.14)` | Zone fill behind the profit range. |

Color strategy: restrained. Ink carries everything; saffron appears only where the reader should look next (one action, one number per block, one rule). No red/green: profit and loss are words and numbers, never a color pair. In the app, positive P&L may take `--accent-ink`; negative stays `--ink`.

## Type

- Display: **Young Serif** (Google Fonts), weight 400 only. Fallback: Iowan Old Style, Palatino, Georgia.
- Body / UI: **Hanken Grotesk**, 400 / 500 / 600, italic 400. Fallback: Helvetica Neue, Arial.
- Tabular figures on every number: `font-variant-numeric: tabular-nums lining-nums`. Apply `.num` to table bodies, prices, stats.

| Role | Face | Size | Line height | Tracking |
|---|---|---|---|---|
| Hero h1 | Serif | `clamp(2.75rem, 2rem + 4.2vw, 5.75rem)` | 1.02 | -0.02em |
| Section h2 | Serif | `clamp(2rem, 1.5rem + 1.8vw, 3rem)` | 1.08 | -0.01em |
| Pull-quote number | Serif | `clamp(2.75rem, 1.8rem + 4vw, 5.5rem)` | 1.0 | -0.02em |
| Stat value | Serif | `clamp(1.75rem, 1.3rem + 1.2vw, 2.5rem)` | 1.0 | -0.01em |
| h3 | Serif | 1.5rem | 1.3 | -0.01em |
| Lede | Sans 400 | `clamp(1.125rem, 1rem + 0.5vw, 1.375rem)` | 1.5 | 0 |
| Body | Sans 400 | 1.0625rem | 1.6 | 0 |
| Small / caption | Sans 400 | 0.875–0.9375rem | 1.5 | 0 |
| Label (table head, tags) | Sans 500–600 | 0.75rem | 1.2 | 0.09em, uppercase |

Measure: prose 66ch max; ledes 52ch; card copy 34–48ch. Display never exceeds 6rem.

## Spacing

Base 4px. Scale tokens: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-6` 24 · `--s-8` 32 · `--s-12` 48 · `--s-16` 64 · `--s-24` 96 · `--s-32` 128.

- Container: 72rem max, side padding 24px (mobile) / 48px (≥60rem).
- Section rhythm: 64px vertical on mobile, 96px on desktop, every section separated by one hairline rule.
- Heading spacing: more above than below (section head to content: 48px; heading to its paragraph: 12–16px).
- Table cells: 16px vertical, 12px horizontal. Rows separated by hairlines; header and last row closed with a 1px ink rule.

## Rules and surfaces

There are no cards. Grouping is done with hairline rules (`--rule`, 1px) and a stronger 1px ink rule to open or close a block. No shadows anywhere. Recessed areas (image slots, inputs) use `--paper-deep`. Hover on rows and secondary buttons is ink at 3–4% alpha.

## Radius

**2px everywhere**: buttons, inputs, image slots, focus rings. No pills, no circles except icon glyph geometry. This is a square world softened by one pixel.

## Controls

- Primary button: saffron fill, ink text, 600 weight, `0.95em 1.4em` padding, hover lightens to `#E3A125`, press translates 1px.
- Secondary button: transparent, 1px `--rule-strong` border, hover to ink border with 4% ink fill.
- Focus: 2px `--accent-ink` outline, 3px offset.
- Selection: saffron on ink. Scrollbar: `--rule-strong` thumb on paper track.

## Motion

One authored moment: the strike ladder draws its axis and ticks once when it scrolls into view (900ms, `cubic-bezier(0.16,1,0.3,1)`), then labels fade. Everything else is 160ms color/border transitions. `prefers-reduced-motion` disables the draw entirely (content visible by default).

## Icons

Authored inline SVG, 1.75px stroke, round caps. One arrow glyph on the primary action. No icon library, no emoji.

## Carrying this into the app

- Screener table: the editorial table on this page is the pattern. Ink header rule, hairline rows, serif rank and credit, tabular sans elsewhere. Selected row: `--accent-soft` background, no left border.
- Setup detail: the "specimen" block. Legs on the left with buy/sell in ink/saffron, outcomes on the right as serif stats, worst case as a sentence.
- Controls drawer: inputs as underlined fields (1px ink rule below), labels in 0.75rem caps.
- Picks / Performance: the pull-quote number style carries the headline stat; the one chart uses ink for the book and `--rule-strong` for SPY.
