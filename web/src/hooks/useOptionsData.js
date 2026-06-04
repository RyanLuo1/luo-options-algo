import { useState, useEffect, useCallback, useMemo } from 'react'
import { loadScreenerResults, saveScreenerResults } from '../lib/sessionState'
import { supabase } from '../lib/supabase'

// Stable empty array — avoids creating a new reference on every render,
// which would trigger useEffect dependency checks in App and cause an infinite loop.
const EMPTY = []

export default function useOptionsData() {
  // Hydrate persisted scan results from sessionStorage (single read on mount).
  const initial = useMemo(() => loadScreenerResults() ?? {}, [])

  const [status,  setStatus]  = useState(null)              // from GET /api/status
  const [result,  setResult]  = useState(initial.result ?? null)  // risk reversal scan
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)  // string or null

  // Persist scan results so they survive in-session navigation (/, /trade, /tradebook).
  // Cleared when the tab closes (sessionStorage default) or on logout (Header).
  useEffect(() => {
    saveScreenerResults({ result })
  }, [result])

  // Fetch market status on mount (fast, no external calls)
  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(data => setStatus(data))
      .catch(() => {})  // server may not be up yet; silently ignore
  }, [])

  // ── Risk reversal scan ──────────────────────────────────────────────────────
  const runScan = useCallback(async ({ tickers, weeksMin, weeksMax, minPremium, minPProfit } = {}) => {
    setLoading(true)
    setError(null)

    try {
      const body = {}
      if (tickers    && tickers.length > 0) body.tickers      = tickers
      if (weeksMin   !== undefined)          body.weeks_min    = weeksMin
      if (weeksMax   !== undefined)          body.weeks_max    = weeksMax
      if (minPremium !== undefined)          body.min_premium  = minPremium
      if (minPProfit !== undefined)          body.min_p_profit = minPProfit

      // Forward the Supabase JWT so the server can attribute this scan in
      // scan_runs (logging is server-side, best-effort).
      const headers = { 'Content-Type': 'application/json' }
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`

      const res  = await fetch('/api/run', {
        method:  'POST',
        headers,
        body:    JSON.stringify(body),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || `Server error (${res.status})`)
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

  // ── Clear results ───────────────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])

  return {
    // market / timing
    marketOpen: result?.market_open ?? status?.market_open ?? null,
    lastRun:    result?.run_at      ?? status?.last_run    ?? null,
    macroEvents: result?.macro_events ?? null,

    // ── Risk reversal results ────────────────────────────────────────────────
    ranked:          result?.ranked           ?? EMPTY,
    tickersUsed:     result?.tickers_used     ?? EMPTY,
    tickersSkipped:  result?.tickers_skipped  ?? EMPTY,
    weeksMinUsed:    result?.weeks_min_used   ?? null,
    weeksMaxUsed:    result?.weeks_max_used   ?? null,
    minPremiumUsed:  result?.min_premium_used ?? null,
    minPProfitUsed:  result?.min_p_profit_used ?? null,
    totalEvaluated:  result?.total_evaluated  ?? 0,
    hasResult:       result !== null,
    // Scan provenance — propagated to tradebook saves so each saved trade
    // links back to the scan and triplet it came from.
    scanId:          result?.scan_id          ?? null,

    // ── Shared state ─────────────────────────────────────────────────────────
    loading,
    error,

    // ── Actions ──────────────────────────────────────────────────────────────
    runScan,
    clearAll,
  }
}
