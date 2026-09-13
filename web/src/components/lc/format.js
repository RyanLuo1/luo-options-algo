// Formatting helpers for the v1 app components (kept out of ui.jsx so that
// file only exports components — Fast Refresh requirement).

/** Money and figure formatting (per-contract dollars; Money Is Ink). */
export const fmtMoney0 = n => (n == null || Number.isNaN(n) ? '—' : `$${Math.round(n).toLocaleString('en-US')}`)
export const fmtMoney2 = n => (n == null || Number.isNaN(n) ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
export const fmtPct0   = p => (p == null ? '—' : `${Math.round(p * 100)}%`)
export const fmtStrike = k => (k == null ? '—' : String(k))

export const INPUT_CLASS =
  'h-11 w-full min-w-0 px-3.5 rounded-lc-half bg-lc-card text-lc-ink border-[1.5px] border-lc-line ' +
  'placeholder:text-lc-ink-2 disabled:bg-lc-ground-deep disabled:text-lc-ink-2 ' +
  'text-[0.95rem] font-figtree [font-variant-numeric:tabular-nums]'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
/** "2026-10-17" → { short: "Oct 17", dte: 34 } (calendar days to expiration from today). */
export function expiryInfo(iso) {
  if (!iso) return { short: '—', dte: null }
  const [y, m, d] = iso.split('-').map(Number)
  const exp = new Date(Date.UTC(y, m - 1, d))
  const now = new Date()
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const dte = Math.round((exp - today) / 86400000)
  return { short: `${MONTHS[m - 1]} ${d}`, dte }
}

/** Per-contract derived figures for a ranked row (100 shares per contract). */
export function rowFigures(r) {
  const credit     = r.net_premium * 100
  const maxProfit  = (r.net_premium + r.spread_width) * 100
  const collateral = r.leg_c_strike * 100
  const breakeven  = r.leg_c_strike - r.net_premium
  return { credit, maxProfit, collateral, breakeven }
}

/** The four-tab shell definition (Tradebook is a route; Picks/Performance are locked). */
export const TABS = [
  { id: 'screener',    label: 'Screener',    free: true },
  { id: 'tradebook',   label: 'Tradebook',   free: true, href: '/tradebook' },
  { id: 'picks',       label: 'Picks',       locked: true },
  { id: 'performance', label: 'Performance', locked: true },
]

/** Stable identity for a ranked row (ticker + expiration + the three strikes). */
export const rowKey = r => `${r.ticker}-${r.expiration}-${r.leg_a_strike}-${r.leg_b_strike}-${r.leg_c_strike}`

/** Return on collateral: credit as a share of the cash the put ties up (per-share basis cancels). */
export const rocOf = row => (row.leg_c_strike > 0 ? row.net_premium / row.leg_c_strike : 0)

/** Why a scanned ticker produced no setups, in words (API reason codes + the client-side ROC floor). */
export function zeroReasonText(code, { minCredit, minRocPct, minPPct }) {
  switch (code) {
    case 'roc':              return `no setup cleared the ${minRocPct}% return floor`
    case 'min_credit':       return `no setup cleared the $${Number(minCredit).toLocaleString('en-US')} minimum`
    case 'min_p':            return `no setup cleared the ${minPPct}% P(max) floor`
    case 'min_credit_or_p':  return `no setup cleared the $${Number(minCredit).toLocaleString('en-US')} minimum or the ${minPPct}% P(max) floor`
    case 'liquidity':        return 'liquidity guards (no leg with a live two-sided quote)'
    case 'no_chain':         return 'no options chain returned'
    default:                 return null
  }
}

/** The incumbent Screener metric: credit as a share of max profit. */
export const creditShareOfMax = row => {
  const max = row.net_premium + row.spread_width
  return max > 0 ? row.net_premium / max : 0
}
