// Inline chips row (no band wrapper) — folded into the controls area, since the
// scanning chips echo the ticker input. Removing a chip filters that ticker.
export default function Holdings({ tickers, skipped, onRemove }) {
  if (!tickers || tickers.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-gray-500 text-xs">Scanning:</span>
      {tickers.map(t => (
        <span
          key={t}
          className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-xs font-mono font-medium bg-gray-800 text-gray-300 border border-gray-700"
        >
          {t}
          {onRemove && (
            <button
              onClick={() => onRemove(t)}
              className="ml-0.5 text-gray-600 hover:text-red-400 transition-colors leading-none cursor-pointer"
              title={`Remove ${t}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {skipped && skipped.length > 0 && (
        <span className="text-gray-600 text-xs ml-1">
          (skipped: {skipped.join(', ')} — no options chain)
        </span>
      )}
    </div>
  )
}
