import { useEffect, useRef, useState } from 'react'

/**
 * Fetch /api/chart for a (ticker, timeframe) pair. Cached by key in a ref
 * so toggling expand/compact doesn't refetch.
 *
 * Returns { data, loading, error }. data is null until the first successful fetch.
 */
export default function useChartData(ticker, timeframe) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  // Cache: { 'MU|1M': { ticker, timeframe, ...payload } }
  const cacheRef = useRef(new Map())
  // Track the latest in-flight key so an out-of-order response doesn't overwrite a newer one.
  const latestKeyRef = useRef(null)

  useEffect(() => {
    if (!ticker || !timeframe) {
      setData(null)
      setError(null)
      return
    }

    const key = `${ticker}|${timeframe}`
    latestKeyRef.current = key

    // Cache hit → no fetch
    const cached = cacheRef.current.get(key)
    if (cached) {
      setData(cached)
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&timeframe=${encodeURIComponent(timeframe)}`)
      .then(async r => {
        const payload = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(payload.error || `Server error (${r.status})`)
        return payload
      })
      .then(payload => {
        if (latestKeyRef.current !== key) return  // stale response
        cacheRef.current.set(key, payload)
        setData(payload)
        setLoading(false)
      })
      .catch(e => {
        if (latestKeyRef.current !== key) return
        setError(e.message || 'Chart fetch failed')
        setData(null)
        setLoading(false)
      })
  }, [ticker, timeframe])

  return { data, loading, error }
}
