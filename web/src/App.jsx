import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import './index.css'
import { supabase } from './lib/supabase'
import useAuth from './hooks/useAuth'
import { loadScreenerState, saveScreenerState, clearScreenerSession } from './lib/sessionState'
import { parseTickersUnique, normalizeWatchlistName, validateWatchlistName, resolveScanTickers } from './lib/watchlists'
import useOptionsData from './hooks/useOptionsData'

import AppShell         from './components/lc/AppShell'
import LockedTeaser     from './components/lc/LockedTeaser'
import ControlsBar      from './components/lc/ControlsBar'
import ScanChips        from './components/lc/ScanChips'
import RankedTable      from './components/lc/RankedTable'
import SetupPanel       from './components/lc/SetupPanel'
import WatchlistManager from './components/WatchlistManager'
import { Card, Button, Pill, XIcon } from './components/lc/ui'
import { ProgressStrip, ErrorStrip, MarketClosedBanner, NoResults, FilteredEmpty } from './components/lc/States'
import { expiryInfo, rowKey, creditShareOfMax, rocOf, zeroReasonText } from './components/lc/format'

// ── Screener (/app) — rebuilt on the v1 design system (DESIGN.md). ──────────
// Shell (b), controls (c), chips (d), ranked table (e), detail panel (f) and
// the non-happy states (g). The scan API, scoring, watchlists, and session
// persistence are unchanged.
export default function App() {
  const navigate = useNavigate()
  const { user, plan } = useAuth()

  const persisted = useMemo(() => loadScreenerState() ?? {}, [])

  // ── Controls (persisted) ───────────────────────────────────────────────────
  const [tickerInput,    setTickerInputRaw] = useState(persisted.tickerInput ?? '')
  const [scanInputError, setScanInputError] = useState(null)
  const setTickerInput = v => { setTickerInputRaw(v); setScanInputError(null) }
  const [activeTickers, setActiveTickers] = useState(persisted.activeTickers ?? [])
  const [weeksMin,      setWeeksMin]      = useState(persisted.weeksMin ?? 1)
  const [weeksMax,      setWeeksMax]      = useState(persisted.weeksMax ?? 12)
  // minPremium stays PER SHARE (the API's unit). The UI shows $ per contract.
  const [minPremium,    setMinPremium]    = useState(persisted.minPremium ?? 1.00)   // $100 per contract: the friction floor
  const [minCreditStr,  setMinCreditStr]  = useState(persisted.minCreditStr ?? String(Math.round((persisted.minPremium ?? 1.00) * 100)))
  // Minimum return on collateral (credit ÷ the cash the put ties up), applied client-side. Default 1%.
  const [minRoc,        setMinRoc]        = useState(persisted.minRoc ?? 0.01)
  const [minRocStr,     setMinRocStr]     = useState(persisted.minRocStr ?? '1')
  const [grouped,       setGrouped]       = useState(persisted.grouped ?? true)
  const [minPProfit,    setMinPProfit]    = useState(persisted.minPProfit ?? 0.50)
  const [minPProfitStr, setMinPProfitStr] = useState(persisted.minPProfitStr ?? '50')
  const [tickerFilter,  setTickerFilter]  = useState(persisted.tickerFilter ?? null)
  // Sort override: null = the scanner's order. Persists across rescans of the
  // same scan context; a fresh context resets it (see below).
  const [sort,        setSort]        = useState(persisted.sort ?? null)
  const [sortCtx,     setSortCtx]     = useState(persisted.sortCtx ?? null)
  const [selectedKey, setSelectedKey] = useState(persisted.selectedKey ?? null)
  // Rows already saved this session (by result_id, else rowKey): Save becomes idempotent.
  const [savedKeys,   setSavedKeys]   = useState(() => new Set(persisted.savedKeys ?? []))

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
    marketOpen, lastRun, ranked, macroEvents, tickersUsed, tickersSkipped, tickerReasons,
    weeksMinUsed, weeksMaxUsed, minPremiumUsed, minPProfitUsed,
    totalEvaluated, hasResult, scanId, loading, error, runScan,
  } = useOptionsData()

  // A new scan result re-seeds the chips, resets the selection, and resets the
  // sort override when the scan context (tickers + thresholds) changed. State
  // is adjusted during render (React's pattern); hydration is a no-op.
  const scanCtx = hasResult ? JSON.stringify([tickersUsed, weeksMinUsed, weeksMaxUsed, minPremiumUsed, minPProfitUsed, minRoc]) : null
  const [seenRanked, setSeenRanked] = useState(ranked)
  if (ranked !== seenRanked) {
    setSeenRanked(ranked)
    setActiveTickers(tickersUsed)
    setTickerFilter(null)
    setSelectedKey(null)
    if (scanCtx !== sortCtx) { setSort(null); setSortCtx(scanCtx) }
  }

  useEffect(() => {
    saveScreenerState({ tickerInput, activeTickers, weeksMin, weeksMax, minPremium, minCreditStr, minRoc, minRocStr, grouped, minPProfit, minPProfitStr, tickerFilter, sort, sortCtx, selectedKey, savedKeys: [...savedKeys] })
  }, [tickerInput, activeTickers, weeksMin, weeksMax, minPremium, minCreditStr, minRoc, minRocStr, grouped, minPProfit, minPProfitStr, tickerFilter, sort, sortCtx, selectedKey, savedKeys])

  // ── Derived rows ───────────────────────────────────────────────────────────
  // The return-on-collateral floor is applied here (the API keeps its own
  // filters and scoring untouched). `rank` = position in the scanner's order
  // after the ROC floor; chip filters never re-rank.
  const rocRanked = useMemo(() => ranked.filter(r => rocOf(r) >= minRoc - 1e-9).map((r, i) => ({ ...r, rank: i + 1 })), [ranked, minRoc])
  const baseRanked = rocRanked.filter(r => activeTickers.includes(r.ticker))
  const tableRows  = tickerFilter ? baseRanked.filter(r => r.ticker === tickerFilter) : baseRanked
  const counts = useMemo(() => {
    const m = {}
    for (const r of rocRanked) m[r.ticker] = (m[r.ticker] ?? 0) + 1
    return m
  }, [rocRanked])
  // Why a ticker shows zero: the scanner's reason, or the client-side return floor.
  const reasons = useMemo(() => {
    const apiCounts = {}
    for (const r of ranked) apiCounts[r.ticker] = (apiCounts[r.ticker] ?? 0) + 1
    const ctx = { minCredit: Math.round((minPremiumUsed ?? minPremium) * 100), minRocPct: +(minRoc * 100).toFixed(2), minPPct: Math.round((minPProfitUsed ?? minPProfit) * 100) }
    const out = {}
    for (const t of tickersUsed) {
      if ((counts[t] ?? 0) > 0) continue
      out[t] = (apiCounts[t] ?? 0) > 0 ? zeroReasonText('roc', ctx) : zeroReasonText(tickerReasons?.[t], ctx)
    }
    return out
  }, [ranked, counts, tickersUsed, tickerReasons, minPremiumUsed, minPremium, minRoc, minPProfitUsed, minPProfit])
  const displayed = tableRows.find(r => rowKey(r) === selectedKey) ?? tableRows[0] ?? null
  const displayedKey = displayed ? rowKey(displayed) : null

  // Macro events (FOMC / CPI / PPI / NFP) dated before a setup's expiration, shown
  // in the detail panel head. They are scan-wide, not per-row, so the table does
  // not carry them. Per-ticker earnings flags are not in the API's row shape; a follow-up.
  const macroList = useMemo(() => parseMacro(macroEvents), [macroEvents])
  const flagsFor = useCallback(r => {
    const exp = new Date(r.expiration + 'T00:00:00')
    return macroList.filter(ev => ev.date <= exp).map(ev => `${ev.name} ${ev.label}`)
  }, [macroList])

  // ── Staleness ──────────────────────────────────────────────────────────────
  const resolvedStale = resolveScanTickers(tickerInput, watchlists)
  const isStale = hasResult && (
    (weeksMinUsed   !== null && weeksMin   !== weeksMinUsed)   ||
    (weeksMaxUsed   !== null && weeksMax   !== weeksMaxUsed)   ||
    (minPremiumUsed !== null && minPremium !== minPremiumUsed) ||
    (minPProfitUsed !== null && minPProfit !== minPProfitUsed) ||
    (!resolvedStale.error && resolvedStale.tickers.some(t => !tickersUsed.includes(t)))
  )

  // ── Field validity (gates every run path, including ⌘Enter) ───────────────
  const minCreditValid  = (() => { const s = minCreditStr.trim();  const n = Number(s); return s !== '' && Number.isFinite(n) && n >= 0 })()
  const minPProfitValid = (() => { const s = minPProfitStr.trim(); const n = Number(s); return s !== '' && Number.isInteger(n) && n >= 1 && n <= 99 })()
  const minRocValid = (() => { const s = minRocStr.trim(); const n = Number(s); return s !== '' && Number.isFinite(n) && n >= 0 })()
  const canRun = minCreditValid && minPProfitValid && minRocValid

  // ── Run scan ───────────────────────────────────────────────────────────────
  const [lastRunTickers, setLastRunTickers] = useState([])
  const [dismissedError, setDismissedError] = useState(null)
  const runWith = useCallback((overrides = {}) => {
    if (loading || !canRun) return
    const { tickers, error: resolveErr } = resolveScanTickers(tickerInput, watchlists)
    if (resolveErr) { setScanInputError(resolveErr); return }
    if (tickers.length === 0) { setScanInputError('Enter one or more tickers, or a @watchlist, then run the scan.'); tickersRef.current?.focus(); return }
    setScanInputError(null)
    setDismissedError(null)
    setActiveTab('screener')
    setLastRunTickers(tickers)
    runScan({ tickers, weeksMin, weeksMax, minPremium, minPProfit, ...overrides })
  }, [loading, canRun, tickerInput, watchlists, weeksMin, weeksMax, minPremium, minPProfit, runScan])
  const handleRun = useCallback(() => runWith(), [runWith])

  // No-results actions: apply the lower threshold to the controls AND rerun with it.
  function lowerCreditAndRerun() { setMinPremium(0.50); setMinCreditStr('50'); runWith({ minPremium: 0.50 }) }
  function lowerPAndRerun()      { setMinPProfit(0.40); setMinPProfitStr('40'); runWith({ minPProfit: 0.40 }) }
  const showError = !!error && error !== dismissedError

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
  function toggleTickerFilter(t) { setSelectedKey(null); setTickerFilter(prev => (prev === t ? null : t)) }
  function removeTicker(t) {
    setActiveTickers(prev => prev.filter(x => x !== t))
    setTickerFilter(prev => (prev === t ? null : prev))
    if (displayed?.ticker === t) setSelectedKey(null)
  }

  // ── Min credit ($ per contract in the UI; per share for the API) ──────────
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

  // ── Min return on collateral (client-side; live) ──────────────────────────
  function onMinRocChange(e) {
    const raw = e.target.value.replace('%', '')
    setMinRocStr(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n) && n >= 0) setMinRoc(parseFloat((n / 100).toFixed(6)))
  }
  function onMinRocBlur() {
    const n = Number(minRocStr)
    if (!Number.isFinite(n) || n < 0 || minRocStr.trim() === '') setMinRocStr(String(+(minRoc * 100).toFixed(2)))
    else setMinRocStr(String(+n.toFixed(2)))
  }
  function bumpMinRoc(delta) {
    const next = Math.max(0, +((minRoc * 100) + delta).toFixed(2))
    setMinRoc(parseFloat((next / 100).toFixed(6))); setMinRocStr(String(next))
  }

  // ── Min P(max profit) ──────────────────────────────────────────────────────
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

  // ── Save to Tradebook (double-insert-safe) + toast ────────────────────────
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [toast,     setToast]     = useState(null)   // { text, href } | null
  const toastTimer = useRef(null)
  function showToast(text, href) {
    clearTimeout(toastTimer.current)
    setToast({ text, href })
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const saveKeyOf = row => row.result_id ?? rowKey(row)
  async function saveToTradebook(row) {
    if (!user || saving || savedKeys.has(saveKeyOf(row))) return
    setSaving(true); setSaveError(null)
    const trade = {
      ticker: row.ticker, expiration: row.expiration, saved_at: new Date().toISOString(),
      leg_a_strike: row.leg_a_strike, leg_a_premium: row.leg_a_prem, leg_a_delta: row.leg_a_delta,
      leg_b_strike: row.leg_b_strike, leg_b_premium: row.leg_b_prem, leg_b_delta: row.leg_b_delta,
      leg_c_strike: row.leg_c_strike, leg_c_premium: row.leg_c_prem, leg_c_delta: row.leg_c_delta,
      net_premium: row.net_premium, spread_width: row.spread_width, score: row.score, p_max_profit: row.p_max_profit,
    }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
      const res  = await fetch('/api/tradebook/save', { method: 'POST', headers, body: JSON.stringify({ scan_id: scanId, result_id: row.result_id ?? null, trade }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setSaveError(`Couldn’t save this trade (${data.error || res.status}). Nothing was written; try again.`); return }
      setSavedKeys(prev => new Set(prev).add(saveKeyOf(row)))
      showToast(`Saved ${row.ticker} ${expiryInfo(row.expiration).short} · ${row.leg_c_strike} / ${row.leg_a_strike} / ${row.leg_b_strike} to your Tradebook.`, '/tradebook')
    } catch (e) {
      setSaveError(`Couldn’t reach the server to save (${e.message}). Nothing was written; try again.`)
    } finally {
      setSaving(false)
    }
  }
  function handleEdit(row) { navigate('/trade', { state: { triplet: row, scan_id: scanId } }) }

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
            loading={loading} isStale={isStale} onRun={handleRun} canRun={canRun}
            tickersRef={tickersRef} tickerInput={tickerInput} setTickerInput={setTickerInput} tickersError={scanInputError}
            onManageWatchlists={() => setManageOpen(o => !o)} manageOpen={manageOpen}
            weeksMin={weeksMin} weeksMax={weeksMax} setWeeksMin={setWeeksMin} setWeeksMax={setWeeksMax}
            minCreditStr={minCreditStr} minCreditValid={minCreditValid} onMinCreditChange={onMinCreditChange} onMinCreditBlur={onMinCreditBlur} bumpMinCredit={bumpMinCredit}
            minRocStr={minRocStr} minRocValid={minRocValid} onMinRocChange={onMinRocChange} onMinRocBlur={onMinRocBlur} bumpMinRoc={bumpMinRoc}
            minPProfitStr={minPProfitStr} minPProfitValid={minPProfitValid} onMinPProfitChange={onMinPProfitChange} onMinPProfitBlur={onMinPProfitBlur} bumpMinPProfit={bumpMinPProfit}
          />

          {manageOpen && (
            <Card className="lc-legacy" padding="p-5">
              <WatchlistManager watchlists={watchlists} onCreate={createWatchlist} onUpdate={updateWatchlist} onDelete={deleteWatchlist} />
            </Card>
          )}

          {tickersUsed.length > 0 && (
            <ScanChips tickers={activeTickers} counts={counts} reasons={reasons} skipped={tickersSkipped} activeFilter={tickerFilter} onToggle={toggleTickerFilter} onRemove={removeTicker} />
          )}

          {loading && <ProgressStrip tickerCount={lastRunTickers.length} />}
          {showError && <ErrorStrip message={error} hadResults={hasResult} onRetry={handleRun} onDismiss={() => setDismissedError(error)} />}
          {hasResult && marketOpen === false && <MarketClosedBanner />}

          {!hasResult ? (
            !loading && <FirstRun onExample={t => { setTickerInput(t); tickersRef.current?.focus() }} onManage={() => setManageOpen(true)} />
          ) : tableRows.length === 0 && rocRanked.length > 0 ? (
            <FilteredEmpty ticker={tickerFilter ?? (activeTickers.length === 0 ? 'the tickers you removed' : activeTickers.join(', '))} onShowAll={() => { setTickerFilter(null); setActiveTickers(tickersUsed) }} />
          ) : tableRows.length > 0 ? (
            <div className="grid grid-cols-[minmax(0,60fr)_minmax(0,40fr)] gap-4 items-start">
              <div className="min-w-0 max-h-[calc(100vh-14rem)] min-h-[28rem] flex flex-col">
                <RankedTable
                  key={scanCtx}
                  rows={tableRows}
                  sort={sort} onSort={setSort} onResetSort={() => setSort(null)}
                  grouped={grouped} onToggleGrouped={() => setGrouped(g => !g)}
                  selectedKey={displayedKey} onSelect={r => setSelectedKey(rowKey(r))} onOpen={handleEdit}
                  metric={creditShareOfMax} metricLabel="Credit as a share of max profit"
                  totalEvaluated={totalEvaluated} dimmed={loading}
                />
              </div>
              <div className="min-w-0">
                <SetupPanel row={displayed} flags={displayed ? flagsFor(displayed) : []} onSave={saveToTradebook} saving={saving} saved={displayed ? savedKeys.has(saveKeyOf(displayed)) : false} onViewTradebook={() => navigate('/tradebook')} saveError={saveError} onEdit={handleEdit} dimmed={loading} />
              </div>
            </div>
          ) : (
            <NoResults
              tickersUsed={tickersUsed} tickersSkipped={tickersSkipped} marketOpen={marketOpen} reasons={reasons}
              minCredit={Math.round((minPremiumUsed ?? minPremium) * 100)} minPP={minPProfitUsed ?? minPProfit} minRocPct={+(minRoc * 100).toFixed(2)}
              onLowerRoc={() => { setMinRoc(0); setMinRocStr('0') }}
              onLowerCredit={lowerCreditAndRerun} onLowerP={lowerPAndRerun} onFocusTickers={() => { tickersRef.current?.focus(); tickersRef.current?.select() }}
            />
          )}
        </div>
      )}

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50 bg-lc-card rounded-lc shadow-lc-lift px-5 py-4 max-w-sm flex items-start gap-3">
          <div className="flex flex-col gap-1 text-[0.95rem]">
            <span className="text-lc-ink">{toast.text}</span>
            {toast.href && <button type="button" onClick={() => navigate(toast.href)} className="text-left font-semibold text-lc-violet hover:underline">View Tradebook</button>}
          </div>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-lc-ink-3 hover:text-lc-ink mt-0.5"><XIcon /></button>
        </div>
      )}
    </AppShell>
  )
}

// "NFP 4/3  |  CPI 4/10" → [{ name: 'NFP', label: '4/3', date }]. Dates without a year
// are placed in the current year, or the next one if that would be in the past.
function parseMacro(s) {
  if (!s || typeof s !== 'string' || /None/i.test(s)) return []
  const now = new Date()
  return s.split('|').map(p => p.trim()).filter(Boolean).map(p => {
    const m = /^([A-Z]+)\s+(\d{1,2})\/(\d{1,2})$/.exec(p)
    if (!m) return null
    let date = new Date(now.getFullYear(), Number(m[2]) - 1, Number(m[3]))
    if (date < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)) date = new Date(now.getFullYear() + 1, Number(m[2]) - 1, Number(m[3]))
    return { name: m[1], label: `${m[2]}/${m[3]}`, date }
  }).filter(Boolean)
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
