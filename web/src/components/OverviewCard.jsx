/**
 * OverviewCard — one ticker's single best Call Spread Risk Reversal setup,
 * rendered as a rich "top pick" card for the per-ticker overview section.
 *
 * Data comes from the scan response's by_ticker[i] entry:
 *   { ticker, best, count }
 * where `best` is the highest-score triplet for that ticker (same shape as a
 * flat ranked entry) and carries `underlying_price` (live yfinance spot) and
 * `result_id`.
 *
 * Pure presentation — all colors/fonts come from the design tokens
 * (bg-surface, border-subtle/accent, text-profit, loss-dim/profit-dim, .num).
 *
 * Props:
 *   ticker   — symbol
 *   best     — the best triplet object
 *   count    — how many qualifying triplets this ticker produced
 *   isBest   — true for the highest-score card → shows the 'best' badge
 *   selected — true when this card is the active filter → accent border + ring
 *              (distinct from isBest: on a fresh scan nothing is `selected`)
 *   compact  — true in the horizontal overview row; drops the under-bar zone
 *              labels so the card stays readable at its narrower (~260px) width
 *   onSelect — clicking the card toggles the single-ticker filter (table + detail)
 *
 * The card itself is intentionally light — ticker, collected-credit header, and
 * the payoff bar only. All numeric setup stats and the leg breakdown live in the
 * detail panel (see SetupDetail), shown for the filtered/selected setup.
 */

// Whole-dollar formatting with thousands separators (per-contract money).
function money0(n) {
  return Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export default function OverviewCard({ ticker, best, count, isBest = false, selected = false, compact = false, onSelect }) {
  if (!best) return null

  const legC = best.leg_c_strike   // short put  (lowest strike)
  const legA = best.leg_a_strike   // long call  (ATM)
  const legB = best.leg_b_strike   // short call (highest strike)
  const now  = best.underlying_price

  // Per-contract money (one option contract = 100 shares).
  const collected = best.net_premium * 100

  // Payoff-zone bar bounds: ~10% below the put strike to ~10% above the short
  // call strike, so all three zones are visible and the 'now' marker lands
  // inside for any reasonable spot price.
  const lo = legC * 0.9
  const hi = legB * 1.1
  const span = hi - lo
  const pct = (x) => (span > 0 ? Math.max(0, Math.min(100, ((x - lo) / span) * 100)) : 0)
  const pctC   = pct(legC)
  const pctA   = pct(legA)
  const pctNow = now != null ? pct(now) : null

  return (
    <div
      onClick={onSelect}
      className={`relative rounded-lg bg-surface px-4 py-3 flex flex-col gap-3 cursor-pointer
                  transition-colors hover:bg-surface-raised
                  ${selected ? 'border border-accent ring-1 ring-accent' : 'border border-subtle'}`}
    >
      {/* 'best' badge */}
      {isBest && (
        <span className="absolute -top-2 left-3 text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent text-primary">
          best
        </span>
      )}

      {/* ── Header: ticker + meta on the left, net collected on the right ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-primary text-sm">
            {ticker}
            <span className="ml-2 text-tertiary text-[11px] font-normal">{count} setup{count === 1 ? '' : 's'}</span>
          </div>
          <div className="text-secondary text-[11px] num">
            {best.expiration} · W{best.week}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="num text-profit font-bold text-base leading-none">
            +${money0(collected)}
          </div>
          <div className="text-tertiary text-[10px] mt-0.5">collected / contract</div>
        </div>
      </div>

      {/* ── Payoff-zone bar ── */}
      <div className="relative pt-4 pb-0.5">
        {/* 'now' price label, centered over the marker */}
        {pctNow != null && (
          <div
            className="absolute top-0 num text-[10px] text-secondary whitespace-nowrap"
            style={{ left: `${pctNow}%`, transform: 'translateX(-50%)' }}
          >
            ${money0(now)}
          </div>
        )}

        {/* the bar: three zones, left→right (loss · credit-only · max) */}
        <div className="relative h-2.5 rounded-full overflow-hidden border border-subtle">
          <div className="absolute inset-y-0 left-0 bg-loss-dim"   style={{ width: `${pctC}%` }} />
          <div className="absolute inset-y-0 bg-surface-raised"    style={{ left: `${pctC}%`, width: `${Math.max(0, pctA - pctC)}%` }} />
          <div className="absolute inset-y-0 right-0 bg-profit-dim" style={{ width: `${Math.max(0, 100 - pctA)}%` }} />
        </div>

        {/* 'now' marker line — sibling of the bar so it isn't clipped */}
        {pctNow != null && (
          <div
            className="absolute -top-0.5 w-0.5 bg-accent pointer-events-none"
            style={{ left: `${pctNow}%`, height: '1.125rem', transform: 'translateX(-50%)' }}
          />
        )}
      </div>

      {/* under-bar zone labels (dropped in compact mode to avoid collision) */}
      {!compact && (
        <div className="flex items-center justify-between text-[10px] text-tertiary -mt-1.5">
          <span>loss &lt;${money0(legC)}</span>
          <span>max zone</span>
        </div>
      )}
      {/* The full setup stats (max profit / score / P(profit) / legs) live in the
          detail panel now — click the card to open it there. */}
    </div>
  )
}
