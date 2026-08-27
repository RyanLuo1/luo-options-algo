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
      },
      fontFamily: {
        // `font-mono` now resolves to the JetBrains Mono stack in --font-mono.
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
}
