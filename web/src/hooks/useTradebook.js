import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { todayET } from '../components/lc/format'

// The Tradebook's data: the user's saved trades joined client-side with their
// grading (trade_outcomes), and the scan they came from (scan_runs +
// scan_results). Every read is a direct supabase-js query under the existing
// row-level policies (own rows only); no API is involved. Status:
//   open    — expiration ≥ today (ET)
//   pending — expired, no outcome row yet (the nightly backfill hasn't graded it)
//   graded  — an outcome row exists
const EMPTY = []

export default function useTradebook(user) {
  const [trades,   setTrades]   = useState(EMPTY)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [reloadTick, setReloadTick] = useState(0)

  const reload = useCallback(() => setReloadTick(t => t + 1), [])

  useEffect(() => {
    if (!user) { setTrades(EMPTY); setLoading(false); return }
    let cancelled = false
    setLoading(true); setError(null)
    ;(async () => {
      try {
        const { data: rows, error: e1 } = await supabase.from('tradebook').select('*').eq('user_id', user.id).order('saved_at', { ascending: false })
        if (e1) throw e1
        const ids = rows.map(r => r.id)
        const scanIds = [...new Set(rows.map(r => r.scan_id).filter(Boolean))]
        const resultIds = [...new Set(rows.map(r => r.result_id).filter(Boolean))]
        const [outcomesRes, runsRes, resultsRes] = await Promise.all([
          ids.length ? supabase.from('trade_outcomes').select('tradebook_id,outcome_type,stock_price_at_expiration,realized_pnl,pnl_per_contract,calculated_at').in('tradebook_id', ids) : { data: [] },
          scanIds.length ? supabase.from('scan_runs').select('id,created_at,tickers_used,weeks_min,weeks_max,min_premium,min_p_profit,total_passed').in('id', scanIds) : { data: [] },
          resultIds.length ? supabase.from('scan_results').select('id,rank').in('id', resultIds) : { data: [] },
        ])
        // provenance and outcomes are best-effort: a policy or schema hiccup must not hide the book
        const outcomes = new Map((outcomesRes.data ?? []).map(o => [o.tradebook_id, o]))
        const runs = new Map((runsRes.data ?? []).map(r => [r.id, r]))
        const results = new Map((resultsRes.data ?? []).map(r => [r.id, r]))
        const today = todayET()
        const joined = rows.map(r => {
          const outcome = outcomes.get(r.id) ?? null
          const status = r.expiration >= today ? 'open' : outcome ? 'graded' : 'pending'
          return { ...r, outcome, status, scan: r.scan_id ? runs.get(r.scan_id) ?? null : null, result: r.result_id ? results.get(r.result_id) ?? null : null }
        })
        if (!cancelled) setTrades(joined)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load your trades')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user, reloadTick])

  const remove = useCallback(async id => {
    const { error: e } = await supabase.from('tradebook').delete().eq('id', id)
    if (e) return { error: e.message }
    setTrades(prev => prev.filter(t => t.id !== id))
    return {}
  }, [])

  const summary = useMemo(() => {
    const open = trades.filter(t => t.status === 'open').length
    const pending = trades.filter(t => t.status === 'pending').length
    const graded = trades.filter(t => t.status === 'graded')
    const totalPnl = graded.reduce((s, t) => s + Number(t.outcome?.pnl_per_contract ?? 0), 0)
    return { open, pending, graded: graded.length, totalPnl }
  }, [trades])

  return { trades, loading, error, reload, remove, summary }
}

/** Live spot for an open trade (best-effort, the existing chart endpoint; cached per ticker for a minute). */
const spotCache = new Map()
export async function fetchSpot(ticker) {
  const hit = spotCache.get(ticker)
  if (hit && Date.now() - hit.at < 60000) return hit.price
  try {
    const r = await fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&timeframe=1D`)
    if (!r.ok) return null
    const d = await r.json()
    const price = Number(d.current_price)
    if (!Number.isFinite(price)) return null
    spotCache.set(ticker, { price, at: Date.now() })
    return price
  } catch { return null }
}
