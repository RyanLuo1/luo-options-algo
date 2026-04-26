import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import './index.css'
import { supabase } from './lib/supabase'
import useAuth from './hooks/useAuth'
import { loadScreenerState, saveScreenerState } from './lib/sessionState'

import useOptionsData    from './hooks/useOptionsData'
import Header            from './components/Header'
import MacroEvents       from './components/MacroEvents'
import Holdings          from './components/Holdings'
import RankedTable       from './components/RankedTable'
import V3Table           from './components/V3Table'
import LoadingSpinner    from './components/LoadingSpinner'
import Toast             from './components/Toast'
import WeeksRangeSlider  from './components/WeeksRangeSlider'

const DEFAULT_DISTANCES = [0.03, 0.05, 0.07, 0.10, 0.15]

export default function App() {
  const navigate = useNavigate()
  const { user } = useAuth()

  // Hydrate all controls from sessionStorage (single read on mount). Survives
  // in-session navigation (e.g. screener → /trade → back); cleared on logout
  // or tab close. See web/src/lib/sessionState.js.
  const persisted = useMemo(() => loadScreenerState() ?? {}, [])

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState(persisted.mode ?? 'v2')  // 'v2' | 'v3'

  // ── Shared controls ────────────────────────────────────────────────────────
  const [tickerInput, setTickerInput] = useState(persisted.tickerInput ?? '')

  // ── V2 controls ────────────────────────────────────────────────────────────
  const [activeTickers, setActiveTickers] = useState(persisted.activeTickers ?? [])
  const [distInput,     setDistInput]     = useState('')
  const [distPills,     setDistPills]     = useState(persisted.distPills ?? DEFAULT_DISTANCES)
  const [weeks,         setWeeks]         = useState(persisted.weeks ?? 4)

  // ── V3 controls ────────────────────────────────────────────────────────────
  const [v3ActiveTickers, setV3ActiveTickers]   = useState(persisted.v3ActiveTickers ?? [])
  const [v3WeeksMin,      setV3WeeksMin]        = useState(persisted.v3WeeksMin ?? 1)
  const [v3WeeksMax,      setV3WeeksMax]        = useState(persisted.v3WeeksMax ?? 12)
  const [v3MinPremium,    setV3MinPremium]      = useState(persisted.v3MinPremium ?? 5.00)
  const [v3MinPProfit,    setV3MinPProfit]      = useState(persisted.v3MinPProfit ?? 0.50)
  // Raw input strings — let the user type freely (incl. empty, partial decimals)
  const [v3MinPremiumStr, setV3MinPremiumStr]   = useState(persisted.v3MinPremiumStr ?? '5.00')
  const [v3MinPProfitStr, setV3MinPProfitStr]   = useState(persisted.v3MinPProfitStr ?? '50')

  const {
    marketOpen, lastRun,
    // V2
    ranked, macroEvents, duplicatesRemoved,
    tickersUsed, tickersSkipped, tickersSource,
    distancesUsed, weeksUsed, hasResult,
    // V3
    v3Ranked, v3TickersUsed, v3TickersSkipped,
    v3WeeksMinUsed, v3WeeksMaxUsed,
    v3MinPremiumUsed, v3MinPProfitUsed,
    v3TotalEvaluated, v3HasResult,
    // shared
    loading, error,
    runScan, runV3Scan, clearAll,
  } = useOptionsData()

  // Sync active ticker pills with scan results — only when the underlying
  // result reference changes (i.e. a NEW scan completes). Refs are primed with
  // the initial values so the first useEffect run after hydration is a no-op,
  // preserving any persisted client-side ticker filter.
  const lastTickersUsedRef   = useRef(tickersUsed)
  const lastV3TickersUsedRef = useRef(v3TickersUsed)
  useEffect(() => {
    if (tickersUsed !== lastTickersUsedRef.current) {
      setActiveTickers(tickersUsed)
      lastTickersUsedRef.current = tickersUsed
    }
  }, [tickersUsed])
  useEffect(() => {
    if (v3TickersUsed !== lastV3TickersUsedRef.current) {
      setV3ActiveTickers(v3TickersUsed)
      lastV3TickersUsedRef.current = v3TickersUsed
    }
  }, [v3TickersUsed])

  // Persist control state on every change. Cheap — sessionStorage write of a
  // small JSON blob. Cleared on logout (Header) or tab close.
  useEffect(() => {
    saveScreenerState({
      mode, tickerInput,
      activeTickers, distPills, weeks,
      v3ActiveTickers, v3WeeksMin, v3WeeksMax,
      v3MinPremium, v3MinPProfit,
      v3MinPremiumStr, v3MinPProfitStr,
    })
  }, [
    mode, tickerInput,
    activeTickers, distPills, weeks,
    v3ActiveTickers, v3WeeksMin, v3WeeksMax,
    v3MinPremium, v3MinPProfit,
    v3MinPremiumStr, v3MinPProfitStr,
  ])

  // ── Utility functions ──────────────────────────────────────────────────────
  function fmtDist(d) {
    const pct = d * 100
    return `${parseFloat(pct.toPrecision(4))}%`
  }

  function parseTickers(raw) {
    return raw
      .split(/[,\s]+/)
      .map(t => t.trim().toUpperCase().replace(/^\$/, ''))
      .filter(Boolean)
  }

  // ── V2 client-side filtering ───────────────────────────────────────────────
  const activeDistSet = new Set(distPills.map(fmtDist))
  const filteredRanked = ranked
    .filter(r => activeTickers.length === 0 || activeTickers.includes(r.ticker))
    .filter(r => activeDistSet.size === 0 || activeDistSet.has(r.dist_pct))
  const rerankedFiltered = filteredRanked.map((r, i) => ({ ...r, rank: i + 1 }))

  // ── V3 client-side filtering ───────────────────────────────────────────────
  const v3FilteredRanked = v3Ranked
    .filter(r => v3ActiveTickers.length === 0 || v3ActiveTickers.includes(r.ticker))
    .map((r, i) => ({ ...r, rank: i + 1 }))

  // ── Staleness detection ────────────────────────────────────────────────────
  const distancesUsedSet = new Set((distancesUsed ?? []).map(fmtDist))
  const v2IsStale = hasResult && (
    (weeksUsed !== null && weeks !== weeksUsed) ||
    distPills.some(d => !distancesUsedSet.has(fmtDist(d))) ||
    parseTickers(tickerInput).some(t => !tickersUsed.includes(t))
  )

  const v3IsStale = v3HasResult && (
    (v3WeeksMinUsed   !== null && v3WeeksMin   !== v3WeeksMinUsed)   ||
    (v3WeeksMaxUsed   !== null && v3WeeksMax   !== v3WeeksMaxUsed)   ||
    (v3MinPremiumUsed !== null && v3MinPremium !== v3MinPremiumUsed) ||
    (v3MinPProfitUsed !== null && v3MinPProfit !== v3MinPProfitUsed) ||
    parseTickers(tickerInput).some(t => !v3TickersUsed.includes(t))
  )

  const isStale = mode === 'v2' ? v2IsStale : v3IsStale

  // ── Mode switch ────────────────────────────────────────────────────────────
  function handleModeChange(newMode) {
    if (newMode === mode || loading) return
    setMode(newMode)
    clearAll()
  }

  // ── Run scan ───────────────────────────────────────────────────────────────
  function handleRun() {
    const tickers = parseTickers(tickerInput)
    if (mode === 'v2') {
      runScan({
        tickers:   tickers.length > 0 ? tickers : undefined,
        distances: distPills,
        weeks,
      })
    } else {
      runV3Scan({
        tickers:    tickers.length > 0 ? tickers : undefined,
        weeksMin:   v3WeeksMin,
        weeksMax:   v3WeeksMax,
        minPremium: v3MinPremium,
        minPProfit: v3MinPProfit,
      })
    }
  }

  // ── V2 handlers ────────────────────────────────────────────────────────────
  function handleRemoveTicker(ticker) {
    setActiveTickers(prev => prev.filter(t => t !== ticker))
  }

  function addDistPill(raw) {
    const num = parseFloat(raw)
    if (isNaN(num) || num <= 0) return
    const decimal = parseFloat((num / 100).toFixed(4))
    if (decimal < 0.01 || decimal > 0.50) return
    setDistPills(prev => prev.includes(decimal) ? prev : [...prev, decimal].sort((a, b) => a - b))
  }

  function handleDistKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addDistPill(distInput.replace(',', '').trim())
      setDistInput('')
    }
  }

  function removeDistPill(d) {
    setDistPills(prev => prev.filter(x => x !== d))
  }

  // ── V3 handlers ────────────────────────────────────────────────────────────
  function handleRemoveV3Ticker(ticker) {
    setV3ActiveTickers(prev => prev.filter(t => t !== ticker))
  }

  // Validation helpers
  const v3MinPremiumValid = (() => {
    const s = v3MinPremiumStr.trim()
    if (s === '') return false
    const n = Number(s)
    return Number.isFinite(n) && n >= 0
  })()

  const v3MinPProfitValid = (() => {
    const s = v3MinPProfitStr.trim()
    if (s === '') return false
    const n = Number(s)
    return Number.isInteger(n) && n >= 1 && n <= 99
  })()

  // Free-text typing — always update string; sync numeric only when valid
  function handleV3MinPremiumChange(e) {
    const raw = e.target.value
    setV3MinPremiumStr(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n) && n >= 0) {
      setV3MinPremium(n)
    }
  }

  function handleV3MinPProfitChange(e) {
    const raw = e.target.value
    setV3MinPProfitStr(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 99) {
      setV3MinPProfit(parseFloat((n / 100).toFixed(4)))
    }
  }

  // Clamp to valid range on blur if invalid
  function handleV3MinPProfitBlur() {
    const n = Number(v3MinPProfitStr)
    let clamped
    if (!Number.isFinite(n)) clamped = Math.round(v3MinPProfit * 100)
    else clamped = Math.min(99, Math.max(1, Math.round(n)))
    setV3MinPProfitStr(String(clamped))
    setV3MinPProfit(parseFloat((clamped / 100).toFixed(4)))
  }

  function handleV3MinPremiumBlur() {
    const n = Number(v3MinPremiumStr)
    if (!Number.isFinite(n) || n < 0) {
      setV3MinPremiumStr(v3MinPremium.toFixed(2))
    }
  }

  // +/- bumpers — operate on the numeric state, then sync the string
  function bumpV3MinPremium(delta) {
    const next = Math.max(0, parseFloat((v3MinPremium + delta).toFixed(2)))
    setV3MinPremium(next)
    setV3MinPremiumStr(next.toFixed(2))
  }

  function bumpV3MinPProfit(delta) {
    const cur = Math.round(v3MinPProfit * 100)
    const next = Math.min(99, Math.max(1, cur + delta))
    setV3MinPProfit(parseFloat((next / 100).toFixed(4)))
    setV3MinPProfitStr(String(next))
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
      user_id:       user.id,
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
    const { error } = await supabase.from('tradebook').insert(trade)
    if (error) {
      console.error('Supabase insert error:', error)
      setSaveError(`Save failed: ${error.message}`)
      return
    }
    showToast()
  }

  function handleEdit(row) {
    navigate('/trade', { state: { triplet: row } })
  }

  // ── Screener content (inlined so it has closure access to all state) ────────
  const screenerContent = (
    <>
      <MacroEvents macroEvents={macroEvents} />

      {/* Control bar */}
      <div className="px-6 py-3 border-b border-gray-800 flex items-start gap-8 flex-wrap">

        {/* Tickers — shared between V2 and V3 */}
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
          <span className="text-gray-600 text-xs">Comma or space · blank = Robinhood</span>
        </div>

        {/* ── V2-only controls ──────────────────────────────────── */}
        {mode === 'v2' && (
          <>
            {/* Dist % pills */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Dist %</label>
              <div className="flex items-center gap-1.5 flex-wrap min-h-[32px]">
                {distPills.map(d => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700
                               rounded px-2 py-0.5 text-xs font-mono text-gray-300"
                  >
                    {fmtDist(d)}
                    <button
                      onClick={() => removeDistPill(d)}
                      disabled={loading}
                      className="text-gray-500 hover:text-gray-200 leading-none disabled:opacity-40"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="number"
                  value={distInput}
                  onChange={e => setDistInput(e.target.value)}
                  onKeyDown={handleDistKeyDown}
                  onBlur={() => { if (distInput.trim()) { addDistPill(distInput.trim()); setDistInput('') } }}
                  placeholder="e.g. 7"
                  disabled={loading}
                  className="w-20 bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1
                             text-xs font-mono placeholder-gray-600
                             focus:outline-none focus:border-indigo-500
                             disabled:opacity-50"
                />
              </div>
              <span className="text-gray-600 text-xs">Enter % value · press Enter or comma to add</span>
            </div>

            {/* V2 Weeks */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Weeks out</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setWeeks(w => Math.max(1, w - 1))}
                  disabled={loading || weeks <= 1}
                  className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                             text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
                >−</button>
                <span className="w-6 text-center text-sm font-mono text-gray-200">{weeks}</span>
                <button
                  onClick={() => setWeeks(w => Math.min(12, w + 1))}
                  disabled={loading || weeks >= 12}
                  className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                             text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
                >+</button>
              </div>
              <span className="text-gray-600 text-xs">1 – 12 weeks</span>
            </div>
          </>
        )}

        {/* ── V3-only controls ──────────────────────────────────── */}
        {mode === 'v3' && (
          <>
            {/* V3 Weeks range slider */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Weeks range</label>
              <div className="flex items-center h-7">
                <WeeksRangeSlider
                  min={1}
                  max={12}
                  valueMin={v3WeeksMin}
                  valueMax={v3WeeksMax}
                  onChange={(mn, mx) => { setV3WeeksMin(mn); setV3WeeksMax(mx) }}
                  disabled={loading}
                />
              </div>
              <span className="text-gray-600 text-xs">
                Weeks {v3WeeksMin} – {v3WeeksMax}
              </span>
            </div>

            {/* Min Net Premium — free text + bumpers */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Min Net Premium $</label>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => bumpV3MinPremium(-0.50)}
                  disabled={loading || v3MinPremium <= 0}
                  className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                             text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
                >−</button>
                <input
                  type="text"
                  inputMode="decimal"
                  value={v3MinPremiumStr}
                  onChange={handleV3MinPremiumChange}
                  onBlur={handleV3MinPremiumBlur}
                  onKeyDown={e => e.key === 'Enter' && !loading && v3MinPremiumValid && handleRun()}
                  disabled={loading}
                  placeholder="e.g. 4.25"
                  className={`w-20 bg-gray-800 text-gray-100 border rounded px-2 py-1.5
                             text-sm font-mono placeholder-gray-600 text-right
                             focus:outline-none disabled:opacity-50
                             ${v3MinPremiumValid
                               ? 'border-gray-700 focus:border-violet-500'
                               : 'border-red-500 focus:border-red-400'}`}
                />
                <button
                  onClick={() => bumpV3MinPremium(+0.50)}
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
                  onClick={() => bumpV3MinPProfit(-1)}
                  disabled={loading || Math.round(v3MinPProfit * 100) <= 1}
                  className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                             text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
                >−</button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={v3MinPProfitStr}
                  onChange={handleV3MinPProfitChange}
                  onBlur={handleV3MinPProfitBlur}
                  onKeyDown={e => e.key === 'Enter' && !loading && v3MinPProfitValid && handleRun()}
                  disabled={loading}
                  placeholder="1–99"
                  className={`w-20 bg-gray-800 text-gray-100 border rounded px-2 py-1.5
                             text-sm font-mono placeholder-gray-600 text-right
                             focus:outline-none disabled:opacity-50
                             ${v3MinPProfitValid
                               ? 'border-gray-700 focus:border-violet-500'
                               : 'border-red-500 focus:border-red-400'}`}
                />
                <button
                  onClick={() => bumpV3MinPProfit(+1)}
                  disabled={loading || Math.round(v3MinPProfit * 100) >= 99}
                  className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                             text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
                >+</button>
              </div>
              <span className="text-gray-600 text-xs">P(max profit) threshold</span>
            </div>
          </>
        )}

      </div>

      {/* Holdings filter bar — mode-aware */}
      {mode === 'v2' && tickersUsed.length > 0 && (
        <Holdings
          tickers={activeTickers}
          skipped={tickersSkipped}
          source={tickersSource}
          onRemove={handleRemoveTicker}
        />
      )}
      {mode === 'v3' && v3TickersUsed.length > 0 && (
        <Holdings
          tickers={v3ActiveTickers}
          skipped={v3TickersSkipped}
          source="manual"
          onRemove={handleRemoveV3Ticker}
        />
      )}

      <main className="flex-1">
        {loading && <LoadingSpinner />}

        {!loading && error && <ErrorBanner error={error} />}

        {!loading && !error && mode === 'v2' && (
          hasResult
            ? <RankedTable
                rows={rerankedFiltered}
                duplicatesRemoved={duplicatesRemoved}
                distancesUsed={distancesUsed}
                weeksUsed={weeksUsed}
              />
            : <EmptyState mode="v2" />
        )}

        {!loading && !error && mode === 'v3' && (
          v3HasResult
            ? <V3Table
                rows={v3FilteredRanked}
                totalEvaluated={v3TotalEvaluated}
                weeksMinUsed={v3WeeksMinUsed}
                weeksMaxUsed={v3WeeksMaxUsed}
                minPremiumUsed={v3MinPremiumUsed}
                minPProfitUsed={v3MinPProfitUsed}
                onEdit={handleEdit}
                onSaveToTradebook={saveToTradebook}
              />
            : <EmptyState mode="v3" />
        )}
      </main>
    </>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <Header
        marketOpen={marketOpen}
        lastRun={lastRun}
        onRun={handleRun}
        loading={loading}
        isStale={isStale}
        mode={mode}
        onModeChange={handleModeChange}
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

function EmptyState({ mode }) {
  const desc = mode === 'v3'
    ? 'Enter tickers and click Run Scan to find call spread risk reversal opportunities.'
    : 'Enter tickers above (or leave blank for Robinhood holdings) and click Run Scan.'

  return (
    <div className="flex flex-col items-center justify-center py-32 gap-3 text-center px-6">
      <p className="text-gray-400 text-base font-medium">Ready to scan</p>
      <p className="text-gray-600 text-sm max-w-sm">{desc}</p>
      <p className="text-gray-700 text-xs mt-2">
        Make sure the Flask server is running: <span className="font-mono">python3 server/app.py</span>
      </p>
    </div>
  )
}

function ErrorBanner({ error }) {
  const isRobinhoodError = error === 'robinhood_unavailable'

  return (
    <div className="mx-6 mt-6 p-4 rounded border border-red-800/60 bg-red-950/30">
      {isRobinhoodError ? (
        <>
          <p className="text-red-400 font-semibold text-sm mb-1">Robinhood login unavailable</p>
          <p className="text-gray-400 text-xs">
            Enter tickers manually in the input above and click Run Scan.
          </p>
        </>
      ) : (
        <>
          <p className="text-red-400 font-semibold text-sm mb-1">Error</p>
          <p className="text-gray-400 text-xs font-mono break-all">{error}</p>
        </>
      )}
    </div>
  )
}
