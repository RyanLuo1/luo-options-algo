// Liquidity: the census and the Tier 1 ladder (Upside, display-only). A zero chip carries its exact
// cause with the census on hover → "Show thin-quote setups" opens the ticker's own labelled group
// (Tier 1 · volume floor off) with the liquidity-cost headline → the Tier 0 table is byte-identical
// with the group open or closed → the panel views read-only, never saves → the four commitment
// tests against the API. `node tests/e2e/liquidity.mjs [baseUrl]`
// The window is chosen so a ticker is empty at Tier 0 and has rows at Tier 1 (MU, weeks 7–8, credit
// −$500, upside 0 on 2026-09-17); if the market moves that away the run says so instead of failing silently.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { BASE, OUT_DIR, ENV, log, finish, makeAccount, cleanupAccount, signIn, runScan, rowsFor } from './helpers.mjs'

mkdirSync(OUT_DIR, { recursive: true })
const acct = await makeAccount('liq')
const SUPABASE_URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL, ANON = ENV.VITE_SUPABASE_ANON_KEY
// The window moves with the market: override with LIQ_TICKERS / LIQ_ZERO / LIQ_WEEKS (e.g. LIQ_WEEKS=7,9 LIQ_ZERO=META).
const TICKERS = process.env.LIQ_TICKERS || 'MU, TSM, NVDA', ZERO = process.env.LIQ_ZERO || 'MU', WEEKS = (process.env.LIQ_WEEKS || '7,8').split(',').map(Number)

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []; page.on('pageerror', e => errors.push(e.message))
const body = () => page.textContent('body')
const tier0Snapshot = () => page.evaluate(() => [...document.querySelectorAll('section:not([data-relaxed-group]) tbody tr[data-kind]')].map(tr => `${tr.dataset.kind}|${tr.dataset.tier ?? ''}|${tr.textContent.trim()}`).join('\n'))
try {
  await signIn(page, acct); await page.waitForSelector('#lc-min-credit')
  await page.getByRole('tab', { name: 'Upside' }).click(); await page.waitForTimeout(200)
  await page.fill('#lc-min-credit', '-500'); await page.locator('#lc-min-credit').blur()
  await page.fill('#lc-min-upside', '0'); await page.locator('#lc-min-upside').blur()
  const sliders = page.locator('section[aria-label="Scan controls"] input[type="range"]')
  await sliders.nth(0).fill(String(WEEKS[0])); await sliders.nth(1).fill(String(WEEKS[1])); await page.waitForTimeout(100)
  log('weeks set to the Tier 1 window', new RegExp(`${WEEKS[0]}–${WEEKS[1]}`).test(await page.textContent('section[aria-label="Scan controls"]')))
  await runScan(page, TICKERS)

  // ── the zero chip: exact cause, census on hover, the opt-in
  const chip = await page.evaluate(t => { const s = [...document.querySelectorAll('[aria-label="Tickers in this scan"] [data-chip]')].find(x => x.querySelector('button')?.textContent.startsWith(t)); return s ? { text: s.textContent.trim().replace(/\s+/g, ' '), title: s.querySelector('button').title, relax: !!s.querySelector('[data-relax]') } : null }, ZERO)
  log(`${ZERO} is a zero chip with an exact cause`, !!chip && /— (quotes too wide|no live quotes|untraded|no complete three-leg setup|candidates|no setup cleared)/.test(chip.text), chip?.text)
  log('the zero chip sits under the hits, in its own “Didn’t make the cut” line', await page.evaluate(t => { const m = document.querySelector('[aria-label="Tickers in this scan"] [data-misses]'); const first = document.querySelector('[aria-label="Tickers in this scan"] > div:first-child'); return !!m && !!m.querySelector(`[data-chip="${t}"]`) && !first.querySelector(`[data-chip="${t}"]`) && m.getBoundingClientRect().top > first.getBoundingClientRect().top }, ZERO))
  log('the hover carries the census', !!chip && /contracts seen: .*tradeable/.test(chip.title), chip?.title)
  log('the chip offers the thin-quote setups (Tier 1 found rows)', !!chip?.relax, chip?.relax ? '' : 'no Tier 1 rows in this window tonight — pick another window')
  await page.screenshot({ path: `${OUT_DIR}/liquidity-chips-1440.png` })

  // ── commitment 1: the Tier 0 table is byte-identical with the group open or closed
  const before = await tier0Snapshot()
  const tier0Rows = (await page.locator('section:not([data-relaxed-group]) tbody tr[data-kind]').count())
  await page.locator(`[data-relax="${ZERO}"]`).click(); await page.waitForTimeout(300)
  const group = page.locator(`[data-relaxed-group="${ZERO}"]`)
  log('the group opens IN PLACE of the ranked list, labelled Volume floor off (no tier in the UI), saying what still holds', (await group.count()) === 1 && /Volume floor off/.test(await group.textContent()) && !/Tier/.test(await group.textContent()) && /spread cap still required · your credit and upside floors still apply/.test(await group.textContent()) && (await page.locator('section:not([data-relaxed-group]) tbody tr[data-kind]').count()) === 0 && (await group.getByRole('button', { name: 'Back to ranked setups' }).count()) === 1)
  const groupTop = await group.evaluate(el => el.getBoundingClientRect().top)
  log('no scroll needed: the group starts where the results were', groupTop >= 0 && groupTop < 900, `top ${Math.round(groupTop)}px`)
  log('the ranked list’s grammar: the best row, then +N more', (await group.locator('table[data-tier="1"] tbody tr[data-tier="1"]').count()) === 1 && /\+\d+ more MU setups/.test(await group.locator('[data-relaxed-more]').textContent()))
  await group.locator('[data-relaxed-more]').click(); await page.waitForTimeout(150)
  const relaxedRows = await group.locator('table[data-tier="1"] tbody tr[data-tier="1"]').count()
  log('relaxed rows sit in their own table, never in the ranked list', relaxedRows > 1 && /Show fewer MU setups/.test(await group.locator('[data-relaxed-more]').textContent()) && (await page.locator('section:not([data-relaxed-group]) tbody tr[data-tier="1"]').count()) === 0, `${relaxedRows} Tier 1 rows · ${tier0Rows} Tier 0 rows`)
  // ── the headline: what patience is worth
  const cost = await group.locator('[data-liquidity-cost]').textContent()
  log('the liquidity cost is the headline: at the bid/ask, at the mid, gap', /What patience is worth/.test(cost) && /At the bid\/ask/.test(cost) && /At the mid/.test(cost) && /Gap/.test(cost), cost.replace(/\s+/g, ' ').slice(0, 160))
  const figs = await group.evaluate(g => [...g.querySelectorAll('[data-liquidity-cost] .font-display')].map(el => el.textContent))
  const num = s => Number(String(s).replace(/[−$,]/g, '')) * (/−/.test(s) ? -1 : 1)
  log('gap = at the mid − at the bid/ask (≥ 0)', figs.length === 3 && Math.abs((num(figs[1]) - num(figs[0])) - num(figs[2])) <= 1 && num(figs[2]) >= 0, figs.join(' | '))
  log('the dashboard marks the thin legs on their tiles; hovering a leg shows volume and open interest', (await group.locator('section[aria-label^="Setup detail"] [data-thin="true"]').count()) >= 1 && (await group.locator('[data-leg-figures]').count()) === 3 && /^Volume: [\d,]+ · OI: [\d,—]+$/.test(await group.locator('[data-thin="true"] [data-leg-figures]').first().textContent()))
  await group.locator('[data-thin="true"]').first().hover(); await page.waitForTimeout(150)
  log('the leg figures appear on hover', await group.locator('[data-thin="true"] [data-leg-figures]').first().isVisible())
  log('the panel in the group is Tier 1, viewable, not saveable', (await group.getByText('Volume floor off').count()) >= 2 && (await group.getByRole('button', { name: 'View in editor' }).count()) === 1 && (await group.getByRole('button', { name: /Save to Tradebook/ }).count()) === 0 && /Not saveable/.test(await group.textContent()))
  await page.screenshot({ path: `${OUT_DIR}/liquidity-group-1440.png`, fullPage: true })
  log('the chip now offers the way back', /Back to ranked setups/.test(await page.locator(`[data-relax="${ZERO}"]`).textContent()))
  await group.getByRole('button', { name: 'Back to ranked setups' }).click(); await page.waitForTimeout(200)
  log('commitment 1: back from the group, the Tier 0 table is byte-identical (rows, ranks, selection)', (await page.locator(`[data-relaxed-group="${ZERO}"]`).count()) === 0 && (await tier0Snapshot()) === before, tier0Rows === 0 ? '(no Tier 0 rows in this window: trivially)' : `${tier0Rows} rows`)

  // ── view in the editor: read-only
  await page.locator(`[data-relax="${ZERO}"]`).click(); await page.waitForTimeout(200)
  await group.getByRole('button', { name: 'View in editor' }).click(); await page.waitForURL(/\/trade/); await page.waitForTimeout(600)
  log('the editor opens read-only for a thin-quote setup', /Thin-quote setup · read-only/.test(await body()) && (await page.getByRole('button', { name: /Recalculate|Save/ }).count()) === 0 && /can’t be edited against the live chain or saved/.test(await body()))
  await page.screenshot({ path: `${OUT_DIR}/liquidity-editor-1440.png` })
  // ── Back returns to the open group with the same row selected (the opt-in survives the trip)
  await page.getByRole('button', { name: /Back to Screener/ }).click(); await page.waitForURL(/\/app/); await page.waitForTimeout(500)
  log('Back from the editor returns to the open group with its selection', (await page.locator(`[data-relaxed-group="${ZERO}"]`).count()) === 1 && (await page.locator(`[data-relaxed-group="${ZERO}"] tr[data-selected="true"]`).count()) === 1)
  // ── keyboard: the selected row is the one tab stop; ↓ moves the selection and the headline follows
  const headBefore = await page.locator(`[data-relaxed-group="${ZERO}"] [data-liquidity-cost]`).textContent()
  await page.locator(`[data-relaxed-group="${ZERO}"] tr[data-selected="true"]`).focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150)   // → expands from the head row, as in the ranked list
  log('→ on the head row reveals the rest', (await page.locator(`[data-relaxed-group="${ZERO}"] table[data-tier="1"] tbody tr[data-tier="1"]`).count()) > 1)
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150)
  const kb = await page.evaluate(t => { const g = document.querySelector(`[data-relaxed-group="${t}"]`); const rows = [...g.querySelectorAll('table[data-tier="1"] tbody tr[data-tier="1"]')]; return { stops: rows.filter(r => r.tabIndex === 0).length, selectedIndex: rows.findIndex(r => r.dataset.selected === 'true'), focusedIsSelected: document.activeElement === rows.find(r => r.dataset.selected === 'true') } }, ZERO)
  log('↓ moves the Tier 1 selection with one roving tab stop, and the headline follows', kb.stops === 1 && kb.selectedIndex === 1 && kb.focusedIsSelected && (await page.locator(`[data-relaxed-group="${ZERO}"] [data-liquidity-cost]`).textContent()) !== headBefore, JSON.stringify(kb))
  const clip = await page.evaluate(t => { const w = document.querySelector(`[data-relaxed-group="${t}"] .overflow-x-auto`); return { scroll: w.scrollWidth, client: w.clientWidth } }, ZERO)
  log('the Tier 1 table fits its column at 1440 (no hidden column)', clip.scroll <= clip.client, JSON.stringify(clip))

  // ── commitments 2–4 against the API, as this account
  const tok = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: acct.email, password: acct.password }) }).then(r => r.json())
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.access_token}` }
  const api = (b, h = headers) => fetch(`${BASE}/api/run`, { method: 'POST', headers: h, body: JSON.stringify(b) }).then(async r => ({ status: r.status, data: await r.json() }))
  const up = await api({ tickers: TICKERS.split(/,\s*/), mode: 'upside', min_premium: -5, min_upside: 0, weeks_min: WEEKS[0], weeks_max: WEEKS[1] })
  const rel = up.data.relaxed?.[ZERO]
  log('commitment 3: every ranked row carries tier 0; every relaxed row tier 1', up.status === 200 && up.data.ranked.every(r => r.tier === 0) && !!rel && rel.rows.length > 0 && rel.rows.every(r => r.tier === 1), `${up.data.ranked.length} ranked · ${rel?.rows?.length ?? 0} relaxed`)
  log('commitment 3: the ladder is fixed — a tier parameter is a 400', (await api({ tickers: [ZERO], mode: 'upside', tier: 1 })).status === 400)
  // scan_results has no user_id (it links through scan_runs): read the scan's rows with the service key
  const SERVICE = ENV.SUPABASE_SERVICE_KEY
  const logged = up.data.scan_id && SERVICE ? (await fetch(`${SUPABASE_URL}/rest/v1/scan_results?scan_id=eq.${up.data.scan_id}&select=id`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }).then(r => r.json())).length : null
  log('commitment 2: relaxed rows are never logged (scan_results holds exactly the ranked rows)', up.data.scan_id != null && logged === up.data.ranked.length, `scan ${up.data.scan_id}: ${logged} logged vs ${up.data.ranked.length} ranked`)
  const r1 = rel?.rows?.[0]
  const trade = r1 && { ticker: r1.ticker, expiration: r1.expiration, saved_at: new Date().toISOString(), leg_a_strike: r1.leg_a_strike, leg_a_premium: r1.leg_a_prem, leg_a_delta: r1.leg_a_delta, leg_b_strike: r1.leg_b_strike, leg_b_premium: r1.leg_b_prem, leg_b_delta: r1.leg_b_delta, leg_c_strike: r1.leg_c_strike, leg_c_premium: r1.leg_c_prem, leg_c_delta: r1.leg_c_delta, net_premium: r1.net_premium, spread_width: r1.spread_width, score: r1.score, p_max_profit: r1.p_max_profit, mode: 'upside', tier: 1 }
  const save = r1 ? await fetch(`${BASE}/api/tradebook/save`, { method: 'POST', headers, body: JSON.stringify({ scan_id: up.data.scan_id, result_id: null, trade }) }).then(async r => ({ status: r.status, data: await r.json() })) : null
  log('commitment 2: a relaxed setup cannot be saved (400) and the Tradebook stays empty', !!save && save.status === 400 && /can't be saved/.test(save.data.error || '') && (acct.id ? (await rowsFor(acct, 'tradebook', 'id')).length === 0 : true), save?.data?.error)
  const inc = await api({ tickers: [ZERO], mode: 'income', weeks_min: WEEKS[0], weeks_max: WEEKS[1] })
  log('commitment 4: an Income response carries no relaxed rows', inc.status === 200 && !('relaxed' in inc.data) && !('ladder' in inc.data))
  log('commitment 4: an Income request cannot ask for relaxation (400)', (await api({ tickers: [ZERO], mode: 'income', relax: true })).status === 400)

  log('no page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  log('script completed', false, e.message)
} finally {
  await browser.close()
  await cleanupAccount(acct)
}
finish()
