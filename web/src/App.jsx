import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import './index.css'
import { supabase } from './lib/supabase'
import useAuth from './hooks/useAuth'
import { loadScreenerState, saveScreenerState, clearScreenerSession } from './lib/sessionState'

import useOptionsData    from './hooks/useOptionsData'
import useChartData      from './hooks/useChartData'
import Header            from './components/Header'
import MacroEvents       from './components/MacroEvents'
import Holdings          from './components/Holdings'
import OverviewCard      from './components/OverviewCard'
import ResultsTable      from './components/ResultsTable'
import SetupDetail       from './components/SetupDetail'
import LoadingSpinner    from './components/LoadingSpinner'
import Toast             from './components/Toast'
import WeeksRangeSlider  from './components/WeeksRangeSlider'
import StockChart        from './components/StockChart'

export default function App() {
  const navigate = useNavigate()
  const { user } = useAuth()

  // Hydrate all controls from sessionStorage (single read on mount). Survives
  // in-session navigation (e.g. screener → /trade → back); cleared on logout
  // or tab close. See web/src/lib/sessionState.js.
  const persisted = useMemo(() => loadScreenerState() ?? {}, [])

  // ── Shared controls ────────────────────────────────────────────────────────
  const [tickerInput, setTickerInput] = useState(persisted.tickerInput ?? '')

  // ── Risk reversal controls ──────────────────────────────────────────────────
  const [activeTickers,   setActiveTickers]   = useState(persisted.activeTickers ?? [])
  const [weeksMin,        setWeeksMin]        = useState(persisted.weeksMin ?? 1)
  const [weeksMax,        setWeeksMax]        = useState(persisted.weeksMax ?? 12)
  const [minPremium,      setMinPremium]      = useState(persisted.minPremium ?? 5.00)
  const [minPProfit,      setMinPProfit]      = useState(persisted.minPProfit ?? 0.50)
  // Raw input strings — let the user type freely (incl. empty, partial decimals)
  const [minPremiumStr,   setMinPremiumStr]   = useState(persisted.minPremiumStr ?? '5.00')
  const [minPProfitStr,   setMinPProfitStr]   = useState(persisted.minPProfitStr ?? '50')

  // ── Detail zone (card-as-filter + per-setup detail) ─────────────────────────
  // `cardFilter` = the ticker an overview card has focused on (null = no filter,
  // table shows the full ranked list); it drives the table filter AND which card
  // gets the accent state. `selectedSetup` = an explicit row override; null means
  // "use the context default" (the filter ticker's best, else the overall
  // rank-1). The chart ticker and selected-row highlight derive from the
  // resulting displayed setup (computed below, once scan data is available).
  const [cardFilter,     setCardFilter]     = useState(persisted.cardFilter ?? null)
  const [selectedSetup,  setSelectedSetup]  = useState(persisted.selectedSetup ?? null)
  const [chartTimeframe, setChartTimeframe] = useState(persisted.chartTimeframe ?? '1M')
  // Fullscreen-within-detail-zone toggle (not persisted — always opens in side panel).
  const [chartFull,      setChartFull]      = useState(false)

  // Clicking a card toggles the single-ticker filter on/off (or switches it),
  // clearing any explicit row override so the detail falls back to that
  // context's default best setup.
  function toggleCardFilter(ticker) {
    setSelectedSetup(null)
    setCardFilter(prev => (prev === ticker ? null : ticker))
  }
  // Clicking a table row picks that specific setup (overrides the default).
  function selectRow(row) {
    setSelectedSetup(row)
  }

  // Macro events band — reference chrome, collapsed by default (not persisted,
  // so it always loads collapsed). Toggled from the 'macro ⌄' control.
  const [macroOpen, setMacroOpen] = useState(false)

  // Horizontal overview strip — ref + helpers for the chevron / wheel scrolling.
  const overviewScrollRef = useRef(null)
  function scrollOverview(dir) {
    overviewScrollRef.current?.scrollBy({ left: dir * 280, behavior: 'smooth' })
  }
  function handleOverviewWheel(e) {
    // Translate vertical wheel into horizontal scroll within the strip so mouse
    // users (no horizontal wheel) can move through the cards. Trackpad
    // horizontal swipe already works natively via overflow-x-auto.
    const el = overviewScrollRef.current
    if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY
  }

  const {
    marketOpen, lastRun, macroEvents,
    ranked, byTicker, tickersWithResults,
    tickersUsed, tickersSkipped,
    weeksMinUsed, weeksMaxUsed,
    minPremiumUsed, minPProfitUsed,
    totalEvaluated, hasResult, scanId,
    loading, error,
    runScan, clearAll,
  } = useOptionsData()

  // Sync active ticker pills with scan results — only when the underlying
  // result reference changes (i.e. a NEW scan completes). The ref is primed with
  // the initial value so the first useEffect run after hydration is a no-op,
  // preserving any persisted client-side ticker filter.
  const lastTickersUsedRef = useRef(tickersUsed)
  useEffect(() => {
    if (tickersUsed !== lastTickersUsedRef.current) {
      setActiveTickers(tickersUsed)
      lastTickersUsedRef.current = tickersUsed
    }
  }, [tickersUsed])

  // ── Client-side filtering + detail-panel selection (all derived) ────────────
  // 1) Holdings pill filter (activeTickers); 2) card filter (single ticker).
  const baseRanked = ranked.filter(r => activeTickers.length === 0 || activeTickers.includes(r.ticker))
  const tableRows = (cardFilter ? baseRanked.filter(r => r.ticker === cardFilter) : baseRanked)
    .map((r, i) => ({ ...r, rank: i + 1 }))

  // Overview cards mirror the Holdings filter only — they stay visible while a
  // card filter is active so the user can toggle / switch it.
  const overviewCards = byTicker
    .filter(g => activeTickers.length === 0 || activeTickers.includes(g.ticker))

  // Setup shown in the detail panel: explicit row override if present, else the
  // context default (the filter ticker's best, else the overall rank-1).
  const contextDefault = cardFilter
    ? (byTicker.find(g => g.ticker === cardFilter)?.best ?? null)
    : (baseRanked[0] ?? null)
  const displayedSetup = selectedSetup ?? contextDefault
  const chartTicker    = displayedSetup?.ticker ?? null

  // Row highlight marks the displayed setup's row (matches ResultsTable.rowKey).
  const selectedKey = displayedSetup
    ? `${displayedSetup.ticker}-${displayedSetup.expiration}-${displayedSetup.leg_a_strike}-${displayedSetup.leg_b_strike}-${displayedSetup.leg_c_strike}`
    : null

  const isChartFull = chartFull && !!chartTicker

  // Persist control state on every change. Cheap — sessionStorage write of a
  // small JSON blob. Cleared on logout (Header) or tab close.
  useEffect(() => {
    saveScreenerState({
      tickerInput,
      activeTickers, weeksMin, weeksMax,
      minPremium, minPProfit,
      minPremiumStr, minPProfitStr,
      cardFilter, selectedSetup, chartTimeframe,
    })
  }, [
    tickerInput,
    activeTickers, weeksMin, weeksMax,
    minPremium, minPProfit,
    minPremiumStr, minPProfitStr,
    cardFilter, selectedSetup, chartTimeframe,
  ])

  // The chart is contextual: it does NOT auto-open. Clear the selection when a
  // new scan arrives so the detail zone shows just the table until the user
  // clicks a card or table row. The ref is primed with the initial `ranked` so
  // the first post-hydration run is a no-op (preserves any persisted selection
  // across in-session navigation); only a genuinely new scan (new `ranked`
  // reference from useOptionsData) clears it.
  const lastRankedRef = useRef(ranked)
  useEffect(() => {
    if (ranked !== lastRankedRef.current) {
      lastRankedRef.current = ranked
      setCardFilter(null)
      setSelectedSetup(null)
      setChartFull(false)
    }
  }, [ranked])

  // ── Chart data — fetched once at App level so the same data feeds both
  //    the compact and expanded chart variants without re-fetch on toggle.
  const { data: chartData, loading: chartLoading, error: chartError } =
    useChartData(chartTicker, chartTimeframe)

  // ── Utility functions ──────────────────────────────────────────────────────
  function parseTickers(raw) {
    return raw
      .split(/[,\s]+/)
      .map(t => t.trim().toUpperCase().replace(/^\$/, ''))
      .filter(Boolean)
  }

  // ── Staleness detection ────────────────────────────────────────────────────
  const isStale = hasResult && (
    (weeksMinUsed   !== null && weeksMin   !== weeksMinUsed)   ||
    (weeksMaxUsed   !== null && weeksMax   !== weeksMaxUsed)   ||
    (minPremiumUsed !== null && minPremium !== minPremiumUsed) ||
    (minPProfitUsed !== null && minPProfit !== minPProfitUsed) ||
    parseTickers(tickerInput).some(t => !tickersUsed.includes(t))
  )

  // ── Clear screener ─────────────────────────────────────────────────────────
  // Resets every persisted control to its default, wipes scan results, and
  // clears the chart. Persist effects will immediately re-write the defaults
  // to sessionStorage; clearScreenerSession() is called as a defensive flush
  // so any cruft outside the persisted state shape is wiped too.
  function handleClear() {
    if (loading) return
    setTickerInput('')
    setActiveTickers([])
    setWeeksMin(1)
    setWeeksMax(12)
    setMinPremium(5.00)
    setMinPremiumStr('5.00')
    setMinPProfit(0.50)
    setMinPProfitStr('50')
    setCardFilter(null)
    setSelectedSetup(null)
    setChartTimeframe('1M')
    setChartFull(false)
    clearAll()
    clearScreenerSession()
  }

  // ── Run scan ───────────────────────────────────────────────────────────────
  function handleRun() {
    const tickers = parseTickers(tickerInput)
    runScan({
      tickers:    tickers.length > 0 ? tickers : undefined,
      weeksMin,
      weeksMax,
      minPremium,
      minPProfit,
    })
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleRemoveTicker(ticker) {
    setActiveTickers(prev => prev.filter(t => t !== ticker))
    // Drop the card filter / row override if it pointed at the removed ticker,
    // so the detail panel falls back to the overall default.
    if (cardFilter === ticker) setCardFilter(null)
    setSelectedSetup(prev => (prev?.ticker === ticker ? null : prev))
  }

  // Validation helpers
  const minPremiumValid = (() => {
    const s = minPremiumStr.trim()
    if (s === '') return false
    const n = Number(s)
    return Number.isFinite(n) && n >= 0
  })()

  const minPProfitValid = (() => {
    const s = minPProfitStr.trim()
    if (s === '') return false
    const n = Number(s)
    return Number.isInteger(n) && n >= 1 && n <= 99
  })()

  // Free-text typing — always update string; sync numeric only when valid
  function handleMinPremiumChange(e) {
    const raw = e.target.value
    setMinPremiumStr(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n) && n >= 0) {
      setMinPremium(n)
    }
  }

  function handleMinPProfitChange(e) {
    const raw = e.target.value
    setMinPProfitStr(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 99) {
      setMinPProfit(parseFloat((n / 100).toFixed(4)))
    }
  }

  // Clamp to valid range on blur if invalid
  function handleMinPProfitBlur() {
    const n = Number(minPProfitStr)
    let clamped
    if (!Number.isFinite(n)) clamped = Math.round(minPProfit * 100)
    else clamped = Math.min(99, Math.max(1, Math.round(n)))
    setMinPProfitStr(String(clamped))
    setMinPProfit(parseFloat((clamped / 100).toFixed(4)))
  }

  function handleMinPremiumBlur() {
    const n = Number(minPremiumStr)
    if (!Number.isFinite(n) || n < 0) {
      setMinPremiumStr(minPremium.toFixed(2))
    }
  }

  // +/- bumpers — operate on the numeric state, then sync the string
  function bumpMinPremium(delta) {
    const next = Math.max(0, parseFloat((minPremium + delta).toFixed(2)))
    setMinPremium(next)
    setMinPremiumStr(next.toFixed(2))
  }

  function bumpMinPProfit(delta) {
    const cur = Math.round(minPProfit * 100)
    const next = Math.min(99, Math.max(1, cur + delta))
    setMinPProfit(parseFloat((next / 100).toFixed(4)))
    setMinPProfitStr(String(next))
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toastVisible, setToastVisible] = useState(false)

  function showToast() {
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 3000)
  }

  // ── Tradebook helpers ──────────────────────────────────────────────────────
  const [saveError, setSaveError] = useState(null)

  async function saveToTradebook(row) {
    if (!user) return
    setSaveError(null)
    const trade = {
      ticker:        row.ticker,
      expiration:    row.expiration,
      saved_at:      new Date().toISOString(),
      leg_a_strike:  row.leg_a_strike,
      leg_a_premium: row.leg_a_prem,
      leg_a_delta:   row.leg_a_delta,
      leg_b_strike:  row.leg_b_strike,
      leg_b_premium: row.leg_b_prem,
      leg_b_delta:   row.leg_b_delta,
      leg_c_strike:  row.leg_c_strike,
      leg_c_premium: row.leg_c_prem,
      leg_c_delta:   row.leg_c_delta,
      net_premium:   row.net_premium,
      spread_width:  row.spread_width,
      score:         row.score,
      p_max_profit:  row.p_max_profit,
      fair_value:    row.fair_value,
    }

    // Route saves through the server so user_id is auth-attributed and the
    // source scan_results row gets was_saved flipped to true. The server-side
    // handler also accepts null scan_id/result_id for legacy rows.
    const { data: { session } } = await supabase.auth.getSession()
    const headers = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`

    try {
      const res  = await fetch('/api/tradebook/save', {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          scan_id:   scanId,
          result_id: row.result_id ?? null,
          trade,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Tradebook save error:', data)
        setSaveError(`Save failed: ${data.error || res.status}`)
        return
      }
    } catch (e) {
      console.error('Tradebook save network error:', e)
      setSaveError(`Save failed: ${e.message}`)
      return
    }
    showToast()
  }

  function handleEdit(row) {
    // Thread scan_id + result_id through router state so the trade editor can
    // attribute the eventual save back to the originating scan.
    navigate('/trade', { state: { triplet: row, scan_id: scanId } })
  }

  // ── Screener content (inlined so it has closure access to all state) ────────
  const screenerContent = (
    <>
      {/* Controls — a single labeled surface panel of evenly-spaced contained
          fields; the 'macro ⌄' toggle sits at the panel's right edge and the
          scanning chips fold in as a sub-row within the panel. */}
      <div className="shrink-0 px-3 py-3">
        <div className="bg-surface border border-subtle rounded-lg px-4 py-3">

          {/* Panel header: CONTROLS label + macro toggle (right edge) */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold tracking-wider uppercase text-tertiary">Controls</span>
            <button
              onClick={() => setMacroOpen(o => !o)}
              title="Show/hide upcoming macro events"
              className="text-xs text-secondary hover:text-primary transition-colors
                         bg-surface-raised border border-subtle rounded-md px-2.5 py-1"
            >
              macro {macroOpen ? '⌃' : '⌄'}
            </button>
          </div>

          {/* Contained fields, evenly spaced */}
          <div className="flex items-start gap-5 flex-wrap">

            {/* Tickers */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-secondary">Tickers</label>
              <input
                type="text"
                value={tickerInput}
                onChange={e => setTickerInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !loading && handleRun()}
                placeholder="NVDA, META, TSLA… · blank = watchlist"
                title="Comma- or space-separated tickers · blank = default watchlist"
                disabled={loading}
                className="w-64 h-[34px] bg-surface-raised text-gray-100 border border-subtle rounded-md px-3
                           text-sm font-mono placeholder-gray-600
                           focus:outline-none focus:border-accent disabled:opacity-50"
              />
            </div>

            {/* Weeks range */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-secondary">Weeks range</label>
              <div className="flex items-center gap-3 h-[34px] bg-surface-raised border border-subtle rounded-md px-3">
                <WeeksRangeSlider
                  min={1}
                  max={12}
                  valueMin={weeksMin}
                  valueMax={weeksMax}
                  onChange={(mn, mx) => { setWeeksMin(mn); setWeeksMax(mx) }}
                  disabled={loading}
                />
                <span className="text-xs num text-secondary whitespace-nowrap">{weeksMin}–{weeksMax}</span>
              </div>
            </div>

            {/* Min Net Premium — unified stepper */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-secondary">Min Net Premium $</label>
              <div
                title="Minimum net credit required (per share)"
                className={`flex items-center h-[34px] bg-surface-raised border rounded-md transition-colors
                            ${minPremiumValid ? 'border-subtle focus-within:border-accent' : 'border-loss'}`}
              >
                <button
                  onClick={() => bumpMinPremium(-0.50)}
                  disabled={loading || minPremium <= 0}
                  className="px-2.5 h-full text-secondary hover:text-primary disabled:opacity-40 text-sm font-bold"
                >−</button>
                <input
                  type="text"
                  inputMode="decimal"
                  value={minPremiumStr}
                  onChange={handleMinPremiumChange}
                  onBlur={handleMinPremiumBlur}
                  onKeyDown={e => e.key === 'Enter' && !loading && minPremiumValid && handleRun()}
                  disabled={loading}
                  placeholder="5.00"
                  className="w-14 bg-transparent text-gray-100 text-sm font-mono text-center
                             placeholder-gray-600 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => bumpMinPremium(+0.50)}
                  disabled={loading}
                  className="px-2.5 h-full text-secondary hover:text-primary disabled:opacity-40 text-sm font-bold"
                >+</button>
              </div>
            </div>

            {/* Min P(Profit) — unified stepper */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-secondary">Min P(Profit) %</label>
              <div
                title="Minimum P(max profit) threshold (1–99%)"
                className={`flex items-center h-[34px] bg-surface-raised border rounded-md transition-colors
                            ${minPProfitValid ? 'border-subtle focus-within:border-accent' : 'border-loss'}`}
              >
                <button
                  onClick={() => bumpMinPProfit(-1)}
                  disabled={loading || Math.round(minPProfit * 100) <= 1}
                  className="px-2.5 h-full text-secondary hover:text-primary disabled:opacity-40 text-sm font-bold"
                >−</button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={minPProfitStr}
                  onChange={handleMinPProfitChange}
                  onBlur={handleMinPProfitBlur}
                  onKeyDown={e => e.key === 'Enter' && !loading && minPProfitValid && handleRun()}
                  disabled={loading}
                  placeholder="50"
                  className="w-14 bg-transparent text-gray-100 text-sm font-mono text-center
                             placeholder-gray-600 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => bumpMinPProfit(+1)}
                  disabled={loading || Math.round(minPProfit * 100) >= 99}
                  className="px-2.5 h-full text-secondary hover:text-primary disabled:opacity-40 text-sm font-bold"
                >+</button>
              </div>
            </div>

          </div>

          {/* Scanning chips — a sub-row within the panel, divided from the fields */}
          {tickersUsed.length > 0 && (
            <div className="mt-3 pt-3 border-t border-subtle">
              <Holdings
                tickers={activeTickers}
                skipped={tickersSkipped}
                onRemove={handleRemoveTicker}
              />
            </div>
          )}

        </div>
      </div>

      {/* Macro events band — collapsed by default, revealed by the toggle above. */}
      {macroOpen && <MacroEvents macroEvents={macroEvents} />}

      {/* Per-ticker overview — each ticker's single best setup as a card.
          Only after a scan returns results. Single card = one full-width rich
          card; multiple = ONE horizontal strip that scrolls sideways (never
          wraps), so the overview is a fixed height regardless of how many
          tickers qualify and never pushes the detail zone down. shrink-0. */}
      {!loading && !error && hasResult && overviewCards.length > 0 && (
        <section className="shrink-0 px-6 py-3 border-b border-subtle">
          <div className="text-xs text-secondary mb-2.5">
            Best per ticker · <span className="num">{tickersWithResults}</span> of{' '}
            <span className="num">{tickersUsed.length}</span> names had qualifying trades
          </div>
          {overviewCards.length === 1 ? (
            <OverviewCard
              ticker={overviewCards[0].ticker}
              best={overviewCards[0].best}
              count={overviewCards[0].count}
              isBest
              selected={cardFilter === overviewCards[0].ticker}
              compact={false}
              onSelect={() => toggleCardFilter(overviewCards[0].ticker)}
            />
          ) : (
            <div className="relative">
              {/* horizontal strip — fixed-width cards, never wraps; the next
                  card peeks at the right edge so it's obvious the row continues.
                  Scrollbar hidden but scrollable (trackpad swipe / wheel / chevrons). */}
              <div
                ref={overviewScrollRef}
                onWheel={handleOverviewWheel}
                className="flex gap-3 overflow-x-auto no-scrollbar scroll-smooth pr-10 pt-2.5"
              >
                {overviewCards.map((g, i) => (
                  <div key={g.ticker} className="shrink-0 w-[260px]">
                    <OverviewCard
                      ticker={g.ticker}
                      best={g.best}
                      count={g.count}
                      isBest={i === 0}
                      selected={cardFilter === g.ticker}
                      compact
                      onSelect={() => toggleCardFilter(g.ticker)}
                    />
                  </div>
                ))}
              </div>
              {/* scroll affordance for mouse users — subtle chevrons */}
              <button
                onClick={() => scrollOverview(-1)}
                aria-label="Scroll overview left"
                className="absolute left-0 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center
                           rounded-full bg-surface border border-subtle text-secondary
                           hover:text-primary hover:border-strong shadow"
              >‹</button>
              <button
                onClick={() => scrollOverview(1)}
                aria-label="Scroll overview right"
                className="absolute right-0 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center
                           rounded-full bg-surface border border-subtle text-secondary
                           hover:text-primary hover:border-strong shadow"
              >›</button>
            </div>
          )}
        </section>
      )}

      {/* Detail zone — TWO columns: ranked table (left, ~60%) + right zone
          (~40%) where SetupDetail stacks ABOVE the chart (the chart fills the
          remaining height, so there's no empty void). The chart's ⤢ expands it
          to fill the whole zone (table + detail hidden). */}
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {loading && <LoadingSpinner />}

        {!loading && error && <ErrorBanner error={error} />}

        {!loading && !error && (
          hasResult ? (
            <div className="flex-1 min-h-0 flex gap-3 p-3">
              {/* Left — ranked table. Width = the 33rem column sum + ~2rem so the
                  trailing spacer gives a little padding after Max Profit (no large
                  void); the chart column takes all the rest. Hidden in fullscreen. */}
              {!isChartFull && (
                <div className="w-[35rem] shrink-0 min-h-0 flex flex-col">
                  <ResultsTable
                    rows={tableRows}
                    totalEvaluated={totalEvaluated}
                    weeksMinUsed={weeksMinUsed}
                    weeksMaxUsed={weeksMaxUsed}
                    minPremiumUsed={minPremiumUsed}
                    minPProfitUsed={minPProfitUsed}
                    selectedKey={selectedKey}
                    onRowSelect={selectRow}
                  />
                </div>
              )}

              {/* Right — detail zone (~62%, the wider column): SetupDetail (compact
                  band) stacked above the chart, which fills the rest of the column.
                  Defaults to the overall rank-1 setup on scan; card filter / row
                  click drive both. ⤢/⤡ toggles fullscreen (chart fills the zone). */}
              <div className="flex-1 min-w-[360px] min-h-0 flex flex-col">
                {displayedSetup ? (
                  <>
                    <SetupDetail
                      setup={displayedSetup}
                      onSave={() => saveToTradebook(displayedSetup)}
                      onEdit={() => handleEdit(displayedSetup)}
                    />
                    <StockChart
                      ticker={chartTicker}
                      timeframe={chartTimeframe}
                      expanded
                      fullscreen={isChartFull}
                      data={chartData}
                      loading={chartLoading}
                      error={chartError}
                      onTimeframeChange={setChartTimeframe}
                      onToggleFull={() => setChartFull(f => !f)}
                    />
                  </>
                ) : (
                  <div className="flex-1 min-h-0 flex items-center justify-center text-center
                                  rounded border border-subtle bg-surface px-4">
                    <p className="text-secondary text-sm">select a setup to view its detail &amp; chart</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <EmptyState />
          )
        )}
      </main>
    </>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  // h-screen + overflow-hidden locks the page to viewport height so only the
  // table body scrolls (see internal scroll in ResultsTable).
  return (
    <div className="h-screen overflow-hidden bg-gray-950 text-gray-100 flex flex-col">
      <Header
        marketOpen={marketOpen}
        lastRun={lastRun}
        onRun={handleRun}
        onClear={handleClear}
        loading={loading}
        isStale={isStale}
      />
      {screenerContent}
      <Toast message="Saved to Tradebook ✓" visible={toastVisible} />
      {saveError && (
        <div
          style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999 }}
          className="bg-gray-800 border border-red-700 rounded-lg shadow-xl px-4 py-3 max-w-xs"
        >
          <div className="flex items-start gap-2">
            <span className="text-red-400 text-sm font-semibold flex-1">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="text-gray-500 hover:text-gray-300 text-xs leading-none mt-0.5">×</button>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-3 text-center px-6">
      <p className="text-gray-400 text-base font-medium">Ready to scan</p>
      <p className="text-gray-600 text-sm max-w-sm">
        Enter tickers and click Run Scan to find call spread risk reversal opportunities.
      </p>
      <p className="text-gray-700 text-xs mt-2">
        Make sure the Flask server is running: <span className="font-mono">python3 server/app.py</span>
      </p>
    </div>
  )
}

function ErrorBanner({ error }) {
  return (
    <div className="mx-6 mt-6 p-4 rounded border border-red-800/60 bg-red-950/30">
      <p className="text-red-400 font-semibold text-sm mb-1">Error</p>
      <p className="text-gray-400 text-xs font-mono break-all">{error}</p>
    </div>
  )
}
