import WeeksRangeSlider from '../WeeksRangeSlider'
import { Button, Field, Input } from './ui'
import { INPUT_CLASS } from './format'

// The inline controls bar. Every value/handler is owned by App (lifted state).
// Enter in any field runs the scan; `/` focus and ⌘/Ctrl+Enter are wired in
// App at the document level. Two credit gates (the dual-gate default):
//   • Minimum credit · $ per contract — the friction floor (API: min_premium, per share)
//   • Minimum return on collateral   — applied client-side to the scan's rows
export default function ControlsBar({
  loading, isStale, onRun, canRun = true,
  tickersRef, tickerInput, setTickerInput, tickersError, onManageWatchlists, manageOpen,
  weeksMin, weeksMax, setWeeksMin, setWeeksMax,
  minCreditStr, minCreditValid, onMinCreditChange, onMinCreditBlur, bumpMinCredit,
  minRocStr, minRocValid, onMinRocChange, onMinRocBlur, bumpMinRoc,
  minPProfitStr, minPProfitValid, onMinPProfitChange, onMinPProfitBlur, bumpMinPProfit,
}) {
  const enterRuns = ok => e => { if (e.key === 'Enter' && !loading && ok) { e.preventDefault(); onRun() } }

  return (
    <section aria-label="Scan controls" className="bg-lc-card rounded-lc shadow-lc px-6 py-5">
      <div className="flex flex-wrap gap-x-5 gap-y-4 items-end">
        <Field
          className="basis-[18rem] grow-[2]"
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
          <Input id="lc-tickers" ref={tickersRef} type="text" value={tickerInput ?? ''} onChange={e => setTickerInput(e.target.value)}
            onKeyDown={enterRuns(true)} placeholder="Tickers, or @watchlist" disabled={loading} error={!!tickersError} autoComplete="off" spellCheck={false} />
        </Field>

        <Field className="basis-[13rem] grow" label="Weeks to expiration" help={`W${weeksMin} to W${weeksMax}`}>
          <div className={`${INPUT_CLASS} flex items-center justify-between gap-3`}>
            <WeeksRangeSlider min={1} max={12} valueMin={weeksMin} valueMax={weeksMax} onChange={(a, b) => { setWeeksMin(a); setWeeksMax(b) }} disabled={loading} />
            <span className="text-[0.9rem] font-semibold whitespace-nowrap">{weeksMin}–{weeksMax}</span>
          </div>
        </Field>

        {/* Min credit, $ per contract — the friction floor (the boundary divides by 100 for the API) */}
        <Field className="basis-[11rem] grow max-lc:grow-0" label="Minimum credit · $ per contract" htmlFor="lc-min-credit" error={minCreditValid ? null : 'Enter a dollar amount, 0 or more.'} help="Covers commissions and bid/ask slippage.">
          <Stepper id="lc-min-credit" value={minCreditStr} onChange={onMinCreditChange} onBlur={onMinCreditBlur} onKeyDown={enterRuns(minCreditValid)}
            onMinus={() => bumpMinCredit(-50)} onPlus={() => bumpMinCredit(+50)} disabled={loading} error={!minCreditValid} inputMode="decimal" prefix="$" />
        </Field>

        {/* Min return on collateral — applied client-side to the scan's rows, live */}
        <Field className="basis-[11rem] grow max-lc:grow-0" label="Minimum return on collateral" htmlFor="lc-min-roc" error={minRocValid ? null : 'Enter a percent, 0 or more.'} help="Credit as a share of the cash the put ties up — lets cheap and expensive stocks compete fairly.">
          <Stepper id="lc-min-roc" value={minRocStr} onChange={onMinRocChange} onBlur={onMinRocBlur} onKeyDown={enterRuns(minRocValid)}
            onMinus={() => bumpMinRoc(-0.5)} onPlus={() => bumpMinRoc(+0.5)} disabled={loading} error={!minRocValid} inputMode="decimal" suffix="%" />
        </Field>

        <Field className="basis-[10rem] grow max-lc:grow-0" label="Minimum P(max profit)" htmlFor="lc-min-p" error={minPProfitValid ? null : 'Whole number from 1 to 99.'} help="Chance the trade ends at max profit.">
          <Stepper id="lc-min-p" value={minPProfitStr} onChange={onMinPProfitChange} onBlur={onMinPProfitBlur} onKeyDown={enterRuns(minPProfitValid)}
            onMinus={() => bumpMinPProfit(-1)} onPlus={() => bumpMinPProfit(+1)} disabled={loading} error={!minPProfitValid} inputMode="numeric" suffix="%" />
        </Field>

        {/* The page's one lime action */}
        <div className="flex flex-col gap-1.5 items-end ml-auto">
          <Button variant="primary" onClick={onRun} disabled={loading || !canRun} title={!canRun ? 'Fix the highlighted field first' : undefined}
            className={isStale ? 'ring-[3px] ring-lc-violet ring-offset-2 ring-offset-lc-card' : ''}>
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
        <input id={id} type="text" inputMode={inputMode} value={value} onChange={onChange} onBlur={onBlur} onKeyDown={onKeyDown} disabled={disabled}
          className="w-full min-w-0 bg-transparent text-center text-lc-ink font-semibold outline-none disabled:text-lc-ink-3 [font-variant-numeric:tabular-nums]" />
        {suffix && <span className="text-lc-ink-2">{suffix}</span>}
      </div>
      <button type="button" onClick={onPlus} disabled={disabled} aria-label="Increase" className="h-full px-3 text-lc-ink-2 hover:text-lc-ink hover:bg-lc-ground disabled:text-lc-ink-3 font-bold">+</button>
    </div>
  )
}
