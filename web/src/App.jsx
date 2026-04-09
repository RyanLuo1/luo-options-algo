import { useState, useEffect } from 'react'
import './index.css'

import useOptionsData  from './hooks/useOptionsData'
import Header          from './components/Header'
import MacroEvents     from './components/MacroEvents'
import Holdings        from './components/Holdings'
import RankedTable     from './components/RankedTable'
import LoadingSpinner  from './components/LoadingSpinner'

export default function App() {
  const [tickerInput,   setTickerInput]   = useState('')
  const [activeTickers, setActiveTickers] = useState([])

  const {
    marketOpen, lastRun,
    ranked, macroEvents, duplicatesRemoved,
    tickersUsed, tickersSkipped, tickersSource,
    loading, error, hasResult,
    runScan,
  } = useOptionsData()

  // When a scan completes, reset the active filter to the full result set
  useEffect(() => {
    setActiveTickers(tickersUsed)
  }, [tickersUsed])

  const filteredRanked = activeTickers.length > 0
    ? ranked.filter(r => activeTickers.includes(r.ticker))
    : ranked

  // Re-rank after filter so rank numbers stay contiguous
  const rerankedFiltered = filteredRanked.map((r, i) => ({ ...r, rank: i + 1 }))

  function parseTickers(raw) {
    return raw
      .split(/[,\s]+/)
      .map(t => t.trim().toUpperCase())
      .filter(Boolean)
  }

  function handleRun() {
    const tickers = parseTickers(tickerInput)
    runScan(tickers.length > 0 ? tickers : undefined)
  }

  function handleRemoveTicker(ticker) {
    setActiveTickers(prev => prev.filter(t => t !== ticker))
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      <Header
        marketOpen={marketOpen}
        lastRun={lastRun}
        onRun={handleRun}
        loading={loading}
      />

      <MacroEvents macroEvents={macroEvents} />

      {/* Ticker input bar */}
      <div className="px-6 py-3 border-b border-gray-800 flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={tickerInput}
          onChange={e => setTickerInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && handleRun()}
          placeholder="NVDA, META, TSLA, AMD…"
          disabled={loading}
          className="w-80 bg-gray-800 text-gray-100 border border-gray-700 rounded px-3 py-1.5
                     text-sm font-mono placeholder-gray-600
                     focus:outline-none focus:border-indigo-500
                     disabled:opacity-50"
        />
        <span className="text-gray-600 text-xs">
          Comma or space separated · leave empty to use Robinhood holdings
        </span>
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
            ? <RankedTable rows={rerankedFiltered} duplicatesRemoved={duplicatesRemoved} />
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
