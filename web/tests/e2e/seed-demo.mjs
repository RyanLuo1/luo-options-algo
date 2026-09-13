// A throwaway account with a realistic Tradebook for a review or click-through:
// one open trade saved from a real scan (so the provenance pill and Rerun work),
// one grading-pending row and one graded row (seeded with the service key).
//   node tests/e2e/seed-demo.mjs [baseUrl]            → prints the credentials, keeps the account
//   node tests/e2e/seed-demo.mjs --cleanup <user id>  → deletes the account and its rows
import { chromium } from 'playwright'
import { BASE, ENV, makeAccount, cleanupAccount, signIn, runScan, rowsFor } from './helpers.mjs'

const SUPABASE_URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL, SERVICE = ENV.SUPABASE_SERVICE_KEY
const admin = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
const rest = (path, init) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...admin, ...(init?.headers || {}) } })

const ci = process.argv.indexOf('--cleanup')
if (ci > -1) {
  const id = process.argv[ci + 1]
  await rest(`trade_outcomes?user_id=eq.${id}`, { method: 'DELETE' })
  await cleanupAccount({ owned: true, id })
  process.exit(0)
}

const acct = await makeAccount('demo')
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await signIn(page, acct)
await runScan(page, 'NVDA, AMD, MU')
await page.getByRole('button', { name: 'Save to Tradebook' }).click(); await page.waitForSelector('[role="status"]')
await browser.close()
const [saved] = await rowsFor(acct, 'tradebook', '*')
const base = { ...saved }; delete base.id; delete base.created_at
const seed = over => ({ ...base, user_id: acct.id, scan_id: null, result_id: null, saved_at: new Date(Date.now() - 86400e3 * 30).toISOString(), ...over })
const ins = await rest('tradebook', { method: 'POST', body: JSON.stringify([
  seed({ ticker: 'MU',  expiration: '2026-08-21', leg_c_strike: 860, leg_a_strike: 1025, leg_b_strike: 1030, net_premium: 10.85, spread_width: 5 }),
  seed({ ticker: 'AMD', expiration: '2026-08-14', leg_c_strike: 150, leg_a_strike: 170, leg_b_strike: 175, net_premium: 6.10, spread_width: 5, leg_a_premium: 9.80, leg_b_premium: 7.40, leg_c_premium: 8.50 }),
  seed({ ticker: 'AMD', expiration: '2026-09-11', saved_at: new Date(Date.now() - 86400e3 * 8).toISOString() }),
]) })
const rows = await ins.json()
const mu = rows.find(r => r.expiration === '2026-08-21'), amd = rows.find(r => r.expiration === '2026-08-14')
await rest('trade_outcomes', { method: 'POST', body: JSON.stringify([
  { tradebook_id: mu.id,  user_id: acct.id, outcome_type: 'expired_capped', stock_price_at_expiration: 1040, leg_a_value: 15, leg_b_liability: 10, leg_c_liability: 0, realized_pnl: 15.85, pnl_per_contract: 1585, notes: 'demo seed' },
  { tradebook_id: amd.id, user_id: acct.id, outcome_type: 'expired_loss',   stock_price_at_expiration: 138.2, leg_a_value: 0, leg_b_liability: 0, leg_c_liability: 11.8, realized_pnl: -5.70, pnl_per_contract: -570, notes: 'demo seed' },
]) })
console.log(JSON.stringify({ email: acct.email, password: acct.password, id: acct.id, url: BASE + '/tradebook' }))
