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
export function zeroReasonText(reason, { minCredit, minRocPct, minPPct, minUpsidePct }) {
  const code = typeof reason === 'string' ? reason : reason?.code
  const n = k => Number(reason?.[k] ?? 0).toLocaleString('en-US')
  const credit = `$${Number(minCredit).toLocaleString('en-US')}`
  switch (code) {
    case 'roc':             return `no setup cleared the ${minRocPct}% return floor`
    case 'min_credit':      return Number(minCredit) === 0 ? `${n('below_min_premium')} candidates were all net debits — no true credit structure exists` : `${n('below_min_premium')} candidates all missed the ${credit} minimum`
    case 'min_p':           return `${n('below_min_p')} candidates cleared ${credit} but failed the scanner’s ${minPPct}% probability rule (shorts expiring worthless, approx.)`
    case 'min_credit_or_p': return `${n('below_min_premium')} candidates missed the ${credit} minimum; ${n('below_min_p')} cleared it but failed the scanner’s ${minPPct}% probability rule`
    case 'min_upside':      return `${n('below_min_upside')} candidates cleared the credit floor but all missed ${minUpsidePct}% upside per $ of collateral`
    case 'no_legs':         return 'no contract met the delta and liquidity rules'
    case 'liquidity':       return 'no contract met the delta and liquidity rules'
    case 'no_chain':        return 'no options chain returned'
    default:                return null
  }
}

/** One collateral definition everywhere: the put strike × 100, "the cash to secure the put" (per-share basis: the put strike). */
export const collateralOf = row => row.leg_c_strike * 100

const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
/** Chance both short legs expire worthless — the stock finishes between the put and the short call: 1 − δ_B − δ_C (each delta read as P(in the money)). */
export const shortsWorthless = row => clamp01(1 - row.leg_b_delta - row.leg_c_delta)
/** Chance the put is assigned — the stock at or below the put: ≈ δ_C (the loss zone). */
export const pPutAssigned = row => clamp01(row.leg_c_delta)
/** Chance of max profit — the stock at or above the short call: ≈ δ_B. */
export const pMaxApprox = row => clamp01(row.leg_b_delta)
/** The Upside metric: max profit ÷ collateral (per share basis cancels). */
export const upsidePerCollateral = row => (row.leg_c_strike > 0 ? (row.net_premium + row.spread_width) / row.leg_c_strike : 0)
/** Move to max: the rise from spot to the short call, as a share of spot. null without a spot. */
export const moveToMax = row => (row.underlying_price > 0 ? (row.leg_b_strike - row.underlying_price) / row.underlying_price : null)

/** Screener modes. Income is the validated scan; Upside is a calculator, not a recommender. */
export const MODES = {
  income: { label: 'Income', lead: 'Get paid to wait.', line: 'A credit up front; the short call caps the gain, the put means you may own the stock.', pick: 'Income setup' },
  upside: { label: 'Upside', lead: 'Own the upside.',   line: 'A small credit or none, a wide call spread, the same put below.', pick: 'Upside setup' },
}
export const NOT_BACKTESTED = 'Not backtested — calculator only'

/** The incumbent Screener metric: credit as a share of max profit. */
export const creditShareOfMax = row => {
  const max = row.net_premium + row.spread_width
  return max > 0 ? row.net_premium / max : 0
}

/** Today's calendar date in New York, as YYYY-MM-DD (expirations are ET trading days). */
export function todayET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/** Signed per-contract dollars: "+$540" / "−$960" / "$0". */
export const fmtSigned0 = n => {
  if (n == null || Number.isNaN(n)) return '—'
  const v = Math.round(n)
  return v > 0 ? `+$${v.toLocaleString('en-US')}` : v < 0 ? `−$${Math.abs(v).toLocaleString('en-US')}` : '$0'
}

/** Payoff-zone label for a graded outcome, in plain language. */
export const ZONE_LABEL = {
  expired_capped:      'Capped · max profit',
  expired_sweet_spot:  'Sweet spot',
  expired_credit_only: 'Kept the credit',
  expired_breakeven:   'Breakeven',
  expired_loss:        'Loss zone · put assigned',
  expired_partial:     'Partial',
  pending:             'Pending',
}
export const zoneLabel = t => ZONE_LABEL[t] ?? t ?? '—'
/** The same zones, short enough for a table cell. */
export const ZONE_SHORT = { expired_capped: 'Capped', expired_sweet_spot: 'Sweet spot', expired_credit_only: 'Kept credit', expired_breakeven: 'Breakeven', expired_loss: 'Loss', expired_partial: 'Partial', pending: 'Pending' }
export const zoneShort = t => ZONE_SHORT[t] ?? t ?? '—'
/** "2026-09-12T21:34:00Z" → "Sep 12". */
export function fmtDay(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getDate()}`
}

/** The settlement sentence for a graded trade (worst-case slot in the dashboard). */
export function settlementSentence(row, outcome) {
  if (!outcome) return null
  const S = Number(outcome.stock_price_at_expiration)
  const pnl = Number(outcome.pnl_per_contract)
  const credit = row.net_premium * 100
  const maxP = (row.net_premium + row.spread_width) * 100
  const at = `Settled at ${fmtMoney2(S)}`
  switch (outcome.outcome_type) {
    case 'expired_capped':      return `${at} — you captured the full spread (${fmtMoney0(maxP)}, max profit).`
    case 'expired_sweet_spot':  return `${at} — the long call finished in the money; you made ${fmtSigned0(pnl)} of the ${fmtMoney0(maxP)} max.`
    case 'expired_credit_only': return credit > 0.5 ? `${at} — every leg expired worthless; you kept the full credit (${fmtMoney0(credit)}).` : `${at} — every leg expired worthless; nothing gained, nothing lost.`
    case 'expired_breakeven':   return `${at} — the put assignment cost about what the credit paid; you broke even.`
    case 'expired_loss':        return `${at} — you lost ${fmtMoney0(Math.abs(pnl))} (put assigned at ${row.leg_c_strike}).`
    default:                    return `${at} — realized ${fmtSigned0(pnl)} per contract.`
  }
}

/** A saved trade as the setup shape the dashboard and editor consume (leg_x_premium → leg_x_prem). */
export function tradeAsSetup(t) {
  return {
    ticker: t.ticker, expiration: t.expiration, week: t.week ?? null,
    leg_a_strike: t.leg_a_strike, leg_a_prem: t.leg_a_premium, leg_a_delta: t.leg_a_delta,
    leg_b_strike: t.leg_b_strike, leg_b_prem: t.leg_b_premium, leg_b_delta: t.leg_b_delta,
    leg_c_strike: t.leg_c_strike, leg_c_prem: t.leg_c_premium, leg_c_delta: t.leg_c_delta,
    net_premium: t.net_premium, spread_width: t.spread_width, score: t.score, p_max_profit: t.p_max_profit,
    result_id: t.result_id ?? null, scan_id: t.scan_id ?? null, mode: t.mode ?? 'income',
  }
}

/** "2026-09-12T21:34:00Z" → "Sep 12 21:34" (local time). */
export function fmtWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Row key for a saved trade. */
export const tradeKey = t => String(t.id)

/** The Tradebook's default order: open first (nearest expiration on top, grading-pending among them), then graded, newest expiration first. */
export function defaultTradeOrder(trades) {
  return [...trades].sort((a, b) => {
    const ga = a.status === 'graded' ? 1 : 0, gb = b.status === 'graded' ? 1 : 0
    if (ga !== gb) return ga - gb
    return ga === 0 ? a.expiration.localeCompare(b.expiration) : b.expiration.localeCompare(a.expiration)
  })
}
