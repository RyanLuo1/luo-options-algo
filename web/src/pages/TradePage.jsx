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

function ChainTable({ contracts, selectedStrike, onSelect, loading, error }) {
  if (loading) {
    return <div className="text-gray-600 text-xs py-4 text-center">Loading chain…</div>
  }
  if (error) {
    return <div className="text-red-400 text-xs py-4 text-center">{error}</div>
  }
  if (!contracts || contracts.length === 0) {
    return <div className="text-gray-600 text-xs py-4 text-center">No contracts in range.</div>
  }

  return (
    <div className="overflow-y-auto" style={{ maxHeight: '340px' }}>
      <table className="w-full text-xs font-mono border-collapse">
        <thead className="sticky top-0 bg-gray-900 z-10">
          <tr className="border-b border-gray-700">
            <th className="px-2 py-1.5 text-right text-gray-500 font-semibold">Strike</th>
            <th className="px-2 py-1.5 text-right text-gray-500 font-semibold">Premium</th>
            <th className="px-2 py-1.5 text-right text-gray-500 font-semibold">Delta</th>
            <th className="px-2 py-1.5 text-right text-gray-500 font-semibold">Volume</th>
            <th className="px-2 py-1.5 text-right text-gray-500 font-semibold">OI</th>
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
                  border-b border-gray-800/50 cursor-pointer transition-colors
                  ${isSelected
                    ? 'ring-1 ring-inset ring-indigo-500 bg-indigo-950/40'
                    : 'hover:bg-gray-800/60'}
                `}
              >
                <td className={`px-2 py-1.5 text-right ${isSelected ? 'text-indigo-300' : 'text-gray-300'}`}>
                  ${c.strike.toFixed(2)}
                </td>
                <td className="px-2 py-1.5 text-right text-gray-300">
                  {c.premium != null ? `$${c.premium.toFixed(4)}` : '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-gray-400">
                  {c.delta?.toFixed(4) ?? '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-gray-500">
                  {c.volume ?? '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-gray-500">
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

function LegColumn({ label, sublabel, selected, contracts, chainLoading, chainError, onSelect }) {
  return (
    <div className="flex flex-col min-w-0 flex-1 bg-gray-900 rounded border border-gray-800">

      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="text-xs font-bold text-gray-100">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{sublabel}</div>
      </div>

      {/* Current selection details */}
      <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/50">
        <div className="text-xs text-gray-500 mb-1.5 font-semibold uppercase tracking-wide">Selected</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
          <div className="text-gray-500">Strike</div>
          <div className="text-gray-100 text-right">
            {selected.strike != null ? `$${selected.strike.toFixed(2)}` : '—'}
          </div>
          <div className="text-gray-500">Premium</div>
          <div className="text-gray-100 text-right">
            {selected.premium != null ? `$${selected.premium.toFixed(4)}` : '—'}
          </div>
          <div className="text-gray-500">Delta</div>
          <div className="text-gray-100 text-right">
            {selected.delta != null ? selected.delta.toFixed(4) : '—'}
          </div>
          <div className="text-gray-500">Volume</div>
          <div className="text-gray-100 text-right">{selected.volume ?? '—'}</div>
          <div className="text-gray-500">OI</div>
          <div className="text-gray-100 text-right">{selected.oi ?? '—'}</div>
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
    const trade = {
      user_id:       user.id,
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
      net_premium:   metrics?.net_premium  ?? triplet.net_premium,
      spread_width:  metrics?.spread_width ?? triplet.spread_width,
      score:         metrics?.score        ?? triplet.score,
      p_max_profit:  metrics?.p_max_profit ?? triplet.p_max_profit,
      fair_value:    triplet.fair_value,
    }
    const { error } = await supabase.from('tradebook').insert(trade)
    if (error) {
      console.error('Supabase insert error:', error)
      setSaveError(`Save failed: ${error.message}`)
      return
    }
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 3000)
  }

  // ── Guard: no state passed ───────────────────────────────────────────────────
  if (!triplet) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
        <Header />
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <p className="text-gray-400 text-sm">No triplet data. Navigate here from a V3 scan.</p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors"
          >
            Go to Screener
          </button>
        </div>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <Header />

      {/* Summary bar */}
      <div className="px-6 py-3 border-b border-gray-800 bg-gray-900/50 flex items-center gap-8 flex-wrap">
        <div className="text-xs text-gray-500">
          <span className="font-semibold text-gray-300 text-sm">{triplet.ticker}</span>
          <span className="ml-2">· {triplet.expiration}</span>
          {triplet.fair_value != null && (
            <span className="ml-2 text-gray-600">· FV ${triplet.fair_value.toFixed(2)}</span>
          )}
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
          sublabel="Buy ATM call (you pay)"
          selected={selectedA}
          contracts={callChain}
          chainLoading={chainLoading}
          chainError={chainError}
          onSelect={c => setSelectedA({ strike: c.strike, premium: c.premium, delta: c.delta, volume: c.volume, oi: c.oi })}
        />
        <LegColumn
          label="Leg B — Short Call"
          sublabel="Sell OTM call (you collect)"
          selected={selectedB}
          contracts={callChain}
          chainLoading={chainLoading}
          chainError={chainError}
          onSelect={c => setSelectedB({ strike: c.strike, premium: c.premium, delta: c.delta, volume: c.volume, oi: c.oi })}
        />
        <LegColumn
          label="Leg C — Short Put"
          sublabel="Sell OTM put (you collect)"
          selected={selectedC}
          contracts={putChain}
          chainLoading={chainLoading}
          chainError={chainError}
          onSelect={c => setSelectedC({ strike: c.strike, premium: c.premium, delta: c.delta, volume: c.volume, oi: c.oi })}
        />
      </div>

      {/* Action bar */}
      <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-center gap-4">
        <button
          onClick={handleRecalculate}
          className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-gray-100 text-sm font-semibold rounded transition-colors"
        >
          Recalculate
        </button>
        <button
          onClick={handleSave}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded transition-colors"
        >
          Save to Tradebook
        </button>
      </div>

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

function MetricCell({ label, value, highlight }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-gray-600 text-xs">{label}</span>
      <span className={highlight ? 'text-white font-bold text-sm' : 'text-gray-300 text-sm'}>
        {value}
      </span>
    </div>
  )
}
