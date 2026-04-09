export default function Header({ marketOpen, lastRun, onRun, loading }) {
  return (
    <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
      <div className="flex items-center justify-between gap-4">

        {/* Left — branding */}
        <div className="flex-shrink-0">
          <div className="text-white font-bold text-xl tracking-tight">Luo Capital</div>
          <div className="text-gray-500 text-xs mt-0.5">Options Screener</div>
        </div>

        {/* Center — status + run button */}
        <div className="flex items-center gap-4">
          <MarketBadge open={marketOpen} />
          <button
            onClick={onRun}
            disabled={loading}
            className={`
              px-5 py-2 rounded text-sm font-semibold transition-colors
              ${loading
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer'}
            `}
          >
            {loading ? 'Running…' : 'Run Scan'}
          </button>
        </div>

        {/* Right — last run */}
        <div className="flex-shrink-0 text-right">
          <div className="text-gray-500 text-xs">Last run</div>
          <div className="text-gray-300 text-xs font-mono mt-0.5">
            {lastRun ?? '—'}
          </div>
        </div>

      </div>
    </header>
  )
}

function MarketBadge({ open }) {
  if (open === null) {
    return <span className="text-gray-500 text-xs font-mono">Market —</span>
  }
  return open ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      OPEN
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400">
      <span className="w-2 h-2 rounded-full bg-red-400" />
      CLOSED
    </span>
  )
}
