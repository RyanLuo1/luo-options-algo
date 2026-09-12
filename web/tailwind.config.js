/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  // Theme is driven by the `dark` class on <html> (see index.html FOUC guard +
  // ThemeScope in src/main.jsx). Token vars flip in src/index.css (:root =
  // light, .dark = the original dark palette).
  darkMode: 'class',
  theme: {
    extend: {
      // Semantic color tokens — each references a CSS variable defined in
      // src/index.css :root. Using `extend` keeps Tailwind's default palette
      // (gray-*, emerald-*, etc.) intact while adding these on top, so
      // components can migrate to bg-surface / text-profit / border-subtle
      // incrementally without breaking existing classes.
      colors: {
        // backgrounds
        base:    'var(--bg-base)',
        // Tokens written as rgb(var(--*-rgb) / <alpha-value>) support Tailwind
        // opacity modifiers (bg-accent/10, border-subtle/30). Raw var() strings
        // silently compile to nothing under a modifier — keep the channel vars
        // in index.css in sync with the hex vars.
        surface: {
          DEFAULT: 'rgb(var(--surface-rgb) / <alpha-value>)',
          raised:  'var(--bg-surface-raised)',
        },
        // borders
        subtle: 'rgb(var(--subtle-rgb) / <alpha-value>)',
        strong: 'var(--border-strong)',
        // text
        primary:   'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        tertiary:  'rgb(var(--tertiary-rgb) / <alpha-value>)',
        // accent — actions / highlights (never profit/loss)
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover:   'var(--accent-hover)',
        },
        // semantic profit/loss — money / P&L only
        profit: {
          DEFAULT: 'var(--profit)',
          dim:     'var(--profit-dim)',
        },
        loss: {
          DEFAULT: 'rgb(var(--loss-rgb) / <alpha-value>)',
          dim:     'var(--loss-dim)',
        },
        // link / info
        link: 'rgb(var(--link-rgb) / <alpha-value>)',

        // ── v1 design system (DESIGN.md), namespaced `lc-*`. Scoped by the
        // `.lc` class on the rebuilt Screener shell; untouched pages keep the
        // slate tokens above. Light-only by design (no .dark variants).
        'lc-ground':      '#F1EEF3',
        'lc-ground-deep': '#E6E1EB',
        'lc-card':        '#FFFFFF',
        'lc-ink':         '#15121A',
        'lc-ink-2':       '#5A5266',
        'lc-ink-3':       '#7E7590',
        'lc-line':        '#E3DEE9',
        'lc-violet':      '#6547E6',
        'lc-violet-soft': '#EEE9FF',
        'lc-lime':        '#D4F53C',
        'lc-lime-hover':  '#C8EE22',
        'lc-bar-deep':    '#D9D2E3',
        // profit / loss pair — P&L only, never chrome, never color alone (shape §7)
        'lc-profit':      '#1F7A4D',
        'lc-profit-tint': '#DDF3E6',
        'lc-loss':        '#C8325A',
        'lc-loss-tint':   '#FBE3E9',
      },
      fontFamily: {
        // `font-mono` now resolves to the JetBrains Mono stack in --font-mono.
        mono: ['var(--font-mono)'],
        // v1 design system (DESIGN.md): display + body faces, self-hosted in public/fonts.
        display: ['"Bricolage Grotesque"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        figtree: ['Figtree', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      // v1 design system radii, shadows (DESIGN.md → Shapes / Elevation)
      borderRadius: {
        lc: '24px',
        'lc-half': '12px',
        'lc-plus': '18px',
      },
      boxShadow: {
        lc: '0 16px 40px rgba(40, 30, 70, .10)',
        'lc-hover': '0 22px 56px rgba(40, 30, 70, .14)',
        'lc-lift': '0 28px 64px rgba(40, 30, 70, .16)',
      },
    },
  },
  plugins: [],
}
