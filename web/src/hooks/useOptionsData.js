import { useState, useEffect, useCallback } from 'react'

export default function useOptionsData() {
  const [status,   setStatus]   = useState(null)  // from GET /api/status
  const [result,   setResult]   = useState(null)  // from POST /api/run  (V2)
  const [v3Result, setV3Result] = useState(null)  // from POST /api/run_v3 (V3)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)  // string or null

  // Fetch market status on mount (fast, no external calls)
  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(data => setStatus(data))
      .catch(() => {})  // server may not be up yet; silently ignore
  }, [])

  // ── V2 scan ────────────────────────────────────────────────────────────────
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
        if (data.robinhood_unavailable) {
          setError('robinhood_unavailable')
        } else {
          setError(data.error || `Server error (${res.status})`)
        }
      } else {
        setResult(data)
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

  // ── V3 scan ────────────────────────────────────────────────────────────────
  const runV3Scan = useCallback(async ({ tickers, weeks, minPremium, minPProfit } = {}) => {
    setLoading(true)
    setError(null)

    try {
      const body = {}
      if (tickers    && tickers.length > 0) body.tickers      = tickers
      if (weeks      !== undefined)          body.weeks        = weeks
      if (minPremium !== undefined)          body.min_premium  = minPremium
      if (minPProfit !== undefined)          body.min_p_profit = minPProfit

      const res  = await fetch('/api/run_v3', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.robinhood_unavailable) {
          setError('robinhood_unavailable')
        } else {
          setError(data.error || `Server error (${res.status})`)
        }
      } else {
        setV3Result(data)
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

  // ── Clear all results (called on mode switch) ──────────────────────────────
  const clearAll = useCallback(() => {
    setResult(null)
    setV3Result(null)
    setError(null)
  }, [])

  return {
    // market / timing
    marketOpen: result?.market_open  ?? v3Result?.market_open  ?? status?.market_open ?? null,
    lastRun:    result?.run_at       ?? v3Result?.run_at       ?? status?.last_run    ?? null,

    // ── V2 ──────────────────────────────────────────────────────────────────
    ranked:            result?.ranked            ?? [],
    macroEvents:       result?.macro_events ?? v3Result?.macro_events ?? null,
    duplicatesRemoved: result?.duplicates_removed ?? 0,
    tickersUsed:       result?.tickers_used      ?? [],
    tickersSkipped:    result?.tickers_skipped   ?? [],
    tickersSource:     result?.tickers_source    ?? null,
    distancesUsed:     result?.distances_used    ?? null,
    weeksUsed:         result?.weeks_used        ?? null,
    hasResult:         result !== null,

    // ── V3 ──────────────────────────────────────────────────────────────────
    v3Ranked:          v3Result?.ranked           ?? [],
    v3TickersUsed:     v3Result?.tickers_used     ?? [],
    v3TickersSkipped:  v3Result?.tickers_skipped  ?? [],
    v3WeeksUsed:       v3Result?.weeks_used       ?? null,
    v3MinPremiumUsed:  v3Result?.min_premium_used ?? null,
    v3MinPProfitUsed:  v3Result?.min_p_profit_used ?? null,
    v3TotalEvaluated:  v3Result?.total_evaluated  ?? 0,
    v3HasResult:       v3Result !== null,

    // ── Shared state ─────────────────────────────────────────────────────────
    loading,
    error,

    // ── Actions ──────────────────────────────────────────────────────────────
    runScan,
    runV3Scan,
    clearAll,
  }
}
