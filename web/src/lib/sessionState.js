/**
 * sessionStorage-backed persistence for screener state and scan results.
 *
 * Two keys, both session-scoped (cleared automatically when the tab closes):
 *   - luo-capital-screener-state    : App.jsx control state (mode, tickers, filters, etc.)
 *   - luo-capital-screener-results  : useOptionsData scan response (result)
 *
 * State survives in-session navigation (e.g. screener → /trade → back) but is
 * wiped on logout (Header) or when the tab closes (browser default).
 */

const STATE_KEY   = 'luo-capital-screener-state'
const RESULTS_KEY = 'luo-capital-screener-results'

function safeLoad(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function safeSave(key, obj) {
  try {
    sessionStorage.setItem(key, JSON.stringify(obj))
  } catch {
    // ignore quota / serialization errors — persistence is best-effort
  }
}

export function loadScreenerState()    { return safeLoad(STATE_KEY) }
export function saveScreenerState(s)   { safeSave(STATE_KEY, s) }
export function loadScreenerResults()  { return safeLoad(RESULTS_KEY) }
export function saveScreenerResults(r) { safeSave(RESULTS_KEY, r) }

export function clearScreenerSession() {
  try {
    sessionStorage.removeItem(STATE_KEY)
    sessionStorage.removeItem(RESULTS_KEY)
  } catch {
    // ignore
  }
}
