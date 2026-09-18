import { XIcon } from './ui'

// Scanning chips: one real button per ticker with its qualifying-setup count.
// Click filters to that ticker (click again clears); × removes it from the
// scan set. A ticker that yielded zero carries its cause in words, as the
// scanner reported it (or the client-side return floor).
export default function ScanChips({ tickers, counts, reasons, details, skipped, activeFilter, onToggle, onRemove, relaxedAvailable, relaxedOpen, onToggleRelaxed }) {
  if ((!tickers || tickers.length === 0) && (!skipped || skipped.length === 0)) return null
  return (
    <div className="flex items-center gap-2 flex-wrap px-1" aria-label="Tickers in this scan">
      <span className="text-[0.85rem] font-semibold text-lc-ink-2 mr-1">Scanning</span>
      {tickers.map(t => {
        const on = activeFilter === t
        const n = counts?.[t] ?? 0
        const why = n === 0 ? reasons?.[t] : null
        const detail = n === 0 ? details?.[t] : null   // the liquidity census, on hover
        return (
          <span key={t} className="inline-flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-lc overflow-hidden border-[1.5px] transition-colors
                ${on ? 'bg-lc-violet-soft border-lc-violet' : 'bg-lc-card border-lc-line hover:border-lc-violet'}`}
            >
              <button
                type="button"
                onClick={() => n > 0 && onToggle?.(t)}
                aria-pressed={on}
                aria-disabled={n === 0 || undefined}
                title={n === 0 ? `${t}: ${why ?? 'no setups in this scan'}${detail ? ` — ${detail}` : ''}` : on ? 'Show all tickers' : `Show only ${t}`}
                className={`flex items-center gap-2 pl-3 pr-2 h-8 text-[0.85rem] font-semibold ${on ? 'text-lc-violet' : 'text-lc-ink'}`}
              >
                {t}
                <span className={`rounded-lc px-1.5 text-[0.72rem] [font-variant-numeric:tabular-nums] ${n > 0 ? 'bg-lc-ground text-lc-ink-2' : 'bg-lc-ground-deep text-lc-ink-2'}`}>{n}</span>
              </button>
              <button
                type="button"
                onClick={() => onRemove?.(t)}
                aria-label={`Remove ${t} from this scan`}
                className="h-8 px-2 text-lc-ink-3 hover:text-lc-loss hover:bg-lc-ground"
              >
                <XIcon />
              </button>
            </span>
            {why && <span className="text-[0.82rem] text-lc-ink-2" title={detail ?? undefined}>— {why}</span>}
            {n === 0 && relaxedAvailable?.[t] > 0 && (
              <button type="button" onClick={() => onToggleRelaxed?.(t)} aria-pressed={relaxedOpen?.includes(t) || false} data-relax={t}
                title={`${relaxedAvailable[t]} setups with the volume floor off, priced at the bid and ask, shown in place of the ranked list. Display only; never ranked, never saved.`}
                className="text-[0.82rem] font-semibold text-lc-violet hover:underline">
                {relaxedOpen?.includes(t) ? 'Back to ranked setups' : 'Show thin-quote setups (worst-case priced)'}
              </button>
            )}
          </span>
        )
      })}
      {activeFilter && (
        <button type="button" onClick={() => onToggle?.(activeFilter)} className="text-[0.85rem] font-semibold text-lc-violet hover:underline ml-1">
          Show all
        </button>
      )}
      {skipped && skipped.length > 0 && (
        <span className="text-[0.85rem] text-lc-ink-2 ml-2">
          Skipped {skipped.join(', ')}: no live stock price.
        </span>
      )}
    </div>
  )
}
