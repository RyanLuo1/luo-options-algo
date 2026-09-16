import { useEffect, useState } from 'react'
import { Button, Card, Pill, XIcon } from './ui'

// ── Stage (g): the Screener's non-happy states, each in words. ────────────────

/** Slim progress strip under the controls while a scan runs. The API is one
 *  request, so this is an honest indeterminate strip with the ticker count and
 *  elapsed time (per-ticker progress needs an API change; recorded follow-up). */
export function ProgressStrip({ tickerCount }) {
  const [t0] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(id)
  }, [t0])
  return (
    <div role="status" aria-live="polite" className="bg-lc-card rounded-lc shadow-lc px-5 py-3 flex items-center gap-4">
      <span className="relative block h-1.5 w-40 rounded-full bg-lc-line overflow-hidden" aria-hidden="true">
        <span className="lc-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-lc-violet" />
      </span>
      <span className="text-[0.9rem] text-lc-ink">
        Scanning {tickerCount} {tickerCount === 1 ? 'ticker' : 'tickers'} · {elapsed}s
      </span>
      <span className="text-[0.85rem] text-lc-ink-2">Your last results stay below until the new ones arrive.</span>
    </div>
  )
}

/** Dismissable error strip above the results. Names the problem and the recovery; never a port number. */
export function ErrorStrip({ message, hadResults, onRetry, onDismiss, tradebook = false }) {
  const text = tradebook
    ? { problem: 'Couldn’t load your trades.', recovery: `${hadResults ? 'Your last list is still shown below.' : ''} Try again.`.trim() }
    : humanizeError(message, hadResults)
  return (
    <div role="alert" className="bg-lc-loss-tint rounded-lc px-5 py-4 flex items-start gap-4">
      <div className="flex-1 text-[0.95rem] text-lc-ink leading-[1.5]">
        <strong className="text-lc-loss-ink font-semibold">{text.problem}</strong> {text.recovery}
      </div>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-lc-ink-3 hover:text-lc-ink mt-1"><XIcon /></button>
    </div>
  )
}

function humanizeError(message, hadResults) {
  const m = String(message || '')
  const keep = hadResults ? 'Your last results are still shown below.' : ''
  if (/Cannot reach server|Failed to fetch|NetworkError|Load failed/i.test(m)) {
    return { problem: 'The scan service didn’t respond.', recovery: `${keep} Try again in a moment.`.trim() }
  }
  if (/429|rate limit/i.test(m)) {
    return { problem: 'The options data feed is rate-limited right now.', recovery: `${keep} Wait a minute and try again, or scan fewer tickers.`.trim() }
  }
  if (/5\d\d|Server error/i.test(m)) {
    return { problem: 'The scan failed on the server.', recovery: `${keep} Try again; if it keeps failing, the data feed may be down.`.trim() }
  }
  return { problem: 'The scan didn’t complete.', recovery: `${keep} Try again; if it keeps failing, the data feed may be down.`.trim() }
}

/** Quiet banner above the results when the market is closed (scanning still allowed). */
export function MarketClosedBanner() {
  return (
    <div className="bg-lc-ground-deep rounded-lc px-5 py-3 text-[0.9rem] text-lc-ink-2">
      <strong className="text-lc-ink font-semibold">Market closed.</strong> Quotes are the last ones printed, not live. Credits shown are what was collectable at the close; run again during market hours for live pricing.
    </div>
  )
}

/**
 * Cause-specific empty result. Causes, in order of what the user can do about them:
 * every ticker skipped → thresholds too strict → market closed placeholders.
 */
export function NoResults({ tickersUsed, tickersSkipped, marketOpen, reasons = {}, reasonCodes = {}, minCredit, minPP, minRocPct = 0, mode = 'income', minUpsidePct = 0, onLowerP, onLowerRoc, onFocusTickers }) {
  const rocBlocked = Object.values(reasonCodes).some(c => c === 'roc')
  const byCause = new Map()
  for (const t of tickersUsed) { const c = reasons[t] ?? 'no setups in this scan'; byCause.set(c, [...(byCause.get(c) ?? []), t]) }
  const allSkipped = tickersUsed.length > 0 && tickersSkipped.length >= tickersUsed.length
  return (
    <Card className="max-w-[52rem]" padding="p-8">
      {allSkipped ? (
        <>
          <h2 className="font-display font-bold text-[1.4rem] leading-[1.1] tracking-[-0.02em] mb-2">Nothing to scan: every ticker was skipped</h2>
          <p className="text-lc-ink-2 leading-[1.6] max-w-[60ch] mb-4">
            {tickersSkipped.join(', ')} returned no tradeable options chain or no live stock price. That usually means an unknown symbol, a name without weekly options, or a price feed hiccup.
          </p>
          <Button size="sm" onClick={onFocusTickers}>Fix the tickers</Button>
        </>
      ) : (
        <>
          <h2 className="font-display font-bold text-[1.4rem] leading-[1.1] tracking-[-0.02em] mb-2">No setup cleared your thresholds</h2>
          <p className="text-lc-ink-2 leading-[1.6] max-w-[60ch] mb-3">
            Floors in force: <Pill tone="quiet" size="sm">${Number(minCredit).toLocaleString('en-US')} per contract</Pill>{' '}
            {mode === 'upside' ? <Pill tone="quiet" size="sm">{minUpsidePct}% upside per $ of collateral</Pill> : <Pill tone="quiet" size="sm">{minRocPct}% return on collateral</Pill>}{' '}
            <Pill tone="quiet" size="sm">{Math.round(minPP * 100)}% chance the shorts expire worthless (approx.)</Pill>.
            {marketOpen === false && ' The market is closed, so quotes are the last ones printed; some names only clear during the session.'}
          </p>
          <ul className="text-[0.9rem] text-lc-ink-2 mb-4 flex flex-col gap-1">
            {[...byCause.entries()].map(([cause, ts]) => <li key={cause}><strong className="text-lc-ink font-semibold">{ts.join(', ')}</strong> — {cause}</li>)}
          </ul>
          <div className="flex gap-2 flex-wrap">
            {mode === 'income' && rocBlocked && minRocPct > 0 && <Button size="sm" onClick={onLowerRoc}>Remove the return floor</Button>}
            {minPP > 0.40 && <Button size="sm" onClick={onLowerP}>Lower the floor to 40%</Button>}
            {tickersSkipped.length > 0 && <span className="text-[0.85rem] text-lc-ink-2 self-center">Skipped: {tickersSkipped.join(', ')}</span>}
          </div>
        </>
      )}
    </Card>
  )
}

/** The table is empty because of a client-side filter, not the scan: say so, offer the way back. */
export function FilteredEmpty({ ticker, onShowAll }) {
  return (
    <Card padding="p-6" className="max-w-[52rem] flex items-center gap-4 flex-wrap">
      <span className="text-lc-ink">No setups for <strong className="font-semibold">{ticker}</strong> in this scan.</span>
      <Button size="sm" onClick={onShowAll}>Show all tickers</Button>
    </Card>
  )
}
