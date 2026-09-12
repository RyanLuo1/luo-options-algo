import { XIcon } from './ui'

// Scanning chips: one real button per ticker with its qualifying-setup count.
// Click filters to that ticker (click again clears); × removes it from the
// scan set. Skipped tickers list their reason in words.
export default function ScanChips({ tickers, counts, skipped, activeFilter, onToggle, onRemove }) {
  if ((!tickers || tickers.length === 0) && (!skipped || skipped.length === 0)) return null
  return (
    <div className="flex items-center gap-2 flex-wrap px-1" aria-label="Tickers in this scan">
      <span className="text-[0.85rem] font-semibold text-lc-ink-2 mr-1">Scanning</span>
      {tickers.map(t => {
        const on = activeFilter === t
        const n = counts?.[t] ?? 0
        return (
          <span
            key={t}
            className={`inline-flex items-center rounded-lc overflow-hidden border-[1.5px] transition-colors
              ${on ? 'bg-lc-violet-soft border-lc-violet' : 'bg-lc-card border-lc-line hover:border-lc-violet'}`}
          >
            <button
              type="button"
              onClick={() => n > 0 && onToggle?.(t)}
              aria-pressed={on}
              aria-disabled={n === 0 || undefined}
              title={n === 0 ? `${t}: no setups in this scan` : on ? `Show all tickers` : `Show only ${t}`}
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
        )
      })}
      {activeFilter && (
        <button type="button" onClick={() => onToggle?.(activeFilter)} className="text-[0.85rem] font-semibold text-lc-violet hover:underline ml-1">
          Show all
        </button>
      )}
      {skipped && skipped.length > 0 && (
        <span className="text-[0.85rem] text-lc-ink-2 ml-2">
          Skipped {skipped.join(', ')}: no tradeable chain or no live price.
        </span>
      )}
    </div>
  )
}
