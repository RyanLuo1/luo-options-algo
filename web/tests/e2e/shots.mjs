// Screenshots of the Screener after a scan at 1440 and 1100, with overflow and font checks.
// `node tests/e2e/shots.mjs [baseUrl] [--tickers "NVDA, AMD, MU"]`
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { BASE, OUT_DIR, log, finish, makeAccount, cleanupAccount, signIn, runScan } from './helpers.mjs'

mkdirSync(OUT_DIR, { recursive: true })
const i = process.argv.indexOf('--tickers'); const tickers = i > -1 ? process.argv[i + 1] : 'NVDA, AMD, MU'
const acct = await makeAccount('shots')
const browser = await chromium.launch()
for (const w of [1440, 1100]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' })).newPage()
  try {
    await signIn(page, acct); await runScan(page, tickers)
    const m = await page.evaluate(() => {
      const leaks = []
      for (const el of document.querySelectorAll('body *')) { const b = el.getBoundingClientRect(); if (b.right > innerWidth + 1) { let a = el.parentElement, clipped = false; while (a && a !== document.body) { if (['auto','scroll','hidden','clip'].includes(getComputedStyle(a).overflowX)) { clipped = true; break } a = a.parentElement } if (!clipped) leaks.push(el.tagName + '.' + String(el.className).slice(0, 40)) } }
      return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, leaks: leaks.slice(0, 5), fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).filter((x, k, a) => a.indexOf(x) === k), h: document.documentElement.scrollHeight }
    })
    await page.screenshot({ path: `${OUT_DIR}/screener-${w}.png`, fullPage: true })
    log(`@${w}: no horizontal overflow, fonts loaded`, !m.overflow && m.fonts.includes('Bricolage Grotesque') && m.fonts.includes('Figtree'), `height ${m.h}${m.leaks.length ? ' leaks ' + m.leaks.join(', ') : ''}`)
  } catch (e) { log(`@${w} exception`, false, e.message) }
  await page.context().close()
}
await browser.close()
await cleanupAccount(acct)
finish()
