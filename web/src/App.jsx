import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import './index.css'
import { supabase } from './lib/supabase'
import useAuth from './hooks/useAuth'
import { loadScreenerState, saveScreenerState, clearScreenerSession } from './lib/sessionState'
import { parseTickersUnique, normalizeWatchlistName, validateWatchlistName, resolveScanTickers } from './lib/watchlists'
import useOptionsData from './hooks/useOptionsData'

import AppShell         from './components/lc/AppShell'
import ControlsBar      from './components/lc/ControlsBar'
import ScanChips        from './components/lc/ScanChips'
import RelaxedGroup     from './components/lc/RelaxedGroup'
import RankedTable      from './components/lc/RankedTable'
import SetupPanel       from './components/lc/SetupPanel'
import WatchlistManager from './components/WatchlistManager'
import { Card, Button, Pill, XIcon } from './components/lc/ui'
import { ProgressStrip, ErrorStrip, MarketClosedBanner, NoResults, FilteredEmpty } from './components/lc/States'
import { expiryInfo, rowKey, creditShareOfMax, rocOf, zeroReasonText, zeroReasonDetail, upsidePerCollateral } from './components/lc/format'

// ── Screener (/app) — rebuilt on the v1 design system (DESIGN.md). ──────────
// Shell (b), controls (c), chips (d), ranked table (e), detail panel (f) and
// the non-happy states (g). The scan API, scoring, watchlists, and session
// persistence are unchanged.
export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, plan } = useAuth()

  const persisted = useMemo(() => loadScreenerState() ?? {}, [])

  // ── Controls (persisted) ───────────────────────────────────────────────────
  const [tickerInput,    setTickerInputRaw] = useState(persisted.tickerInput ?? '')
  const [scanInputError, setScanInputError] = useState(null)
  const setTickerInput = v => { setTickerInputRaw(v); setScanInputError(null) }
  const [activeTickers, setActiveTickers] = useState(persisted.activeTickers ?? [])
  const [weeksMin,      setWeeksMin]      = useState(persisted.weeksMin ?? 1)
  const [weeksMax,      setWeeksMax]      = useState(persisted.weeksMax ?? 12)
  // Screener mode: Income (the validated scan) or Upside (a calculator). Each mode keeps its own credit floor.
  const [mode, setModeRaw] = useState(persisted.mode === 'upside' ? 'upside' : 'income')
  // minPremium stays PER SHARE (the API's unit). The UI shows $ per contract. Income: $100 (the friction floor); Upside: $0 (must still be a credit).
  const [creditByMode, setCreditByMode] = useState(persisted.creditByMode ?? { income: { v: persisted.minPremium ?? 1.00, str: persisted.minCreditStr ?? String(Math.round((persisted.minPremium ?? 1.00) * 100)) }, upside: { v: 0, str: '0' } })
  const minPremium = creditByMode[mode].v, minCreditStr = creditByMode[mode].str
  const setMinPremium   = v   => setCreditByMode(p => ({ ...p, [mode]: { ...p[mode], v } }))
  const setMinCreditStr = str => setCreditByMode(p => ({ ...p, [mode]: { ...p[mode], str } }))
  // Upside only: the floor on max profit ÷ collateral (a request parameter; rescan to apply). Default 5%.
  const [minUpside,     setMinUpside]     = useState(persisted.minUpside ?? 0.05)
  const [minUpsideStr,  setMinUpsideStr]  = useState(persisted.minUpsideStr ?? '5')
  // Minimum return on collateral (credit ÷ the cash the put ties up), applied client-side. Default 1%.
  const [minRoc,        setMinRoc]        = useState(persisted.minRoc ?? 0.01)
  const [minRocStr,     setMinRocStr]     = useState(persisted.minRocStr ?? '1')
  const [grouped,       setGrouped]       = useState(persisted.grouped ?? true)
  // The scanner's probability gate — (1 − δ_B)(1 − δ_C) ≥ 50% — is a strategy term, not a user control:
  // Income requests carry it unchanged; Upside (a calculator) sends it off. The gauge is the probability view.
  const MIN_P_PROFIT = 0.50
  const [tickerFilter,  setTickerFilter]  = useState(persisted.tickerFilter ?? null)
  // Sort override: null = the scanner's order. Persists across rescans of the
  // same scan context; a fresh context resets it (see below).
  const [sort,        setSort]        = useState(persisted.sort ?? null)
  const [sortCtx,     setSortCtx]     = useState(persisted.sortCtx ?? null)
  const [selectedKey, setSelectedKey] = useState(persisted.selectedKey ?? null)
  const [relaxedView, setRelaxedView] = useState(persisted.relaxedView ?? { ctx: null, ticker: null })   // the results zone's view: one ticker's thin-quote setups in place of the ranked list (Upside, display-only); persisted with its scan context so a trip to the editor comes back to it
  const [relaxedSel, setRelaxedSel] = useState(persisted.relaxedSel ?? {})   // ticker -> selected Tier 1 row key
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
    marketOpen, lastRun, ranked, macroEvents, tickersUsed, tickersSkipped, tickerReasons, relaxed, ladder,
    weeksMinUsed, weeksMaxUsed, minPremiumUsed, minPProfitUsed, minUpsideUsed, otherResult,
    totalEvaluated, hasResult, scanId, loading, error, runScan,
  } = useOptionsData(mode)
  function setMode(next) { if (next === mode || loading) return; setModeRaw(next); setSelectedKey(null); setTickerFilter(null) }

  // A new scan result re-seeds the chips, resets the selection, and resets the
  // sort override when the scan context (tickers + thresholds) changed. State
  // is adjusted during render (React's pattern); hydration is a no-op.
  const scanCtx = hasResult ? JSON.stringify([mode, tickersUsed, weeksMinUsed, weeksMaxUsed, minPremiumUsed, minPProfitUsed, minUpsideUsed]) : null
  const [seenRanked, setSeenRanked] = useState(ranked)
  if (ranked !== seenRanked) {
    setSeenRanked(ranked)
    setActiveTickers(tickersUsed)
    setTickerFilter(null)
    setSelectedKey(null)
    if (scanCtx !== sortCtx) { setSort(null); setSortCtx(scanCtx) }
  }

  useEffect(() => {
    saveScreenerState({ tickerInput, activeTickers, weeksMin, weeksMax, mode, creditByMode, minUpside, minUpsideStr, minRoc, minRocStr, grouped, tickerFilter, sort, sortCtx, selectedKey, savedKeys: [...savedKeys], relaxedView, relaxedSel })
  }, [tickerInput, activeTickers, weeksMin, weeksMax, mode, creditByMode, minUpside, minUpsideStr, minRoc, minRocStr, grouped, tickerFilter, sort, sortCtx, selectedKey, savedKeys, relaxedView, relaxedSel])

  // ── Derived rows ───────────────────────────────────────────────────────────
  // The return-on-collateral floor is applied here (the API keeps its own
  // filters and scoring untouched). `rank` = position in the scanner's order
  // after the ROC floor; chip filters never re-rank.
  // Income only: the return floor. Upside results come back already gated server-side.
  // Upside is a calculator: its default order is the metric it shows (max profit ÷ collateral), not the scanner's score.
  const rocRanked = useMemo(() => (mode === 'income' ? ranked.filter(r => rocOf(r) >= minRoc - 1e-9) : [...ranked].sort((a, b) => upsidePerCollateral(b) - upsidePerCollateral(a))).map((r, i) => ({ ...r, rank: i + 1 })), [ranked, minRoc, mode])
  const baseRanked = rocRanked.filter(r => activeTickers.includes(r.ticker))
  const tableRows  = tickerFilter ? baseRanked.filter(r => r.ticker === tickerFilter) : baseRanked
  const counts = useMemo(() => {
    const m = {}
    for (const r of rocRanked) m[r.ticker] = (m[r.ticker] ?? 0) + 1
    return m
  }, [rocRanked])
  // Why a ticker shows zero: the scanner's reason, or the client-side return floor.
  const { reasons, reasonCodes, reasonDetails } = useMemo(() => {
    const apiCounts = {}
    for (const r of ranked) apiCounts[r.ticker] = (apiCounts[r.ticker] ?? 0) + 1
    const ctx = { minCredit: Math.round((minPremiumUsed ?? minPremium) * 100), minRocPct: +(minRoc * 100).toFixed(2), minPPct: Math.round((minPProfitUsed ?? MIN_P_PROFIT) * 100), minUpsidePct: +(((minUpsideUsed ?? minUpside) * 100).toFixed(2)) }
    const reasons = {}, reasonCodes = {}, reasonDetails = {}
    for (const t of tickersUsed) {
      if ((counts[t] ?? 0) > 0) continue
      const fromRoc = (apiCounts[t] ?? 0) > 0
      reasonCodes[t] = fromRoc ? 'roc' : (tickerReasons?.[t]?.code ?? tickerReasons?.[t] ?? null)
      reasons[t] = fromRoc ? zeroReasonText('roc', ctx) : zeroReasonText(tickerReasons?.[t], ctx)
      reasonDetails[t] = fromRoc ? null : zeroReasonDetail(tickerReasons?.[t], relaxed?.[t])
    }
    return { reasons, reasonCodes, reasonDetails }
  }, [ranked, counts, tickersUsed, tickerReasons, relaxed, minPremiumUsed, minPremium, minRoc, minPProfitUsed, minUpsideUsed, minUpside])
  // Thin-quote (Tier 1) groups: Upside only, per-ticker opt-in from the chip, shown under the ranked list.
  const relaxedAvailable = useMemo(() => {
    const out = {}
    if (mode !== 'upside' || !relaxed) return out
    for (const t of tickersUsed) if ((counts[t] ?? 0) === 0 && (relaxed[t]?.rows?.length ?? 0) > 0) out[t] = relaxed[t].rows.length
    return out
  }, [mode, relaxed, tickersUsed, counts])
  // One view at a time: the ranked setups, or one ticker's thin-quote setups in their place.
  const relaxedTicker = relaxedView.ctx === scanCtx && relaxedAvailable[relaxedView.ticker] ? relaxedView.ticker : null
  function toggleRelaxed(t) { setRelaxedView(prev => ({ ctx: scanCtx, ticker: prev.ctx === scanCtx && prev.ticker === t ? null : t })) }
  function handleView(row) { navigate('/trade', { state: { triplet: { ...row, mode: 'upside' }, scan_id: null, source: { id: null, status: 'relaxed' }, from: 'screener' } }) }
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
    (mode === 'upside' && minUpsideUsed !== null && minUpside !== minUpsideUsed) ||
    (!resolvedStale.error && resolvedStale.tickers.some(t => !tickersUsed.includes(t)))
  )

  // ── Field validity (gates every run path, including ⌘Enter) ───────────────
  // Income: a credit floor, ≥ 0. Upside: any number — a negative floor admits net-debit structures (owner, 2026-09-17).
  const minCreditValid  = (() => { const s = minCreditStr.trim();  const n = Number(s); return s !== '' && Number.isFinite(n) && (n >= 0 || mode === 'upside') })()
  const minRocValid = (() => { const s = minRocStr.trim(); const n = Number(s); return s !== '' && Number.isFinite(n) && n >= 0 })()
  const minUpsideValid = (() => { const s = minUpsideStr.trim(); const n = Number(s); return s !== '' && Number.isFinite(n) && n >= 0 && n <= 500 })()
  const canRun = minCreditValid && (mode === 'income' ? minRocValid : minUpsideValid)

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
    // Upside is a calculator: the probability gate is off (0); the gauge still shows every chance per setup.
    runScan({ tickers, weeksMin, weeksMax, minPremium, minPProfit: mode === 'upside' ? 0 : MIN_P_PROFIT, mode, minUpside, minRoc: mode === 'income' ? minRoc : undefined, ...overrides })
  }, [loading, canRun, tickerInput, watchlists, weeksMin, weeksMax, minPremium, mode, minUpside, minRoc, runScan])
  const handleRun = useCallback(() => runWith(), [runWith])

  // No-results actions: apply the lower threshold to the controls AND rerun with it.
  const showError = !!error && error !== dismissedError

  // A "Rerun this scan" from the Tradebook arrives as router state: prefill the
  // controls from that scan's inputs and run once, then clear the state.
  const rerun = location.state?.rerun
  useEffect(() => {
    if (!rerun || !Array.isArray(rerun.tickers) || rerun.tickers.length === 0) return
    const tickers = rerun.tickers.map(t => String(t).toUpperCase())
    setTickerInputRaw(tickers.join(', '))
    if (Number.isFinite(rerun.weeksMin)) setWeeksMin(rerun.weeksMin)
    if (Number.isFinite(rerun.weeksMax)) setWeeksMax(rerun.weeksMax)
    if (Number.isFinite(rerun.minPremium)) { setMinPremium(rerun.minPremium); setMinCreditStr(String(Math.round(rerun.minPremium * 100))) }
    const runMode = rerun.mode === 'upside' ? 'upside' : 'income'
    if (runMode !== mode) setModeRaw(runMode)
    setActiveTab('screener'); setLastRunTickers(tickers); setDismissedError(null)
    runScan({ tickers, weeksMin: rerun.weeksMin ?? weeksMin, weeksMax: rerun.weeksMax ?? weeksMax, minPremium: rerun.minPremium ?? minPremium, minPProfit: runMode === 'upside' ? 0 : MIN_P_PROFIT, mode: runMode, minUpside, minRoc: runMode === 'income' ? minRoc : undefined })
    navigate(location.pathname, { replace: true, state: null })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerun])

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
    const raw = e.target.value.replace(/[$,]/g, '').replace(/[−–]/g, '-')
    setMinCreditStr(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n) && (n >= 0 || mode === 'upside')) setMinPremium(parseFloat((n / 100).toFixed(4)))
  }
  function onMinCreditBlur() {
    const n = Number(minCreditStr)
    if (!Number.isFinite(n) || (n < 0 && mode !== 'upside') || minCreditStr.trim() === '') setMinCreditStr(String(Math.round(minPremium * 100)))
    else setMinCreditStr(String(Math.round(n)))
  }
  function bumpMinCredit(delta) {
    const next = mode === 'upside' ? Math.round(minPremium * 100) + delta : Math.max(0, Math.round(minPremium * 100) + delta)
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

  // ── Min upside per $ of collateral (Upside mode; a request parameter) ─────
  function onMinUpsideChange(e) {
    const raw = e.target.value.replace('%', '')
    setMinUpsideStr(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 500) setMinUpside(parseFloat((n / 100).toFixed(6)))
  }
  function onMinUpsideBlur() {
    const n = Number(minUpsideStr)
    if (!Number.isFinite(n) || n < 0 || minUpsideStr.trim() === '') setMinUpsideStr(String(+(minUpside * 100).toFixed(2)))
    else setMinUpsideStr(String(+Math.min(500, n).toFixed(2)))
  }
  function bumpMinUpside(delta) {
    const next = Math.min(500, Math.max(0, +((minUpside * 100) + delta).toFixed(2)))
    setMinUpside(parseFloat((next / 100).toFixed(6))); setMinUpsideStr(String(next))
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
      mode: row.mode ?? mode,   // an Upside save must not sit in the ledger looking like an income trade
    }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
      const res  = await fetch('/api/tradebook/save', { method: 'POST', headers, body: JSON.stringify({ scan_id: scanId, result_id: row.result_id ?? null, trade }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Never render a server internals blob; a plain sentence or the status.
        const why = typeof data.error === 'string' && !/[{}]/.test(data.error) ? data.error : `the Tradebook rejected it (${res.status})`
        setSaveError(`Couldn’t save this trade: ${why} Nothing was written.`)
        return
      }
      setSavedKeys(prev => new Set(prev).add(saveKeyOf(row)))
      showToast(`Saved ${row.ticker} ${expiryInfo(row.expiration).short} · ${row.leg_c_strike} / ${row.leg_a_strike} / ${row.leg_b_strike} to your Tradebook.`, '/tradebook')
    } catch (e) {
      setSaveError(`Couldn’t reach the server to save (${e.message}). Nothing was written; try again.`)
    } finally {
      setSaving(false)
    }
  }
  function handleEdit(row) { navigate('/trade', { state: { triplet: { ...row, mode: row.mode ?? mode }, scan_id: scanId, from: 'screener' } }) }

  // ── Logout ─────────────────────────────────────────────────────────────────
  async function handleLogout() {
    clearScreenerSession()
    try { sessionStorage.setItem('luo-logged-out', '1') } catch { /* private mode */ }
    await supabase.auth.signOut()
    navigate('/login', { replace: true, state: { loggedOut: true } })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab} plan={plan} marketOpen={marketOpen} lastRun={lastRun} onLogout={handleLogout}>
      {(
        <div className="flex flex-col gap-4 pt-6">
          <ControlsBar
            loading={loading} isStale={isStale} onRun={handleRun} canRun={canRun}
            mode={mode} onModeChange={setMode}
            minUpsideStr={minUpsideStr} minUpsideValid={minUpsideValid} onMinUpsideChange={onMinUpsideChange} onMinUpsideBlur={onMinUpsideBlur} bumpMinUpside={bumpMinUpside}
            tickersRef={tickersRef} tickerInput={tickerInput} setTickerInput={setTickerInput} tickersError={scanInputError}
            onManageWatchlists={() => setManageOpen(o => !o)} manageOpen={manageOpen}
            weeksMin={weeksMin} weeksMax={weeksMax} setWeeksMin={setWeeksMin} setWeeksMax={setWeeksMax}
            minCreditStr={minCreditStr} minCreditValid={minCreditValid} onMinCreditChange={onMinCreditChange} onMinCreditBlur={onMinCreditBlur} bumpMinCredit={bumpMinCredit}
            minRocStr={minRocStr} minRocValid={minRocValid} onMinRocChange={onMinRocChange} onMinRocBlur={onMinRocBlur} bumpMinRoc={bumpMinRoc}
          />

          {manageOpen && (
            <Card className="lc-legacy" padding="p-5">
              <WatchlistManager watchlists={watchlists} onCreate={createWatchlist} onUpdate={updateWatchlist} onDelete={deleteWatchlist} />
            </Card>
          )}

          {tickersUsed.length > 0 && (
            <ScanChips tickers={activeTickers} counts={counts} reasons={reasons} details={reasonDetails} skipped={tickersSkipped} activeFilter={tickerFilter} onToggle={toggleTickerFilter} onRemove={removeTicker}
              relaxedAvailable={relaxedAvailable} relaxedOpen={relaxedTicker ? [relaxedTicker] : []} onToggleRelaxed={toggleRelaxed} />
          )}

          {loading && <ProgressStrip tickerCount={lastRunTickers.length} />}
          {showError && <ErrorStrip message={error} hadResults={hasResult} onRetry={handleRun} onDismiss={() => setDismissedError(error)} />}
          {hasResult && marketOpen === false && <MarketClosedBanner />}

          {!hasResult ? (
            !loading && <FirstRun mode={mode} otherHasResults={!!otherResult} onExample={t => { setTickerInput(t); tickersRef.current?.focus() }} onManage={() => setManageOpen(true)} />
          ) : tableRows.length === 0 && rocRanked.length > 0 ? (
            <FilteredEmpty ticker={tickerFilter ?? (activeTickers.length === 0 ? 'the tickers you removed' : activeTickers.join(', '))} onShowAll={() => { setTickerFilter(null); setActiveTickers(tickersUsed) }} />
          ) : relaxedTicker ? (
            <RelaxedGroup key={`${scanCtx}:${relaxedTicker}`} ticker={relaxedTicker} group={relaxed[relaxedTicker]} ladder={ladder} scannedAt={lastRun ? String(lastRun).slice(11, 16) : null}
              onView={handleView} onClose={() => toggleRelaxed(relaxedTicker)} dimmed={loading}
              initialKey={relaxedSel[relaxedTicker] ?? null} onSelect={k => setRelaxedSel(prev => ({ ...prev, [relaxedTicker]: k }))} />
          ) : tableRows.length > 0 ? (
            <div className="grid grid-cols-[minmax(0,64fr)_minmax(0,36fr)] gap-4 items-start">
              <div className="min-w-0 max-h-[calc(100vh-14rem)] min-h-[28rem] flex flex-col">
                <RankedTable
                  key={scanCtx}
                  rows={tableRows}
                  sort={sort} onSort={setSort} onResetSort={() => setSort(null)}
                  grouped={grouped} onToggleGrouped={() => setGrouped(g => !g)}
                  selectedKey={displayedKey} onSelect={r => setSelectedKey(rowKey(r))} onOpen={handleEdit}
                  mode={mode}
                  metric={mode === 'upside' ? upsidePerCollateral : creditShareOfMax} metricLabel={mode === 'upside' ? 'Max profit per $ of collateral' : 'Credit as a share of max profit'}
                  totalEvaluated={totalEvaluated} dimmed={loading}
                />
              </div>
              <div className="min-w-0">
                <SetupPanel row={displayed} mode={displayed?.mode ?? mode} flags={displayed ? flagsFor(displayed) : []} onSave={saveToTradebook} saving={saving} saved={displayed ? savedKeys.has(saveKeyOf(displayed)) : false} onViewTradebook={() => navigate('/tradebook')} saveError={saveError} onEdit={handleEdit} dimmed={loading} />
              </div>
            </div>
          ) : (
            <NoResults
              tickersUsed={tickersUsed} tickersSkipped={tickersSkipped} marketOpen={marketOpen} reasons={reasons} reasonCodes={reasonCodes}
              minCredit={Math.round((minPremiumUsed ?? minPremium) * 100)} minRocPct={+(minRoc * 100).toFixed(2)} mode={mode} minUpsidePct={+(((minUpsideUsed ?? minUpside) * 100).toFixed(2))}
              onLowerRoc={() => { setMinRoc(0); setMinRocStr('0') }}
              onFocusTickers={() => { tickersRef.current?.focus(); tickersRef.current?.select() }}
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
function FirstRun({ mode = 'income', otherHasResults = false, onExample, onManage }) {
  const upside = mode === 'upside'
  return (
    <Card className="max-w-[52rem]" padding="p-8">
      <h2 className="font-display font-bold text-[1.6rem] leading-[1.1] tracking-[-0.02em] text-lc-ink mb-2">{upside ? 'Run an Upside scan' : otherHasResults ? 'Run an Income scan' : 'Run your first scan'}</h2>
      <p className="text-lc-ink-2 leading-[1.6] max-w-[60ch] mb-5">
        {upside
          ? 'Type a few tickers above and run the scan. For each one, the screener builds the same three legs with a wide call spread — a small credit or none, most of the payoff in the ramp — and sorts them by max profit per $ of collateral.'
          : 'Type a few tickers above and run the scan. For each one, the screener builds every three-leg credit trade for the next 1 to 12 weekly expirations, prices each leg at the real bid or ask, and ranks the ones that pay a credit up front.'}
        {otherHasResults && <> <span className="text-lc-ink font-semibold">Your {upside ? 'Income' : 'Upside'} results are kept</span> — switch back any time.</>}
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
