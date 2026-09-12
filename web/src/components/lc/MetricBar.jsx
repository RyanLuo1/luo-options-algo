// A swappable metric bar for table cells. The metric is a prop (a function of
// the row returning 0..1) plus a label, never a formula in the cell, so the
// Screener can render credit ÷ max (the incumbent ranking) and Picks can later
// render ROC in the same table with no re-layout.
export default function MetricBar({ value, label, className = '' }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <span
      className={`inline-block h-1.5 w-full rounded-full bg-lc-line overflow-hidden align-middle ${className}`}
      role="img"
      aria-label={`${label}: ${Math.round(v * 100)}%`}
      title={`${label} ${Math.round(v * 100)}%`}
    >
      <span className="block h-full rounded-full bg-lc-violet" style={{ width: `${v * 100}%` }} />
    </span>
  )
}
