import { useEffect, useRef } from 'react'
import { toTvSymbol } from './TradingViewChart'

// Watchlist order for the tape (per the screener watchlist). Built into the
// exchange-prefixed form via the same toTvSymbol map the chart uses, so GEV
// resolves to NYSE:GEV, TSM to NYSE:TSM, etc.
const WATCHLIST = ['MU', 'NVDA', 'AMD', 'META', 'AVGO', 'PLTR', 'APP', 'TSM', 'GEV', 'TSLA']

// Index/context symbols up front. VIX uses CAPITALCOM:VIX — the Capital.com
// feed reliably renders on the free embed (TVC:VIX and CBOE:VIX did not). It's
// a CFD proxy that tracks the index closely. SPY is AMEX:SPY, QQQ is NASDAQ:QQQ.
const SYMBOLS = [
  { proName: 'AMEX:SPY',       title: 'SPY' },
  { proName: 'NASDAQ:QQQ',     title: 'QQQ' },
  { proName: 'CAPITALCOM:VIX', title: 'VIX' },
  ...WATCHLIST.map(t => ({ proName: toTvSymbol(t), title: t })),
]

/**
 * TradingView Ticker Tape embed — a scrolling market strip for the header.
 *
 * Same injection/cleanup pattern as TradingViewChart.jsx (official embed
 * script, not the npm package). Mounted ONCE and kept mounted — the parent
 * fades it under the header controls via opacity rather than unmounting, so the
 * widget never reloads/flickers on hover.
 *
 * `isTransparent: true` is critical: it drops the widget's own background and
 * border so the tape blends straight into the header surface.
 */
export default function TickerTape() {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.innerHTML = ''

    const widgetDiv = document.createElement('div')
    widgetDiv.className = 'tradingview-widget-container__widget'
    container.appendChild(widgetDiv)

    const script = document.createElement('script')
    script.src   = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js'
    script.type  = 'text/javascript'
    script.async = true
    script.text  = JSON.stringify({
      symbols: SYMBOLS,
      colorTheme: 'dark',
      isTransparent: true,
      showSymbolLogo: true,
      displayMode: 'adaptive',
      locale: 'en',
    })
    container.appendChild(script)

    return () => { container.innerHTML = '' }
  }, [])

  return (
    <div ref={containerRef} className="tradingview-widget-container w-full" />
  )
}
