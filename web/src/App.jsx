import { useState, useEffect } from 'react'
import './index.css'

import useOptionsData  from './hooks/useOptionsData'
import Header          from './components/Header'
import MacroEvents     from './components/MacroEvents'
import Holdings        from './components/Holdings'
import RankedTable     from './components/RankedTable'
import LoadingSpinner  from './components/LoadingSpinner'

const DEFAULT_DISTANCES = [0.03, 0.05, 0.07, 0.10, 0.15]

export default function App() {
  const [tickerInput,    setTickerInput]    = useState('')
  const [activeTickers,  setActiveTickers]  = useState([])
  const [distInput,      setDistInput]      = useState('')
  const [distPills,      setDistPills]      = useState(DEFAULT_DISTANCES)
  const [weeks,          setWeeks]          = useState(4)

  const {
    marketOpen, lastRun,
    ranked, macroEvents, duplicatesRemoved,
    tickersUsed, tickersSkipped, tickersSource,
    distancesUsed, weeksUsed,
    loading, error, hasResult,
    runScan,
  } = useOptionsData()

  // When a scan completes, reset the active filter to the full result set
  useEffect(() => {
    setActiveTickers(tickersUsed)
  }, [tickersUsed])

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

  // ── Client-side filtering (instant, no API call) ─────────────
  const activeDistSet = new Set(distPills.map(fmtDist))

  const filteredRanked = ranked
    .filter(r => activeTickers.length === 0 || activeTickers.includes(r.ticker))
    .filter(r => activeDistSet.size === 0 || activeDistSet.has(r.dist_pct))

  // Re-rank after filter so rank numbers stay contiguous
  const rerankedFiltered = filteredRanked.map((r, i) => ({ ...r, rank: i + 1 }))

  // ── Staleness detection ──────────────────────────────────────
  // Stale when the displayed results don't cover what the current controls would scan.
  // Removing pills is NOT stale — the client-side filter handles it instantly.
  const distancesUsedSet = new Set((distancesUsed ?? []).map(fmtDist))
  const isStale = hasResult && (
    (weeksUsed !== null && weeks !== weeksUsed) ||
    distPills.some(d => !distancesUsedSet.has(fmtDist(d))) ||
    parseTickers(tickerInput).some(t => !tickersUsed.includes(t))
  )

  function handleRun() {
    const tickers = parseTickers(tickerInput)
    runScan({
      tickers:   tickers.length > 0 ? tickers : undefined,
      distances: distPills,
      weeks,
    })
  }

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

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      <Header
        marketOpen={marketOpen}
        lastRun={lastRun}
        onRun={handleRun}
        loading={loading}
        isStale={isStale}
      />

      <MacroEvents macroEvents={macroEvents} />

      {/* Control bar */}
      <div className="px-6 py-3 border-b border-gray-800 flex items-start gap-8 flex-wrap">

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
          <span className="text-gray-600 text-xs">Comma or space · blank = Robinhood</span>
        </div>

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

        {/* Weeks */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Weeks out</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeeks(w => Math.max(1, w - 1))}
              disabled={loading || weeks <= 1}
              className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                         text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
            >
              −
            </button>
            <span className="w-6 text-center text-sm font-mono text-gray-200">{weeks}</span>
            <button
              onClick={() => setWeeks(w => Math.min(12, w + 1))}
              disabled={loading || weeks >= 12}
              className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 border border-gray-700
                         text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-sm font-bold"
            >
              +
            </button>
          </div>
          <span className="text-gray-600 text-xs">1 – 12 weeks</span>
        </div>

      </div>

      {/* Tickers used after a successful scan — dismissible to filter table in real time */}
      {tickersUsed.length > 0 && (
        <Holdings
          tickers={activeTickers}
          skipped={tickersSkipped}
          source={tickersSource}
          onRemove={handleRemoveTicker}
        />
      )}

      <main className="flex-1">
        {loading && <LoadingSpinner />}

        {!loading && error && <ErrorBanner error={error} />}

        {!loading && !error && (
          hasResult
            ? <RankedTable
                rows={rerankedFiltered}
                duplicatesRemoved={duplicatesRemoved}
                distancesUsed={distancesUsed}
                weeksUsed={weeksUsed}
              />
            : <EmptyState />
        )}
      </main>

    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-3 text-center px-6">
      <p className="text-gray-400 text-base font-medium">Ready to scan</p>
      <p className="text-gray-600 text-sm max-w-sm">
        Enter tickers above (or leave blank for Robinhood holdings) and click{' '}
        <span className="text-indigo-400">Run Scan</span>.
      </p>
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
