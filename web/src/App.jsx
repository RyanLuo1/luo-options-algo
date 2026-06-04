import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import './index.css'
import { supabase } from './lib/supabase'
import useAuth from './hooks/useAuth'
import { loadScreenerState, saveScreenerState, clearScreenerSession } from './lib/sessionState'

import useOptionsData    from './hooks/useOptionsData'
import useChartData      from './hooks/useChartData'
import Header            from './components/Header'
import MacroEvents       from './components/MacroEvents'
import Holdings          from './components/Holdings'
import V3Table           from './components/V3Table'
import LoadingSpinner    from './components/LoadingSpinner'
import Toast             from './components/Toast'
import WeeksRangeSlider  from './components/WeeksRangeSlider'
import StockChart        from './components/StockChart'

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

  // ── Stock chart ────────────────────────────────────────────────────────────
  const [selectedChartTicker, setSelectedChartTicker] = useState(persisted.selectedChartTicker ?? null)
  const [chartTimeframe,      setChartTimeframe]      = useState(persisted.chartTimeframe      ?? '1M')
  const [chartExpanded,       setChartExpanded]       = useState(persisted.chartExpanded       ?? false)

  const {
    marketOpen, lastRun, macroEvents,
    ranked, tickersUsed, tickersSkipped,
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

  // Persist control state on every change. Cheap — sessionStorage write of a
  // small JSON blob. Cleared on logout (Header) or tab close.
  useEffect(() => {
    saveScreenerState({
      tickerInput,
      activeTickers, weeksMin, weeksMax,
      minPremium, minPProfit,
      minPremiumStr, minPProfitStr,
      selectedChartTicker, chartTimeframe, chartExpanded,
    })
  }, [
    tickerInput,
    activeTickers, weeksMin, weeksMax,
    minPremium, minPProfit,
    minPremiumStr, minPProfitStr,
    selectedChartTicker, chartTimeframe, chartExpanded,
  ])

  // Auto-select rank-1 ticker when a new scan completes (or current selection
  // is no longer in results). Depends on the raw scan array (stable ref from
  // useOptionsData) — the derived/filtered array would re-fire every render.
  useEffect(() => {
    if (ranked.length === 0) return
    const exists = ranked.some(r => r.ticker === selectedChartTicker)
    if (!selectedChartTicker || !exists) {
      setSelectedChartTicker(ranked[0].ticker)
    }
  }, [ranked, selectedChartTicker])

  // ── Chart data — fetched once at App level so the same data feeds both
  //    the compact and expanded chart variants without re-fetch on toggle.
  const { data: chartData, loading: chartLoading, error: chartError } =
    useChartData(selectedChartTicker, chartTimeframe)

  // ── Utility functions ──────────────────────────────────────────────────────
  function parseTickers(raw) {
    return raw
      .split(/[,\s]+/)
      .map(t => t.trim().toUpperCase().replace(/^\$/, ''))
      .filter(Boolean)
  }

  // ── Client-side filtering ────────────────────────────────────────────────────
  const filteredRanked = ranked
    .filter(r => activeTickers.length === 0 || activeTickers.includes(r.ticker))
    .map((r, i) => ({ ...r, rank: i + 1 }))

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
    setSelectedChartTicker(null)
    setChartTimeframe('1M')
    setChartExpanded(false)
    clearAll()
    clearScreenerSession()
  }

  // ── Run scan ───────────────────────────────────────────────────────────────
  function handleRun() {
    const tickers = parseTickers(tickerInput)
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
      <MacroEvents macroEvents={macroEvents} />

      {/* Control bar — inputs cluster on the left, stock chart fills the right */}
      <div className="px-6 py-3 border-b border-gray-800 flex items-start gap-6 flex-wrap">

        {/* Inputs cluster */}
        <div className="flex items-start gap-8 flex-wrap shrink-0">

        {/* Tickers */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Tickers</label>
          <input
            type="text"
            value={tickerInput}
            onChange={e => setTickerInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleRun()}
            placeholder="NVDA, META, TSLA…"
            disabled={loading}
            className="w-64 bg-gray-800 text-gray-100 border border-gray-700 rounded px-3 py-1.5
                       text-sm font-mono placeholder-gray-600
                       focus:outline-none focus:border-indigo-500
                       disabled:opacity-50"
          />
          <span className="text-gray-600 text-xs">Comma or space · blank = default watchlist</span>
        </div>

        {/* Weeks range slider */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Weeks range</label>
          <div className="flex items-center h-7">
            <WeeksRangeSlider
              min={1}
              max={12}
              valueMin={weeksMin}
              valueMax={weeksMax}
              onChange={(mn, mx) => { setWeeksMin(mn); setWeeksMax(mx) }}
              disabled={loading}
            />
          </div>
          <span className="text-gray-600 text-xs">
            Weeks {weeksMin} – {weeksMax}
          </span>
        </div>

        {/* Min Net Premium — free text + bumpers */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Min Net Premium $</label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => bumpMinPremium(-0.50)}
              disabled={loading || minPremium <= 0}
              className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                         text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
            >−</button>
            <input
              type="text"
              inputMode="decimal"
              value={minPremiumStr}
              onChange={handleMinPremiumChange}
              onBlur={handleMinPremiumBlur}
              onKeyDown={e => e.key === 'Enter' && !loading && minPremiumValid && handleRun()}
              disabled={loading}
              placeholder="e.g. 4.25"
              className={`w-20 bg-gray-800 text-gray-100 border rounded px-2 py-1.5
                         text-sm font-mono placeholder-gray-600 text-right
                         focus:outline-none disabled:opacity-50
                         ${minPremiumValid
                           ? 'border-gray-700 focus:border-violet-500'
                           : 'border-red-500 focus:border-red-400'}`}
            />
            <button
              onClick={() => bumpMinPremium(+0.50)}
              disabled={loading}
              className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                         text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
            >+</button>
          </div>
          <span className="text-gray-600 text-xs">Net credit required</span>
        </div>

        {/* Min P(Profit) — free text + bumpers */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Min P(Profit) %</label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => bumpMinPProfit(-1)}
              disabled={loading || Math.round(minPProfit * 100) <= 1}
              className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                         text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
            >−</button>
            <input
              type="text"
              inputMode="numeric"
              value={minPProfitStr}
              onChange={handleMinPProfitChange}
              onBlur={handleMinPProfitBlur}
              onKeyDown={e => e.key === 'Enter' && !loading && minPProfitValid && handleRun()}
              disabled={loading}
              placeholder="1–99"
              className={`w-20 bg-gray-800 text-gray-100 border rounded px-2 py-1.5
                         text-sm font-mono placeholder-gray-600 text-right
                         focus:outline-none disabled:opacity-50
                         ${minPProfitValid
                           ? 'border-gray-700 focus:border-violet-500'
                           : 'border-red-500 focus:border-red-400'}`}
            />
            <button
              onClick={() => bumpMinPProfit(+1)}
              disabled={loading || Math.round(minPProfit * 100) >= 99}
              className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                         text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
            >+</button>
          </div>
          <span className="text-gray-600 text-xs">P(max profit) threshold</span>
        </div>

        </div>
        {/* End inputs cluster */}

        {/* Stock chart — compact variant. Takes the remaining horizontal space.
            With flex-wrap the chart drops to its own full-width row on narrow
            viewports. Hidden when the chart is expanded (rendered in <main> instead). */}
        {!chartExpanded && (
          <div className="flex-1 min-w-[320px]">
            <StockChart
              ticker={selectedChartTicker}
              timeframe={chartTimeframe}
              expanded={false}
              data={chartData}
              loading={chartLoading}
              error={chartError}
              onTimeframeChange={setChartTimeframe}
              onToggleExpanded={() => setChartExpanded(true)}
            />
          </div>
        )}

      </div>

      {/* Holdings filter bar */}
      {tickersUsed.length > 0 && (
        <Holdings
          tickers={activeTickers}
          skipped={tickersSkipped}
          onRemove={handleRemoveTicker}
        />
      )}

      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Expanded chart takes over the whole table area until closed. */}
        {chartExpanded ? (
          <div className="flex-1 min-h-0 flex flex-col p-3">
            <StockChart
              ticker={selectedChartTicker}
              timeframe={chartTimeframe}
              expanded
              data={chartData}
              loading={chartLoading}
              error={chartError}
              onTimeframeChange={setChartTimeframe}
              onToggleExpanded={() => setChartExpanded(false)}
            />
          </div>
        ) : (
          <>
            {loading && <LoadingSpinner />}

            {!loading && error && <ErrorBanner error={error} />}

            {!loading && !error && (
              hasResult
                ? <V3Table
                    rows={filteredRanked}
                    totalEvaluated={totalEvaluated}
                    weeksMinUsed={weeksMinUsed}
                    weeksMaxUsed={weeksMaxUsed}
                    minPremiumUsed={minPremiumUsed}
                    minPProfitUsed={minPProfitUsed}
                    onEdit={handleEdit}
                    onSaveToTradebook={saveToTradebook}
                    onRowSelect={row => setSelectedChartTicker(row.ticker)}
                  />
                : <EmptyState />
            )}
          </>
        )}
      </main>
    </>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  // h-screen + overflow-hidden locks the page to viewport height so only the
  // table body scrolls (see internal scroll in V3Table).
  return (
    <div className="h-screen overflow-hidden bg-gray-950 text-gray-100 flex flex-col">
      <Header
        marketOpen={marketOpen}
        lastRun={lastRun}
        onRun={handleRun}
        onClear={handleClear}
        loading={loading}
        isStale={isStale}
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
