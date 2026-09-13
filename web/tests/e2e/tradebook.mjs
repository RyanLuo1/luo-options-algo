// Tradebook flow: save from the Screener → appears first as open → edit with replace on (open
// count unchanged, original gone) → edit without replace (both present, panel says so) → delete
// with confirm → graded + grading-pending states from seeded rows → summary matches → provenance
// pill + Rerun. `node tests/e2e/tradebook.mjs [baseUrl]`
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { BASE, OUT_DIR, ENV, log, finish, makeAccount, cleanupAccount, signIn, runScan, waitForScan, rowsFor } from './helpers.mjs'

mkdirSync(OUT_DIR, { recursive: true })
const acct = await makeAccount('tradebook')
const SUPABASE_URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL, SERVICE = ENV.SUPABASE_SERVICE_KEY
const admin = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
const rest = (path, init) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...admin, ...(init?.headers || {}) } })

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
const tbSummary = () => page.evaluate(() => {
  const figs = [...document.querySelectorAll('section[aria-label="Tradebook summary"] > div')].map(d => ({ label: d.children[0].textContent.trim(), value: d.children[1].textContent.trim(), sub: d.children[2].textContent.trim() }))
  return Object.fromEntries(figs.map(f => [f.label, f]))
})
try {
  await signIn(page, acct)

  // 0. empty state
  await page.goto(BASE + '/tradebook', { waitUntil: 'networkidle' }); await page.waitForTimeout(600)
  log('empty state with Go to the Screener', /No trades yet/.test(await page.textContent('body')) && (await page.getByRole('button', { name: 'Go to the Screener', exact: true }).count()) === 1)

  // 1. save from the Screener → appears first as open
  await page.goto(BASE + '/app', { waitUntil: 'networkidle' })
  await runScan(page, 'NVDA, AMD, MU')
  const savedRow = await page.evaluate(() => { const r = document.querySelector('tbody tr[data-selected="true"]'); const t = [...r.children].map(td => td.textContent.trim()); return { ticker: t[1], strikes: t[3].replace(/\s+/g, '') } })
  await page.getByRole('button', { name: 'Save to Tradebook' }).click(); await page.waitForSelector('[role="status"]')
  await page.goto(BASE + '/tradebook', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, null, { timeout: 20000 }); await page.waitForTimeout(300)
  const first = await page.evaluate(() => { const r = document.querySelector('tbody tr'); return { status: r.dataset.status, ticker: r.children[1].textContent.trim(), strikes: r.children[3].textContent.trim().replace(/\s+/g, ''), pill: r.children[0].textContent.trim() } })
  log('saved trade appears first as open', first.status === 'open' && first.ticker === savedRow.ticker && first.strikes === savedRow.strikes && /^Open/.test(first.pill), JSON.stringify(first))
  let sum = await tbSummary()
  log('summary: 1 open, 0 graded, caption exact', sum['Open']?.value === '1' && sum['Graded']?.value === '0' && sum['Total realized P&L']?.sub === 'sum of per-contract outcomes, not a portfolio return', JSON.stringify(sum))
  const beforeRows = await rowsFor(acct, 'tradebook', 'id')
  const originalId = beforeRows[0]?.id

  // 2. provenance pill + Rerun
  const prov = await page.evaluate(() => (document.body.textContent.match(/From your scan · [A-Z][a-z]{2} \d+ \d\d:\d\d(?: · rank \d+ of \d+)?/) || [])[0])
  log('provenance pill names the scan and rank', !!prov && /rank \d+ of \d+/.test(prov), prov)
  await page.getByRole('button', { name: 'Rerun this scan' }).click()
  await page.waitForURL(/\/app$/); await waitForScan(page)
  const rerun = await page.evaluate(() => ({ tickers: document.querySelector('#lc-tickers')?.value, rows: document.querySelectorAll('tbody tr').length }))
  log('Rerun prefilled the Screener and ran the scan', /NVDA/.test(rerun.tickers) && rerun.rows > 0, JSON.stringify(rerun))

  // 3. edit with replace on: open count unchanged, original row gone
  await page.goto(BASE + '/tradebook', { waitUntil: 'networkidle' }); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, null, { timeout: 20000 })
  await page.getByRole('button', { name: 'Open in editor' }).click(); await page.waitForURL(/\/trade$/)
  await page.waitForFunction(() => document.querySelectorAll('section[aria-label="Sell put"] tbody tr').length > 0 || /didn’t load/.test(document.body.textContent), null, { timeout: 90000 }); await page.waitForTimeout(300)
  log('editor opened from the Tradebook with replace checked by default', (await page.getByLabel('Replace the original').isChecked()) && (await page.getByRole('button', { name: 'Save as new trade' }).count()) === 1)
  const anchor = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Sell put"], section[aria-label="Buy call"], section[aria-label="Sell call"]')].map(s => { const box = s.querySelector('.overflow-auto'); const row = box?.querySelector('tr[aria-current="true"]'); if (!box || !row) return 'missing'; const top = row.offsetTop - box.scrollTop; return top >= 0 && top + row.clientHeight <= box.clientHeight ? 'visible' : `off by ${Math.round(top)}` }))
  log('each chain opens with the saved strike in view', anchor.every(a => a === 'visible'), anchor.join(', '))
  // pick a different put strike (the first row of the Sell put chain that is not the current one)
  const putRows = page.locator('section[aria-label="Sell put"] tbody tr'); const n = await putRows.count()
  if (n > 1) { const cur = await page.locator('section[aria-label="Sell put"] tr[aria-current="true"]').count(); await putRows.nth(cur ? 0 : 1).click() }
  await page.getByRole('button', { name: 'Save as new trade' }).click()
  await page.waitForSelector('[role="status"]', { timeout: 30000 })
  await page.waitForURL(/\/tradebook$/, { timeout: 15000 }); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, null, { timeout: 20000 }); await page.waitForTimeout(400)
  const afterReplace = await rowsFor(acct, 'tradebook', 'id')
  sum = await tbSummary()
  log('edit with replace: open count unchanged (1) and the original row is gone', sum['Open']?.value === '1' && afterReplace.length === 1 && !afterReplace.some(r => r.id === originalId), `rows ${afterReplace.length}`)

  // 4. edit without replace: both rows remain, panel says so
  await page.getByRole('button', { name: 'Open in editor' }).click(); await page.waitForURL(/\/trade$/)
  await page.waitForFunction(() => document.querySelectorAll('section[aria-label="Sell put"] tbody tr').length > 0 || /didn’t load/.test(document.body.textContent), null, { timeout: 90000 }); await page.waitForTimeout(300)
  await page.getByLabel('Replace the original').uncheck()
  log('unticking replace says both will stay', /Both trades will stay/.test(await page.textContent('body')))
  await page.getByRole('button', { name: 'Save as new trade' }).click(); await page.waitForSelector('[role="status"]', { timeout: 30000 })
  await page.waitForURL(/\/tradebook$/, { timeout: 15000 }); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 1, null, { timeout: 20000 }); await page.waitForTimeout(300)
  sum = await tbSummary()
  log('edit without replace: both rows present, open count 2', sum['Open']?.value === '2' && (await rowsFor(acct, 'tradebook', 'id')).length === 2)

  // 5. delete with confirm (Keep first, then confirm)
  await page.getByRole('button', { name: 'Delete' }).click()
  log('Delete asks for confirmation with a Keep escape', (await page.getByRole('button', { name: 'Confirm delete' }).count()) === 1 && (await page.getByRole('button', { name: 'Keep' }).count()) === 1)
  await page.getByRole('button', { name: 'Keep' }).click()
  await page.getByRole('button', { name: 'Delete' }).click(); await page.getByRole('button', { name: 'Confirm delete' }).click()
  await page.waitForSelector('[role="status"]', { timeout: 15000 }); await page.waitForTimeout(300)
  log('confirm delete removes the row with a named toast', /Deleted [A-Z]+ /.test(await page.locator('[role="status"]').textContent()) && (await rowsFor(acct, 'tradebook', 'id')).length === 1)

  // 6. seeded graded + grading-pending rows (service key), then the page shows their states
  const [remaining] = await rowsFor(acct, 'tradebook', '*')
  const base = { ...remaining }; delete base.id; delete base.created_at
  const seedRow = (over) => ({ ...base, user_id: acct.id, scan_id: null, result_id: null, saved_at: new Date().toISOString(), ...over })
  const pastGraded = '2026-08-21', pastPending = '2026-09-11'
  const ins = await rest('tradebook', { method: 'POST', body: JSON.stringify([
    seedRow({ ticker: 'MU', expiration: pastGraded, leg_c_strike: 860, leg_a_strike: 1025, leg_b_strike: 1030, net_premium: 10.85, spread_width: 5 }),
    seedRow({ ticker: 'AMD', expiration: pastPending }),
  ]) })
  const seeded = await ins.json()
  const gradedId = seeded.find(r => r.expiration === pastGraded)?.id
  // realized: settled at 1040 (capped): pnl/share = 10.85 + (1040-1025) - (1040-1030) - 0 = 15.85 → $1,585 per contract
  const oc = await rest('trade_outcomes', { method: 'POST', body: JSON.stringify({ tradebook_id: gradedId, user_id: acct.id, outcome_type: 'expired_capped', stock_price_at_expiration: 1040, leg_a_value: 15, leg_b_liability: 10, leg_c_liability: 0, realized_pnl: 15.85, pnl_per_contract: 1585, notes: 'e2e seed' }) })
  log('seeded one graded and one grading-pending trade', ins.ok && oc.ok, `${ins.status}/${oc.status}`)
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3, null, { timeout: 20000 }); await page.waitForTimeout(400)
  const order = await page.evaluate(() => [...document.querySelectorAll('tbody tr')].map(r => `${r.dataset.status}:${r.children[1].textContent.trim()}`))
  // the brief: open trades first, nearest expiration on top — grading-pending rows join them, oldest first (they're already expired, so they lead) — then graded, newest first
  log('default order: grading-pending on top, then open nearest-first, then graded', order[0].startsWith('pending') && order[1].startsWith('open') && order[2].startsWith('graded'), order.join(' | '))
  const pendingRow = await page.evaluate(() => { const r = document.querySelector('tbody tr[data-status="pending"]'); return { pill: r.children[0].textContent.trim(), pnl: r.children[6].textContent.trim(), zone: r.children[7].textContent.trim() } })
  log('grading-pending row: pill + "grades after the next close", no stale Open', pendingRow.pill === 'Grading pending' && pendingRow.pnl === 'pending' && pendingRow.zone === '—', JSON.stringify(pendingRow))
  await page.locator('tbody tr[data-status="pending"]').click(); await page.waitForTimeout(300)
  log('pending panel: note, Grade pending tile instead of the gauge, View in editor', /Grading pending · grades after the next close/.test(await page.textContent('body')) && /Grade pending/.test(await page.textContent('section[aria-label^="Setup detail"]')) && !/Chance of max profit/.test(await page.textContent('section[aria-label^="Setup detail"]')) && (await page.getByRole('button', { name: 'View in editor' }).count()) === 1)
  await page.getByRole('button', { name: 'View in editor' }).click(); await page.waitForURL(/\/trade$/); await page.waitForTimeout(300)
  log('grading-pending trade opens the editor read-only', /grade pending · read-only/.test(await page.textContent('body')) && (await page.getByRole('button', { name: /Save/ }).count()) === 0)
  await page.goto(BASE + '/tradebook', { waitUntil: 'networkidle' }); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3, null, { timeout: 20000 }); await page.waitForTimeout(300)
  await page.locator('tbody tr[data-status="pending"]').click(); await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT_DIR}/tradebook-pending-1440.png`, fullPage: true })
  await page.locator('tbody tr[data-status="graded"]').click(); await page.waitForTimeout(300)
  const gradedRow = await page.evaluate(() => { const r = document.querySelector('tbody tr[data-status="graded"]'); return { pnl: r.children[6].textContent.trim(), zone: r.children[7].textContent.trim() } })
  const panel = await page.textContent('section[aria-label^="Setup detail"]')
  log('graded row: signed P&L and zone label', gradedRow.pnl === '+$1,585' && gradedRow.zone === 'Capped', JSON.stringify(gradedRow))
  log('graded panel: answer first (Realized P&L + settlement sentence), setup folded, read-only editor action', /settled at \$1,040\.00/.test(panel) && /Realized P&L/.test(panel) && /Settled at \$1,040\.00 — you captured the full spread \(\$1,585, max profit\)/.test(panel) && /View in editor/.test(panel) && (await page.locator('section[aria-label^="Setup detail"] details summary').count()) === 1 && !(await page.locator('section[aria-label^="Setup detail"] details').first().evaluate(d => d.open)))
  const answerY = await page.evaluate(() => { const el = [...document.querySelectorAll('section[aria-label^="Setup detail"] p')].find(p => /^Outcome:/.test(p.textContent)); return el ? Math.round(el.getBoundingClientRect().bottom) : 9999 })
  log('the settlement sentence is above the fold at 1440×900', answerY < 900, `bottom at ${answerY}px`)
  await page.locator('section[aria-label^="Setup detail"] details summary').click(); await page.waitForTimeout(200)
  log('unfolding shows the curve with the settled marker', /settled 1040\.00/.test(await page.textContent('section[aria-label^="Setup detail"] details')))
  await page.locator('section[aria-label^="Setup detail"] details summary').click()
  await page.screenshot({ path: `${OUT_DIR}/tradebook-graded-1440.png`, fullPage: true })
  const fit = await page.evaluate(() => { const t = document.querySelector('section[aria-label="Saved trades"] table'); return { wrap: t.parentElement.clientWidth, table: t.scrollWidth, cols: [...t.querySelectorAll('thead th')].map(th => `${th.textContent.trim()}:${Math.round(th.getBoundingClientRect().width)}`).join(' ') } })
  log('table fits its column at 1440 (no clipped columns)', fit.table <= fit.wrap, `${fit.table} of ${fit.wrap} · ${fit.cols}`)
  sum = await tbSummary()
  log('summary matches: 2 open (1 open · 1 grading), 1 graded, total +$1,585', sum['Open']?.value === '2' && /1 open · 1 grading/.test(sum['Open']?.sub) && sum['Graded']?.value === '1' && sum['Total realized P&L']?.value === '+$1,585', JSON.stringify(sum))
  // read-only editor for the graded trade
  await page.getByRole('button', { name: 'View in editor' }).click(); await page.waitForURL(/\/trade$/); await page.waitForTimeout(300)
  const ro = await page.textContent('body')
  log('graded trade opens the editor read-only', /read-only/.test(ro) && (await page.getByRole('button', { name: /Save/ }).count()) === 0)
  await page.screenshot({ path: `${OUT_DIR}/editor-readonly-1440.png` })

  // 7. sort override + keyboard
  await page.goto(BASE + '/tradebook', { waitUntil: 'networkidle' }); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3, null, { timeout: 20000 })
  await page.getByRole('button', { name: /Credit \/ct/ }).click()
  log('column sort shows "Back to default"', (await page.locator('text=Back to default').count()) === 1)
  await page.getByRole('button', { name: 'Back to default' }).click()
  await page.locator('section[aria-label="Saved trades"] [tabindex="0"]').focus(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150)
  log('↓ moves the selection', (await page.locator('tbody tr[data-selected="true"]').getAttribute('data-status')) === 'open')
} catch (e) { log('exception', false, e.message); await page.screenshot({ path: `${OUT_DIR}/tradebook-failure.png` }).catch(() => {}) }
if (errors.length) console.log('page errors:', errors.join(' | '))
await browser.close()
// cleanup: outcomes then trades then the account
if (acct.id) { await rest(`trade_outcomes?user_id=eq.${acct.id}`, { method: 'DELETE' }); await rest(`tradebook?user_id=eq.${acct.id}`, { method: 'DELETE' }) }
await cleanupAccount(acct)
finish()
