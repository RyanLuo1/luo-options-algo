// The full user flow: fresh account (through the real form) → create a watchlist → scan it →
// grouped results → sort → select → save → toast → Tradebook shows it → DB row with provenance.
// `node tests/e2e/flow.mjs [baseUrl]`
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { BASE, OUT_DIR, log, finish, makeAccount, cleanupAccount, signUpViaUI, runScan, rowsFor } from './helpers.mjs'

mkdirSync(OUT_DIR, { recursive: true })
const acct = await makeAccount('flow')
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
try {
  if (acct.owned) {
    // the account exists from the sign-up API; sign in through the form instead of creating twice
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await page.locator('input[autocomplete="email"]').fill(acct.email)
    await page.locator('input[autocomplete="current-password"]').fill(acct.password)
    await page.locator('button[type="submit"]').click(); await page.waitForURL(/\/app$/, { timeout: 20000 })
  } else {
    await signUpViaUI(page, acct)
  }
  await page.waitForFunction(() => /Run your first scan|Ranked setups/.test(document.body.textContent), null, { timeout: 15000 })
  log('signed in, landed on /app first-run state', /Run your first scan/.test(await page.textContent('body')))

  await page.getByRole('button', { name: 'Manage watchlists' }).click()
  await page.getByPlaceholder('name (e.g. semis)').fill('e2e')
  await page.getByPlaceholder('tickers (NVDA, AMD, MU)').fill('NVDA, AMD, MU')
  await page.getByRole('button', { name: '+ Add watchlist' }).click()
  await page.waitForFunction(() => /@e2e/.test(document.body.textContent), null, { timeout: 15000 })
  log('watchlist @e2e created', true)

  await runScan(page, '@e2e')
  const g = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('[aria-label="Tickers in this scan"] button[aria-pressed]')].map(b => b.textContent.trim()),
    best: [...document.querySelectorAll('tbody tr[data-kind="best"]')].map(tr => tr.children[1].textContent.trim()),
  }))
  log('scan of @e2e: chips for the resolved tickers, grouped best rows', g.chips.length === 3 && g.best.length >= 1, `chips ${g.chips.join(' | ')} · best ${g.best.join('/')}`)

  await page.getByRole('button', { name: /Credit \/ct/ }).click()
  log('Credit sort override active', (await page.locator('text=Back to ranked').count()) === 1)
  const rows = page.locator('tbody tr[data-kind="best"]'); await rows.nth(Math.min(1, (await rows.count()) - 1)).click()
  const sel = await page.evaluate(() => { const r = document.querySelector('tbody tr[data-selected="true"]'); const t = [...r.children].map(td => td.textContent.trim()); return { rank: t[0], ticker: t[1], strikes: t[3] } })
  const panelTicker = (await page.locator('section[aria-label^="Setup detail"]').getAttribute('aria-label')).replace('Setup detail: ', '').split(' ')[0]
  log('selected row drives the panel', sel.ticker === panelTicker, `${sel.ticker} ${sel.strikes} (rank ${sel.rank})`)
  await page.screenshot({ path: `${OUT_DIR}/flow-selected.png` })

  await page.getByRole('button', { name: 'Save to Tradebook' }).click()
  await page.waitForSelector('[role="status"]', { timeout: 30000 })
  const toast = (await page.locator('[role="status"]').textContent()).trim()
  log('toast names the saved trade and links to the Tradebook', /Saved .* to your Tradebook/.test(toast) && /View Tradebook/.test(toast), toast.slice(0, 100))
  await page.getByRole('button', { name: 'View Tradebook', exact: true }).click(); await page.waitForURL(/\/tradebook$/)
  await page.waitForFunction(() => /Date Saved/i.test(document.body.textContent) && document.querySelectorAll('tbody tr').length > 0, null, { timeout: 20000 })
  const strikes = sel.strikes.replace(/\s+/g, '').split('/'); const tb = await page.textContent('body')
  log('Tradebook shows the saved trade', strikes.every(s => tb.includes(s)), strikes.join('/'))
  await page.screenshot({ path: `${OUT_DIR}/flow-tradebook.png` })

  if (acct.id) {
    const db = await rowsFor(acct, 'tradebook', 'ticker,leg_a_strike,leg_b_strike,leg_c_strike,scan_id,result_id')
    log('DB row carries scan_id + result_id provenance', db.length === 1 && !!db[0].scan_id && !!db[0].result_id, JSON.stringify(db[0]))
  }
} catch (e) { log('exception', false, e.message); await page.screenshot({ path: `${OUT_DIR}/flow-failure.png` }).catch(() => {}) }
if (errors.length) console.log('page errors:', errors.join(' | '))
await browser.close()
await cleanupAccount(acct)
finish()
