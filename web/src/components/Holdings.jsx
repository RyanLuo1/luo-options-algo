export default function Holdings({ tickers, skipped, source }) {
  if (!tickers || tickers.length === 0) return null

  return (
    <div className="px-6 py-3 flex items-center gap-2 flex-wrap border-b border-gray-800">
      <span className="text-gray-500 text-xs">
        {source === 'robinhood' ? 'Holdings:' : 'Scanning:'}
      </span>
      {tickers.map(t => (
        <span
          key={t}
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-gray-800 text-gray-300 border border-gray-700"
        >
          {t}
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
