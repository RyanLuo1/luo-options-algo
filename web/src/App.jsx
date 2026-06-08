import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import './index.css'
import { supabase } from './lib/supabase'
import useAuth from './hooks/useAuth'
import { loadScreenerState, saveScreenerState, clearScreenerSession } from './lib/sessionState'

import useOptionsData    from './hooks/useOptionsData'
import Header            from './components/Header'
import Holdings          from './components/Holdings'
import ControlsDrawer    from './components/ControlsDrawer'
import ResultsTable      from './components/ResultsTable'
import SetupDetail       from './components/SetupDetail'
import LoadingSpinner    from './components/LoadingSpinner'
import Toast             from './components/Toast'
import TradingViewChart, { toTvSymbol } from './components/TradingViewChart'

export default function App() {
  const navigate = useNavigate()
  const { user } = useAuth()

  // Hydrate all controls from sessionStorage (single read on mount). Survives
  // in-session navigation (e.g. screener → /trade → back); cleared on logout
  // or tab close. See web/src/lib/sessionState.js.
  const persisted = useMemo(() => loadScreenerState() ?? {}, [])

  // ── Shared controls ────────────────────────────────────────────────────────
  const [tickerInput, setTickerInput] = useState(persisted.tickerInput ?? '')

  // ── Risk reversal controls ──────────────────────────────────────────────────
  const [activeTickers,   setActiveTickers]   = useState(persisted.activeTickers ?? [])
  const [weeksMin,        setWeeksMin]        = useState(persisted.weeksMin ?? 1)
  const [weeksMax,        setWeeksMax]        = useState(persisted.weeksMax ?? 12)
  const [minPremium,      setMinPremium]      = useState(persisted.minPremium ?? 5.00)
  const [minPProfit,      setMinPProfit]      = useState(persisted.minPProfit ?? 0.50)
  // Raw input strings — let the user type freely (incl. empty, partial decimals)
  const [minPremiumStr,   setMinPremiumStr]   = useState(persisted.minPremiumStr ?? '5.00')
  const [minPProfitStr,   setMinPProfitStr]   = useState(persisted.minPProfitStr ?? '50')

  // ── Detail zone (per-setup detail, driven by table-row selection) ───────────
  // `selectedSetup` = an explicit row override; null means "use the context
  // default" (the overall rank-1). The chart ticker and selected-row highlight
  // both derive from the resulting displayed setup (computed below, once scan
  // data is available).
  const [selectedSetup,  setSelectedSetup]  = useState(persisted.selectedSetup ?? null)
  // Per-ticker results filter (set by double-clicking a scanning chip). null =
  // no filter (table/chart show all results). Only one ticker at a time.
  const [tickerFilter,   setTickerFilter]   = useState(persisted.tickerFilter ?? null)
  // Fullscreen-within-detail-zone toggle (not persisted — always opens split).
  const [chartFull,      setChartFull]      = useState(false)
  // Left controls drawer — CLOSED by default on load so results get full width;
  // open/closed state is remembered for the session.
  const [drawerOpen,     setDrawerOpen]     = useState(persisted.drawerOpen ?? false)

  // Clicking a table row picks that specific setup (overrides the rank-1 default).
  function selectRow(row) {
    setSelectedSetup(row)
  }

  // Double-clicking a scanning chip toggles the per-ticker results filter on /
  // off (or switches it to another ticker). Clears any explicit row override so
  // the detail panel + chart fall back to that ticker's rank-1 setup.
  function toggleTickerFilter(ticker) {
    setSelectedSetup(null)
    setTickerFilter(prev => (prev === ticker ? null : ticker))
  }

  const {
    marketOpen, lastRun,
    ranked,
    tickersUsed, tickersSkipped,
    weeksMinUsed, weeksMaxUsed,
    minPremiumUsed, minPProfitUsed,
    totalEvaluated, hasResult, scanId,
    loading, error,
    runScan, clearAll,
  } = useOptionsData()

  // Sync active ticker pills with scan results — only when the underlying
  // result reference changes (i.e. a NEW scan completes). The ref is primed with
  // the initial value so the first useEffect run after hydration is a no-op,
  // preserving any persisted client-side ticker filter.
  const lastTickersUsedRef = useRef(tickersUsed)
  useEffect(() => {
    if (tickersUsed !== lastTickersUsedRef.current) {
      setActiveTickers(tickersUsed)
      lastTickersUsedRef.current = tickersUsed
    }
  }, [tickersUsed])

  // ── Client-side filtering + detail-panel selection (all derived) ────────────
  // Two filters: (1) the scan-set membership (activeTickers — chips with × that
  // remove a ticker from the set); (2) the single-ticker results filter
  // (tickerFilter — set by double-clicking a chip). The visible rows are then
  // re-ranked 1..N.
  const baseRanked = ranked.filter(r => activeTickers.length === 0 || activeTickers.includes(r.ticker))
  const tableRows = (tickerFilter ? baseRanked.filter(r => r.ticker === tickerFilter) : baseRanked)
    .map((r, i) => ({ ...r, rank: i + 1 }))

  // Setup shown in the detail panel: explicit row override if present, else the
  // rank-1 of the current view (the filtered ticker's best, or the overall
  // rank-1 when no ticker filter is active).
  const displayedSetup = selectedSetup ?? (tableRows[0] ?? null)
  const chartTicker    = displayedSetup?.ticker ?? null

  // Row highlight marks the displayed setup's row (matches ResultsTable.rowKey).
  const selectedKey = displayedSetup
    ? `${displayedSetup.ticker}-${displayedSetup.expiration}-${displayedSetup.leg_a_strike}-${displayedSetup.leg_b_strike}-${displayedSetup.leg_c_strike}`
    : null

  const isChartFull = chartFull && !!chartTicker

  // Persist control state on every change. Cheap — sessionStorage write of a
  // small JSON blob. Cleared on logout (Header) or tab close.
  useEffect(() => {
    saveScreenerState({
      tickerInput,
      activeTickers, weeksMin, weeksMax,
      minPremium, minPProfit,
      minPremiumStr, minPProfitStr,
      selectedSetup, tickerFilter, drawerOpen,
    })
  }, [
    tickerInput,
    activeTickers, weeksMin, weeksMax,
    minPremium, minPProfit,
    minPremiumStr, minPProfitStr,
    selectedSetup, tickerFilter, drawerOpen,
  ])

  // Reset the row selection when a new scan arrives so the detail panel + chart
  // default to the overall rank-1 setup. The ref is primed with the initial
  // `ranked` so the first post-hydration run is a no-op (preserves any persisted
  // selection across in-session navigation); only a genuinely new scan (new
  // `ranked` reference from useOptionsData) clears it.
  const lastRankedRef = useRef(ranked)
  useEffect(() => {
    if (ranked !== lastRankedRef.current) {
      lastRankedRef.current = ranked
      setSelectedSetup(null)
      setTickerFilter(null)
      setChartFull(false)
    }
  }, [ranked])

  // ── Utility functions ──────────────────────────────────────────────────────
  function parseTickers(raw) {
    return raw
      .split(/[,\s]+/)
      .map(t => t.trim().toUpperCase().replace(/^\$/, ''))
      .filter(Boolean)
  }

  // ── Staleness detection ────────────────────────────────────────────────────
  const isStale = hasResult && (
    (weeksMinUsed   !== null && weeksMin   !== weeksMinUsed)   ||
    (weeksMaxUsed   !== null && weeksMax   !== weeksMaxUsed)   ||
    (minPremiumUsed !== null && minPremium !== minPremiumUsed) ||
    (minPProfitUsed !== null && minPProfit !== minPProfitUsed) ||
    parseTickers(tickerInput).some(t => !tickersUsed.includes(t))
  )

  // ── Clear screener ─────────────────────────────────────────────────────────
  // Resets every persisted control to its default, wipes scan results, and
  // clears the chart. Persist effects will immediately re-write the defaults
  // to sessionStorage; clearScreenerSession() is called as a defensive flush
  // so any cruft outside the persisted state shape is wiped too.
  function handleClear() {
    if (loading) return
    setTickerInput('')
    setActiveTickers([])
    setWeeksMin(1)
    setWeeksMax(12)
    setMinPremium(5.00)
    setMinPremiumStr('5.00')
    setMinPProfit(0.50)
    setMinPProfitStr('50')
    setSelectedSetup(null)
    setTickerFilter(null)
    setChartFull(false)
    setDrawerOpen(false)
    clearAll()
    clearScreenerSession()
  }

  // ── Run scan ───────────────────────────────────────────────────────────────
  function handleRun() {
    const tickers = parseTickers(tickerInput)
    // Auto-close the controls drawer so the user drops straight into results.
    setDrawerOpen(false)
    runScan({
      tickers:    tickers.length > 0 ? tickers : undefined,
      weeksMin,
      weeksMax,
      minPremium,
      minPProfit,
    })
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleRemoveTicker(ticker) {
    setActiveTickers(prev => prev.filter(t => t !== ticker))
    // Drop the row override / ticker filter if they pointed at the removed
    // ticker, so the detail panel falls back to the overall rank-1 default.
    setSelectedSetup(prev => (prev?.ticker === ticker ? null : prev))
    setTickerFilter(prev => (prev === ticker ? null : prev))
  }

  // Validation helpers
  const minPremiumValid = (() => {
    const s = minPremiumStr.trim()
    if (s === '') return false
    const n = Number(s)
    return Number.isFinite(n) && n >= 0
  })()

  const minPProfitValid = (() => {
    const s = minPProfitStr.trim()
    if (s === '') return false
    const n = Number(s)
    return Number.isInteger(n) && n >= 1 && n <= 99
  })()

  // Free-text typing — always update string; sync numeric only when valid
  function handleMinPremiumChange(e) {
    const raw = e.target.value
    setMinPremiumStr(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n) && n >= 0) {
      setMinPremium(n)
    }
  }

  function handleMinPProfitChange(e) {
    const raw = e.target.value
    setMinPProfitStr(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 99) {
      setMinPProfit(parseFloat((n / 100).toFixed(4)))
    }
  }

  // Clamp to valid range on blur if invalid
  function handleMinPProfitBlur() {
    const n = Number(minPProfitStr)
    let clamped
    if (!Number.isFinite(n)) clamped = Math.round(minPProfit * 100)
    else clamped = Math.min(99, Math.max(1, Math.round(n)))
    setMinPProfitStr(String(clamped))
    setMinPProfit(parseFloat((clamped / 100).toFixed(4)))
  }

  function handleMinPremiumBlur() {
    const n = Number(minPremiumStr)
    if (!Number.isFinite(n) || n < 0) {
      setMinPremiumStr(minPremium.toFixed(2))
    }
  }

  // +/- bumpers — operate on the numeric state, then sync the string
  function bumpMinPremium(delta) {
    const next = Math.max(0, parseFloat((minPremium + delta).toFixed(2)))
    setMinPremium(next)
    setMinPremiumStr(next.toFixed(2))
  }

  function bumpMinPProfit(delta) {
    const cur = Math.round(minPProfit * 100)
    const next = Math.min(99, Math.max(1, cur + delta))
    setMinPProfit(parseFloat((next / 100).toFixed(4)))
    setMinPProfitStr(String(next))
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toastVisible, setToastVisible] = useState(false)

  function showToast() {
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 3000)
  }

  // ── Tradebook helpers ──────────────────────────────────────────────────────
  const [saveError, setSaveError] = useState(null)

  async function saveToTradebook(row) {
    if (!user) return
    setSaveError(null)
    const trade = {
      ticker:        row.ticker,
      expiration:    row.expiration,
      saved_at:      new Date().toISOString(),
      leg_a_strike:  row.leg_a_strike,
      leg_a_premium: row.leg_a_prem,
      leg_a_delta:   row.leg_a_delta,
      leg_b_strike:  row.leg_b_strike,
      leg_b_premium: row.leg_b_prem,
      leg_b_delta:   row.leg_b_delta,
      leg_c_strike:  row.leg_c_strike,
      leg_c_premium: row.leg_c_prem,
      leg_c_delta:   row.leg_c_delta,
      net_premium:   row.net_premium,
      spread_width:  row.spread_width,
      score:         row.score,
      p_max_profit:  row.p_max_profit,
      fair_value:    row.fair_value,
    }

    // Route saves through the server so user_id is auth-attributed and the
    // source scan_results row gets was_saved flipped to true. The server-side
    // handler also accepts null scan_id/result_id for legacy rows.
    const { data: { session } } = await supabase.auth.getSession()
    const headers = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`

    try {
      const res  = await fetch('/api/tradebook/save', {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          scan_id:   scanId,
          result_id: row.result_id ?? null,
          trade,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Tradebook save error:', data)
        setSaveError(`Save failed: ${data.error || res.status}`)
        return
      }
    } catch (e) {
      console.error('Tradebook save network error:', e)
      setSaveError(`Save failed: ${e.message}`)
      return
    }
    showToast()
  }

  function handleEdit(row) {
    // Thread scan_id + result_id through router state so the trade editor can
    // attribute the eventual save back to the originating scan.
    navigate('/trade', { state: { triplet: row, scan_id: scanId } })
  }

  // ── Screener content (inlined so it has closure access to all state) ────────
  const screenerContent = (
    <>
      {/* Scanning chips — a slim visible row above the results (NOT in the
          drawer). × removes a ticker from the scan set; double-clicking a chip
          toggles the per-ticker results filter. */}
      {tickersUsed.length > 0 && (
        <div className="shrink-0 px-3 pt-3">
          <div className="bg-surface border border-subtle rounded-lg px-4 py-2">
            <Holdings
              tickers={activeTickers}
              skipped={tickersSkipped}
              onRemove={handleRemoveTicker}
              onToggleFilter={toggleTickerFilter}
              activeFilter={tickerFilter}
            />
          </div>
        </div>
      )}

      {/* Detail zone — TWO columns: LEFT (~38%, fixed table width) = SetupDetail
          stacked ABOVE the scrollable ranked table; RIGHT (flex-1) = the
          TradingView chart alone, filling all remaining width and the full
          height. Selection is driven purely by clicking a table row (defaults to
          the overall rank-1 on a fresh scan). The chart's ⤢ expands it to fill
          the whole zone (left column hidden). */}
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {loading && <LoadingSpinner />}

        {!loading && error && <ErrorBanner error={error} />}

        {!loading && !error && (
          hasResult ? (
            <div className="flex-1 min-h-0 flex gap-3 p-3">
              {/* Left — SetupDetail (compact band, on top) + the ranked table
                  (below, scrolls within its area). Fixed width = the 33rem column
                  sum + ~2rem padding after Max Profit. Hidden in fullscreen. */}
              {!isChartFull && (
                <div className="w-[35rem] shrink-0 min-h-0 flex flex-col">
                  {displayedSetup && (
                    <SetupDetail
                      setup={displayedSetup}
                      onSave={() => saveToTradebook(displayedSetup)}
                      onEdit={() => handleEdit(displayedSetup)}
                    />
                  )}
                  <div className="flex-1 min-h-0 flex flex-col">
                    <ResultsTable
                      rows={tableRows}
                      totalEvaluated={totalEvaluated}
                      weeksMinUsed={weeksMinUsed}
                      weeksMaxUsed={weeksMaxUsed}
                      minPremiumUsed={minPremiumUsed}
                      minPProfitUsed={minPProfitUsed}
                      selectedKey={selectedKey}
                      onRowSelect={selectRow}
                    />
                  </div>
                </div>
              )}

              {/* Right — the TradingView chart alone, filling the freed width and
                  full height so price / volume / RSI panes all have room. ⤢/⤡
                  toggles fullscreen (chart fills the whole zone). */}
              <div className="flex-1 min-w-[360px] min-h-0 flex flex-col">
                <TradingViewChart
                  symbol={toTvSymbol(chartTicker)}
                  fullscreen={isChartFull}
                  onToggleFull={() => setChartFull(f => !f)}
                />
              </div>
            </div>
          ) : (
            <EmptyState />
          )
        )}
      </main>

      {/* Left controls drawer — slides in over the content; closed by default.
          Run Scan lives in the header, not here. */}
      <ControlsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        loading={loading}
        tickerInput={tickerInput}
        setTickerInput={setTickerInput}
        onRun={handleRun}
        weeksMin={weeksMin}
        weeksMax={weeksMax}
        setWeeksMin={setWeeksMin}
        setWeeksMax={setWeeksMax}
        minPremium={minPremium}
        minPremiumStr={minPremiumStr}
        minPremiumValid={minPremiumValid}
        handleMinPremiumChange={handleMinPremiumChange}
        handleMinPremiumBlur={handleMinPremiumBlur}
        bumpMinPremium={bumpMinPremium}
        minPProfit={minPProfit}
        minPProfitStr={minPProfitStr}
        minPProfitValid={minPProfitValid}
        handleMinPProfitChange={handleMinPProfitChange}
        handleMinPProfitBlur={handleMinPProfitBlur}
        bumpMinPProfit={bumpMinPProfit}
      />
    </>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  // h-screen + overflow-hidden locks the page to viewport height so only the
  // table body scrolls (see internal scroll in ResultsTable).
  return (
    <div className="h-screen overflow-hidden bg-gray-950 text-gray-100 flex flex-col">
      <Header
        marketOpen={marketOpen}
        lastRun={lastRun}
        onRun={handleRun}
        onClear={handleClear}
        loading={loading}
        isStale={isStale}
        onToggleControls={() => setDrawerOpen(o => !o)}
        controlsOpen={drawerOpen}
      />
      {screenerContent}
      <Toast message="Saved to Tradebook ✓" visible={toastVisible} />
      {saveError && (
        <div
          style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999 }}
          className="bg-gray-800 border border-red-700 rounded-lg shadow-xl px-4 py-3 max-w-xs"
        >
          <div className="flex items-start gap-2">
            <span className="text-red-400 text-sm font-semibold flex-1">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="text-gray-500 hover:text-gray-300 text-xs leading-none mt-0.5">×</button>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-3 text-center px-6">
      <p className="text-gray-400 text-base font-medium">Ready to scan</p>
      <p className="text-gray-600 text-sm max-w-sm">
        Enter tickers and click Run Scan to find call spread risk reversal opportunities.
      </p>
      <p className="text-gray-700 text-xs mt-2">
        Make sure the Flask server is running: <span className="font-mono">python3 server/app.py</span>
      </p>
    </div>
  )
}

function ErrorBanner({ error }) {
  return (
    <div className="mx-6 mt-6 p-4 rounded border border-red-800/60 bg-red-950/30">
      <p className="text-red-400 font-semibold text-sm mb-1">Error</p>
      <p className="text-gray-400 text-xs font-mono break-all">{error}</p>
    </div>
  )
}
