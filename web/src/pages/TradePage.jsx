import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import Toast from '../components/Toast'
import { supabase } from '../lib/supabase'
import useAuth from '../hooks/useAuth'

// ── Helpers ────────────────────────────────────────────────────────────────────

function legFromTriplet(triplet, leg) {
  return {
    strike:  triplet[`leg_${leg}_strike`],
    premium: triplet[`leg_${leg}_prem`],
    delta:   triplet[`leg_${leg}_delta`],
    volume:  null,
    oi:      null,
  }
}

function calcMetrics(legA, legB, legC) {
  const netPrem    = (legB.premium ?? 0) + (legC.premium ?? 0) - (legA.premium ?? 0)
  const spreadWidth = (legB.strike ?? 0) - (legA.strike ?? 0)
  const score       = spreadWidth > 0 ? netPrem / spreadWidth : 0
  const pMaxProfit  = (1 - (legB.delta ?? 0)) * (1 - (legC.delta ?? 0))
  return {
    net_premium:  netPrem,
    spread_width: spreadWidth,
    score,
    p_max_profit: pMaxProfit,
  }
}

// ── Chain table for one leg ────────────────────────────────────────────────────

function ChainTable({ contracts, selectedStrike, onSelect, loading, error, priceKey, priceLabel }) {
  if (loading) {
    return <div className="text-tertiary text-xs py-4 text-center">Loading chain…</div>
  }
  if (error) {
    return <div className="text-loss text-xs py-4 text-center">{error}</div>
  }
  if (!contracts || contracts.length === 0) {
    return <div className="text-tertiary text-xs py-4 text-center">No contracts in range.</div>
  }

  return (
    <div className="overflow-y-auto" style={{ maxHeight: '340px' }}>
      <table className="w-full text-xs font-mono border-collapse">
        <thead className="sticky top-0 bg-surface z-10">
          <tr className="border-b border-subtle">
            <th className="px-2 py-1.5 text-right text-tertiary font-semibold">Strike</th>
            <th className="px-2 py-1.5 text-right text-tertiary font-semibold">{priceLabel}</th>
            <th className="px-2 py-1.5 text-right text-tertiary font-semibold">Delta</th>
            <th className="px-2 py-1.5 text-right text-tertiary font-semibold">Volume</th>
            <th className="px-2 py-1.5 text-right text-tertiary font-semibold">OI</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map(c => {
            const isSelected = c.strike === selectedStrike
            return (
              <tr
                key={c.strike}
                onClick={() => onSelect(c)}
                className={`
                  border-b border-subtle/50 cursor-pointer transition-colors
                  ${isSelected
                    ? 'ring-1 ring-inset ring-accent bg-accent/20'
                    : 'hover:bg-subtle/40'}
                `}
              >
                <td className={`px-2 py-1.5 text-right ${isSelected ? 'text-accent' : 'text-secondary'}`}>
                  ${c.strike.toFixed(2)}
                </td>
                <td className="px-2 py-1.5 text-right text-secondary">
                  {c[priceKey] != null ? `$${c[priceKey].toFixed(4)}` : '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-secondary">
                  {c.delta?.toFixed(4) ?? '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-tertiary">
                  {c.volume ?? '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-tertiary">
                  {c.oi ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Leg column ─────────────────────────────────────────────────────────────────

// priceKey selects the transactable side of the quote for this leg:
// 'ask' for the leg we buy (A), 'bid' for the legs we sell (B, C).
function LegColumn({ label, sublabel, selected, contracts, chainLoading, chainError, onSelect, priceKey, priceLabel }) {
  return (
    <div className="flex flex-col min-w-0 flex-1 bg-surface rounded border border-subtle">

      {/* Header */}
      <div className="px-4 py-3 border-b border-subtle">
        <div className="text-xs font-bold text-primary">{label}</div>
        <div className="text-xs text-tertiary mt-0.5">{sublabel}</div>
      </div>

      {/* Current selection details */}
      <div className="px-4 py-3 border-b border-subtle bg-surface/50">
        <div className="text-xs text-tertiary mb-1.5 font-semibold uppercase tracking-wide">Selected</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
          <div className="text-tertiary">Strike</div>
          <div className="text-primary text-right">
            {selected.strike != null ? `$${selected.strike.toFixed(2)}` : '—'}
          </div>
          <div className="text-tertiary">Premium</div>
          <div className="text-primary text-right">
            {selected.premium != null ? `$${selected.premium.toFixed(4)}` : '—'}
          </div>
          <div className="text-tertiary">Delta</div>
          <div className="text-primary text-right">
            {selected.delta != null ? selected.delta.toFixed(4) : '—'}
          </div>
          <div className="text-tertiary">Volume</div>
          <div className="text-primary text-right">{selected.volume ?? '—'}</div>
          <div className="text-tertiary">OI</div>
          <div className="text-primary text-right">{selected.oi ?? '—'}</div>
        </div>
      </div>

      {/* Chain */}
      <div className="flex-1">
        <ChainTable
          contracts={contracts}
          selectedStrike={selected.strike}
          onSelect={onSelect}
          loading={chainLoading}
          error={chainError}
          priceKey={priceKey}
          priceLabel={priceLabel}
        />
      </div>

    </div>
  )
}

// ── Main TradePage ─────────────────────────────────────────────────────────────

export default function TradePage() {
  const location = useLocation()
  const navigate  = useNavigate()
  const triplet   = location.state?.triplet
  const scanId    = location.state?.scan_id ?? null   // scan provenance
  const { user }  = useAuth()

  // Selected contract per leg
  const [selectedA, setSelectedA] = useState(() => triplet ? legFromTriplet(triplet, 'a') : null)
  const [selectedB, setSelectedB] = useState(() => triplet ? legFromTriplet(triplet, 'b') : null)
  const [selectedC, setSelectedC] = useState(() => triplet ? legFromTriplet(triplet, 'c') : null)

  // Chain data
  const [callChain,    setCallChain]    = useState([])
  const [putChain,     setPutChain]     = useState([])
  const [chainLoading, setChainLoading] = useState(true)
  const [chainError,   setChainError]   = useState(null)

  // Metrics — initialized from triplet, updated only on Recalculate
  const [metrics, setMetrics] = useState(() => triplet ? {
    net_premium:  triplet.net_premium,
    spread_width: triplet.spread_width,
    score:        triplet.score,
    p_max_profit: triplet.p_max_profit,
  } : null)

  const [toastVisible, setToastVisible] = useState(false)
  const [saveError,    setSaveError]    = useState(null)

  // Fetch chains on mount
  useEffect(() => {
    if (!triplet) return
    const { ticker, expiration } = triplet
    setChainLoading(true)
    setChainError(null)

    Promise.all([
      fetch(`/api/chain?ticker=${ticker}&expiration=${expiration}&side=call`).then(r => r.json()),
      fetch(`/api/chain?ticker=${ticker}&expiration=${expiration}&side=put`).then(r => r.json()),
    ])
      .then(([rawCalls, rawPuts]) => {
        console.log('/api/chain calls response:', rawCalls)
        console.log('/api/chain puts response:', rawPuts)

        // Unwrap if server ever wraps in { data: [...] } or { chain: [...] }
        const normalize = (r) => {
          if (Array.isArray(r)) return r
          if (r && Array.isArray(r.data))  return r.data
          if (r && Array.isArray(r.chain)) return r.chain
          console.error('/api/chain unexpected shape:', r)
          return null  // signals an error response
        }

        const calls = normalize(rawCalls)
        const puts  = normalize(rawPuts)

        if (!calls || !puts) {
          const msg = rawCalls?.error || rawPuts?.error || 'Unexpected response from /api/chain'
          setChainError(msg)
          return
        }

        setCallChain(calls)
        setPutChain(puts)

        // Back-fill volume/OI for initially selected strikes from chain data
        const matchA = calls.find(c => c.strike === triplet.leg_a_strike)
        const matchB = calls.find(c => c.strike === triplet.leg_b_strike)
        const matchC = puts.find( c => c.strike === triplet.leg_c_strike)
        if (matchA) setSelectedA(prev => ({ ...prev, volume: matchA.volume, oi: matchA.oi }))
        if (matchB) setSelectedB(prev => ({ ...prev, volume: matchB.volume, oi: matchB.oi }))
        if (matchC) setSelectedC(prev => ({ ...prev, volume: matchC.volume, oi: matchC.oi }))
      })
      .catch(err => {
        console.error('Chain fetch error:', err)
        setChainError(`Failed to load chain: ${err.message}`)
      })
      .finally(() => setChainLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRecalculate() {
    setMetrics(calcMetrics(selectedA, selectedB, selectedC))
  }

  async function handleSave() {
    if (!triplet || !user) return
    setSaveError(null)
    // Compute the metrics FRESH from the currently-selected legs at save time —
    // never trust the `metrics` state, which only updates on Recalculate. If the
    // user edits a leg strike but saves without clicking Recalculate, the old
    // behavior wrote the NEW strikes alongside the STALE spread_width/score/
    // net_premium, leaving the row internally inconsistent (strikes said
    // K_B−K_A=20 while spread_width still said 10). That broke downstream
    // payoff/capture math (realized P&L could exceed the computed max). Deriving
    // spread_width = selectedB.strike − selectedA.strike here keeps the saved
    // strikes and metrics on the same basis, always.
    const saveMetrics = calcMetrics(selectedA, selectedB, selectedC)
    const trade = {
      ticker:        triplet.ticker,
      expiration:    triplet.expiration,
      saved_at:      new Date().toISOString(),
      leg_a_strike:  selectedA.strike,
      leg_a_premium: selectedA.premium,
      leg_a_delta:   selectedA.delta,
      leg_b_strike:  selectedB.strike,
      leg_b_premium: selectedB.premium,
      leg_b_delta:   selectedB.delta,
      leg_c_strike:  selectedC.strike,
      leg_c_premium: selectedC.premium,
      leg_c_delta:   selectedC.delta,
      net_premium:   saveMetrics.net_premium,
      spread_width:  saveMetrics.spread_width,
      score:         saveMetrics.score,
      p_max_profit:  saveMetrics.p_max_profit,
    }

    // Route through the server endpoint — sets user_id from JWT, links to the
    // originating scan_run/scan_result, and flips was_saved=true on the source row.
    const { data: { session } } = await supabase.auth.getSession()
    const headers = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`

    try {
      const res  = await fetch('/api/tradebook/save', {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          scan_id:   scanId,
          result_id: triplet.result_id ?? null,
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
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 3000)
  }

  // ── Guard: no state passed ───────────────────────────────────────────────────
  if (!triplet) {
    return (
      <div className="min-h-screen bg-base text-primary flex flex-col">
        <Header />
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <p className="text-secondary text-sm">No triplet data. Navigate here from a scan.</p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded transition-colors"
          >
            Go to Screener
          </button>
        </div>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-base text-primary flex flex-col">
      <Header />

      {/* Summary bar */}
      <div className="px-6 py-3 border-b border-subtle bg-surface/50 flex items-center gap-8 flex-wrap">
        <div className="text-xs text-tertiary">
          <span className="font-semibold text-secondary text-sm">{triplet.ticker}</span>
          <span className="ml-2">· {triplet.expiration}</span>
        </div>

        {metrics && (
          <div className="flex items-center gap-6 text-xs font-mono ml-auto flex-wrap">
            <MetricCell label="Net Premium" value={`$${metrics.net_premium.toFixed(4)}`} highlight />
            <MetricCell label="Spread Width" value={metrics.spread_width.toFixed(2)} />
            <MetricCell label="Score" value={metrics.score.toFixed(6)} />
            <MetricCell label="P(Profit)%" value={`${(metrics.p_max_profit * 100).toFixed(2)}%`} />
          </div>
        )}
      </div>

      {/* Three-column leg editor */}
      <div className="flex-1 px-6 py-4 flex gap-4 min-h-0 overflow-auto">
        <LegColumn
          label="Leg A — Long Call"
          sublabel="Buy ATM call (you pay the ask)"
          selected={selectedA}
          contracts={callChain}
          chainLoading={chainLoading}
          chainError={chainError}
          priceKey="ask"
          priceLabel="Ask"
          onSelect={c => setSelectedA({ strike: c.strike, premium: c.ask, delta: c.delta, volume: c.volume, oi: c.oi })}
        />
        <LegColumn
          label="Leg B — Short Call"
          sublabel="Sell OTM call (you collect the bid)"
          selected={selectedB}
          contracts={callChain}
          chainLoading={chainLoading}
          chainError={chainError}
          priceKey="bid"
          priceLabel="Bid"
          onSelect={c => setSelectedB({ strike: c.strike, premium: c.bid, delta: c.delta, volume: c.volume, oi: c.oi })}
        />
        <LegColumn
          label="Leg C — Short Put"
          sublabel="Sell OTM put (you collect the bid)"
          selected={selectedC}
          contracts={putChain}
          chainLoading={chainLoading}
          chainError={chainError}
          priceKey="bid"
          priceLabel="Bid"
          onSelect={c => setSelectedC({ strike: c.strike, premium: c.bid, delta: c.delta, volume: c.volume, oi: c.oi })}
        />
      </div>

      {/* Action bar */}
      <div className="px-6 py-4 border-t border-subtle flex items-center justify-center gap-4">
        <button
          onClick={handleRecalculate}
          className="px-6 py-2 bg-subtle hover:bg-strong text-primary text-sm font-semibold rounded transition-colors"
        >
          Recalculate
        </button>
        <button
          onClick={handleSave}
          className="px-6 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded transition-colors"
        >
          Save to Tradebook
        </button>
      </div>

      <Toast message="Saved to Tradebook ✓" visible={toastVisible} />
      {saveError && (
        <div
          style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999 }}
          className="bg-surface border border-loss-dim rounded-lg shadow-xl px-4 py-3 max-w-xs"
        >
          <div className="flex items-start gap-2">
            <span className="text-loss text-sm font-semibold flex-1">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="text-tertiary hover:text-secondary text-xs leading-none mt-0.5">×</button>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCell({ label, value, highlight }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-tertiary text-xs">{label}</span>
      <span className={highlight ? 'text-primary font-bold text-sm' : 'text-secondary text-sm'}>
        {value}
      </span>
    </div>
  )
}
