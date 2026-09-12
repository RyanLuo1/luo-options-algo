import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import './index.css'
import { supabase } from './lib/supabase'
import useAuth from './hooks/useAuth'
import { loadScreenerState, saveScreenerState, clearScreenerSession } from './lib/sessionState'
import { parseTickersUnique, normalizeWatchlistName, validateWatchlistName, resolveScanTickers } from './lib/watchlists'
import useOptionsData from './hooks/useOptionsData'

import AppShell        from './components/lc/AppShell'
import LockedTeaser    from './components/lc/LockedTeaser'
import ControlsBar     from './components/lc/ControlsBar'
import ScanChips       from './components/lc/ScanChips'
import WatchlistManager from './components/WatchlistManager'
import { Card, Button, Pill } from './components/lc/ui'

// ── Screener (/app) — rebuilt on the v1 design system (DESIGN.md). ──────────
// Build stage 1: shell (b), controls bar (c), scanning chips (d), first-run
// state. The ranked table (e), detail panel (f) and the remaining states (g)
// follow in later stages. The scan API, scoring, watchlists, and session
// persistence are unchanged.
export default function App() {
  const navigate = useNavigate()
  const { user, plan } = useAuth()

  const persisted = useMemo(() => loadScreenerState() ?? {}, [])

  // ── Controls (persisted) ───────────────────────────────────────────────────
  const [tickerInput,   setTickerInputRaw] = useState(persisted.tickerInput ?? '')
  const [scanInputError, setScanInputError] = useState(null)
  // Editing the input clears its inline error.
  const setTickerInput = v => { setTickerInputRaw(v); setScanInputError(null) }
  const [activeTickers, setActiveTickers] = useState(persisted.activeTickers ?? [])
  const [weeksMin,      setWeeksMin]      = useState(persisted.weeksMin ?? 1)
  const [weeksMax,      setWeeksMax]      = useState(persisted.weeksMax ?? 12)
  // minPremium stays PER SHARE (the API's unit). The UI shows $ per contract:
  // minCreditStr is the per-contract string the user types; default $500 = $5/share.
  const [minPremium,    setMinPremium]    = useState(persisted.minPremium ?? 5.00)
  const [minCreditStr,  setMinCreditStr]  = useState(persisted.minCreditStr ?? String(Math.round((persisted.minPremium ?? 5.00) * 100)))
  const [minPProfit,    setMinPProfit]    = useState(persisted.minPProfit ?? 0.50)
  const [minPProfitStr, setMinPProfitStr] = useState(persisted.minPProfitStr ?? '50')
  const [tickerFilter,  setTickerFilter]  = useState(persisted.tickerFilter ?? null)

  // ── Shell ──────────────────────────────────────────────────────────────────
  const [activeTab,  setActiveTab]  = useState('screener')
  const [manageOpen, setManageOpen] = useState(false)
  const tickersRef = useRef(null)

  // ── Watchlists (server-backed, unchanged) ──────────────────────────────────
  const [watchlists, setWatchlists] = useState([])
  useEffect(() => {
    if (!user) { setWatchlists([]); return }
    let cancelled = false
    supabase.from('watchlists').select('*').eq('user_id', user.id).order('name', { ascending: true })
      .then(({ data, error }) => { if (!cancelled && !error && data) setWatchlists(data) })
    return () => { cancelled = true }
  }, [user])

  async function createWatchlist(rawName, rawTickers) {
    if (!user) return { error: 'Sign in to save watchlists.' }
    const nameErr = validateWatchlistName(rawName)
    if (nameErr) return { error: nameErr }
    const name = normalizeWatchlistName(rawName)
    const tickers = parseTickersUnique(rawTickers)
    if (tickers.length === 0) return { error: 'Add at least one ticker.' }
    if (watchlists.some(w => w.name === name)) return { error: `Watchlist "${name}" already exists.` }
    const { data, error } = await supabase.from('watchlists').insert({ user_id: user.id, name, tickers }).select().single()
    if (error) return { error: error.code === '23505' ? `Watchlist "${name}" already exists.` : error.message }
    setWatchlists(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    return {}
  }
  async function updateWatchlist(id, rawName, rawTickers) {
    if (!user) return { error: 'Sign in to edit watchlists.' }
    const nameErr = validateWatchlistName(rawName)
    if (nameErr) return { error: nameErr }
    const name = normalizeWatchlistName(rawName)
    const tickers = parseTickersUnique(rawTickers)
    if (tickers.length === 0) return { error: 'Add at least one ticker.' }
    if (watchlists.some(w => w.name === name && w.id !== id)) return { error: `Watchlist "${name}" already exists.` }
    const { data, error } = await supabase.from('watchlists').update({ name, tickers, updated_at: new Date().toISOString() }).eq('id', id).select().single()
    if (error) return { error: error.code === '23505' ? `Watchlist "${name}" already exists.` : error.message }
    setWatchlists(prev => prev.map(w => (w.id === id ? data : w)).sort((a, b) => a.name.localeCompare(b.name)))
    return {}
  }
  async function deleteWatchlist(id) {
    if (!user) return
    const { error } = await supabase.from('watchlists').delete().eq('id', id)
    if (!error) setWatchlists(prev => prev.filter(w => w.id !== id))
  }

  // ── Scan data (unchanged hook) ─────────────────────────────────────────────
  const {
    marketOpen, lastRun, ranked, tickersUsed, tickersSkipped,
    weeksMinUsed, weeksMaxUsed, minPremiumUsed, minPProfitUsed,
    totalEvaluated, hasResult, loading, error, runScan,
  } = useOptionsData()

  // A new scan result re-seeds the scan-set chips (state adjusted during render,
  // the React-endorsed pattern; the first render after hydration is a no-op).
  const [seenTickersUsed, setSeenTickersUsed] = useState(tickersUsed)
  if (tickersUsed !== seenTickersUsed) {
    setSeenTickersUsed(tickersUsed)
    setActiveTickers(tickersUsed)
  }

  // Persist controls
  useEffect(() => {
    saveScreenerState({ tickerInput, activeTickers, weeksMin, weeksMax, minPremium, minCreditStr, minPProfit, minPProfitStr, tickerFilter })
  }, [tickerInput, activeTickers, weeksMin, weeksMax, minPremium, minCreditStr, minPProfit, minPProfitStr, tickerFilter])

  // ── Derived rows ───────────────────────────────────────────────────────────
  const baseRanked = ranked.filter(r => activeTickers.length === 0 || activeTickers.includes(r.ticker))
  const counts = useMemo(() => {
    const m = {}
    for (const r of ranked) m[r.ticker] = (m[r.ticker] ?? 0) + 1
    return m
  }, [ranked])

  // ── Staleness ──────────────────────────────────────────────────────────────
  const resolvedStale = resolveScanTickers(tickerInput, watchlists)
  const isStale = hasResult && (
    (weeksMinUsed   !== null && weeksMin   !== weeksMinUsed)   ||
    (weeksMaxUsed   !== null && weeksMax   !== weeksMaxUsed)   ||
    (minPremiumUsed !== null && minPremium !== minPremiumUsed) ||
    (minPProfitUsed !== null && minPProfit !== minPProfitUsed) ||
    (!resolvedStale.error && resolvedStale.tickers.some(t => !tickersUsed.includes(t)))
  )

  // ── Run scan ───────────────────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    if (loading) return
    const { tickers, error: resolveErr } = resolveScanTickers(tickerInput, watchlists)
    if (resolveErr) { setScanInputError(resolveErr); return }
    if (tickers.length === 0) { setScanInputError('Enter one or more tickers, or a @watchlist, then run the scan.'); tickersRef.current?.focus(); return }
    setScanInputError(null)
    setActiveTab('screener')
    runScan({ tickers, weeksMin, weeksMax, minPremium, minPProfit })
  }, [loading, tickerInput, watchlists, weeksMin, weeksMax, minPremium, minPProfit, runScan])

  // Keyboard: ⌘/Ctrl+Enter runs from anywhere; `/` focuses the tickers input.
  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleRun(); return }
      if (e.key === '/' && !typing) { e.preventDefault(); tickersRef.current?.focus(); tickersRef.current?.select() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleRun])

  // ── Chips ──────────────────────────────────────────────────────────────────
  function toggleTickerFilter(t) { setTickerFilter(prev => (prev === t ? null : t)) }
  function removeTicker(t) {
    setActiveTickers(prev => prev.filter(x => x !== t))
    setTickerFilter(prev => (prev === t ? null : prev))
  }

  // ── Min credit ($ per contract in the UI; per share for the API) ──────────
  const minCreditValid = (() => { const s = minCreditStr.trim(); const n = Number(s); return s !== '' && Number.isFinite(n) && n >= 0 })()
  function onMinCreditChange(e) {
    const raw = e.target.value.replace(/[$,]/g, '')
    setMinCreditStr(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n) && n >= 0) setMinPremium(parseFloat((n / 100).toFixed(4)))
  }
  function onMinCreditBlur() {
    const n = Number(minCreditStr)
    if (!Number.isFinite(n) || n < 0 || minCreditStr.trim() === '') setMinCreditStr(String(Math.round(minPremium * 100)))
    else setMinCreditStr(String(Math.round(n)))
  }
  function bumpMinCredit(delta) {
    const next = Math.max(0, Math.round(minPremium * 100) + delta)
    setMinPremium(parseFloat((next / 100).toFixed(4)))
    setMinCreditStr(String(next))
  }

  // ── Min P(max profit) ──────────────────────────────────────────────────────
  const minPProfitValid = (() => { const s = minPProfitStr.trim(); const n = Number(s); return s !== '' && Number.isInteger(n) && n >= 1 && n <= 99 })()
  function onMinPProfitChange(e) {
    const raw = e.target.value.replace('%', '')
    setMinPProfitStr(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 99) setMinPProfit(parseFloat((n / 100).toFixed(4)))
  }
  function onMinPProfitBlur() {
    const n = Number(minPProfitStr)
    const clamped = !Number.isFinite(n) || minPProfitStr.trim() === '' ? Math.round(minPProfit * 100) : Math.min(99, Math.max(1, Math.round(n)))
    setMinPProfitStr(String(clamped)); setMinPProfit(parseFloat((clamped / 100).toFixed(4)))
  }
  function bumpMinPProfit(delta) {
    const next = Math.min(99, Math.max(1, Math.round(minPProfit * 100) + delta))
    setMinPProfit(parseFloat((next / 100).toFixed(4))); setMinPProfitStr(String(next))
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  async function handleLogout() {
    clearScreenerSession()
    await supabase.auth.signOut()
    navigate('/login')
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab} plan={plan} marketOpen={marketOpen} lastRun={lastRun} onLogout={handleLogout}>
      {activeTab !== 'screener' ? (
        <LockedTeaser tab={activeTab} />
      ) : (
        <div className="flex flex-col gap-4 pt-6">
          <ControlsBar
            loading={loading} isStale={isStale} onRun={handleRun}
            tickersRef={tickersRef} tickerInput={tickerInput} setTickerInput={setTickerInput} tickersError={scanInputError}
            onManageWatchlists={() => setManageOpen(o => !o)} manageOpen={manageOpen}
            weeksMin={weeksMin} weeksMax={weeksMax} setWeeksMin={setWeeksMin} setWeeksMax={setWeeksMax}
            minCreditStr={minCreditStr} minCreditValid={minCreditValid} onMinCreditChange={onMinCreditChange} onMinCreditBlur={onMinCreditBlur} bumpMinCredit={bumpMinCredit}
            minPProfitStr={minPProfitStr} minPProfitValid={minPProfitValid} onMinPProfitChange={onMinPProfitChange} onMinPProfitBlur={onMinPProfitBlur} bumpMinPProfit={bumpMinPProfit}
          />

          {manageOpen && (
            <Card className="lc-legacy" padding="p-5">
              <WatchlistManager watchlists={watchlists} onCreate={createWatchlist} onUpdate={updateWatchlist} onDelete={deleteWatchlist} />
            </Card>
          )}

          {tickersUsed.length > 0 && (
            <ScanChips tickers={activeTickers} counts={counts} skipped={tickersSkipped} activeFilter={tickerFilter} onToggle={toggleTickerFilter} onRemove={removeTicker} />
          )}

          {/* Results area — stage 1 placeholder: first-run state, or a count line until the table lands in stage 2. */}
          {!hasResult && !loading && !error ? (
            <FirstRun onExample={t => { setTickerInput(t); tickersRef.current?.focus() }} onManage={() => setManageOpen(true)} />
          ) : (
            <Card>
              <p className="text-lc-ink-2">{loading ? 'Scanning…' : error ? error : `${baseRanked.length} setups ranked from ${totalEvaluated.toLocaleString()} evaluated. Table arrives in the next build step.`}</p>
            </Card>
          )}
        </div>
      )}
    </AppShell>
  )
}

// First-run empty state: what a scan does, example tickers, the watchlist hint. No developer text.
function FirstRun({ onExample, onManage }) {
  return (
    <Card className="max-w-[52rem]" padding="p-8">
      <h2 className="font-display font-bold text-[1.6rem] leading-[1.1] tracking-[-0.02em] text-lc-ink mb-2">Run your first scan</h2>
      <p className="text-lc-ink-2 leading-[1.6] max-w-[60ch] mb-5">
        Type a few tickers above and run the scan. For each one, the screener builds every three-leg credit trade for the next
        1 to 12 weekly expirations, prices each leg at the real bid or ask, and ranks the ones that pay a credit up front.
      </p>
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <span className="text-[0.85rem] font-semibold text-lc-ink-2 mr-1">Try</span>
        {['NVDA, AMD, MU', 'META, AVGO, TSM', 'TSLA, PLTR'].map(ex => (
          <Button key={ex} size="sm" onClick={() => onExample(ex)}>{ex}</Button>
        ))}
      </div>
      <p className="text-[0.9rem] text-lc-ink-2">
        Scan a saved list with <Pill tone="violet" size="sm">@name</Pill> ·{' '}
        <button type="button" onClick={onManage} className="text-lc-violet font-semibold hover:underline">Create a watchlist</button>
      </p>
    </Card>
  )
}
