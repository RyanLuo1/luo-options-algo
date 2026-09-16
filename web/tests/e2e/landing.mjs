// Landing page guard: serves at the root, no evidence / outcome language anywhere on the page, the Income · Upside
// section renders with two cards that stack under 720px, screenshots at 1440 and 390, the header keeps its shape.
// `node tests/e2e/landing.mjs [baseUrl]`
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { BASE, OUT_DIR, log, finish } from './helpers.mjs'

mkdirSync(OUT_DIR, { recursive: true })
// Banned on the landing (owner decision 2026-09-16): evidence claims and outcome-implying phrases.
const BANNED = [/backtest/i, /validated/i, /\btested\b/i, /calculator/i, /keeps? most/i, /captures? the rise/i, /most of the rise/i, /usually wins?/i, /guaranteed/i, /win rate/i]
const html = await fetch(BASE + '/').then(r => r.text())
const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
log('serves at the root', html.includes('One structure. Two ways to set it.'))
const hits = BANNED.filter(re => re.test(text)).map(String)
log('no evidence or outcome-implying language on the page', hits.length === 0, hits.join(' '))
log('the Screener preview no longer cites a probability control', !/minimum credit and probability/i.test(text))
log('the NVDA sample appears once per section (the compact card beside the table is gone)', !/class="card setup-card"/.test(html) && (html.match(/Sample setup · illustrative/g) || []).length === 1)
log('the fourth tiles are shape facts, not ratios to compare', (html.match(/Stock must reach/g) || []).length === 2 && !/Upside per \$ of collateral/.test(text) && !/Return on collateral/.test(text))
log('no P(profit) survives on the page', !/P\(profit\)/.test(text))
log('the table ranks by the app\'s own caption', /Ranked by credit as a share of max profit/.test(text))
log('the dashboard and the table say Income', /What a row opens into/.test(html) && (html.match(/pill pill-quiet">Income</g) || []).length === 3)

const browser = await chromium.launch()
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' })).newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300)
  const m = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#modes .mode')].map(c => c.getBoundingClientRect())
    const brand = document.querySelector('header .brand')?.getBoundingClientRect()
    const btn = document.querySelector('header .btn')?.getBoundingClientRect()
    return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, cards: cards.map(r => [Math.round(r.x), Math.round(r.y), Math.round(r.width)]), brand: brand && [Math.round(brand.x), Math.round(brand.y)], btn: btn && Math.round(btn.right), collateral: [...document.querySelectorAll('#modes .kpi')].filter(k => /Collateral/.test(k.textContent)).map(k => k.querySelector('.v').textContent) }
  })
  log(`@${w}: no horizontal overflow`, !m.overflow)
  log(`@${w}: two mode cards ${w < 720 ? 'stacked' : 'side by side'}`, m.cards.length === 2 && (w < 720 ? m.cards[1][1] > m.cards[0][1] && m.cards[0][0] === m.cards[1][0] : m.cards[0][1] === m.cards[1][1] && m.cards[1][0] > m.cards[0][0]), JSON.stringify(m.cards))
  log(`@${w}: identical collateral on both cards`, m.collateral.length === 2 && m.collateral[0] === m.collateral[1] && m.collateral[0] === '$16,500', m.collateral.join(' / '))
  log(`@${w}: header keeps brand left and one button right`, !!m.brand && !!m.btn && m.btn <= w, `brand ${m.brand} · button right ${m.btn}`)
  await page.screenshot({ path: `${OUT_DIR}/landing-${w}.png`, fullPage: true })
  const sec = await page.locator('#modes').boundingBox()
  await page.screenshot({ path: `${OUT_DIR}/landing-modes-${w}.png`, fullPage: true, clip: { x: 0, y: sec.y - 8, width: w, height: sec.height + 16 } })
  if (errors.length) log(`@${w}: no page errors`, false, errors.join(' | '))
  await page.context().close()
}
await browser.close()
finish()
