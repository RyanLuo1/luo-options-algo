import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import '../index.css'
import { supabase } from '../lib/supabase'
import useAuth from '../hooks/useAuth'
import useTradebook, { fetchSpot } from '../hooks/useTradebook'
import { clearScreenerSession } from '../lib/sessionState'
import AppShell from '../components/lc/AppShell'
import LockedTeaser from '../components/lc/LockedTeaser'
import SetupPanel from '../components/lc/SetupPanel'
import TradebookTable, { StatusPill } from '../components/lc/TradebookTable'
import { ErrorStrip } from '../components/lc/States'
import { Button, Card, Pill, XIcon } from '../components/lc/ui'
import { fmtSigned0, tradeAsSetup, fmtWhen, expiryInfo, tradeKey as rowKeyOf, defaultTradeOrder as defaultOrder } from '../components/lc/format'

// ── Tradebook (/tradebook) — the second free tab, on the v1 design system. ────
// Logic unchanged: reads are direct supabase-js queries under the existing
// row-level policies; delete is the existing per-row delete with a confirm step.
export default function TradebookPage() {
  const navigate = useNavigate()
  const { user, plan } = useAuth()
  const { trades, loading, error, reload, remove, summary } = useTradebook(user)

  const [activeTab, setActiveTab] = useState('tradebook')
  const [sort, setSort] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)
  const [dismissedError, setDismissedError] = useState(null)
  const [confirmFor, setConfirmFor] = useState(null)   // row key whose Delete is awaiting confirmation
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  function showToast(text) { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(null), 6000) }
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const ordered = useMemo(() => defaultOrder(trades), [trades])
  const selected = trades.find(t => rowKeyOf(t) === selectedKey) ?? ordered[0] ?? null
  const selectedKeyEff = selected ? rowKeyOf(selected) : null
  const confirmingDelete = confirmFor != null && confirmFor === selectedKeyEff
  const setConfirmingDelete = on => setConfirmFor(on ? selectedKeyEff : null)

  // Live spot for the selected OPEN trade (best-effort, cached per ticker).
  const [spots, setSpots] = useState({})
  useEffect(() => {
    if (!selected || selected.status !== 'open' || spots[selected.ticker] !== undefined) return
    let cancelled = false
    fetchSpot(selected.ticker).then(p => { if (!cancelled) setSpots(s => ({ ...s, [selected.ticker]: p })) })
    return () => { cancelled = true }
  }, [selected, spots])

  const setup = selected ? tradeAsSetup(selected) : null

  function openEditor(t) {
    navigate('/trade', { state: { triplet: tradeAsSetup(t), scan_id: t.scan_id ?? null, source: { id: t.id, status: t.status }, from: 'tradebook' } })
  }
  function rerun(t) {
    const s = t.scan
    if (!s) return
    navigate('/app', { state: { rerun: { tickers: s.tickers_used, weeksMin: s.weeks_min, weeksMax: s.weeks_max, minPremium: Number(s.min_premium), minPProfit: Number(s.min_p_profit) } } })
  }
  async function confirmDelete(t) {
    setDeleting(true)
    const { error: e } = await remove(t.id)
    setDeleting(false); setConfirmingDelete(false)
    if (e) { showToast(`Couldn’t delete (${e}). Nothing changed.`); return }
    setSelectedKey(null)
    showToast(`Deleted ${t.ticker} ${expiryInfo(t.expiration).short} · ${t.leg_c_strike} / ${t.leg_a_strike} / ${t.leg_b_strike}.`)
  }
  async function handleLogout() { clearScreenerSession(); await supabase.auth.signOut(); navigate('/login') }

  const showError = !!error && error !== dismissedError
  const provenance = selected ? (
    selected.scan ? (
      <div className="flex items-center gap-2 flex-wrap text-[0.85rem]">
        <Pill tone="quiet">From your scan · {fmtWhen(selected.scan.created_at)}{selected.result ? ` · rank ${selected.result.rank} of ${selected.scan.total_passed}` : ''}</Pill>
        <button type="button" onClick={() => rerun(selected)} className="font-semibold text-lc-violet hover:underline">Rerun this scan</button>
      </div>
    ) : (
      <div className="text-[0.85rem]"><Pill tone="quiet">Saved before scan history</Pill></div>
    )
  ) : null

  const actions = selected ? (
    confirmingDelete ? (
      <>
        <Button variant="confirm" onClick={() => confirmDelete(selected)} disabled={deleting} aria-busy={deleting}>{deleting ? 'Deleting…' : 'Confirm delete'}</Button>
        <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>Keep</Button>
        <span className="text-[0.85rem] text-lc-ink-2">This removes the trade{selected.status === 'graded' ? ' and its grade' : ''}.</span>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={() => openEditor(selected)}>{selected.status === 'graded' ? 'View in editor' : 'Open in editor'}</Button>
        <Button variant="ghost" onClick={() => setConfirmingDelete(true)} className="text-lc-loss hover:bg-lc-loss-tint">Delete</Button>
      </>
    )
  ) : null

  return (
    <AppShell activeTab={activeTab} onTabChange={id => (id === 'screener' ? navigate('/app') : setActiveTab(id))} plan={plan} marketOpen={null} lastRun={null} onLogout={handleLogout}>
      {activeTab !== 'tradebook' ? (
        <LockedTeaser tab={activeTab} />
      ) : (
        <div className="flex flex-col gap-4 pt-6">
          {/* Summary strip */}
          <section aria-label="Tradebook summary" className="bg-lc-card rounded-lc shadow-lc px-6 py-4 flex items-start gap-8 flex-wrap">
            <Figure label="Open" value={summary.open + summary.pending} sub={summary.pending ? `${summary.open} open · ${summary.pending} grading` : 'positions not yet expired'} />
            <Figure label="Graded" value={summary.graded} sub="settled and labeled" />
            <Figure label="Total realized P&L" value={fmtSigned0(summary.totalPnl)} tone={summary.totalPnl > 0 ? 'profit' : summary.totalPnl < 0 ? 'loss' : null} sub="sum of per-contract outcomes, not a portfolio return" />
          </section>

          {loading && trades.length === 0 && (
            <div role="status" aria-live="polite" className="bg-lc-card rounded-lc shadow-lc px-5 py-3 text-[0.9rem] text-lc-ink">Loading your trades…</div>
          )}
          {showError && <ErrorStrip message={error} hadResults={trades.length > 0} onRetry={reload} onDismiss={() => setDismissedError(error)} tradebook />}

          {!loading && !error && trades.length === 0 ? (
            <Card className="max-w-[52rem]" padding="p-8">
              <h2 className="font-display font-bold text-[1.6rem] leading-[1.1] tracking-[-0.02em] text-lc-ink mb-2">No trades yet</h2>
              <p className="text-lc-ink-2 leading-[1.6] max-w-[60ch] mb-5">Save one from the Screener. Each saved trade is graded automatically after it expires, so this page becomes your record of what the idea actually did.</p>
              <Button variant="primary" onClick={() => navigate('/app')}>Go to the Screener</Button>
            </Card>
          ) : trades.length > 0 ? (
            <div className="grid grid-cols-[minmax(0,65fr)_minmax(0,35fr)] gap-4 items-start">
              <div className="min-w-0 max-h-[calc(100vh-16rem)] min-h-[28rem] flex flex-col">
                <TradebookTable trades={trades} sort={sort} onSort={setSort} onResetSort={() => setSort(null)}
                  selectedKey={selectedKeyEff} onSelect={t => setSelectedKey(rowKeyOf(t))} onOpen={openEditor} dimmed={loading} />
              </div>
              <div className="min-w-0">
                <SetupPanel
                  row={setup}
                  spot={selected.status === 'open' ? spots[selected.ticker] ?? null : null}
                  settlement={selected.status === 'graded' ? selected.outcome : null}
                  expired={selected.status !== 'open'}
                  statusPill={<StatusPill trade={selected} size="md" />}
                  provenance={provenance}
                  actions={actions}
                  note={selected.status === 'pending' ? 'Grading pending · grades after the next close (the nightly backfill runs on trading days).' : selected.status === 'open' ? 'Editing saves a corrected trade and replaces this one unless you untick “Replace the original”.' : null}
                  dimmed={loading}
                />
              </div>
            </div>
          ) : null}
        </div>
      )}

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50 bg-lc-card rounded-lc shadow-lc-lift px-5 py-4 max-w-sm flex items-start gap-3">
          <span className="text-[0.95rem] text-lc-ink">{toast}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-lc-ink-3 hover:text-lc-ink mt-0.5"><XIcon /></button>
        </div>
      )}
    </AppShell>
  )
}

function Figure({ label, value, sub, tone = null }) {
  const ink = tone === 'profit' ? 'text-lc-profit' : tone === 'loss' ? 'text-lc-loss' : 'text-lc-ink'
  return (
    <div className="flex flex-col gap-0.5 min-w-[10rem]">
      <span className="text-[0.85rem] font-semibold text-lc-ink-2">{label}</span>
      <span className={`font-display font-extrabold text-[1.7rem] leading-[1.1] tracking-[-0.02em] [font-variant-numeric:tabular-nums] ${ink}`}>{value}</span>
      <span className="text-[0.82rem] text-lc-ink-2">{sub}</span>
    </div>
  )
}
