# v5 — Sunlit Minimal · design tokens

Direction: near-white, Swiss-grid discipline, black ink, one warm wash. Very few words; the confidence is in the spacing. Written so the winner lifts straight into app tokens.

## Palette

| Token | Hex | Role |
|---|---|---|
| `--ground` | `#FBFBF9` | Page ground everywhere. Never pure white. |
| `--ground-2` | `#F3F1EC` | One step deeper: image slots, row hover, quiet fills. |
| `--ink` | `#101010` | Primary text, primary buttons, strong rules. |
| `--ink-2` | `#4A4845` | Secondary text (7.6:1 on ground). |
| `--ink-3` | `#6E6B66` | Labels, table headers, muted meta (4.9:1 on ground). |
| `--rule` | `#DEDBD4` | Hairlines, borders, secondary-button edge. |
| `--wash-a` → `--wash-b` | `#FFE3CF` → `#FFF6E2` | The single warm wash. |
| `--white` | `#FFFFFF` | Reserved for cards on the wash only. |

Color rule: neutrals plus one wash. No accent hue for text or controls. Money is not colored; it is set heavier or larger. Profit/loss color, if the app needs it, is added as two tokens later and never used for chrome.

Wash rule: `linear-gradient(135deg, var(--wash-a), var(--wash-b) 70%, var(--ground))`, applied exactly once per page as a large background field (here: the closing CTA section). Never on text, never as a card fill, never purple.

## Type

| Role | Face | Weight | Size | Leading | Tracking |
|---|---|---|---|---|---|
| Display / h1 | Schibsted Grotesk | 600 | `clamp(2.5rem, 5.6vw, 5rem)` | 0.98 | −0.035em |
| Big number | Schibsted Grotesk | 600 | `clamp(3rem, 7vw, 6rem)` | 1.0 | −0.04em |
| h2 | Schibsted Grotesk | 600 | `clamp(1.75rem, 3vw, 2.5rem)` | 1.1 | −0.03em |
| h3 | Schibsted Grotesk | 600 | 1.25rem | 1.2 | −0.03em |
| Lede | Albert Sans | 400 | 1.25rem | 1.4 | −0.01em |
| Body | Albert Sans | 400 | 1.0625rem | 1.55 | 0 |
| Control | Albert Sans | 500 | 1rem | 1 | 0 |
| Label / meta | Albert Sans | 400–500 | 0.8125rem | 1.4 | +0.01em |

Fallbacks: `"Helvetica Neue", Helvetica, Arial, sans-serif` for both.
Numbers: `font-variant-numeric: tabular-nums` (`"tnum"`) on every numeric cell and stat.
Measure: body ≤ 40ch in cards and lists, lede ≤ 30ch, headline ≤ 12ch.

## Spacing scale (rem)

`0.25 · 0.5 · 0.75 · 1 · 1.5 · 2 · 3 · 4 · 6 · 8 · 10 · 14`
(`--s-1` … `--s-56`). Rhythm: section padding `--s-40` (10rem) desktop, `--s-24` tablet, `--s-16` phone; closing section `--s-56`. Inside a component: `--s-4` row padding, `--s-6` block gap. Always more space above a heading than below it (heading → content gap is `--s-16` for h2 groups, `--s-2`/`--s-6` inside components).

## Grid

12 columns, `minmax(0,1fr)`, gutter `1.5rem`, outer margin `clamp(1.25rem, 4vw, 4rem)`, max width `84rem`. Spans used: 4/4/4 (nav), 6 + 6 (hero), 6 + 5 offset (proof), 4 + 7 offset (setup), 12 (tables, lists). Below 64rem every span becomes 12; three-up and four-up lists become 2-up, then 1-up below 40rem.

## Radius

One value: `--radius: 8px`. Applies to buttons, the image slot, focus rings, scrollbar thumb. Tables, rules and sections have no radius.

## Rules and surfaces

Hairline `1px var(--rule)` separates sections and rows; `1px var(--ink)` marks the top of a component that starts a reading (setup block, table header, big-number pairs). No shadows, no filled cards. A component is a ruled region on the grid.

## Controls

Primary: ink fill, ground text, 3rem tall, 1.375rem side padding. Hover `#2A2825`. Active `translateY(1px)`.
Secondary: transparent, `--rule` border, hover border → ink.
Focus: `2px solid var(--ink)`, offset 3px, radius 8px.
Selection: ink on ground inverted. Scrollbar: `--rule` thumb on `--ground`.

## Motion

One authored moment: the product screenshot slot slides in from the right on load (`1.1s cubic-bezier(.16,1,.3,1)`, 0.15s delay). Everything else is a 150–180ms ease on color only. `prefers-reduced-motion` removes the slide and all transitions.

## Hero image slot

3:2 box, right half of the grid (columns 7–12), width 118% so ~18% bleeds past the viewport edge; `object-fit: cover`; radius 8px; `--ground-2` fill until the real screenshot lands. On phones: full width, no bleed, same ratio.
