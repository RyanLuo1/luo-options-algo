import { useLocation, useNavigate } from 'react-router-dom'

export default function Header({ marketOpen, lastRun, onRun, loading, isStale, mode, onModeChange }) {
  const location = useLocation()
  const navigate  = useNavigate()
  const path      = location.pathname
  const isScreener  = path === '/'
  const isTrade     = path === '/trade'
  const isTradebook = path === '/tradebook'

  // ── Trade editor: minimal header with back button ──────────────────────────
  if (isTrade) {
    return (
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-gray-400 hover:text-gray-100 text-sm font-medium transition-colors"
        >
          ← Back to Screener
        </button>
        <span className="text-gray-700">|</span>
        <span className="text-white font-semibold text-sm">Trade Editor</span>
      </header>
    )
  }

  // ── Tradebook: minimal header with back button ─────────────────────────────
  if (isTradebook) {
    return (
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-gray-400 hover:text-gray-100 text-sm font-medium transition-colors"
        >
          ← Back to Screener
        </button>
        <span className="text-gray-700">|</span>
        <span className="text-white font-semibold text-sm">Tradebook</span>
      </header>
    )
  }

  // ── Screener + Tradebook: full header ──────────────────────────────────────
  return (
    <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">

        {/* Left — branding */}
        <div className="flex-shrink-0">
          <div className="text-white font-bold text-xl tracking-tight">Luo Capital</div>
          <div className="text-gray-500 text-xs mt-0.5">Options Screener</div>
        </div>

        {/* Nav group — V2/V3 toggle (screener only) + Tradebook */}
        <div className="flex items-center flex-shrink-0 border border-gray-700 rounded">
          {isScreener && (
            <>
              <button
                onClick={() => onModeChange('v2')}
                disabled={loading}
                className={`
                  px-4 py-1.5 text-xs font-semibold transition-colors rounded-l
                  ${mode === 'v2'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700'}
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                V2 — Delta Rank
              </button>
              <button
                onClick={() => onModeChange('v3')}
                disabled={loading}
                className={`
                  px-4 py-1.5 text-xs font-semibold transition-colors border-l border-gray-700
                  ${mode === 'v3'
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700'}
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                V3 — Risk Reversal
              </button>
            </>
          )}
          <button
            onClick={() => navigate('/tradebook')}
            className={`
              px-4 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap rounded-r
              ${isScreener ? 'border-l border-gray-700' : 'rounded-l'}
              ${isTradebook
                ? 'bg-violet-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700'}
            `}
          >
            Tradebook
          </button>
        </div>

        {/* Market status + run button — screener only */}
        {isScreener && (
          <div className="flex items-center gap-4">
            <MarketBadge open={marketOpen} />
            <button
              onClick={onRun}
              disabled={loading}
              className={`
                px-5 py-2 rounded text-sm font-semibold transition-colors whitespace-nowrap
                ${loading
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : isStale
                    ? 'bg-amber-500 hover:bg-amber-400 text-gray-900 cursor-pointer'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer'}
              `}
            >
              {loading ? 'Running…' : isStale ? '⚠ Rescan needed' : 'Run Scan'}
            </button>
          </div>
        )}

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
