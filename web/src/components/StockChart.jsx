import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, ReferenceLine,
} from 'recharts'

const TIMEFRAMES = ['1D', '5D', '1M', '3M', '6M', '1Y']

function formatTimestamp(ts, timeframe) {
  if (ts == null) return ''
  const d = new Date(ts)
  if (timeframe === '1D' || timeframe === '5D') {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtVolume(v) {
  if (v == null) return ''
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return `${v}`
}

/**
 * Stock chart with three stacked panels: price (line), volume (bars), RSI (line + 30/70 refs).
 * Two variants:
 *   - compact  (default): fixed ~200px height, fits in the screener control bar
 *   - expanded:           flex-1, takes over the table area
 *
 * Data fetched in App.jsx via useChartData and passed in — same data feeds both
 * variants without re-fetch on toggle.
 */
export default function StockChart({
  ticker, timeframe, expanded,
  data, loading, error,
  onTimeframeChange, onToggleExpanded,
}) {
  const wrapperClass = expanded
    ? 'flex-1 min-h-0 flex flex-col bg-gray-900/40 border border-gray-800 rounded'
    : 'h-[200px] w-full flex flex-col bg-gray-900/30 border border-gray-800 rounded'

  return (
    <div className={wrapperClass}>
      <ChartHeader
        ticker={ticker}
        timeframe={timeframe}
        expanded={expanded}
        data={data}
        onTimeframeChange={onTimeframeChange}
        onToggleExpanded={onToggleExpanded}
      />

      {!ticker && <CenteredMessage>Run a scan to see chart</CenteredMessage>}
      {ticker && loading && <CenteredMessage>Loading chart…</CenteredMessage>}
      {ticker && !loading && error && <CenteredMessage tone="error">Chart unavailable</CenteredMessage>}
      {ticker && !loading && !error && data && (
        <ChartBody data={data} timeframe={timeframe} expanded={expanded} />
      )}
    </div>
  )
}

function ChartHeader({ ticker, timeframe, expanded, data, onTimeframeChange, onToggleExpanded }) {
  const price       = data?.current_price
  const changePct   = data?.change_pct
  const changeColor = changePct == null
    ? 'text-gray-500'
    : changePct >= 0 ? 'text-emerald-400' : 'text-red-400'
  const changeSign = changePct >= 0 ? '+' : ''

  return (
    <div className={`shrink-0 flex items-center justify-between gap-3 px-3 ${expanded ? 'py-2' : 'py-1.5'} border-b border-gray-800`}>
      <div className="flex items-baseline gap-3 min-w-0">
        <span className={`font-bold text-gray-100 ${expanded ? 'text-lg' : 'text-sm'}`}>
          {ticker || '—'}
        </span>
        {price != null && (
          <span className={`font-mono ${expanded ? 'text-base' : 'text-xs'} text-gray-200`}>
            ${price.toFixed(2)}
          </span>
        )}
        {changePct != null && (
          <span className={`font-mono ${expanded ? 'text-sm' : 'text-xs'} ${changeColor}`}>
            {changeSign}{changePct.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <select
          value={timeframe}
          onChange={e => onTimeframeChange(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs font-mono text-gray-200
                     focus:outline-none focus:border-indigo-500 cursor-pointer"
        >
          {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={onToggleExpanded}
          title={expanded ? 'Close chart' : 'Expand chart'}
          className="text-gray-500 hover:text-gray-200 text-base leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800"
        >
          {expanded ? '×' : '⤢'}
        </button>
      </div>
    </div>
  )
}

function CenteredMessage({ children, tone }) {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center px-3 py-4">
      <p className={`text-xs ${tone === 'error' ? 'text-red-400' : 'text-gray-600'}`}>{children}</p>
    </div>
  )
}

function ChartBody({ data, timeframe, expanded }) {
  const { bars, rsi } = data
  const showAxis = expanded
  const xDomain = bars.length
    ? [bars[0].timestamp, bars[bars.length - 1].timestamp]
    : ['auto', 'auto']

  // Per spec: price 60%, volume 20%, RSI 20% — flex weights match.
  return (
    <div className="flex-1 min-h-0 flex flex-col">

      {/* Price */}
      <div className="flex-[6] min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart syncId="luo-chart" data={bars} margin={{ top: 4, right: 8, left: showAxis ? 4 : 4, bottom: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="timestamp" type="number" domain={xDomain} scale="time"
              tickFormatter={ts => formatTimestamp(ts, timeframe)}
              hide={!showAxis}
              tick={{ fill: '#9ca3af', fontSize: 10 }} stroke="#374151"
            />
            <YAxis
              domain={['auto', 'auto']}
              hide={!showAxis}
              tick={{ fill: '#9ca3af', fontSize: 10 }} stroke="#374151"
              width={showAxis ? 56 : 0}
              tickFormatter={v => `$${v.toFixed(0)}`}
              orientation="right"
            />
            <Tooltip content={<ChartTooltip kind="price" timeframe={timeframe} />} cursor={{ stroke: '#4b5563', strokeWidth: 1 }} />
            <Line type="monotone" dataKey="close" stroke="#818cf8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Volume */}
      <div className="flex-[2] min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart syncId="luo-chart" data={bars} margin={{ top: 2, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="timestamp" type="number" domain={xDomain} scale="time" hide />
            <YAxis
              hide={!showAxis}
              tick={{ fill: '#9ca3af', fontSize: 10 }} stroke="#374151"
              width={showAxis ? 56 : 0}
              tickFormatter={fmtVolume}
              orientation="right"
            />
            <Tooltip content={<ChartTooltip kind="volume" timeframe={timeframe} />} cursor={{ stroke: '#4b5563', strokeWidth: 1 }} />
            <Bar dataKey="volume" fill="#374151" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* RSI */}
      <div className="flex-[2] min-h-0 border-t border-gray-800/40">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart syncId="luo-chart" data={rsi} margin={{ top: 2, right: 8, left: 4, bottom: showAxis ? 4 : 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="timestamp" type="number" domain={xDomain} scale="time"
              tickFormatter={ts => formatTimestamp(ts, timeframe)}
              hide={!showAxis}
              tick={{ fill: '#9ca3af', fontSize: 10 }} stroke="#374151"
            />
            <YAxis
              domain={[0, 100]}
              hide={!showAxis}
              tick={{ fill: '#9ca3af', fontSize: 10 }} stroke="#374151"
              width={showAxis ? 56 : 0}
              ticks={[30, 50, 70]}
              orientation="right"
            />
            <ReferenceLine y={70} stroke="#ef4444" strokeOpacity={0.35} strokeDasharray="3 3" />
            <ReferenceLine y={30} stroke="#ef4444" strokeOpacity={0.35} strokeDasharray="3 3" />
            <Tooltip content={<ChartTooltip kind="rsi" timeframe={timeframe} />} cursor={{ stroke: '#4b5563', strokeWidth: 1 }} />
            <Line type="monotone" dataKey="value" stroke="#a78bfa" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ChartTooltip({ active, payload, label, kind, timeframe }) {
  if (!active || !payload || payload.length === 0) return null
  const p  = payload[0].payload || {}
  const ts = p.timestamp ?? label

  return (
    <div className="bg-gray-950/95 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-200 shadow-xl">
      <div className="text-gray-500 mb-0.5">{formatTimestamp(ts, timeframe)}</div>
      {kind === 'price' && p.close != null && (
        <>
          {p.open != null && <div>O <span className="text-gray-400">${p.open.toFixed(2)}</span></div>}
          {p.high != null && <div>H <span className="text-gray-400">${p.high.toFixed(2)}</span></div>}
          {p.low  != null && <div>L <span className="text-gray-400">${p.low.toFixed(2)}</span></div>}
          <div>C <span className="text-indigo-400 font-semibold">${p.close.toFixed(2)}</span></div>
        </>
      )}
      {kind === 'volume' && p.volume != null && (
        <div>Vol <span className="text-gray-300">{fmtVolume(p.volume)}</span></div>
      )}
      {kind === 'rsi' && p.value != null && (
        <div>RSI <span className="text-violet-400 font-semibold">{p.value.toFixed(2)}</span></div>
      )}
    </div>
  )
}
