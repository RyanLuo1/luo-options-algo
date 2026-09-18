import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import '../index.css'
import { supabase } from '../lib/supabase'
import useAuth from '../hooks/useAuth'
import { clearScreenerSession } from '../lib/sessionState'
import AppShell from '../components/lc/AppShell'
import LockedTeaser from '../components/lc/LockedTeaser'
import { Button, Pill, XIcon } from '../components/lc/ui'
import { fmtMoney0, fmtMoney2, fmtPct0, expiryInfo, shortsWorthless, pMaxApprox, pPutAssigned } from '../components/lc/format'

// ── Trade editor (/trade) — re-skinned on the v1 design system. ───────────────
// Functionally as before: three leg columns with live chains (ask for the leg
// you buy, bid for the legs you sell), Recalculate, and a save through
// /api/tradebook/save (insert-only). Opened from the Tradebook with a `source`
// trade, the action is "Save as new trade" with "Replace the original" checked
// by default: on success the original row is deleted (existing delete policy),
// so an edit never duplicates the ledger. Graded trades open read-only.

function legFromTriplet(triplet, leg) {
  return { strike: triplet[`leg_${leg}_strike`], premium: triplet[`leg_${leg}_prem`], delta: triplet[`leg_${leg}_delta`], volume: null, oi: null }
}
function calcMetrics(a, b, c) {
  const net = (b.premium ?? 0) + (c.premium ?? 0) - (a.premium ?? 0)
  const width = (b.strike ?? 0) - (a.strike ?? 0)
  return { net_premium: net, spread_width: width, score: width > 0 ? net / width : 0, p_max_profit: (1 - (b.delta ?? 0)) * (1 - (c.delta ?? 0)), leg_b_delta: b.delta ?? 0, leg_c_delta: c.delta ?? 0 }
}

export default function TradePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, plan } = useAuth()
  const triplet = location.state?.triplet
  const scanId  = location.state?.scan_id ?? null
  const source  = location.state?.source ?? null          // { id, status } when opened from the Tradebook
  const from    = location.state?.from ?? (source ? 'tradebook' : 'screener')
  const readOnly = !!source && source.status !== 'open'   // expired trades (graded or grading-pending) can't be changed

  const [activeTab, setActiveTab] = useState(from === 'tradebook' ? 'tradebook' : 'screener')
  const [selA, setSelA] = useState(() => (triplet ? legFromTriplet(triplet, 'a') : null))
  const [selB, setSelB] = useState(() => (triplet ? legFromTriplet(triplet, 'b') : null))
  const [selC, setSelC] = useState(() => (triplet ? legFromTriplet(triplet, 'c') : null))
  const [calls, setCalls] = useState([])
  const [puts, setPuts] = useState([])
  const [chainLoading, setChainLoading] = useState(!readOnly)
  const [chainError, setChainError] = useState(null)
  const [metrics, setMetrics] = useState(() => (triplet ? { net_premium: triplet.net_premium, spread_width: triplet.spread_width, score: triplet.score, p_max_profit: triplet.p_max_profit, leg_b_delta: triplet.leg_b_delta ?? 0, leg_c_delta: triplet.leg_c_delta ?? 0 } : null))
  const [replace, setReplace] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  useEffect(() => { window.scrollTo(0, 0) }, [])   // the Tradebook may hand over mid-scroll

  useEffect(() => {
    if (!triplet || readOnly) return
    const { ticker, expiration } = triplet
    setChainLoading(true); setChainError(null)
    Promise.all([
      fetch(`/api/chain?ticker=${ticker}&expiration=${expiration}&side=call`).then(r => r.json()),
      fetch(`/api/chain?ticker=${ticker}&expiration=${expiration}&side=put`).then(r => r.json()),
    ]).then(([rc, rp]) => {
      const norm = r => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : Array.isArray(r?.chain) ? r.chain : null)
      const c = norm(rc), p = norm(rp)
      if (!c || !p) { setChainError(rc?.error || rp?.error || 'The options chain didn’t load. Try again.'); return }
      setCalls(c); setPuts(p)
      const mA = c.find(x => x.strike === triplet.leg_a_strike), mB = c.find(x => x.strike === triplet.leg_b_strike), mC = p.find(x => x.strike === triplet.leg_c_strike)
      if (mA) setSelA(s => ({ ...s, volume: mA.volume, oi: mA.oi }))
      if (mB) setSelB(s => ({ ...s, volume: mB.volume, oi: mB.oi }))
      if (mC) setSelC(s => ({ ...s, volume: mC.volume, oi: mC.oi }))
    }).catch(e => setChainError(`The options chain didn’t load (${e.message}). Try again.`)).finally(() => setChainLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!triplet || !user || saving || readOnly) return
    setSaving(true); setSaveError(null)
    // Metrics are recomputed from the selected legs at save time so strikes and metrics always share a basis.
    const m = calcMetrics(selA, selB, selC)
    const trade = {
      ticker: triplet.ticker, expiration: triplet.expiration, saved_at: new Date().toISOString(),
      leg_a_strike: selA.strike, leg_a_premium: selA.premium, leg_a_delta: selA.delta,
      leg_b_strike: selB.strike, leg_b_premium: selB.premium, leg_b_delta: selB.delta,
      leg_c_strike: selC.strike, leg_c_premium: selC.premium, leg_c_delta: selC.delta,
      net_premium: m.net_premium, spread_width: m.spread_width, score: m.score, p_max_profit: m.p_max_profit,
      mode: triplet.mode === 'upside' ? 'upside' : 'income',
    }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
      const res = await fetch('/api/tradebook/save', { method: 'POST', headers, body: JSON.stringify({ scan_id: scanId, result_id: triplet.result_id ?? null, trade }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setSaveError(`Couldn’t save (${data.error || res.status}). Nothing was written; try again.`); return }
      let replaced = false
      if (source?.id && replace) {
        const { error } = await supabase.from('tradebook').delete().eq('id', source.id)
        replaced = !error
        if (error) { setSaveError('Saved the new trade, but the original couldn’t be removed; delete it from the Tradebook.'); }
      }
      const label = `${triplet.ticker} ${expiryInfo(triplet.expiration).short} · ${selC.strike} / ${selA.strike} / ${selB.strike}`
      clearTimeout(toastTimer.current)
      setToast(source ? (replaced ? `Replaced the original with ${label}.` : `Saved ${label} as a new trade; the original is still in your Tradebook.`) : `Saved ${label} to your Tradebook.`)
      toastTimer.current = setTimeout(() => setToast(null), 6000)
      if (source) setTimeout(() => navigate('/tradebook', { state: { selected: replaced ? null : source.id } }), 900)
    } catch (e) {
      setSaveError(`Couldn’t reach the server to save (${e.message}). Nothing was written; try again.`)
    } finally { setSaving(false) }
  }
  async function handleLogout() { clearScreenerSession(); try { sessionStorage.setItem('luo-logged-out', '1') } catch { /* private mode */ } await supabase.auth.signOut(); navigate('/login', { replace: true, state: { loggedOut: true } }) }
  const back = () => navigate(from === 'tradebook' ? '/tradebook' : '/app', from === 'tradebook' && source?.id ? { state: { selected: source.id } } : undefined)

  const shellProps = { activeTab, onTabChange: id => (id === 'screener' ? navigate('/app') : setActiveTab(id)), plan, marketOpen: null, lastRun: null, onLogout: handleLogout }

  if (!triplet) {
    return (
      <AppShell {...shellProps}>
        <div className="pt-8 max-w-[40rem] flex flex-col gap-4">
          <h1 className="font-display font-bold text-[1.6rem] leading-[1.1] tracking-[-0.02em]">Nothing to edit</h1>
          <p className="text-lc-ink-2 leading-[1.6]">Open a setup from the Screener or a trade from the Tradebook and it appears here with its live options chains.</p>
          <div className="flex gap-3"><Button variant="primary" onClick={() => navigate('/app')}>Go to the Screener</Button><Button onClick={() => navigate('/tradebook')}>Go to the Tradebook</Button></div>
        </div>
      </AppShell>
    )
  }
  if (activeTab !== 'screener' && activeTab !== 'tradebook') {
    return <AppShell {...shellProps}><LockedTeaser tab={activeTab} /></AppShell>
  }

  const exp = expiryInfo(triplet.expiration)
  return (
    <AppShell {...shellProps}>
      <div className="flex flex-col gap-4 pt-6">
        {/* Head */}
        <section className="bg-lc-card rounded-lc shadow-lc px-6 py-5 flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <button type="button" onClick={back} className="text-[0.9rem] font-semibold text-lc-violet hover:underline">← Back to {from === 'tradebook' ? 'Tradebook' : 'Screener'}</button>
            <div className="font-display font-bold text-[1.6rem] leading-none tracking-[-0.02em] flex items-baseline gap-2.5">
              {triplet.ticker}
              <small className="font-figtree font-medium text-[1rem] text-lc-ink-2 tracking-normal">{readOnly ? `expired ${exp.short}` : `expires ${exp.short}${exp.dte != null && exp.dte >= 0 ? ` · ${exp.dte}d` : ''}`}</small>
            </div>
            {readOnly && <Pill tone="quiet">{source.status === 'graded' ? 'Expired and graded · read-only' : 'Expired · grade pending · read-only'}</Pill>}
            {source && !readOnly && <Pill tone="quiet">Editing a saved trade</Pill>}
          </div>
          {metrics && (
            <div className="flex items-end gap-6 flex-wrap">
              <Metric label={metrics.net_premium < 0 ? 'Debit /ct' : 'Credit /ct'} value={fmtMoney0(Math.abs(metrics.net_premium) * 100)} hi />
              <Metric label="Max profit /ct" value={fmtMoney0((metrics.net_premium + metrics.spread_width) * 100)} />
              <Metric label="Spread width" value={String(metrics.spread_width)} />
              {/* the gauge triad, from the two short legs' deltas (p_max_profit is still saved; it is not shown) */}
              <Metric label="Shorts worthless" value={fmtPct0(shortsWorthless(metrics))} title="1 − δ of the short call − δ of the put: the stock finishes between them" />
              <Metric label="Max profit ≈" value={fmtPct0(pMaxApprox(metrics))} title="≈ the delta of the short call: the stock at or above it" />
              <Metric label="Put assigned ≈" value={fmtPct0(pPutAssigned(metrics))} title="≈ the delta of the put: the stock at or below it" />
            </div>
          )}
        </section>

        {/* Three leg columns */}
        <div className="grid grid-cols-3 max-lc:grid-cols-1 gap-4 items-start">
          <LegColumn label="Buy call" sub="You pay the ask" selected={selA} contracts={calls} loading={chainLoading} error={chainError} readOnly={readOnly} priceKey="ask" priceLabel="Ask" pay onSelect={c => setSelA({ strike: c.strike, premium: c.ask, delta: c.delta, volume: c.volume, oi: c.oi })} />
          <LegColumn label="Sell call" sub="You collect the bid" selected={selB} contracts={calls} loading={chainLoading} error={chainError} readOnly={readOnly} priceKey="bid" priceLabel="Bid" onSelect={c => setSelB({ strike: c.strike, premium: c.bid, delta: c.delta, volume: c.volume, oi: c.oi })} />
          <LegColumn label="Sell put"  sub="You collect the bid" selected={selC} contracts={puts}  loading={chainLoading} error={chainError} readOnly={readOnly} priceKey="bid" priceLabel="Bid" onSelect={c => setSelC({ strike: c.strike, premium: c.bid, delta: c.delta, volume: c.volume, oi: c.oi })} />
        </div>

        {/* Actions */}
        <section className="bg-lc-card rounded-lc shadow-lc px-6 py-4 flex items-center gap-4 flex-wrap">
          {readOnly ? (
            <span className="text-[0.95rem] text-lc-ink-2">{source.status === 'graded' ? 'This trade has expired and been graded; its legs are shown as saved. Nothing here can change the grade.' : 'This trade has expired; its legs are shown as saved. The grade posts after the next close and nothing here can change it.'}</span>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setMetrics(calcMetrics(selA, selB, selC))}>Recalculate</Button>
              <Button variant="confirm" onClick={handleSave} disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : source ? 'Save as new trade' : 'Save to Tradebook'}</Button>
              {source && (
                <label className="inline-flex items-center gap-2 text-[0.95rem] text-lc-ink cursor-pointer select-none">
                  <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} className="w-4 h-4 accent-[#6547E6]" />
                  Replace the original
                </label>
              )}
              {source && <span className="text-[0.85rem] text-lc-ink-2">{replace ? 'The original is removed once the new trade is saved.' : 'Both trades will stay in your Tradebook.'}</span>}
              {saveError && <span role="alert" className="text-[0.85rem] font-semibold text-lc-loss">{saveError}</span>}
            </>
          )}
        </section>
      </div>

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50 bg-lc-card rounded-lc shadow-lc-lift px-5 py-4 max-w-sm flex items-start gap-3">
          <div className="flex flex-col gap-1 text-[0.95rem]">
            <span className="text-lc-ink">{toast}</span>
            <button type="button" onClick={() => navigate('/tradebook')} className="text-left font-semibold text-lc-violet hover:underline">View Tradebook</button>
          </div>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-lc-ink-3 hover:text-lc-ink mt-0.5"><XIcon /></button>
        </div>
      )}
    </AppShell>
  )
}

function Metric({ label, value, hi, title }) {
  return (
    <div className="flex flex-col items-end" title={title}>
      <span className="text-[0.78rem] font-semibold text-lc-ink-2">{label}</span>
      <span className={`font-display font-extrabold text-[1.3rem] leading-tight tracking-[-0.01em] ${hi ? 'text-lc-ink' : 'text-lc-ink'}`}>{value}</span>
    </div>
  )
}

function LegColumn({ label, sub, selected, contracts, loading, error, readOnly, priceKey, priceLabel, pay, onSelect }) {
  // Once the chain is in, bring the saved strike into the middle of the box (once — not on every click).
  const boxRef = useRef(null)
  const anchored = useRef(false)
  useEffect(() => {
    if (anchored.current || loading || !contracts.length || !boxRef.current) return
    const row = boxRef.current.querySelector('tr[aria-current="true"]')
    if (!row) return
    boxRef.current.scrollTop = Math.max(0, row.offsetTop - boxRef.current.clientHeight / 2 + row.clientHeight / 2)
    anchored.current = true
  }, [loading, contracts])
  return (
    <section aria-label={label} className="bg-lc-card rounded-lc shadow-lc p-5 flex flex-col gap-3 min-w-0">
      <div>
        <div className={`text-[0.85rem] font-semibold ${pay ? 'text-lc-violet' : 'text-lc-ink-2'}`}>{label}</div>
        <div className="text-[0.8rem] text-lc-ink-2">{sub}</div>
      </div>
      <div className="bg-lc-ground rounded-lc-plus p-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[0.9rem] [font-variant-numeric:tabular-nums]">
        <span className="text-lc-ink-2">Strike</span><span className="text-right font-display font-extrabold text-[1.2rem] leading-tight">{selected?.strike ?? '—'}</span>
        <span className="text-lc-ink-2">{priceLabel}</span><span className="text-right font-semibold">{selected?.premium != null ? fmtMoney2(selected.premium) : '—'}</span>
        <span className="text-lc-ink-2">Delta</span><span className="text-right">{selected?.delta != null ? selected.delta.toFixed(3) : '—'}</span>
        {!readOnly && <><span className="text-lc-ink-2">Volume · OI</span><span className="text-right">{selected?.volume ?? '—'} · {selected?.oi ?? '—'}</span></>}
      </div>
      {!readOnly && (
        <div ref={boxRef} className="border-[1.5px] border-lc-line rounded-lc-plus overflow-auto max-h-[22rem]">
          {loading ? (
            <div className="text-[0.85rem] text-lc-ink-2 p-4 text-center">Loading chain…</div>
          ) : error ? (
            <div className="text-[0.85rem] text-lc-loss font-semibold p-4 text-center" role="alert">{error}</div>
          ) : contracts.length === 0 ? (
            <div className="text-[0.85rem] text-lc-ink-2 p-4 text-center">No contracts in range.</div>
          ) : (
            <table className="w-full border-collapse text-[0.88rem] [font-variant-numeric:tabular-nums]">
              <thead><tr>{['Strike', priceLabel, 'Delta', 'Vol', 'OI'].map(h => <th key={h} scope="col" className="sticky top-0 bg-lc-card text-[0.75rem] font-semibold tracking-[0.03em] text-lc-ink-2 border-b border-lc-line px-2 py-2 text-right">{h}</th>)}</tr></thead>
              <tbody>
                {contracts.map(c => {
                  const on = c.strike === selected?.strike
                  return (
                    <tr key={c.strike} onClick={() => onSelect(c)} aria-current={on ? 'true' : undefined}
                      className={`cursor-pointer border-b border-lc-line/60 ${on ? 'bg-lc-violet-soft' : 'hover:bg-lc-ground'}`}>
                      <td className={`px-2 py-1.5 text-right font-semibold ${on ? 'text-lc-violet' : 'text-lc-ink'}`}>{c.strike}</td>
                      <td className="px-2 py-1.5 text-right">{c[priceKey] != null ? fmtMoney2(c[priceKey]) : '—'}</td>
                      <td className="px-2 py-1.5 text-right text-lc-ink-2">{c.delta?.toFixed(3) ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right text-lc-ink-2">{c.volume ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right text-lc-ink-2">{c.oi ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
