import PayoffCurve from './PayoffCurve'
import { Button, Pill } from './ui'
import { fmtMoney0, fmtMoney2, fmtPct0, fmtSigned0, expiryInfo, rowFigures, rocOf, zoneLabel, settlementSentence, shortsWorthless, pMaxApprox, pPutAssigned, upsidePerCollateral } from './format'

// The detail panel: the setup dashboard, one component in two states.
//   • open (default): live spot marker, P(max) gauge, the worst-case sentence.
//   • graded: pass `settlement` (an outcome row) — a different shape: the
//     Realized P&L card and the settlement sentence lead, and the setup as
//     saved (legs, curve with the settled marker, figures) folds below.
//   • expired but ungraded (`expired`): the open shape with a "Grade pending"
//     tile in the gauge slot and an expired outcome line.
// `actions` replaces the default Save / Open-in-editor row (the Tradebook passes
// its own); `note` is an optional one-line caption under the actions; `spot`
// overrides the row's own underlying price (the Tradebook fetches it live).
export default function SetupPanel({
  row, flags = [], spot: spotProp, settlement = null, expired: expiredProp, statusPill = null, provenance = null,
  onSave, saving = false, saved = false, saveError = null, onEdit, onViewTradebook,
  actions, note, dimmed = false, stickyActions = false, mode = 'income',
}) {
  if (!row) return null
  const f = rowFigures(row)
  const exp = expiryInfo(row.expiration)
  const graded = !!settlement
  const expired = expiredProp ?? graded
  const spot = graded ? Number(settlement.stock_price_at_expiration) : expired ? null : (spotProp ?? row.underlying_price)
  const worstShares = 100
  const pnl = graded ? Number(settlement.pnl_per_contract) : null

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
            {graded ? `settled at ${fmtMoney2(spot)}` : expired ? `expired ${exp.short} · grade pending` : Number.isFinite(spot) ? `stock at ${fmtMoney2(spot)}` : 'spot unavailable'}
          </small>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {statusPill}
          {mode === 'upside' && <Pill tone="quiet">Upside</Pill>}
          <Pill>{expired ? `Expired ${exp.short}` : `Expires ${exp.short}`}</Pill>
          {!expired && <Pill tone="quiet">{row.week ? `W${row.week}` : ''}{row.week && exp.dte != null ? ' · ' : ''}{exp.dte != null ? `${exp.dte}d` : ''}</Pill>}
          {flags.length > 3
            ? <Pill tone="quiet" title={flags.join(' · ')}>{flags.length} macro events before expiry</Pill>
            : flags.map(fl => <Pill key={fl} tone="quiet">{fl}</Pill>)}
        </div>
      </div>

      {provenance}

      {graded ? (
        <>
          {/* The answer first: realized P&L beside the settlement sentence. */}
          <div className="grid grid-cols-[minmax(11rem,auto)_1fr] max-lc:grid-cols-1 gap-4 items-stretch">
            <RealizedCard pnl={pnl} zone={zoneLabel(settlement.outcome_type)} hero />
            <p className="text-[1.05rem] text-lc-ink leading-[1.55] self-center">
              <strong className="font-semibold">Outcome:</strong> {settlementSentence(row, settlement)}
            </p>
          </div>
          {/* The setup as saved, folded. */}
          <details className="group rounded-lc-plus border-[1.5px] border-lc-line">
            <summary className="list-none cursor-pointer select-none flex items-center justify-between gap-3 px-4 py-3 rounded-lc-plus hover:bg-lc-ground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-lc-violet [&::-webkit-details-marker]:hidden">
              <span className="flex items-baseline gap-2 flex-wrap min-w-0">
                <span className="text-[0.95rem] font-semibold text-lc-ink">The setup as saved</span>
                <span className="text-[0.85rem] text-lc-ink-2 [font-variant-numeric:tabular-nums]">{row.leg_c_strike} / {row.leg_a_strike} / {row.leg_b_strike} · credit {fmtMoney0(f.credit)} · max {fmtMoney0(f.maxProfit)}</span>
              </span>
              <svg viewBox="0 0 16 16" className="w-4 h-4 shrink-0 text-lc-ink-2 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6l5 5 5-5" /></svg>
            </summary>
            <div className="px-4 pb-4 pt-1 flex flex-col gap-4">
              <Legs row={row} />
              <PayoffCurve row={row} spot={spot} markerLabel="settled" />
              <div className="grid grid-cols-2 max-lc:grid-cols-1 gap-3">
                <Stat label={f.debit ? 'Debit paid' : 'Credit collected'} value={fmtMoney0(Math.abs(f.credit))} sub={f.debit ? 'per contract, paid to open' : `per contract, up front · ${(rocOf(row) * 100).toFixed(1)}% of collateral`} />
                <Stat label="Max profit" value={fmtMoney0(f.maxProfit)} sub={`if ${row.ticker} had finished above ${row.leg_b_strike}`} />
                <Stat label="Collateral" value={fmtMoney0(f.collateral)} sub="cash that secured the put" />
                <Stat label="Breakeven" value={f.breakeven == null ? '—' : fmtMoney2(f.breakeven)} sub={f.breakeven == null ? 'none — max profit was below zero' : 'below this the trade lost money'} />
              </div>
            </div>
          </details>
        </>
      ) : (
        <>
          <Legs row={row} />

          <PayoffCurve row={row} spot={spot} markerLabel={expired ? 'settled' : 'spot'} />

          {/* Stats */}
          <div className="grid grid-cols-2 max-lc:grid-cols-1 gap-3">
            <Stat label={f.debit ? 'Debit paid' : 'Credit collected'} value={fmtMoney0(Math.abs(f.credit))} sub={f.debit ? 'per contract, paid to open — the flat zone is a loss' : f.credit > 0.5 ? `per contract, up front · ${(rocOf(row) * 100).toFixed(1)}% of collateral` : 'none — this setup costs nothing to open'} hi={mode !== 'upside'} />
            <Stat label="Max profit" value={fmtMoney0(f.maxProfit)} sub={mode === 'upside' ? `${(upsidePerCollateral(row) * 100).toFixed(1)}% of collateral · if ${row.ticker} ${expired ? 'finished' : 'is'} above ${row.leg_b_strike}` : `if ${row.ticker} ${expired ? 'finished' : 'is'} above ${row.leg_b_strike}`} hi={mode === 'upside'} />
            {expired
              ? <Stat label="Grade pending" value="—" sub="posts after the next close" />
              : <Gauge row={row} />}
            <Stat label="Collateral" value={fmtMoney0(f.collateral)} sub={expired ? 'cash that secured the put' : 'cash to secure the put while it’s open'} />
            <Stat label="Breakeven" value={f.breakeven == null ? '—' : fmtMoney2(f.breakeven)} sub={f.breakeven == null ? 'none — max profit is below zero' : f.debit ? `below this you lose money (the debit needs ${row.ticker} above ${row.leg_a_strike})` : 'below this you lose money'} className={expired ? 'col-span-2 max-lc:col-span-1' : ''} />
          </div>

          <p className="text-[0.95rem] text-lc-ink-2 leading-[1.55]">
            {expired ? (
              <><strong className="text-lc-ink font-semibold">Outcome:</strong> expired {exp.short}. The closing price on expiration decides the zone; the grade posts after the next close.</>
            ) : (
              <><strong className="text-lc-ink font-semibold">Worst case:</strong> the stock drops below {row.leg_c_strike} and you own {worstShares} {row.ticker} at an effective {fmtMoney2(f.effectiveCost)}, which is {fmtMoney0(f.effectiveCost * worstShares)} of stock. That is the downside in plain dollars.</>
            )}
          </p>
        </>
      )}

      {/* Actions — with `stickyActions` the row pins to the bottom edge of the panel's scroll container */}
      <div className={stickyActions ? 'sticky bottom-0 -mx-6 -mb-6 px-6 pb-5 pt-3 bg-lc-card rounded-b-lc border-t border-lc-line/70' : ''}>
      <div className="flex items-center gap-3 flex-wrap pt-1">
        {actions ?? (
          <>
            {saved ? (
              <Button variant="secondary" onClick={onViewTradebook}>Saved · View Tradebook</Button>
            ) : (
              <Button variant="confirm" onClick={() => !dimmed && onSave?.(row)} disabled={saving || dimmed} aria-busy={saving}>
                {saving ? 'Saving…' : 'Save to Tradebook'}
              </Button>
            )}
            <Button variant="secondary" onClick={() => onEdit?.(row)}>Open in editor</Button>
            {saveError && <span role="alert" className="text-[0.85rem] font-semibold text-lc-loss">{saveError}</span>}
          </>
        )}
      </div>
      {note && <p className="text-[0.82rem] text-lc-ink-2 mt-2">{note}</p>}
      </div>
    </section>
  )
}

// Thin-quote setups carry each leg's volume and open interest. A leg below the volume floor wears a
// quiet dashed edge; hovering (or focusing) any leg tile that has the figures shows them.
const THIN_FLOOR = 20
function Legs({ row }) {
  const num = k => (Number.isFinite(row[k]) ? row[k] : null)
  return (
    <div className="grid grid-cols-3 max-lc:grid-cols-1 gap-3">
      <Leg role="Buy call"  strike={row.leg_a_strike} px={row.leg_a_prem} side="ask" pay volume={num('leg_a_volume')} oi={num('leg_a_oi')} />
      <Leg role="Sell call" strike={row.leg_b_strike} px={row.leg_b_prem} side="bid" volume={num('leg_b_volume')} oi={num('leg_b_oi')} />
      <Leg role="Sell put"  strike={row.leg_c_strike} px={row.leg_c_prem} side="bid" volume={num('leg_c_volume')} oi={num('leg_c_oi')} />
    </div>
  )
}

function Leg({ role, strike, px, side, pay, volume = null, oi = null }) {
  const thin = volume != null && volume < THIN_FLOOR
  const hasFigures = volume != null
  const n = v => (v == null ? '—' : Number(v).toLocaleString('en-US'))
  return (
    <div className={`relative group rounded-lc-plus p-4 flex flex-col gap-1 outline-none ${thin ? 'bg-lc-ground border-[1.5px] border-dashed border-lc-violet/50' : 'bg-lc-ground'}`}
      data-thin={thin || undefined} tabIndex={hasFigures ? 0 : undefined} aria-describedby={hasFigures ? `leg-${role.replace(/\s/g, '-')}-${strike}` : undefined}>
      <span className={`text-[0.85rem] font-semibold ${pay ? 'text-lc-violet' : 'text-lc-ink-2'}`}>{role}</span>
      <span className="font-display font-extrabold text-[1.35rem] leading-tight tracking-[-0.01em] text-lc-ink">{strike}</span>
      <span className="text-[0.92rem] text-lc-ink-2">{fmtMoney2(px)} · {side}</span>
      {hasFigures && (
        <span id={`leg-${role.replace(/\s/g, '-')}-${strike}`} role="tooltip" data-leg-figures
          className="pointer-events-none absolute left-0 top-full mt-2 z-20 w-56 rounded-lc-half bg-lc-ink text-lc-card text-[0.8rem] leading-[1.45] px-3 py-2 shadow-lc-lift hidden group-hover:block group-focus-within:block [font-variant-numeric:tabular-nums]">
          Volume {n(volume)} today · Open interest {n(oi)}{thin ? ` — below the ${THIN_FLOOR}-contract volume floor` : ''}
        </span>
      )}
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

// Realized P&L for a graded trade: the profit/loss pair, always with a sign, plus the zone in words.
function RealizedCard({ pnl, zone, hero = false }) {
  const tone = pnl > 0 ? 'profit' : pnl < 0 ? 'loss' : 'flat'
  const bg = tone === 'profit' ? 'bg-lc-profit-tint' : tone === 'loss' ? 'bg-lc-loss-tint' : 'bg-lc-ground'
  const ink = tone === 'profit' ? 'text-lc-profit' : tone === 'loss' ? 'text-lc-loss-ink' : 'text-lc-ink'
  return (
    <div className={`${bg} rounded-lc p-4 flex flex-col gap-1 min-w-0 ${hero ? 'justify-center' : ''}`}>
      <span className={`text-[0.85rem] font-semibold ${tone === 'flat' ? 'text-lc-ink-2' : ink}`}>Realized P&amp;L</span>
      <span className={`font-display font-extrabold ${hero ? 'text-[2.2rem]' : 'text-[1.7rem]'} leading-[1.1] tracking-[-0.02em] ${ink}`}>{fmtSigned0(pnl)}</span>
      <span className={`text-[0.85rem] ${tone === 'flat' ? 'text-lc-ink-2' : ink}`}>per contract · {zone}</span>
    </div>
  )
}

// Chance the short legs expire worthless (1 − δ_B − δ_C) as a soft arc, with the
// chance of max profit (≈ δ_B, the stock at or above the short call) as a second
// figure beside it. Spans both stat columns.
function Gauge({ row }) {
  const p = shortsWorthless(row)
  const v = Math.max(0, Math.min(1, p ?? 0))
  const len = 264
  return (
    <div className="bg-lc-ground rounded-lc p-4 col-span-2 max-lc:col-span-1 flex items-center gap-4 min-w-0">
      <svg viewBox="0 0 120 70" className="w-[64px] h-auto shrink-0" fill="none" aria-hidden="true">
        <path d="M12 62 A48 48 0 0 1 108 62" stroke="#EEE9FF" strokeWidth="12" strokeLinecap="round" />
        <path d="M12 62 A48 48 0 0 1 108 62" stroke="#6547E6" strokeWidth="12" strokeLinecap="round" pathLength={len} strokeDasharray={len} strokeDashoffset={len * (1 - v)} />
      </svg>
      <div className="grid grid-cols-[1.3fr_1fr_1fr] max-lc:grid-cols-1 gap-x-5 gap-y-1 flex-1 min-w-0">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[0.85rem] font-semibold text-lc-ink-2">Chance the short legs expire worthless</span>
          <span className="font-display font-extrabold text-[1.7rem] leading-[1.1] tracking-[-0.02em] text-lc-ink" data-shorts-worthless={p.toFixed(4)}>{fmtPct0(p)}</span>
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[0.85rem] font-semibold text-lc-ink-2">Chance of max profit</span>
          <span className="font-display font-extrabold text-[1.7rem] leading-[1.1] tracking-[-0.02em] text-lc-ink" title="≈ the delta of the short call: the stock at or above it">≈ {fmtPct0(pMaxApprox(row))}</span>
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[0.85rem] font-semibold text-lc-ink-2">Chance the put is assigned</span>
          <span className="font-display font-extrabold text-[1.7rem] leading-[1.1] tracking-[-0.02em] text-lc-ink" title="≈ the delta of the put: the stock at or below it — the loss zone">≈ {fmtPct0(pPutAssigned(row))}</span>
        </div>
        <span className="col-span-3 max-lc:col-span-1 text-[0.85rem] text-lc-ink-2">{row.net_premium < 0 ? 'the three add up: worthless shorts still leave the debit unpaid unless the stock clears the call you bought, the short call caps the win, the put is where you own the stock' : 'the three add up: worthless shorts keep at least the credit, the short call caps the win, the put is where you own the stock'}</span>
      </div>
    </div>
  )
}
