/**
 * SetupDetail — the rich detail block for the selected setup. It sits as a
 * compact **band at the top of the right detail column**, stacked ABOVE the
 * chart (the chart fills the remaining height below it). `shrink-0` so it keeps
 * its natural height and never steals the chart's space.
 *
 * Shows: setup stats (net premium collected, max profit, score, P(profit)), the
 * full three-leg breakdown (strike / premium / delta, color-coded per the
 * existing convention — Leg A = you pay / sky, Leg B & C = you collect / profit),
 * spread width, fair value, and the Save / Open-in-editor actions.
 *
 * Pure presentation; all colors from design tokens. Per-contract dollars use
 * × 100 (one option contract = 100 shares).
 */

function money0(n) {
  return Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function LegRow({ label, labelClass, premClass, strike, prem, delta }) {
  return (
    <>
      <span className={`${labelClass} whitespace-nowrap`}>{label}</span>
      <span className="num text-right text-secondary">{strike != null ? `$${strike.toFixed(2)}` : '—'}</span>
      <span className={`num text-right ${premClass}`}>{prem != null ? `$${prem.toFixed(2)}` : '—'}</span>
      <span className="num text-right text-secondary">{delta != null ? delta.toFixed(2) : '—'}</span>
    </>
  )
}

function Stat({ label, value, cls = 'text-primary' }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-tertiary text-[10px]">{label}</span>
      <span className={`num font-semibold ${cls}`}>{value}</span>
    </span>
  )
}

export default function SetupDetail({ setup, onSave, onEdit }) {
  if (!setup) return null

  const collected = (setup.net_premium ?? 0) * 100
  // Spread width is derived from the actual leg strikes (K_B − K_A) — the same
  // basis the realized-P&L / max-profit math uses — falling back to the stored
  // spread_width only if a strike is missing. This keeps max profit consistent
  // with the strikes even if a row ever carries a stale spread_width column.
  const spreadWidth = (setup.leg_b_strike != null && setup.leg_a_strike != null)
    ? setup.leg_b_strike - setup.leg_a_strike
    : (setup.spread_width ?? 0)
  const maxProfit = ((setup.net_premium ?? 0) + spreadWidth) * 100

  return (
    <div className="shrink-0 mb-2 rounded border border-subtle bg-surface px-3 py-2.5 flex flex-col gap-2 text-xs">

      {/* ── Setup stats ── */}
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
        <span className="font-bold text-primary">{setup.ticker}</span>
        <span className="num text-secondary">{setup.expiration} · W{setup.week}</span>
        <Stat label="collected"  value={`+$${money0(collected)}`} cls="text-profit" />
        <Stat label="max profit" value={`$${money0(maxProfit)}`}  cls="text-profit" />
        <Stat label="score"      value={setup.score?.toFixed(2) ?? '—'} />
        <Stat label="P(profit)"  value={setup.p_max_profit != null ? `${(setup.p_max_profit * 100).toFixed(1)}%` : '—'} />
      </div>

      {/* ── Leg breakdown ── */}
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-3 gap-y-1 pt-1 border-t border-subtle">
        <span className="text-tertiary text-[10px]">leg</span>
        <span className="text-tertiary text-[10px] text-right">strike</span>
        <span className="text-tertiary text-[10px] text-right">prem</span>
        <span className="text-tertiary text-[10px] text-right">delta</span>

        <LegRow
          label="A · long call"  labelClass="text-sky-400"  premClass="text-sky-400"
          strike={setup.leg_a_strike} prem={setup.leg_a_prem} delta={setup.leg_a_delta}
        />
        <LegRow
          label="B · short call" labelClass="text-profit"   premClass="text-profit"
          strike={setup.leg_b_strike} prem={setup.leg_b_prem} delta={setup.leg_b_delta}
        />
        <LegRow
          label="C · short put"  labelClass="text-profit"   premClass="text-profit"
          strike={setup.leg_c_strike} prem={setup.leg_c_prem} delta={setup.leg_c_delta}
        />
      </div>

      {/* ── Spread + actions ── */}
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap pt-1 border-t border-subtle">
        <span className="text-tertiary">spread <span className="num text-secondary">{spreadWidth ? spreadWidth.toFixed(2) : '—'}</span></span>
        <div className="ml-auto flex items-center gap-3">
          {onSave && (
            <button onClick={onSave} className="text-link font-medium hover:underline">Save</button>
          )}
          {onEdit && (
            <button onClick={onEdit} className="text-link font-medium hover:underline">Open in editor ›</button>
          )}
        </div>
      </div>
    </div>
  )
}
