import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { clearScreenerSession } from '../lib/sessionState'

export default function Header({ marketOpen, lastRun, onRun, onClear, loading, isStale, onToggleControls, controlsOpen }) {
  const location = useLocation()
  const navigate  = useNavigate()
  const path      = location.pathname

  async function handleLogout() {
    clearScreenerSession()
    await supabase.auth.signOut()
    navigate('/login')
  }
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

  // ── Screener: full header in a contained surface panel ─────────────────────
  // Two zones: lockup (left) and controls (right), with an empty center. The
  // outer flex uses justify-between so the controls pin right and the middle
  // stays calm/empty.
  return (
    <header className="shrink-0 px-3 pt-3">
      <div className="bg-surface border border-subtle rounded-lg px-5 py-3 flex items-center justify-between gap-4">

        {/* Left — branding */}
        <div className="flex-shrink-0 leading-tight">
          <div className="text-primary font-bold text-xl tracking-tight">Luo Capital</div>
          <div className="text-tertiary text-xs mt-0.5">Options Screener</div>
        </div>

        {/* Right — controls, always visible & clickable */}
        <div className="flex-shrink-0 flex items-center justify-end gap-2.5">
          <MarketBadge open={marketOpen} />

          {onToggleControls && (
            <button
              onClick={onToggleControls}
              title="Open scan controls"
              className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors whitespace-nowrap
                          bg-surface-raised border
                          ${controlsOpen
                            ? 'border-accent text-primary'
                            : 'border-subtle text-secondary hover:text-primary hover:border-strong'}`}
            >
              ⚙ Controls
            </button>
          )}

          <button
            onClick={onClear}
            disabled={loading}
            title="Reset all controls and clear results"
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors whitespace-nowrap
                        bg-surface-raised border border-subtle
                        ${loading
                          ? 'text-tertiary cursor-not-allowed opacity-60'
                          : 'text-secondary hover:text-primary hover:border-strong cursor-pointer'}`}
          >
            Clear
          </button>

          <button
            onClick={onRun}
            disabled={loading}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors whitespace-nowrap
                        ${loading
                          ? 'bg-surface-raised text-tertiary cursor-not-allowed'
                          : isStale
                            ? 'bg-amber-500 hover:bg-amber-400 text-gray-900 cursor-pointer'
                            : 'bg-accent hover:bg-accent-hover text-primary cursor-pointer'}`}
          >
            {loading ? 'Running…' : isStale ? '⚠ Rescan needed' : 'Run Scan'}
          </button>

          <button
            onClick={() => navigate('/tradebook')}
            className="px-4 py-1.5 rounded-md text-sm font-semibold whitespace-nowrap transition-colors
                       bg-surface-raised border border-subtle text-secondary hover:text-primary hover:border-strong"
          >
            Tradebook
          </button>

          {/* Last run + logout — smaller / muted, divided from the actions */}
          <div className="flex items-center gap-3 pl-3 border-l border-subtle">
            <div className="text-right leading-tight">
              <div className="text-tertiary text-[10px] uppercase tracking-wide">Last run</div>
              <div className="text-secondary text-xs num mt-0.5">{lastRun ?? '—'}</div>
            </div>
            <button
              onClick={handleLogout}
              className="text-xs text-tertiary hover:text-secondary transition-colors whitespace-nowrap"
            >
              Log out
            </button>
          </div>
        </div>

      </div>
    </header>
  )
}

function MarketBadge({ open }) {
  if (open === null) {
    return <span className="text-tertiary text-xs font-mono">Market —</span>
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
