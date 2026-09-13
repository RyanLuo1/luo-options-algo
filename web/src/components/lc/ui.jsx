// v1 design-system primitives for the rebuilt app (DESIGN.md). Everything here
// assumes it renders inside an element carrying the `.lc` class (index.css),
// which sets the ground, ink, Figtree, tabular figures, selection, focus ring.
import { INPUT_CLASS } from './format'

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lc font-figtree font-semibold ' +
  'whitespace-nowrap transition-colors duration-150 select-none ' +
  'disabled:bg-lc-ground-deep disabled:text-lc-ink-3 disabled:shadow-none disabled:cursor-default'

const BTN_VARIANT = {
  // The One Action Rule: lime is the page's single primary action.
  primary:   'bg-lc-lime text-lc-ink hover:bg-lc-lime-hover shadow-[0_8px_20px_rgba(160,190,20,.25)]',
  secondary: 'bg-lc-card text-lc-ink border-[1.5px] border-lc-line hover:text-lc-violet hover:border-lc-violet',
  ghost:     'bg-transparent text-lc-ink hover:bg-lc-card',
  // In-panel commits (Save): ink fill so lime stays unique.
  confirm:   'bg-lc-ink text-lc-card hover:bg-lc-ink-2',
}

const BTN_SIZE = {
  md: 'h-11 px-6 text-[0.95rem]',
  sm: 'h-9 px-4 text-sm',
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }) {
  return (
    <button type={type} className={`${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${className}`} {...rest} />
  )
}

const PILL_TONE = {
  violet: 'bg-lc-violet-soft text-lc-violet',
  quiet:  'bg-lc-ground-deep text-lc-ink-2',
  lime:   'bg-lc-lime text-lc-ink',
  profit: 'bg-lc-profit-tint text-lc-profit',
  loss:   'bg-lc-loss-tint text-lc-loss',
}

export function Pill({ tone = 'violet', size = 'md', className = '', children, ...rest }) {
  const sz = size === 'sm' ? 'text-[0.72rem] px-2 py-[2px]' : 'text-[0.8rem] px-3 py-[5px]'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lc font-semibold tracking-[0.01em] leading-[1.6] ${sz} ${PILL_TONE[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  )
}

export function Card({ className = '', padding = 'p-6', ...rest }) {
  return <div className={`bg-lc-card rounded-lc shadow-lc ${padding} ${className}`} {...rest} />
}

/** Field: label above, control, helper or error line beneath (DESIGN.md → Inputs). */
export function Field({ label, htmlFor, help, error, className = '', children }) {
  return (
    <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
      {label && (
        <label htmlFor={htmlFor} className="text-[0.8rem] font-semibold tracking-[0.01em] text-lc-ink-2 leading-[1.6]">
          {label}
        </label>
      )}
      {children}
      {(error || help) && (
        <span className={`text-[0.8rem] leading-[1.45] min-h-[2.4rem] ${error ? 'text-lc-loss font-semibold' : 'text-lc-ink-2'}`} role={error ? 'alert' : undefined}>
          {error || help}
        </span>
      )}
    </div>
  )
}

export function Input({ error = false, className = '', ...rest }) {
  return <input className={`${INPUT_CLASS} ${error ? 'border-lc-loss' : ''} ${className}`} {...rest} />
}

/** Icons: one 1.8px stroke set, drawn inline (no glyph fonts). */
export function LockIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
export function XIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
export function ArrowIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
export function SortIcon({ dir, className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {dir === 'asc'  && <path d="M12 5v14M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {dir === 'desc' && <path d="M12 5v14M6 13l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {!dir && <path d="M8 9l4-4 4 4M8 15l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}
