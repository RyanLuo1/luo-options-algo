// Screener state checks at 1440: grouping, dual credit gates, loading, error, no-results,
// keyboard, sort override, idempotent Save, filter-empty. `node tests/e2e/states.mjs [baseUrl]`
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { BASE, OUT_DIR, log, finish, makeAccount, cleanupAccount, signIn, runScan, waitForScan } from './helpers.mjs'

mkdirSync(OUT_DIR, { recursive: true })
const acct = await makeAccount('states')
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
try {
  await signIn(page, acct)
  await page.waitForSelector('#lc-min-credit', { timeout: 15000 })   // the controls mount a beat after the shell

  // Defaults: dual-gate ($100 friction floor + 1% return on collateral), grouped view
  const defaults = await page.evaluate(() => ({ credit: document.querySelector('#lc-min-credit')?.value, roc: document.querySelector('#lc-min-roc')?.value, p: document.querySelectorAll('#lc-min-p').length }))
  log('defaults: $100 min credit, 1% return floor, no probability control', defaults.credit === '100' && defaults.roc === '1' && defaults.p === 0, JSON.stringify(defaults))

  // 1. scan: grouped by default — one row per ticker, each with a real best or an explained zero
  await runScan(page, 'NVDA, AMD, MU')
  const g = await page.evaluate(() => {
    const best = [...document.querySelectorAll('tbody tr[data-kind="best"]')].map(tr => tr.children[1].textContent.trim())
    const chips = [...document.querySelectorAll('[aria-label="Tickers in this scan"] button[aria-pressed]')].map(b => b.textContent.trim())
    const reasons = [...document.querySelectorAll('[aria-label="Tickers in this scan"] > span')].map(s => s.textContent.trim()).filter(t => /—/.test(t))
    const groupedOn = document.querySelector('button[aria-pressed="true"]')?.textContent.includes('Best per ticker')
    const more = [...document.querySelectorAll('button[aria-expanded]')].map(b => b.textContent.trim())
    return { best, chips, reasons, groupedOn, more, variants: document.querySelectorAll('tbody tr[data-kind="variant"]').length }
  })
  log('grouped by default: one best row per ticker with results, variants collapsed', g.groupedOn && g.best.length === new Set(g.best).size && g.variants === 0, `best rows ${g.best.join('/')} · expanders ${g.more.join(' | ')}`)
  log('every scanned ticker is a chip; zero-count chips carry a cause', g.chips.length === 3 && g.reasons.every(r => /no setup cleared|missed the|delta and liquidity|no options chain/.test(r)), g.reasons.join(' | ') || 'no zero tickers')
  await page.screenshot({ path: `${OUT_DIR}/grouped-1440.png`, fullPage: true })

  // 2. expand a group: variants appear in algorithm order (ranks ascending), collapse hides them
  const firstMore = page.locator('button[aria-expanded]').first()
  if (await firstMore.count()) {
    await firstMore.click()
    const ranks = await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-kind="variant"]')].map(tr => Number(tr.children[0].textContent.trim())))
    log('"+N more" expands the ticker’s variants in algorithm order', ranks.length > 0 && ranks.every((v, i) => i === 0 || v > ranks[i - 1]), `ranks ${ranks.slice(0, 5).join(',')}…`)
    await page.getByRole('button', { name: /Show fewer/ }).first().click()
    log('"Show fewer" collapses them', (await page.locator('tbody tr[data-kind="variant"]').count()) === 0)
  }

  // 3. flat toggle, then back
  await page.getByRole('button', { name: 'Flat list' }).click()
  const flat = await page.evaluate(() => ({ flat: document.querySelectorAll('tbody tr[data-kind="flat"]').length, rank1: document.querySelector('tbody tr')?.children[0].textContent.trim() }))
  log('Flat list shows every row, rank 1 first', flat.flat > 1 && flat.rank1 === '1', `${flat.flat} rows`)
  await page.getByRole('button', { name: 'Best per ticker' }).click()

  // 4. the return floor is live and client-side: raise it, rows drop and a chip explains
  await page.locator('#lc-min-roc').fill('50'); await page.locator('#lc-min-roc').blur(); await page.waitForTimeout(300)
  const roc = await page.evaluate(() => ({ rows: document.querySelectorAll('tbody tr[data-kind="best"]').length, reason: document.body.textContent.match(/no setup cleared the 50% return floor/)?.[0], stale: /Rescan needed/.test(document.body.textContent) }))
  log('raising the return floor filters live (no rescan) and chips say why', !roc.stale && !!roc.reason, JSON.stringify(roc))
  await page.locator('#lc-min-roc').fill('1'); await page.locator('#lc-min-roc').blur(); await page.waitForTimeout(300)

  // 5. loading: rescan; results stay mounted + dimmed, progress strip visible
  await page.getByRole('button', { name: /Run scan|Rescan needed/ }).click(); await page.waitForTimeout(400)
  const loading = await page.evaluate(() => ({ strip: /Scanning \d+ tickers/.test(document.body.textContent), rows: document.querySelectorAll('tbody tr').length, dimmed: !!document.querySelector('section[aria-label="Ranked setups"].opacity-60') }))
  log('loading keeps results mounted + dimmed + progress strip', loading.strip && loading.rows > 0 && loading.dimmed, JSON.stringify(loading))
  await waitForScan(page)

  // 6. error: fail /api/run once; previous results remain; strip dismisses
  await page.route('**/api/run', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'upstream timeout' }) }), { times: 1 })
  await page.getByRole('button', { name: /Run scan|Rescan needed/ }).click()
  await page.waitForSelector('[role="alert"]', { timeout: 30000 }); await page.waitForTimeout(300)
  const err = await page.evaluate(() => ({ text: document.querySelector('[role="alert"]')?.textContent?.trim().slice(0, 120), rows: document.querySelectorAll('tbody tr').length, port: /50\d\d/.test(document.querySelector('[role="alert"]')?.textContent || '') }))
  log('failed rescan keeps results, human copy, no port number', err.rows > 0 && !err.port, err.text)
  await page.getByRole('button', { name: 'Dismiss' }).first().click()
  log('error strip dismisses', (await page.locator('[role="alert"]').count()) === 0)

  // 7. no results (credit floor absurd): cause-specific card with per-ticker reasons
  await page.locator('#lc-min-credit').fill('99999')
  await page.getByRole('button', { name: /Run scan|Rescan needed/ }).click(); await waitForScan(page)
  const none = await page.evaluate(() => ({ title: document.body.textContent.match(/No setup cleared your thresholds|every ticker was skipped/)?.[0], perTicker: (document.body.textContent.match(/missed the \$99,999 minimum/g) || []).length }))
  log('no-results names the cause per ticker', !!none.title && none.perTicker >= 1, JSON.stringify(none))
  await page.screenshot({ path: `${OUT_DIR}/noresults-1440.png` })
  await page.locator('#lc-min-credit').fill('100'); await page.getByRole('button', { name: /Run scan|Rescan needed/ }).click(); await waitForScan(page)

  // 8. keyboard: ↓ moves selection, → expands the group, `/` focuses tickers
  await page.locator('section[aria-label="Ranked setups"] [tabindex="0"]').focus()
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150)
  const expandedByKey = await page.locator('tbody tr[data-kind="variant"]').count()
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150)
  const sel = await page.locator('tbody tr[data-selected="true"]').getAttribute('data-kind')
  log('→ expands the selected ticker and ↓ moves into its variants', expandedByKey > 0 && sel === 'variant', `expanded ${expandedByKey}, selected kind ${sel}`)
  await page.keyboard.press('/')
  log('`/` focuses the tickers input', await page.evaluate(() => document.activeElement?.id === 'lc-tickers'))

  // 9. sort override + Back to ranked (grouped: groups reorder by their best under the sort)
  await page.getByRole('button', { name: /Credit \/ct/ }).click()
  log('Credit sort override shows "Back to ranked"', (await page.locator('text=Back to ranked').count()) === 1)
  const heads = await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-kind="best"]')].map(tr => ({ t: tr.children[1].textContent.trim(), rank: Number(tr.children[0].textContent.trim()) })))
  log('under a sort each ticker’s head row is still its scanner-best (rank 1 stays a head)', heads.some(h => h.rank === 1), heads.map(h => `${h.t}#${h.rank}`).join(' '))
  await page.getByRole('button', { name: 'Back to ranked' }).click()
  log('Back to ranked restores rank 1 first', (await page.locator('tbody tr').first().locator('td').first().textContent())?.trim() === '1')

  // 10. Save is idempotent
  await page.getByRole('button', { name: 'Save to Tradebook' }).click()
  await page.waitForSelector('[role="status"]', { timeout: 30000 })
  log('after a save the row shows "Saved · View Tradebook"', (await page.getByRole('button', { name: /Saved · View Tradebook/ }).count()) === 1 && (await page.getByRole('button', { name: 'Save to Tradebook' }).count()) === 0)

  // 11. filter-empty ≠ threshold-empty
  for (const t of ['AMD', 'MU', 'NVDA']) { const b = page.getByRole('button', { name: `Remove ${t} from this scan` }); if (await b.count()) await b.click() }
  await page.waitForTimeout(300)
  const body = await page.textContent('body')
  log('removing every chip shows the filter card, not the threshold card', /No setups for .* in this scan/.test(body) && !/No setup cleared your thresholds/.test(body))
} catch (e) { log('exception', false, e.message); await page.screenshot({ path: `${OUT_DIR}/states-failure.png` }).catch(() => {}) }
if (errors.length) console.log('page errors:', errors.join(' | '))
await browser.close()
await cleanupAccount(acct)
finish()
