// Auth surface: create account → /app → log out → log in → bounce from /tradebook while logged out →
// log in → lands on /tradebook; every error case at 390 with a screenshot; forgot-password request;
// a REAL recovery link (admin generate_link, service key) → set a new password → /app → log in with it.
// `node tests/e2e/auth.mjs [baseUrl]`
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { BASE, OUT_DIR, ENV, log, finish } from './helpers.mjs'

mkdirSync(OUT_DIR, { recursive: true })
const SUPABASE_URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL, SERVICE = ENV.SUPABASE_SERVICE_KEY
const admin = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }
const email = `ryanleeluo2+luotest-auth-${Date.now()}@gmail.com`
const password = 'Luo-auth-2026!x', password2 = 'Luo-auth-2026!y'
let userId = null

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
const page = await ctx.newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
const strip = () => page.locator('#auth-form [role="alert"], #auth-form [role="status"]').first()
const stripText = async () => (await strip().count()) ? (await strip().textContent()).trim() : ''
const shot = name => page.screenshot({ path: `${OUT_DIR}/auth-${name}-390.png`, fullPage: true })
const logout = async () => { await page.getByRole('button', { name: 'Log out' }).click(); await page.waitForURL(/\/login$/) }

try {
  // ── Log in: load, focus, keyboard, shared validation
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' }); await page.waitForTimeout(300)
  log('focus lands on Email on load', (await page.evaluate(() => document.activeElement?.id)) === 'auth-email')
  log('no horizontal overflow at 390', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)))
  await shot('login')
  await page.locator('#auth-email').fill('nope'); await page.locator('#auth-password').fill('x'); await page.keyboard.press('Enter'); await page.waitForTimeout(200)
  log('Enter submits; bad email shape is named', /doesn’t look like an email address/.test(await stripText()), await stripText())
  await shot('err-email-shape')
  await page.locator('#auth-email').fill(email); await page.locator('#auth-password').fill('wrong-password-1'); await page.locator('button[type="submit"]').click()
  await page.waitForFunction(() => document.querySelector('#auth-form [role="alert"]'), null, { timeout: 15000 })
  log('bad login: one message, both recoveries, no Supabase text', /don’t match/.test(await stripText()) && /create an account/.test(await stripText()) && !/Invalid login credentials/.test(await stripText()), await stripText())
  await page.waitForTimeout(150)
  log('after a server error, focus is on the offending field and it is marked', (await page.evaluate(() => document.activeElement?.id)) === 'auth-password' && (await page.locator('#auth-password').getAttribute('aria-invalid')) === 'true')
  await shot('err-bad-login')
  await page.getByRole('button', { name: 'Create account', exact: true }).first().click(); await page.waitForTimeout(200)
  log('the strip’s action switches to Create account and keeps the email', (await page.getByRole('tab', { name: 'Create account' }).getAttribute('aria-selected')) === 'true' && (await page.locator('#auth-email').inputValue()) === email)
  await page.getByRole('tab', { name: 'Create account' }).focus(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100)
  log('ArrowLeft on the tab strip switches mode and keeps focus on the strip', (await page.getByRole('tab', { name: 'Log in' }).getAttribute('aria-selected')) === 'true' && (await page.evaluate(() => document.activeElement?.getAttribute('role'))) === 'tab')
  await page.getByRole('tab', { name: 'Create account' }).click(); await page.waitForTimeout(100)
  log('sign-up states the password rule and the honesty line', /At least 6 characters/.test(await page.textContent('#auth-form')) && /Free account\. The screener and tradebook are yours — no card, no trial clock\./.test(await page.textContent('#auth-form')))

  // ── Create account: weak password, then success → /app
  await page.locator('#auth-password').fill('abc'); await page.keyboard.press('Enter'); await page.waitForTimeout(200)
  log('weak password names the actual rule', /Passwords need at least 6 characters/.test(await stripText()), await stripText())
  await shot('err-weak-password')
  await page.locator('#auth-password').fill(password)
  await page.getByRole('button', { name: 'Show password' }).click()
  log('Show reveals the password', (await page.locator('#auth-password').getAttribute('type')) === 'text' && (await page.getByRole('button', { name: 'Hide password' }).count()) === 1)
  const markLogin = await page.evaluate(() => { const r = document.querySelector('header a[aria-label="Luo Capital home"]').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.height)] })
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/app$/, { timeout: 30000 }); await page.waitForSelector('header button[aria-label="Luo Capital, go to the screener"]', { timeout: 15000 })
  const markApp = await page.evaluate(() => { const r = document.querySelector('header button[aria-label="Luo Capital, go to the screener"]').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.height)] })
  log('the wordmark holds still from /login to /app', markLogin.join(',') === markApp.join(','), `${markLogin.join(',')} → ${markApp.join(',')}`)
  userId = await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token$/.test(k)) { try { return JSON.parse(localStorage.getItem(k))?.user?.id ?? null } catch { return null } } return null })
  log('create account lands in /app', /\/app$/.test(page.url()) && !!userId, userId ? 'user id captured' : 'no user id in storage')

  // ── Log out → log in
  await logout()
  await page.locator('#auth-email').fill(email); await page.locator('#auth-password').fill(password); await page.keyboard.press('Enter')
  await page.waitForURL(/\/app$/, { timeout: 30000 })
  log('log in lands in /app', /\/app$/.test(page.url()))

  // ── Existing email on sign-up
  await logout()
  await page.getByRole('tab', { name: 'Create account' }).click()
  await page.locator('#auth-email').fill(email); await page.locator('#auth-password').fill(password); await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('#auth-form [role="alert"]'), null, { timeout: 15000 })
  log('existing email on sign-up offers Log in', /already exists for/.test(await stripText()) && (await page.getByRole('button', { name: 'Log in instead' }).count()) === 1, await stripText())
  await shot('err-account-exists')
  await page.getByRole('button', { name: 'Log in instead' }).click(); await page.waitForTimeout(200)
  log('Log in instead switches mode and keeps the email', (await page.getByRole('tab', { name: 'Log in' }).getAttribute('aria-selected')) === 'true' && (await page.locator('#auth-email').inputValue()) === email)

  // ── Bounce from /tradebook while logged out → log in → lands on /tradebook
  await page.goto(BASE + '/tradebook', { waitUntil: 'networkidle' })
  await page.waitForURL(/\/login$/, { timeout: 15000 })
  log('logged-out /tradebook bounces to /login', /\/login$/.test(page.url()))
  log('the card says why you are here', /Log in to open your tradebook\./.test(await page.textContent('section[aria-labelledby="auth-title"]')))
  await page.locator('#auth-email').fill(email); await page.locator('#auth-password').fill(password); await page.keyboard.press('Enter')
  await page.waitForURL(/\/tradebook$/, { timeout: 30000 })
  log('login returns to the bounced route', /\/tradebook$/.test(page.url()))

  // ── Forgot password: request state + notice
  await logout()
  await page.getByRole('button', { name: 'Forgot password?' }).click(); await page.waitForTimeout(200)
  log('reset state: email only, Send reset link, Back to log in', (await page.locator('#auth-password').count()) === 0 && (await page.getByRole('button', { name: 'Send reset link' }).count()) === 1 && (await page.getByRole('button', { name: /Back to log in/ }).count()) === 1)
  await shot('reset')
  await page.locator('#auth-email').fill(email); await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('#auth-form [role="status"]'), null, { timeout: 20000 })
  log('reset request shows the check-your-email notice with a Create account recovery', new RegExp(`Check ${email.replace('+', '\\+')} for a reset link`).test(await stripText()) && /create one instead/.test(await stripText()), await stripText())
  log('after sending, the primary reads Link sent and is disabled; Back to log in is the next step', (await page.locator('button[type="submit"]').textContent()).trim() === 'Link sent' && (await page.locator('button[type="submit"]').isDisabled()) && (await page.getByRole('button', { name: 'Back to log in', exact: true }).count()) === 1)
  await shot('reset-sent')

  // ── A real recovery link (admin API) → Set a new password → /app → log in with it
  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: admin, body: JSON.stringify({ type: 'recovery', email, redirect_to: BASE + '/login' }) })
  const gld = await gl.json()
  const actionLink = gld.action_link || gld.properties?.action_link
  log('admin generate_link returned a recovery link', gl.ok && !!actionLink, gl.ok ? '' : JSON.stringify(gld).slice(0, 160))
  if (actionLink) {
    await page.goto(actionLink, { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
    const landed = page.url()
    const onRecovery = landed.startsWith(BASE + '/login') && (await page.getByRole('button', { name: 'Set password' }).count()) === 1
    log('recovery link lands on /login in the Set-a-new-password state', onRecovery, onRecovery ? '' : `landed on ${landed.slice(0, 120)} — if this is not ${BASE}/login, add it to Supabase → Authentication → URL Configuration → Redirect URLs`)
    if (onRecovery) {
      await shot('recovery')
      await page.locator('#auth-password').fill(password2); await page.keyboard.press('Enter')
      await page.waitForURL(/\/app$/, { timeout: 30000 })
      log('setting a new password lands in /app', /\/app$/.test(page.url()))
      await logout()
      await page.locator('#auth-email').fill(email); await page.locator('#auth-password').fill(password2); await page.keyboard.press('Enter')
      await page.waitForURL(/\/app$/, { timeout: 30000 })
      log('the new password logs in', /\/app$/.test(page.url()))
    }
  }

  // ── Expired-link state (a bad hash, no session)
  await page.goto(BASE + '/login#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', { waitUntil: 'networkidle' }); await page.waitForTimeout(300)
  log('an expired link opens the reset form with its own strip', /reset link has expired/.test(await stripText()) && (await page.getByRole('button', { name: 'Send reset link' }).count()) === 1 && (await page.locator('#auth-password').count()) === 0, await stripText())
  await shot('err-expired-link')

  // ── Desktop capture
  const desk = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage()
  await desk.goto(BASE + '/login', { waitUntil: 'networkidle' }); await desk.waitForTimeout(300)
  await desk.screenshot({ path: `${OUT_DIR}/auth-login-1440.png` })
  await desk.getByRole('tab', { name: 'Create account' }).click(); await desk.waitForTimeout(200)
  await desk.screenshot({ path: `${OUT_DIR}/auth-signup-1440.png` })
  await desk.context().close()
} catch (e) { log('exception', false, e.message); await page.screenshot({ path: `${OUT_DIR}/auth-failure.png` }).catch(() => {}) }
if (errors.length) console.log('page errors:', errors.join(' | '))
await browser.close()
if (userId && SERVICE) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: admin })
  console.log(`cleanup account: ${r.status}`)
}
finish()
