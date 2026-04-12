import { useState, useEffect, useCallback } from 'react'

export default function useOptionsData() {
  const [status,  setStatus]  = useState(null)   // from GET /api/status
  const [result,  setResult]  = useState(null)   // from POST /api/run
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)   // string or null

  // Fetch market status on mount (fast, no external calls)
  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(data => setStatus(data))
      .catch(() => {})  // server may not be up yet; silently ignore
  }, [])

  const runScan = useCallback(async ({ tickers, distances, weeks } = {}) => {
    setLoading(true)
    setError(null)

    try {
      const body = {}
      if (tickers && tickers.length > 0) body.tickers = tickers
      if (distances && distances.length > 0) body.distances = distances
      if (weeks !== undefined) body.weeks = weeks
      const res  = await fetch('/api/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        // Surface a friendly message for the Robinhood-unavailable case
        if (data.robinhood_unavailable) {
          setError('robinhood_unavailable')
        } else {
          setError(data.error || `Server error (${res.status})`)
        }
      } else {
        setResult(data)
        // Keep status market_open in sync with the most recent run
        setStatus(prev => ({
          ...prev,
          market_open: data.market_open,
          last_run:    data.run_at,
        }))
      }
    } catch (e) {
      setError(`Cannot reach server. Is Flask running on port 5001? (${e.message})`)
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    // market / timing
    marketOpen:        result?.market_open     ?? status?.market_open ?? null,
    lastRun:           result?.run_at          ?? status?.last_run    ?? null,
    // ranked data
    ranked:            result?.ranked          ?? [],
    macroEvents:       result?.macro_events    ?? null,
    duplicatesRemoved: result?.duplicates_removed ?? 0,
    tickersUsed:       result?.tickers_used    ?? [],
    tickersSkipped:    result?.tickers_skipped ?? [],
    tickersSource:     result?.tickers_source  ?? null,
    totalRanked:       result?.total_ranked    ?? 0,
    distancesUsed:     result?.distances_used  ?? null,
    weeksUsed:         result?.weeks_used      ?? null,
    // state
    loading,
    error,
    hasResult: result !== null,
    // actions
    runScan,
  }
}
