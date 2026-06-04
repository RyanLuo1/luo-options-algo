/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
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
        surface: {
          DEFAULT: 'var(--bg-surface)',
          raised:  'var(--bg-surface-raised)',
        },
        // borders
        subtle: 'var(--border-subtle)',
        strong: 'var(--border-strong)',
        // text
        primary:   'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        tertiary:  'var(--text-tertiary)',
        // accent — actions / highlights (never profit/loss)
        accent: {
          DEFAULT: 'var(--accent)',
          hover:   'var(--accent-hover)',
        },
        // semantic profit/loss — money / P&L only
        profit: {
          DEFAULT: 'var(--profit)',
          dim:     'var(--profit-dim)',
        },
        loss: {
          DEFAULT: 'var(--loss)',
          dim:     'var(--loss-dim)',
        },
        // link / info
        link: 'var(--link)',
      },
      fontFamily: {
        // `font-mono` now resolves to the JetBrains Mono stack in --font-mono.
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
}
