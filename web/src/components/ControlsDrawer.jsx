import WeeksRangeSlider from './WeeksRangeSlider'

/**
 * ControlsDrawer — the four scan controls (Tickers, Weeks range, Min Net
 * Premium, Min P(Profit)) in a panel that slides in from the LEFT. Opened /
 * closed by the '⚙ Controls' trigger in the header; default CLOSED so the
 * results (table + detail + chart) get full width.
 *
 * Run Scan is intentionally NOT in here — it stays in the header so the user
 * can re-scan without opening the drawer. Pressing Enter in any field still
 * runs the scan (via `onRun`).
 *
 * Pure presentation + lifted state: every value/handler is owned by App.jsx
 * and threaded through props (mirrors the old inline controls panel exactly,
 * just laid out vertically and full-width).
 */
export default function ControlsDrawer({
  open, onClose, loading,
  // Tickers
  tickerInput, setTickerInput, onRun,
  // Weeks
  weeksMin, weeksMax, setWeeksMin, setWeeksMax,
  // Min Net Premium
  minPremium, minPremiumStr, minPremiumValid,
  handleMinPremiumChange, handleMinPremiumBlur, bumpMinPremium,
  // Min P(Profit)
  minPProfit, minPProfitStr, minPProfitValid,
  handleMinPProfitChange, handleMinPProfitBlur, bumpMinPProfit,
}) {
  return (
    <>
      {/* Backdrop — click to close. Fades; non-interactive when closed. */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200
                    ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        aria-hidden="true"
      />

      {/* Drawer panel — slides from the left. */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] bg-surface border-r border-subtle
                    shadow-2xl flex flex-col transition-transform duration-200 ease-out
                    ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-subtle">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-tertiary">Controls</span>
          <button
            onClick={onClose}
            title="Close controls"
            className="text-tertiary hover:text-primary text-lg leading-none w-6 h-6
                       flex items-center justify-center rounded hover:bg-surface-raised"
          >
            ×
          </button>
        </div>

        {/* Fields — stacked vertically */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-5">

          {/* Tickers */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-secondary">Tickers</label>
            <input
              type="text"
              value={tickerInput}
              onChange={e => setTickerInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && onRun()}
              placeholder="NVDA, META, TSLA… · blank = watchlist"
              title="Comma- or space-separated tickers · blank = default watchlist"
              disabled={loading}
              className="w-full h-[34px] bg-surface-raised text-gray-100 border border-subtle rounded-md px-3
                         text-sm font-mono placeholder-gray-600
                         focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>

          {/* Weeks range */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-secondary">Weeks range</label>
            <div className="flex items-center justify-between gap-3 h-[34px] bg-surface-raised border border-subtle rounded-md px-3">
              <WeeksRangeSlider
                min={1}
                max={12}
                valueMin={weeksMin}
                valueMax={weeksMax}
                onChange={(mn, mx) => { setWeeksMin(mn); setWeeksMax(mx) }}
                disabled={loading}
              />
              <span className="text-xs num text-secondary whitespace-nowrap">{weeksMin}–{weeksMax}</span>
            </div>
          </div>

          {/* Min Net Premium — unified stepper */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-secondary">Min Net Premium $</label>
            <div
              title="Minimum net credit required (per share)"
              className={`flex items-center justify-between h-[34px] bg-surface-raised border rounded-md transition-colors
                          ${minPremiumValid ? 'border-subtle focus-within:border-accent' : 'border-loss'}`}
            >
              <button
                onClick={() => bumpMinPremium(-0.50)}
                disabled={loading || minPremium <= 0}
                className="px-3 h-full text-secondary hover:text-primary disabled:opacity-40 text-sm font-bold"
              >−</button>
              <input
                type="text"
                inputMode="decimal"
                value={minPremiumStr}
                onChange={handleMinPremiumChange}
                onBlur={handleMinPremiumBlur}
                onKeyDown={e => e.key === 'Enter' && !loading && minPremiumValid && onRun()}
                disabled={loading}
                placeholder="5.00"
                className="flex-1 min-w-0 bg-transparent text-gray-100 text-sm font-mono text-center
                           placeholder-gray-600 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={() => bumpMinPremium(+0.50)}
                disabled={loading}
                className="px-3 h-full text-secondary hover:text-primary disabled:opacity-40 text-sm font-bold"
              >+</button>
            </div>
          </div>

          {/* Min P(Profit) — unified stepper */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-secondary">Min P(Profit) %</label>
            <div
              title="Minimum P(max profit) threshold (1–99%)"
              className={`flex items-center justify-between h-[34px] bg-surface-raised border rounded-md transition-colors
                          ${minPProfitValid ? 'border-subtle focus-within:border-accent' : 'border-loss'}`}
            >
              <button
                onClick={() => bumpMinPProfit(-1)}
                disabled={loading || Math.round(minPProfit * 100) <= 1}
                className="px-3 h-full text-secondary hover:text-primary disabled:opacity-40 text-sm font-bold"
              >−</button>
              <input
                type="text"
                inputMode="numeric"
                value={minPProfitStr}
                onChange={handleMinPProfitChange}
                onBlur={handleMinPProfitBlur}
                onKeyDown={e => e.key === 'Enter' && !loading && minPProfitValid && onRun()}
                disabled={loading}
                placeholder="50"
                className="flex-1 min-w-0 bg-transparent text-gray-100 text-sm font-mono text-center
                           placeholder-gray-600 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={() => bumpMinPProfit(+1)}
                disabled={loading || Math.round(minPProfit * 100) >= 99}
                className="px-3 h-full text-secondary hover:text-primary disabled:opacity-40 text-sm font-bold"
              >+</button>
            </div>
          </div>

          <p className="text-[11px] text-tertiary mt-1">
            Adjust controls, then Run Scan in the header. Enter in any field runs the scan too.
          </p>
        </div>
      </aside>
    </>
  )
}
