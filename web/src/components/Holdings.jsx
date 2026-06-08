// Scanning chips — a slim visible row above the results (NOT in the controls
// drawer). Each chip:
//   • × button  → removes that ticker from the scan set (onRemove), unchanged.
//   • double-click on the chip body → toggles a per-ticker results filter
//     (onToggleFilter): the table + chart/detail filter to ONLY that ticker.
//     The currently-filtered chip is highlighted (accent state). Double-click
//     it again to clear; double-click a different chip to switch.
// The × stops propagation so removing never triggers the double-click filter.
export default function Holdings({ tickers, skipped, onRemove, onToggleFilter, activeFilter }) {
  if (!tickers || tickers.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-gray-500 text-xs">Scanning:</span>
      {tickers.map(t => {
        const isFiltered = activeFilter === t
        return (
          <span
            key={t}
            onDoubleClick={() => onToggleFilter?.(t)}
            title={onToggleFilter ? `Double-click to ${isFiltered ? 'clear filter' : `filter to ${t}`}` : undefined}
            className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-xs font-mono font-medium
                        select-none transition-colors
                        ${onToggleFilter ? 'cursor-pointer' : ''}
                        ${isFiltered
                          ? 'bg-accent/20 text-primary border border-accent'
                          : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-strong'}`}
          >
            {t}
            {onRemove && (
              <button
                onClick={e => { e.stopPropagation(); onRemove(t) }}
                className="ml-0.5 text-gray-600 hover:text-red-400 transition-colors leading-none cursor-pointer"
                title={`Remove ${t}`}
              >
                ×
              </button>
            )}
          </span>
        )
      })}
      {activeFilter && (
        <span className="text-tertiary text-[11px] ml-1">· filtered to {activeFilter} (double-click chip to clear)</span>
      )}
      {skipped && skipped.length > 0 && (
        <span className="text-gray-600 text-xs ml-1">
          (skipped: {skipped.join(', ')} — no options chain)
        </span>
      )}
    </div>
  )
}
