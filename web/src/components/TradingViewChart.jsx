import { useEffect, useRef } from 'react'

// Hex values behind the design tokens (web/src/index.css) — the TradingView
// embed config can't read CSS custom properties, so the raw values are
// duplicated here. Keep in sync with --bg-surface / --border-subtle.
const SURFACE_HEX = '#1E293B'  // --bg-surface
const SUBTLE_HEX  = '#334155'  // --border-subtle

// TradingView needs exchange-prefixed symbols (NASDAQ:MU, not MU). Watchlist
// tickers mapped to their listing exchange; anything unknown defaults to
// NASDAQ. Note: PLTR moved NYSE → NASDAQ in Nov 2022; TSM trades on NYSE as
// an ADR; GEV (GE Vernova) is NYSE.
const EXCHANGE_MAP = {
  GEV:  'NYSE',
  TSM:  'NYSE',
  PLTR: 'NASDAQ',
  APP:  'NASDAQ',
  AVGO: 'NASDAQ',
  META: 'NASDAQ',
  MU:   'NASDAQ',
  NVDA: 'NASDAQ',
  TSLA: 'NASDAQ',
  AMD:  'NASDAQ',
}

export function toTvSymbol(ticker) {
  if (!ticker) return null
  const t = ticker.toUpperCase()
  return `${EXCHANGE_MAP[t] ?? 'NASDAQ'}:${t}`
}

/**
 * TradingView Advanced Chart embed — replaces the homegrown Recharts chart.
 *
 * Uses the official embed script (s3.tradingview.com/external-embedding), NOT
 * the unmaintained react-tradingview-widget npm package. The widget is created
 * by injecting the script tag with the config JSON as its text content; on
 * symbol change the container is cleared and the script re-injected so
 * switching tickers reloads the chart cleanly (no stacked widgets).
 * autosize:true makes the iframe fill the container, so the wrapper must have
 * a real height (flex-1 min-h-0 inside the detail column).
 *
 * The copyright/attribution link below the widget is REQUIRED by TradingView's
 * embed terms — do not remove it.
 */
export default function TradingViewChart({ symbol, fullscreen, onToggleFull }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !symbol) return

    // Tear down any previous widget before creating the new one.
    container.innerHTML = ''

    const widgetDiv = document.createElement('div')
    widgetDiv.className = 'tradingview-widget-container__widget'
    widgetDiv.style.height = '100%'
    widgetDiv.style.width  = '100%'
    container.appendChild(widgetDiv)

    const script = document.createElement('script')
    script.src   = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type  = 'text/javascript'
    script.async = true
    // If the STD; study IDs ever stop rendering, fall back to
    // ["Volume@tv-basicstudies", "RSI@tv-basicstudies"].
    script.text = JSON.stringify({
      autosize: true,
      symbol,
      interval: 'D',
      timezone: 'America/New_York',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: SURFACE_HEX,
      gridColor: SUBTLE_HEX,
      hide_side_toolbar: true,
      allow_symbol_change: false,
      calendar: false,
      studies: ['STD;Volume', 'STD;RSI'],
      support_host: 'https://www.tradingview.com',
    })
    container.appendChild(script)

    return () => { container.innerHTML = '' }
  }, [symbol])

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-surface border border-subtle rounded overflow-hidden">
      {/* Slim header — keeps the existing expand-within-detail-zone toggle */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-1.5 border-b border-subtle">
        <span className="text-sm font-bold text-primary">{symbol ?? '—'}</span>
        {onToggleFull && (
          <button
            onClick={onToggleFull}
            title={fullscreen ? 'Collapse chart' : 'Expand chart to full width'}
            className="text-tertiary hover:text-primary text-base leading-none w-6 h-6
                       flex items-center justify-center rounded hover:bg-surface-raised"
          >
            {fullscreen ? '⤡' : '⤢'}
          </button>
        )}
      </div>

      {/* Widget mount point — script + iframe injected here per symbol */}
      <div ref={containerRef} className="tradingview-widget-container flex-1 min-h-0" />

      {/* Required TradingView attribution — do not remove (embed terms) */}
      <div className="tradingview-widget-copyright shrink-0 px-3 py-1 text-[10px] text-tertiary border-t border-subtle">
        <a
          href={`https://www.tradingview.com/symbols/${symbol ? symbol.replace(':', '-') : ''}/`}
          rel="noopener nofollow"
          target="_blank"
          className="hover:underline"
          style={{ color: 'var(--link)' }}
        >
          {symbol ? `${symbol} chart` : 'Charts'}
        </a>
        <span> by TradingView</span>
      </div>
    </div>
  )
}
