import { useState, useEffect } from 'react'
import './index.css'

import useOptionsData  from './hooks/useOptionsData'
import Header          from './components/Header'
import MacroEvents     from './components/MacroEvents'
import Holdings        from './components/Holdings'
import RankedTable     from './components/RankedTable'
import V3Table         from './components/V3Table'
import LoadingSpinner  from './components/LoadingSpinner'

const DEFAULT_DISTANCES = [0.03, 0.05, 0.07, 0.10, 0.15]

export default function App() {
  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState('v2')  // 'v2' | 'v3'

  // ── Shared controls ────────────────────────────────────────────────────────
  const [tickerInput, setTickerInput] = useState('')

  // ── V2 controls ────────────────────────────────────────────────────────────
  const [activeTickers, setActiveTickers] = useState([])
  const [distInput,     setDistInput]     = useState('')
  const [distPills,     setDistPills]     = useState(DEFAULT_DISTANCES)
  const [weeks,         setWeeks]         = useState(4)

  // ── V3 controls ────────────────────────────────────────────────────────────
  const [v3ActiveTickers, setV3ActiveTickers] = useState([])
  const [v3Weeks,         setV3Weeks]         = useState(12)
  const [v3MinPremium,    setV3MinPremium]    = useState(5.00)
  const [v3MinPProfit,    setV3MinPProfit]    = useState(0.50)

  const {
    marketOpen, lastRun,
    // V2
    ranked, macroEvents, duplicatesRemoved,
    tickersUsed, tickersSkipped, tickersSource,
    distancesUsed, weeksUsed, hasResult,
    // V3
    v3Ranked, v3TickersUsed, v3TickersSkipped,
    v3WeeksUsed, v3MinPremiumUsed, v3MinPProfitUsed,
    v3TotalEvaluated, v3HasResult,
    // shared
    loading, error,
    runScan, runV3Scan, clearAll,
  } = useOptionsData()

  // Sync active ticker pills with scan results
  useEffect(() => { setActiveTickers(tickersUsed) },   [tickersUsed])
  useEffect(() => { setV3ActiveTickers(v3TickersUsed) }, [v3TickersUsed])

  // ── Utility functions ──────────────────────────────────────────────────────
  function fmtDist(d) {
    const pct = d * 100
    return `${parseFloat(pct.toPrecision(4))}%`
  }

  function parseTickers(raw) {
    return raw
      .split(/[,\s]+/)
      .map(t => t.trim().toUpperCase())
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
    (v3WeeksUsed    !== null && v3Weeks      !== v3WeeksUsed)    ||
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
        weeks:      v3Weeks,
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

  function handleV3MinPremiumChange(e) {
    const val = parseFloat(e.target.value)
    if (!isNaN(val) && val >= 0) setV3MinPremium(val)
  }

  function handleV3MinPProfitChange(e) {
    const val = parseFloat(e.target.value)
    if (!isNaN(val) && val >= 1 && val <= 99) setV3MinPProfit(parseFloat((val / 100).toFixed(4)))
  }

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
            {/* V3 Weeks */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Weeks out</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setV3Weeks(w => Math.max(1, w - 1))}
                  disabled={loading || v3Weeks <= 1}
                  className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                             text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
                >−</button>
                <span className="w-6 text-center text-sm font-mono text-gray-200">{v3Weeks}</span>
                <button
                  onClick={() => setV3Weeks(w => Math.min(12, w + 1))}
                  disabled={loading || v3Weeks >= 12}
                  className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                             text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
                >+</button>
              </div>
              <span className="text-gray-600 text-xs">1 – 12 weeks</span>
            </div>

            {/* Min Net Premium */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Min Net Premium $</label>
              <input
                type="number"
                value={v3MinPremium}
                onChange={handleV3MinPremiumChange}
                onKeyDown={e => e.key === 'Enter' && !loading && handleRun()}
                min="0"
                step="0.50"
                disabled={loading}
                className="w-24 bg-gray-800 text-gray-100 border border-gray-700 rounded px-3 py-1.5
                           text-sm font-mono
                           focus:outline-none focus:border-violet-500
                           disabled:opacity-50"
              />
              <span className="text-gray-600 text-xs">Net credit required</span>
            </div>

            {/* Min P(Profit) */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Min P(Profit) %</label>
              <input
                type="number"
                value={Math.round(v3MinPProfit * 100)}
                onChange={handleV3MinPProfitChange}
                onKeyDown={e => e.key === 'Enter' && !loading && handleRun()}
                min="1"
                max="99"
                step="1"
                disabled={loading}
                className="w-24 bg-gray-800 text-gray-100 border border-gray-700 rounded px-3 py-1.5
                           text-sm font-mono
                           focus:outline-none focus:border-violet-500
                           disabled:opacity-50"
              />
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
                weeksUsed={v3WeeksUsed}
                minPremiumUsed={v3MinPremiumUsed}
                minPProfitUsed={v3MinPProfitUsed}
              />
            : <EmptyState mode="v3" />
        )}
      </main>

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
