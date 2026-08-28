import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { clearScreenerSession } from '../lib/sessionState'

export default function Header({ marketOpen, lastRun, onRun, onClear, loading, isStale, onToggleControls, controlsOpen, tickerInput, setTickerInput, tickersError }) {
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
      <header className="bg-surface border-b border-subtle px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-secondary hover:text-primary text-sm font-medium transition-colors"
        >
          ← Back to Screener
        </button>
        {/* text-subtle used AS TEXT (decorative divider): fine on dark, near-invisible on white — revisit in the app-wide light pass */}
        <span className="text-subtle">|</span>
        <span className="text-primary font-semibold text-sm">Trade Editor</span>
      </header>
    )
  }

  // ── Tradebook: minimal header with back button ─────────────────────────────
  if (isTradebook) {
    return (
      <header className="bg-surface border-b border-subtle px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-secondary hover:text-primary text-sm font-medium transition-colors"
        >
          ← Back to Screener
        </button>
        <span className="text-subtle">|</span>
        <span className="text-primary font-semibold text-sm">Tradebook</span>
      </header>
    )
  }

  // ── Screener: full header in a contained surface panel ─────────────────────
  // Three zones: lockup (left), the scan-Tickers input (center, flex-1), and
  // controls (right). Lockup + controls are flex-shrink-0 so they keep their
  // space; the center input absorbs the remaining width and shrinks first on
  // narrower windows.
  return (
    <header className="shrink-0 px-3 pt-3">
      <div className="bg-surface border border-subtle rounded-lg px-5 py-3 flex items-center justify-between gap-4">

        {/* Left — branding */}
        <div className="flex-shrink-0 leading-tight">
          <div className="text-primary font-bold text-xl tracking-tight">Luo Capital</div>
          <div className="text-tertiary text-xs mt-0.5">Options Screener</div>
        </div>

        {/* Center — scan Tickers input (relocated from the controls drawer)
            with an adjacent info tooltip. Same state/handler as before: blank =
            default watchlist; Enter runs the scan, identical to Run Scan. */}
        <div className="flex-1 min-w-0 flex justify-center px-2">
          <div className="relative flex items-center gap-2 w-full max-w-md min-w-0">
            <input
              type="text"
              value={tickerInput ?? ''}
              onChange={e => setTickerInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && onRun()}
              placeholder="Enter tickers or a @watchlist to scan"
              title="Tickers (NVDA, META) or @watchlist (@semis)"
              disabled={loading}
              className={`flex-1 min-w-0 h-[34px] bg-surface-raised text-primary border rounded-md px-3
                          text-sm font-mono placeholder-tertiary focus:outline-none disabled:opacity-50
                          ${tickersError ? 'border-loss' : 'border-subtle focus:border-accent'}`}
            />

            {/* Inline error (e.g. unknown @watchlist) — absolute so the header
                height doesn't shift; cleared in App when the input changes. */}
            {tickersError && (
              <div className="absolute left-0 top-full mt-1 text-[11px] text-loss leading-tight">
                {tickersError}
              </div>
            )}

            {/* Info tooltip — usage hint. Shows on hover AND keyboard focus
                (group-focus-within). Inline SVG icon (no icon dependency);
                on-brand dark popover using design tokens. */}
            <div className="relative group flex-shrink-0">
              <button
                type="button"
                aria-label="How the tickers input works"
                className="flex items-center justify-center w-6 h-6 rounded-full text-tertiary
                           hover:text-secondary focus:text-secondary focus:outline-none
                           focus-visible:ring-1 focus-visible:ring-accent"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                     strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              </button>
              <div
                role="tooltip"
                className="pointer-events-none absolute right-0 top-full mt-2 w-64 z-50
                           rounded-md border border-subtle bg-surface-raised px-3 py-2
                           text-[11px] leading-relaxed text-secondary shadow-xl
                           opacity-0 invisible transition-opacity duration-150
                           group-hover:opacity-100 group-hover:visible
                           group-focus-within:opacity-100 group-focus-within:visible"
              >
                Enter tickers separated by commas or spaces (NVDA, META). Use @name to scan a
                saved watchlist (e.g. @semis). Manage watchlists in Controls.
              </div>
            </div>
          </div>
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
                            : 'bg-accent hover:bg-accent-hover text-white cursor-pointer'}`}
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
  // Semantic stretch: profit/loss tokens are documented as money-only; reused here for market OPEN/CLOSED status.
  return open ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-profit">
      <span className="w-2 h-2 rounded-full bg-profit animate-pulse" />
      OPEN
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-loss">
      <span className="w-2 h-2 rounded-full bg-loss" />
      CLOSED
    </span>
  )
}
