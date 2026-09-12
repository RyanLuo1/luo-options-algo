import WeeksRangeSlider from '../WeeksRangeSlider'
import { Button, Field, Input } from './ui'
import { INPUT_CLASS } from './format'

// The inline controls bar: one row of white cards above the results. Every
// value/handler is owned by App (lifted state). Enter in any field runs the
// scan; `/` focus and ⌘/Ctrl+Enter are wired in App at the document level.
export default function ControlsBar({
  loading, isStale, onRun,
  tickersRef, tickerInput, setTickerInput, tickersError, onManageWatchlists, manageOpen,
  weeksMin, weeksMax, setWeeksMin, setWeeksMax,
  minCreditStr, minCreditValid, onMinCreditChange, onMinCreditBlur, bumpMinCredit,
  minPProfitStr, minPProfitValid, onMinPProfitChange, onMinPProfitBlur, bumpMinPProfit,
}) {
  const enterRuns = ok => e => { if (e.key === 'Enter' && !loading && ok) { e.preventDefault(); onRun() } }

  return (
    <section aria-label="Scan controls" className="bg-lc-card rounded-lc shadow-lc px-6 py-5">
      <div className="grid grid-cols-[minmax(14rem,1.5fr)_minmax(12rem,1fr)_minmax(11rem,.9fr)_minmax(9.5rem,.8fr)_auto] gap-5 items-end">
        {/* Tickers */}
        <Field
          label="Tickers or @watchlist"
          htmlFor="lc-tickers"
          error={tickersError}
          help={!tickersError && (
            <span>
              NVDA, META, or @semis ·{' '}
              <button type="button" onClick={onManageWatchlists} className="text-lc-violet font-semibold hover:underline">
                {manageOpen ? 'Hide watchlists' : 'Manage watchlists'}
              </button>
            </span>
          )}
        >
          <Input
            id="lc-tickers"
            ref={tickersRef}
            type="text"
            value={tickerInput ?? ''}
            onChange={e => setTickerInput(e.target.value)}
            onKeyDown={enterRuns(true)}
            placeholder="Tickers, or @watchlist"
            disabled={loading}
            error={!!tickersError}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        {/* Weeks */}
        <Field label="Weeks to expiration" help={`W${weeksMin} to W${weeksMax}`}>
          <div className={`${INPUT_CLASS} flex items-center justify-between gap-3`}>
            <WeeksRangeSlider min={1} max={12} valueMin={weeksMin} valueMax={weeksMax} onChange={(a, b) => { setWeeksMin(a); setWeeksMax(b) }} disabled={loading} />
            <span className="text-[0.9rem] font-semibold whitespace-nowrap">{weeksMin}–{weeksMax}</span>
          </div>
        </Field>

        {/* Min credit, $ per contract (the boundary divides by 100 for the API) */}
        <Field label="Minimum credit · $ per contract" htmlFor="lc-min-credit" error={minCreditValid ? null : 'Enter a dollar amount, 0 or more.'} help="Default $500 = the $5 per share rule.">
          <Stepper
            id="lc-min-credit"
            value={minCreditStr}
            onChange={onMinCreditChange}
            onBlur={onMinCreditBlur}
            onKeyDown={enterRuns(minCreditValid)}
            onMinus={() => bumpMinCredit(-50)}
            onPlus={() => bumpMinCredit(+50)}
            disabled={loading}
            error={!minCreditValid}
            inputMode="decimal"
            prefix="$"
          />
        </Field>

        {/* Min P(max profit) */}
        <Field label="Minimum P(max profit)" htmlFor="lc-min-p" error={minPProfitValid ? null : 'Whole number from 1 to 99.'} help="Chance the trade ends at max profit.">
          <Stepper
            id="lc-min-p"
            value={minPProfitStr}
            onChange={onMinPProfitChange}
            onBlur={onMinPProfitBlur}
            onKeyDown={enterRuns(minPProfitValid)}
            onMinus={() => bumpMinPProfit(-1)}
            onPlus={() => bumpMinPProfit(+1)}
            disabled={loading}
            error={!minPProfitValid}
            inputMode="numeric"
            suffix="%"
          />
        </Field>

        {/* The page's one lime action */}
        <div className="flex flex-col gap-1.5 items-end">
          <Button
            variant="primary"
            onClick={onRun}
            disabled={loading}
            aria-live="polite"
            className={isStale ? 'ring-[3px] ring-lc-violet ring-offset-2 ring-offset-lc-card' : ''}
          >
            {loading ? 'Scanning…' : isStale ? 'Rescan needed' : 'Run scan'}
          </Button>
          <span className="text-[0.75rem] text-lc-ink-2 whitespace-nowrap">⌘ Enter runs</span>
        </div>
      </div>
    </section>
  )
}

function Stepper({ id, value, onChange, onBlur, onKeyDown, onMinus, onPlus, disabled, error, inputMode, prefix, suffix }) {
  return (
    <div className={`${INPUT_CLASS} flex items-center p-0 overflow-hidden ${error ? 'border-lc-loss' : ''} ${disabled ? 'bg-lc-ground-deep' : ''}`}>
      <button type="button" onClick={onMinus} disabled={disabled} aria-label="Decrease" className="h-full px-3 text-lc-ink-2 hover:text-lc-ink hover:bg-lc-ground disabled:text-lc-ink-3 font-bold">−</button>
      <div className="flex-1 min-w-0 flex items-center justify-center gap-0.5">
        {prefix && <span className="text-lc-ink-2">{prefix}</span>}
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          disabled={disabled}
          className="w-full min-w-0 bg-transparent text-center text-lc-ink font-semibold outline-none disabled:text-lc-ink-3 [font-variant-numeric:tabular-nums]"
        />
        {suffix && <span className="text-lc-ink-2">{suffix}</span>}
      </div>
      <button type="button" onClick={onPlus} disabled={disabled} aria-label="Increase" className="h-full px-3 text-lc-ink-2 hover:text-lc-ink hover:bg-lc-ground disabled:text-lc-ink-3 font-bold">+</button>
    </div>
  )
}
