// Shared helpers for the Screener end-to-end scripts (plain Node + Playwright, no runner).
// Run from web/: `node tests/e2e/<script>.mjs [baseUrl]`. Default base: http://127.0.0.1:5002.
// Accounts: each script creates a throwaway account through the public sign-up API using
// the project's .env / web/.env, and deletes it (and its rows) when done. Set E2E_EMAIL and
// E2E_PASSWORD to use an existing account instead (then nothing is deleted).
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const here = path.dirname(fileURLToPath(import.meta.url))
export const WEB_ROOT = path.resolve(here, '..', '..')
export const PROJECT_ROOT = path.resolve(WEB_ROOT, '..')
export const OUT_DIR = process.env.E2E_OUT || path.join(WEB_ROOT, 'tests', 'e2e', 'out')

export const BASE = process.argv[2] && /^https?:/.test(process.argv[2]) ? process.argv[2] : (process.env.E2E_BASE || 'http://127.0.0.1:5002')

function parseEnv(p) {
  try { return Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] })) }
  catch { return {} }
}
export const ENV = { ...parseEnv(path.join(PROJECT_ROOT, '.env')), ...parseEnv(path.join(WEB_ROOT, '.env')) }
const SUPABASE_URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL
const ANON = ENV.VITE_SUPABASE_ANON_KEY || ENV.SUPABASE_ANON_KEY
const SERVICE = ENV.SUPABASE_SERVICE_KEY
const adminHeaders = () => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}` })

let failures = 0
export const log = (name, ok, note = '') => { if (!ok) failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`) }
export const finish = () => { console.log(failures ? `${failures} FAILED` : 'ALL PASSED'); process.exit(failures ? 1 : 0) }

/** A fresh throwaway account (or the E2E_EMAIL/E2E_PASSWORD one). */
export async function makeAccount(tag = 'e2e') {
  if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) return { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD, id: null, owned: false }
  if (!SUPABASE_URL || !ANON) throw new Error('Need SUPABASE_URL + anon key in .env / web/.env, or E2E_EMAIL/E2E_PASSWORD')
  const email = `ryanleeluo2+luotest-${tag}-${Date.now()}@gmail.com`, password = `Luo-${tag}-2026!x`
  const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const d = await r.json()
  if (!d.user?.id) throw new Error('sign-up failed: ' + JSON.stringify(d).slice(0, 200))
  return { email, password, id: d.user.id, owned: true }
}

/** Delete the throwaway account's rows and the account itself. No-op for E2E_EMAIL accounts. */
export async function cleanupAccount(acct) {
  if (!acct?.owned || !acct.id || !SERVICE) return
  for (const t of ['tradebook', 'watchlists']) await fetch(`${SUPABASE_URL}/rest/v1/${t}?user_id=eq.${acct.id}`, { method: 'DELETE', headers: adminHeaders() })
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${acct.id}`, { method: 'DELETE', headers: adminHeaders() })
  console.log(`cleanup account: ${r.status}`)
}

/** Rows this account has in a table (service key). */
export async function rowsFor(acct, table, select = '*') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${acct.id}&select=${select}`, { headers: adminHeaders() })
  return r.json()
}

/** Sign in through the real /login form. */
export async function signIn(page, acct) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await page.locator('input[autocomplete="email"]').fill(acct.email)
  await page.locator('input[autocomplete="current-password"]').fill(acct.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app$/, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
}

/** Create an account through the real Create Account form and land on /app. */
export async function signUpViaUI(page, acct) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Create Account' }).click()
  await page.locator('input[autocomplete="email"]').fill(acct.email)
  const pw = page.locator('input[autocomplete="new-password"]'); await pw.nth(0).fill(acct.password); await pw.nth(1).fill(acct.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app$/, { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
}

/** Fill tickers and run; wait until the scan settles. */
export async function runScan(page, tickers) {
  await page.locator('#lc-tickers').fill(tickers)
  await page.getByRole('button', { name: /Run scan|Rescan needed/ }).click()
  await waitForScan(page)
}
export async function waitForScan(page) {
  await page.waitForFunction(() => !/Scanning \d+ tickers?/.test(document.body.textContent) && !/Scanning…/.test(document.body.textContent), null, { timeout: 180000 })
  await page.waitForTimeout(400)
}
