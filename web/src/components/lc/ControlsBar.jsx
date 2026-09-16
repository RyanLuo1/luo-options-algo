import WeeksRangeSlider from '../WeeksRangeSlider'
import { Button, Input, InfoTip } from './ui'
import { INPUT_CLASS, MODES } from './format'

// The controls bar is a three-row grid: label row · input row (one baseline, 44px)
// · helper row (fixed two-line slot). Each field is a subgrid spanning the three
// rows, so every input sits on the same line whatever its label or helper needs.
// Helpers are one line; longer explanations live in an ⓘ tooltip beside the label.
// Two credit gates: "$ per contract" goes to the API per share (rescan);
// "return on collateral" is applied client-side, live.
// ≤1100: two bands of three fields; Run scan sits on the second band's input row.
export default function ControlsBar({
  loading, isStale, onRun, canRun = true,
  tickersRef, tickerInput, setTickerInput, tickersError, onManageWatchlists, manageOpen,
  weeksMin, weeksMax, setWeeksMin, setWeeksMax,
  minCreditStr, minCreditValid, onMinCreditChange, onMinCreditBlur, bumpMinCredit,
  minRocStr, minRocValid, onMinRocChange, onMinRocBlur, bumpMinRoc,
  minPProfitStr, minPProfitValid, onMinPProfitChange, onMinPProfitBlur, bumpMinPProfit,
  mode = 'income', onModeChange,
  minUpsideStr, minUpsideValid, onMinUpsideChange, onMinUpsideBlur, bumpMinUpside,
}) {
  const enterRuns = ok => e => { if (e.key === 'Enter' && !loading && ok) { e.preventDefault(); onRun() } }

  return (
    <section aria-label="Scan controls" className="bg-lc-card rounded-lc shadow-lc px-6 pt-5 pb-5">
      {/* Mode: Income (the validated scan) · Upside (a calculator). Custom is a later segment. */}
      <div className="flex items-center gap-4 flex-wrap mb-4">
        <div role="tablist" aria-label="Screener mode" className="flex p-1.5 bg-lc-ground-deep/60 rounded-lc-plus"
          onKeyDown={e => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; e.preventDefault(); onModeChange?.(mode === 'income' ? 'upside' : 'income') }}>
          {Object.entries(MODES).map(([id, m]) => {
            const active = mode === id
            return (
              <button key={id} type="button" role="tab" id={`lc-mode-${id}`} aria-selected={active} tabIndex={active ? 0 : -1} disabled={loading} onClick={() => onModeChange?.(id)}
                className={`h-9 px-4 rounded-lc-half font-display font-bold text-[0.95rem] whitespace-nowrap transition-colors ${active ? 'bg-lc-card text-lc-ink shadow-lc' : 'text-lc-ink-2 hover:text-lc-ink'}`}>
                {m.label}
              </button>
            )
          })}
        </div>
        <p className="text-[0.85rem] text-lc-ink-2 leading-[1.4] min-w-0" aria-live="polite">
          <strong className="text-lc-ink font-semibold">{MODES[mode].lead}</strong><br />{MODES[mode].line}
        </p>
      </div>
      <div className={`lc-controls grid gap-x-5 gap-y-1.5 items-start
                      ${mode === 'upside'
                        ? 'grid-cols-[minmax(15rem,1.8fr)_minmax(11rem,1.1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto]'
                        : 'grid-cols-[minmax(15rem,1.8fr)_minmax(11rem,1.1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(9rem,.9fr)_auto]'}
                      grid-rows-[auto_2.75rem_auto]
                      max-lc:grid-cols-[minmax(12rem,2fr)_minmax(11rem,1.2fr)_minmax(10rem,1fr)] max-lc:grid-rows-[auto_2.75rem_auto_auto_2.75rem_auto]`}>

        <Field label="Tickers or @watchlist" htmlFor="lc-tickers" error={tickersError}
          extra={<button type="button" onClick={onManageWatchlists} className="text-[0.8rem] text-lc-violet font-semibold hover:underline whitespace-nowrap">{manageOpen ? 'Hide watchlists' : 'Manage watchlists'}</button>}
          tip="Separate tickers with commas or spaces (e.g. NVDA, META). @name scans a saved watchlist; mix both freely.">
          <Input id="lc-tickers" ref={tickersRef} type="text" value={tickerInput ?? ''} onChange={e => setTickerInput(e.target.value)} onKeyDown={enterRuns(true)}
            placeholder="Tickers, or @watchlist" disabled={loading} error={!!tickersError} autoComplete="off" spellCheck={false} />
        </Field>

        <Field label="Weeks to expiration" tip="Weekly expirations to scan, counted from the next Friday. W1 is this week; W12 is about three months out.">
          <div className={`${INPUT_CLASS} flex items-center justify-between gap-3`}>
            <WeeksRangeSlider min={1} max={12} valueMin={weeksMin} valueMax={weeksMax} onChange={(a, b) => { setWeeksMin(a); setWeeksMax(b) }} disabled={loading} />
            <span className="text-[0.9rem] font-semibold whitespace-nowrap">{weeksMin}–{weeksMax}</span>
          </div>
        </Field>

        <Field label="Minimum credit" htmlFor="lc-min-credit" error={minCreditValid ? null : 'Enter 0 or more.'}
          tip={mode === 'upside' ? 'Upside admits any true credit: default $0 per contract (a debit never qualifies). Raise it to demand some income too. Rescan to apply.' : 'The friction floor: the credit must cover commissions and bid/ask slippage. Default $100 per contract ($1 per share). Rescan to apply.'}>
          <Stepper id="lc-min-credit" value={minCreditStr} onChange={onMinCreditChange} onBlur={onMinCreditBlur} onKeyDown={enterRuns(minCreditValid)}
            onMinus={() => bumpMinCredit(-50)} onPlus={() => bumpMinCredit(+50)} disabled={loading} error={!minCreditValid} inputMode="decimal" prefix="$" />
        </Field>

        {mode === 'upside' ? (
          <Field label="Minimum upside per $ of collateral" htmlFor="lc-min-upside" error={minUpsideValid ? null : '0 to 500.'}
            tip="Max profit ÷ the cash to secure the put (the put strike × 100). Default 5%. The scanner applies it, so a change needs a rescan.">
            <Stepper id="lc-min-upside" value={minUpsideStr} onChange={onMinUpsideChange} onBlur={onMinUpsideBlur} onKeyDown={enterRuns(minUpsideValid)}
              onMinus={() => bumpMinUpside(-1)} onPlus={() => bumpMinUpside(+1)} disabled={loading} error={!minUpsideValid} inputMode="decimal" suffix="%" />
          </Field>
        ) : (
          <Field label="Minimum return on collateral" htmlFor="lc-min-roc" error={minRocValid ? null : 'Enter 0 or more.'}
            tip="Credit ÷ the cash to secure the put (the put strike × 100). Lets cheap and expensive stocks compete fairly. Default 1%. Applies instantly to the results you already have; no rescan.">
            <Stepper id="lc-min-roc" value={minRocStr} onChange={onMinRocChange} onBlur={onMinRocBlur} onKeyDown={enterRuns(minRocValid)}
              onMinus={() => bumpMinRoc(-0.5)} onPlus={() => bumpMinRoc(+0.5)} disabled={loading} error={!minRocValid} inputMode="decimal" suffix="%" />
          </Field>
        )}

        {/* Upside is a calculator: no probability gate (the gauge still shows every chance per setup). */}
        {mode !== 'upside' && <Field label="Minimum chance shorts expire worthless (approx.)" htmlFor="lc-min-p" error={minPProfitValid ? null : '1 to 99.'}
          tip="Gates ~5 pts above the chance the table and gauge show; rescan to apply. The scanner gates on (1 − short call delta) × (1 − short put delta), which runs a few points above the exact chance the table and gauge show (1 − δ short call − δ short put). Default 50%.">
          <Stepper id="lc-min-p" value={minPProfitStr} onChange={onMinPProfitChange} onBlur={onMinPProfitBlur} onKeyDown={enterRuns(minPProfitValid)}
            onMinus={() => bumpMinPProfit(-1)} onPlus={() => bumpMinPProfit(+1)} disabled={loading} error={!minPProfitValid} inputMode="numeric" suffix="%" />
        </Field>}

        {/* The page's one lime action, on the input row (second band's input row ≤1100) */}
        <div className={`${mode === 'upside' ? 'col-start-5' : 'col-start-6'} row-start-2 max-lc:row-start-5 max-lc:col-start-3 max-lc:justify-self-end self-center`}>
          <Button variant="primary" onClick={onRun} disabled={loading || !canRun} title={!canRun ? 'Fix the highlighted field first' : '⌘ Enter runs from anywhere'}
            className={isStale ? 'ring-[3px] ring-lc-violet ring-offset-2 ring-offset-lc-card' : ''}>
            {loading ? 'Scanning…' : isStale ? 'Rescan needed' : 'Run scan'}
          </Button>
        </div>
      </div>
    </section>
  )
}

// A field = three cells of the parent grid (subgrid): label+ⓘ · control · helper/error.
function Field({ label, htmlFor, error, tip, extra, children }) {
  const tipId = htmlFor ? `${htmlFor}-tip` : undefined
  return (
    <div className="grid grid-rows-[subgrid] row-span-3 min-w-0">
      <div className="flex items-start gap-1.5 min-w-0 self-end">
        <label htmlFor={htmlFor} className="text-[0.8rem] font-semibold tracking-[0.01em] text-lc-ink-2 leading-[1.3]">{label}</label>
        {tip && <InfoTip id={tipId} text={tip} />}
        {extra && <span className="ml-auto pl-2">{extra}</span>}
      </div>
      <div className="min-w-0">{children}</div>
      {/* Only an error occupies the third row; the ⓘ carries the explanation. */}
      <span className={`text-[0.8rem] leading-[1.45] text-lc-loss font-semibold ${error ? 'pt-1' : ''}`} role={error ? 'alert' : undefined}>{error}</span>
    </div>
  )
}

// ⓘ tooltip: shows on hover and keyboard focus; the button is named, the text is its description.

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
