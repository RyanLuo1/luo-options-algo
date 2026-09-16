// Screener modes: Income · Upside. Mode switch swaps the gate row and help text → an Upside scan
// stamps every row → the "Not backtested — calculator only" pill on the results header and the
// panel → the metric bar and Move-to-max column → an Income run too → a shared ticker's group
// shows two head rows (Income pick / Upside pick) → the Upside head drives the panel → the gauge
// reads "Chance the short legs expire worthless" and equals 1 − δ_B − δ_C → an Upside save lands in
// the Tradebook labelled Upside with the right sentence. `node tests/e2e/modes.mjs [baseUrl]`
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { BASE, OUT_DIR, ENV, log, finish, makeAccount, cleanupAccount, signIn, runScan, rowsFor } from './helpers.mjs'

mkdirSync(OUT_DIR, { recursive: true })
const acct = await makeAccount('modes')
const SUPABASE_URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL, SERVICE = ENV.SUPABASE_SERVICE_KEY
// The REST schema lists each table's columns (a `select=mode` probe can't tell a missing column from a parse quirk).
const schema = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }).then(r => r.json()).catch(() => ({}))
const columnExists = t => !!schema?.definitions?.[t]?.properties?.mode
const ddl = { scan_runs: columnExists('scan_runs'), tradebook: columnExists('tradebook') }

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
const body = () => page.textContent('body')
const shot = name => page.screenshot({ path: `${OUT_DIR}/modes-${name}.png`, fullPage: true })
try {
  await signIn(page, acct); await page.waitForSelector('#lc-min-credit')

  // ── Income is today's Screener
  log('mode control: Income active, Upside offered', (await page.getByRole('tab', { name: 'Income' }).getAttribute('aria-selected')) === 'true' && (await page.getByRole('tab', { name: 'Upside' }).count()) === 1)
  log('Income help text', /Get paid to wait\./.test(await page.textContent('section[aria-label="Scan controls"]')))
  log('Income gate row: return on collateral', (await page.locator('#lc-min-roc').count()) === 1 && (await page.locator('#lc-min-upside').count()) === 0)
  log('the P control is labelled approx.', /Minimum chance shorts expire worthless \(approx\.\)/.test(await page.textContent('section[aria-label="Scan controls"]')))
  await runScan(page, 'NVDA, AMD, MU')
  const incomeRows = await page.locator('tbody tr[data-kind="best"]').count()
  log('Income scan produced rows, all stamped income', incomeRows > 0 && (await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-kind]:not([data-kind="other"])')].every(r => r.dataset.mode === 'income'))), `${incomeRows} tickers`)
  log('no calculator pill in Income', !/Not backtested/.test(await body()))
  log('column header reads Shorts worthless', (await page.getByRole('button', { name: /Shorts worthless/ }).count()) === 1)
  const g = await page.evaluate(() => { const r = document.querySelector('tbody tr[data-selected="true"]'); const v = document.querySelector('[data-shorts-worthless]'); return { db: +r.dataset.db, dc: +r.dataset.dc, gauge: +v.dataset.shortsWorthless, label: v.previousElementSibling?.textContent } })
  log('gauge is the exact 1 − δ_B − δ_C with the new label', Math.abs(g.gauge - Math.max(0, 1 - g.db - g.dc)) < 0.00051 && g.label === 'Chance the short legs expire worthless', JSON.stringify(g))
  log('gauge shows Chance of max profit ≈ δ_B', /Chance of max profit\s*≈ \d+%/.test(await page.textContent('section[aria-label^="Setup detail"]')))
  const incomeTickers = await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-kind="best"] td:nth-child(2)')].map(td => td.getAttribute('aria-label')))
  await shot('income-1440')

  // ── Upside: gate row swap, preset, pill, metric, column
  await page.getByRole('tab', { name: 'Upside' }).click(); await page.waitForTimeout(200)
  log('Upside help text', /Own the upside\./.test(await page.textContent('section[aria-label="Scan controls"]')))
  log('Upside gate row: minimum upside per $ of collateral at 5%, credit at $0', (await page.locator('#lc-min-upside').inputValue()) === '5' && (await page.locator('#lc-min-credit').inputValue()) === '0' && (await page.locator('#lc-min-roc').count()) === 0)
  log('Upside has no results yet: the first-run prompt shows', (await page.locator('tbody tr').count()) === 0)
  await page.getByRole('button', { name: /Run scan/ }).click()
  await page.waitForFunction(() => document.querySelector('tbody tr[data-kind]') || /No setup cleared/.test(document.body.textContent), null, { timeout: 120000 }); await page.waitForTimeout(400)
  const upsideRows = await page.locator('tbody tr[data-kind="best"]').count()
  // (the other mode's picks sit in the group as data-kind="other" and keep their own mode)
  log('Upside scan produced rows, all stamped upside', upsideRows > 0 && (await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-kind]:not([data-kind="other"])')].every(r => r.dataset.mode === 'upside'))), `${upsideRows} tickers`)
  const pills = await page.locator('text=Not backtested — calculator only').count()
  log('the calculator pill sits on the results header and the panel', pills === 2, `${pills} pills`)
  log('Upside is a sorted list, not a ranking: heading, status, no numerals, no lime', /Upside setups/.test(await page.textContent('h2')) && /Sorted by max profit per \$ of collateral/.test(await body()) && (await page.locator('tbody tr[data-kind="best"] td:first-child span.bg-lc-lime').count()) === 0 && (await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-kind="best"] td:first-child')].every(td => td.textContent.trim() === '·'))))
  const order = await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-kind="best"] [role="img"]')].map(el => +el.getAttribute('aria-label').match(/(\d+)%$/)[1]))
  log('Upside heads are ordered by their own metric', order.every((v, i) => i === 0 || v <= order[i - 1]), order.join(' ≥ '))
  log('the metric bar is max profit per $ of collateral', (await page.locator('[role="img"][aria-label^="Max profit per $ of collateral"]').count()) > 0)
  log('the Move to max column is present', (await page.getByRole('button', { name: /Move to max/ }).count()) === 1 && /\+\d+\.\d%/.test(await page.textContent('tbody')))
  const up = await page.evaluate(() => { const r = document.querySelector('tbody tr[data-selected="true"]'); return { db: +r.dataset.db } })
  log('Upside rows use the wide window (δ_B ≤ 0.20)', up.db <= 0.2001, `δ_B ${up.db}`)
  const fitUp = await page.evaluate(() => { const t = document.querySelector('section[aria-label$="setups"] table'); return { table: t.scrollWidth, wrap: t.parentElement.clientWidth } })
  log('the Upside table fits its column at 1440 (Move to max included)', fitUp.table <= fitUp.wrap, `${fitUp.table} of ${fitUp.wrap}`)
  await shot('upside-1440')
  const upsideTickers = await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-kind="best"] td:nth-child(2)')].map(td => td.getAttribute('aria-label')))

  // ── Both modes have run: two head rows on a shared ticker
  await page.getByRole('tab', { name: 'Income' }).click(); await page.waitForTimeout(300)
  const shared = incomeTickers.filter(t => upsideTickers.includes(t))
  const others = await page.locator('tbody tr[data-kind="other"]').count()
  log('shared tickers show two head rows (Income setup / Upside · not backtested)', shared.length > 0 && others === shared.length && /Income setup/.test(await page.textContent('tbody')) && /Upside · not backtested/.test(await page.textContent('tbody')), `${shared.length} shared, ${others} second heads`)
  log('an Upside row inside the Income table carries its own bar', (await page.locator('tbody tr[data-kind="other"] [role="img"][aria-label^="Max profit per $ of collateral"]').count()) === others)
  const fitIn = await page.evaluate(() => { const t = document.querySelector('section[aria-label$="setups"] table'); return { table: t.scrollWidth, wrap: t.parentElement.clientWidth } })
  log('the Income table with second heads fits its column at 1440', fitIn.table <= fitIn.wrap, `${fitIn.table} of ${fitIn.wrap}`)
  await shot('both-1440')
  await page.locator('tbody tr[data-kind="other"]').first().click(); await page.waitForTimeout(300)
  const panel = await page.textContent('section[aria-label^="Setup detail"]')
  log('selecting the Upside setup drives the panel with its pills', /Upside/.test(panel) && /Not backtested — calculator only/.test(panel))
  await page.locator('#lc-min-p-tip').locator('..').locator('button').hover(); await page.waitForTimeout(150)
  const tipBox = await page.locator('#lc-min-p-tip').boundingBox()
  log('the P control’s ⓘ tooltip stays inside the viewport', !!tipBox && tipBox.x >= 0 && tipBox.x + tipBox.width <= 1440, tipBox ? `right edge ${Math.round(tipBox.x + tipBox.width)}` : 'no tooltip')
  await shot('upside-pick-panel-1440')

  // ── Save the Upside pick → Tradebook
  if (!ddl.tradebook) {
    log('Upside save round-trip', false, 'tradebook.mode column not found — run docs/scan_mode_migration.sql, then rerun')
  } else {
    await page.getByRole('button', { name: 'Save to Tradebook' }).click(); await page.waitForSelector('[role="status"]', { timeout: 30000 })
    const saved = await rowsFor(acct, 'tradebook', '*')
    log('the saved row carries mode = upside', saved.length === 1 && saved[0].mode === 'upside', saved[0] ? `${saved[0].ticker} mode=${saved[0].mode}` : 'no row')
    await page.goto(BASE + '/tradebook', { waitUntil: 'networkidle' }); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, null, { timeout: 20000 }); await page.waitForTimeout(400)
    const tb = await page.textContent('body')
    log('the Tradebook labels it Upside in the row and the panel', (await page.locator('tbody tr').first().textContent()).includes('Upside') && /Not backtested — calculator only/.test(tb))
    await shot('tradebook-upside-1440')
    if (!ddl.scan_runs) log('scan_runs.mode column', false, 'not found — run docs/scan_mode_migration.sql (upside scans log without provenance until then)')
  }

  // ── 1100
  const p2 = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage()
  await signIn(p2, acct); await p2.waitForSelector('#lc-min-credit')
  await p2.getByRole('tab', { name: 'Upside' }).click(); await p2.waitForTimeout(200)
  await p2.screenshot({ path: `${OUT_DIR}/modes-upside-controls-1100.png` })
  log('no horizontal overflow at 1100 in Upside', !(await p2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)))
  await p2.context().close()
} catch (e) { log('exception', false, e.message); await page.screenshot({ path: `${OUT_DIR}/modes-failure.png` }).catch(() => {}) }
if (errors.length) console.log('page errors:', errors.join(' | '))
await browser.close()
await cleanupAccount(acct)
finish()
