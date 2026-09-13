import { fmtMoney0 } from './format'

// Payoff at expiration, per contract, for the three-leg structure. Zones are
// labelled in words (never color alone); the spot price is a marker when known.
// Geometry: x is the stock price over [K_C - pad, K_B + pad]; y is P&L.
const W = 600, H = 250, PADX = 24, TOP = 26, BOTTOM = 44

export default function PayoffCurve({ row, spot, markerLabel = 'spot' }) {
  const kc = row.leg_c_strike, ka = row.leg_a_strike, kb = row.leg_b_strike
  const credit = row.net_premium * 100
  const maxP = (row.net_premium + row.spread_width) * 100
  const breakeven = kc - row.net_premium

  const span = Math.max(kb - kc, 1)
  const xMin = kc - span * 0.45, xMax = kb + span * 0.35
  const lossAtXMin = credit - (kc - xMin) * 100
  const yMin = Math.min(lossAtXMin, -maxP * 0.25), yMax = maxP * 1.1
  const X = p => PADX + ((p - xMin) / (xMax - xMin)) * (W - 2 * PADX)
  const Y = v => TOP + (1 - (v - yMin) / (yMax - yMin)) * (H - TOP - BOTTOM)

  const path = `M${X(xMin)} ${Y(lossAtXMin)} L${X(kc)} ${Y(credit)} L${X(ka)} ${Y(credit)} L${X(kb)} ${Y(maxP)} L${X(xMax)} ${Y(maxP)}`
  const y0 = Y(0)
  const hasSpot = Number.isFinite(spot) && spot > 0
  const spotX = hasSpot ? Math.max(X(xMin), Math.min(X(xMax), X(spot))) : null
  const callsClose = X(kb) - X(ka) < 90
  const zoneWide = { loss: X(kc) - X(xMin) > 56, keep: X(ka) - X(kc) > 64, sweet: X(kb) - X(ka) > 64, capped: X(xMax) - X(kb) > 48 }
  const needLegend = !Object.values(zoneWide).every(Boolean)

  return (
    <div className="border-[1.5px] border-lc-line rounded-lc-plus p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" fill="none" role="img"
        aria-label={`Payoff at expiration per contract: loses below ${kc}, flat at ${fmtMoney0(credit)} credit between ${kc} and ${ka}, rises to ${fmtMoney0(maxP)} at ${kb} and stays there above.`}>
        {/* zones */}
        <rect x={X(xMin)} y={TOP} width={X(kc) - X(xMin)} height={H - TOP - BOTTOM} fill="#FBE3E9" opacity=".55" />
        <rect x={X(kc)} y={TOP} width={X(ka) - X(kc)} height={H - TOP - BOTTOM} fill="#F1EEF3" />
        <rect x={X(ka)} y={TOP} width={X(kb) - X(ka)} height={H - TOP - BOTTOM} fill="#EEE9FF" opacity=".7" />
        <rect x={X(kb)} y={TOP} width={X(xMax) - X(kb)} height={H - TOP - BOTTOM} fill="#F1EEF3" />
        {/* breakeven line */}
        <line x1={PADX} y1={y0} x2={W - PADX} y2={y0} stroke="#E3DEE9" strokeWidth="1.5" strokeDasharray="4 6" />
        <text x={W - PADX} y={y0 - 6} textAnchor="end" fill="#5A5266" fontFamily="Figtree, sans-serif" fontSize="11">break even {breakeven.toFixed(2)}</text>
        {/* spot marker */}
        {hasSpot && (
          <>
            <line x1={spotX} y1={TOP - 4} x2={spotX} y2={H - BOTTOM + 4} stroke="#6547E6" strokeWidth="1.5" strokeDasharray="2 4" />
            <text x={spotX} y={Math.abs(spotX - (X(kb) + X(xMax)) / 2) < 80 ? y0 + 16 : TOP - 8} textAnchor={spotX > W - PADX - 56 ? 'end' : spotX < PADX + 56 ? 'start' : 'middle'} fill="#6547E6" fontFamily="Figtree, sans-serif" fontSize="11" fontWeight="700">{markerLabel} {spot.toFixed(2)}</text>
          </>
        )}
        {/* curve */}
        <path d={path} stroke="#6547E6" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={X(kc)} cy={Y(credit)} r="6" fill="#D4F53C" stroke="#15121A" strokeWidth="3" />
        <circle cx={X(ka)} cy={Y(credit)} r="6" fill="#fff" stroke="#6547E6" strokeWidth="3" />
        <circle cx={X(kb)} cy={Y(maxP)} r="6" fill="#D4F53C" stroke="#15121A" strokeWidth="3" />
        {/* strike labels — when the two calls sit close, anchor them away from each other */}
        <text x={X(kc)} y={H - 22} textAnchor="middle" fill="#15121A" fontFamily="Figtree, sans-serif" fontSize="12" fontWeight="600">sell {kc} put</text>
        <text x={callsClose ? X(ka) - 6 : X(ka)} y={H - 22} textAnchor={callsClose ? 'end' : 'middle'} fill="#6547E6" fontFamily="Figtree, sans-serif" fontSize="12" fontWeight="600">buy {ka} call</text>
        <text x={callsClose ? X(kb) + 6 : X(kb)} y={H - 22} textAnchor={callsClose ? 'start' : 'middle'} fill="#15121A" fontFamily="Figtree, sans-serif" fontSize="12" fontWeight="600">sell {kb} call</text>
        {/* zone words — only where the zone is wide enough to hold them */}
        {zoneWide.loss && <text x={(X(xMin) + X(kc)) / 2} y={H - 6} textAnchor="middle" fill="#C8325A" fontFamily="Figtree, sans-serif" fontSize="11" fontWeight="600">loss zone</text>}
        {zoneWide.keep && <text x={(X(kc) + X(ka)) / 2} y={H - 6} textAnchor="middle" fill="#5A5266" fontFamily="Figtree, sans-serif" fontSize="11" fontWeight="600">keep credit</text>}
        {zoneWide.sweet && <text x={(X(ka) + X(kb)) / 2} y={H - 6} textAnchor="middle" fill="#5A5266" fontFamily="Figtree, sans-serif" fontSize="11" fontWeight="600">sweet spot</text>}
        {zoneWide.capped && <text x={(X(kb) + X(xMax)) / 2} y={H - 6} textAnchor="middle" fill="#5A5266" fontFamily="Figtree, sans-serif" fontSize="11" fontWeight="600">capped</text>}
        {/* value labels — the credit label drops below its line when the line sits near the top */}
        <text x={(X(kc) + X(ka)) / 2} y={Y(credit) < TOP + 30 ? Y(credit) + 20 : Y(credit) - 12} textAnchor="middle" fill="#6547E6" fontFamily="Figtree, sans-serif" fontSize="12" fontWeight="600">+{fmtMoney0(credit)} credit</text>
        <text x={(X(kb) + X(xMax)) / 2} y={Y(maxP) - 12} textAnchor="middle" fill="#6547E6" fontFamily="Figtree, sans-serif" fontSize="12" fontWeight="600">+{fmtMoney0(maxP)} max</text>
      </svg>
      {needLegend && (
        <div className="flex gap-x-4 gap-y-1 flex-wrap text-[0.8rem] mt-2" aria-label="Zones, left to right">
          <span className="inline-flex items-center gap-1.5 text-lc-loss font-semibold"><i className="w-3 h-3 rounded-sm bg-lc-loss-tint border border-lc-loss/40" /> loss zone, below {kc}</span>
          <span className="inline-flex items-center gap-1.5 text-lc-ink-2"><i className="w-3 h-3 rounded-sm bg-lc-ground border border-lc-line" /> keep credit, {kc}–{ka}</span>
          <span className="inline-flex items-center gap-1.5 text-lc-ink-2"><i className="w-3 h-3 rounded-sm bg-lc-violet-soft border border-lc-violet/30" /> sweet spot, {ka}–{kb}</span>
          <span className="inline-flex items-center gap-1.5 text-lc-ink-2"><i className="w-3 h-3 rounded-sm bg-lc-ground border border-lc-line" /> capped, above {kb}</span>
        </div>
      )}
      <div className="flex justify-between gap-3 text-[0.85rem] text-lc-ink-2 mt-2 flex-wrap">
        <span>Payoff at expiration, per contract</span>
        <span>{hasSpot ? 'Stock price →' : markerLabel === 'spot' ? 'Spot price unavailable right now · stock price →' : 'Stock price →'}</span>
      </div>
    </div>
  )
}
