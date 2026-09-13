import PayoffCurve from './PayoffCurve'
import { Button, Pill } from './ui'
import { fmtMoney0, fmtMoney2, fmtPct0, expiryInfo, rowFigures } from './format'

// The detail panel: the landing's setup dashboard driven by the selected row.
export default function SetupPanel({ row, flags = [], onSave, saving = false, saved = false, saveError = null, onEdit, onViewTradebook, dimmed = false }) {
  if (!row) return null
  const f = rowFigures(row)
  const exp = expiryInfo(row.expiration)
  const spot = row.underlying_price
  const worstShares = 100

  return (
    <section
      aria-label={`Setup detail: ${row.ticker} ${row.expiration}`}
      className={`bg-lc-card rounded-lc shadow-lc p-6 flex flex-col gap-5 transition-opacity ${dimmed ? 'opacity-60' : ''}`}
      aria-busy={dimmed || undefined}
    >
      {/* Head */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="font-display font-bold text-[2rem] leading-none tracking-[-0.02em] flex items-baseline gap-2.5">
          {row.ticker}
          <small className="font-figtree font-medium text-[1rem] text-lc-ink-2 tracking-normal">
            {Number.isFinite(spot) ? `stock at ${fmtMoney2(spot)}` : 'spot unavailable'}
          </small>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Pill>Expires {exp.short}</Pill>
          <Pill tone="quiet">W{row.week}{exp.dte != null ? ` · ${exp.dte}d` : ''}</Pill>
          {flags.map(fl => <Pill key={fl} tone="quiet">{fl}</Pill>)}
        </div>
      </div>

      {/* Legs */}
      <div className="grid grid-cols-3 max-lc:grid-cols-1 gap-3">
        <Leg role="Buy call"  strike={row.leg_a_strike} px={row.leg_a_prem} side="ask" pay />
        <Leg role="Sell call" strike={row.leg_b_strike} px={row.leg_b_prem} side="bid" />
        <Leg role="Sell put"  strike={row.leg_c_strike} px={row.leg_c_prem} side="bid" />
      </div>

      <PayoffCurve row={row} spot={spot} />

      {/* Stats */}
      <div className="grid grid-cols-2 max-lc:grid-cols-1 gap-3">
        <Stat label="Credit collected" value={fmtMoney0(f.credit)} sub="per contract, up front" hi />
        <Stat label="Max profit" value={fmtMoney0(f.maxProfit)} sub={`if ${row.ticker} is above ${row.leg_b_strike}`} />
        <Gauge p={row.p_max_profit} />
        <Stat label="Collateral" value={fmtMoney0(f.collateral)} sub="cash to secure the put while it’s open" />
        <Stat label="Breakeven" value={fmtMoney2(f.breakeven)} sub="below this you lose money" className="col-span-2 max-lc:col-span-1" />
      </div>

      <p className="text-[0.95rem] text-lc-ink-2 leading-[1.55]">
        <strong className="text-lc-ink font-semibold">Worst case:</strong> the stock drops below {row.leg_c_strike} and you own {worstShares} {row.ticker} at an effective {fmtMoney2(f.breakeven)}, which is {fmtMoney0(f.breakeven * worstShares)} of stock. That is the downside in plain dollars.
      </p>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap pt-1">
        {saved ? (
          <Button variant="secondary" onClick={onViewTradebook}>Saved · View Tradebook</Button>
        ) : (
          <Button variant="confirm" onClick={() => !dimmed && onSave?.(row)} disabled={saving || dimmed} aria-busy={saving}>
            {saving ? 'Saving…' : 'Save to Tradebook'}
          </Button>
        )}
        <Button variant="secondary" onClick={() => onEdit?.(row)}>Open in editor</Button>
        {saveError && <span role="alert" className="text-[0.85rem] font-semibold text-lc-loss">{saveError}</span>}
      </div>
    </section>
  )
}

function Leg({ role, strike, px, side, pay }) {
  return (
    <div className="bg-lc-ground rounded-lc-plus p-4 flex flex-col gap-1">
      <span className={`text-[0.85rem] font-semibold ${pay ? 'text-lc-violet' : 'text-lc-ink-2'}`}>{role}</span>
      <span className="font-display font-extrabold text-[1.35rem] leading-tight tracking-[-0.01em] text-lc-ink">{strike}</span>
      <span className="text-[0.92rem] text-lc-ink-2">{fmtMoney2(px)} · {side}</span>
    </div>
  )
}

function Stat({ label, value, sub, hi = false, className = '' }) {
  return (
    <div className={`${hi ? 'bg-lc-violet-soft' : 'bg-lc-ground'} rounded-lc p-4 flex flex-col gap-1 min-w-0 ${className}`}>
      <span className={`text-[0.85rem] font-semibold ${hi ? 'text-lc-violet' : 'text-lc-ink-2'}`}>{label}</span>
      <span className="font-display font-extrabold text-[1.7rem] leading-[1.1] tracking-[-0.02em] text-lc-ink">{value}</span>
      <span className="text-[0.85rem] text-lc-ink-2">{sub}</span>
    </div>
  )
}

// Chance of max profit as a soft arc; the number carries the value.
function Gauge({ p }) {
  const v = Math.max(0, Math.min(1, p ?? 0))
  const len = 264
  return (
    <div className="bg-lc-ground rounded-lc p-4 flex items-center gap-4 min-w-0">
      <svg viewBox="0 0 120 70" className="w-[96px] h-auto shrink-0" fill="none" aria-hidden="true">
        <path d="M12 62 A48 48 0 0 1 108 62" stroke="#EEE9FF" strokeWidth="12" strokeLinecap="round" />
        <path d="M12 62 A48 48 0 0 1 108 62" stroke="#6547E6" strokeWidth="12" strokeLinecap="round" pathLength={len} strokeDasharray={len} strokeDashoffset={len * (1 - v)} />
      </svg>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[0.85rem] font-semibold text-lc-ink-2">Chance of max profit</span>
        <span className="font-display font-extrabold text-[1.7rem] leading-[1.1] tracking-[-0.02em] text-lc-ink">{fmtPct0(p)}</span>
        <span className="text-[0.85rem] text-lc-ink-2">from the options’ own deltas</span>
      </div>
    </div>
  )
}
