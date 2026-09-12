import { useEffect, useRef, useState } from 'react'
import MetricBar from './MetricBar'
import { Pill, SortIcon } from './ui'
import { fmtMoney0, fmtPct0, expiryInfo, rowFigures, rowKey } from './format'

// Columns. `sort` names the accessor for user overrides; money columns sort
// descending first. Rank is the scanner's order and is not a user sort.
const COLUMNS = [
  { key: 'rank',       label: 'Rank',              align: 'left'  },
  { key: 'ticker',     label: 'Ticker',            align: 'left'  },
  { key: 'expiration', label: 'Expires',           align: 'left',  sort: r => r.expiration, firstDir: 'asc' },
  { key: 'strikes',    label: 'Put / Call / Call', align: 'left'  },
  { key: 'credit',     label: 'Credit /ct',        align: 'right', sort: r => r.net_premium, firstDir: 'desc' },
  { key: 'max',        label: 'Max profit /ct',    align: 'right', sort: r => r.net_premium + r.spread_width, firstDir: 'desc' },
  { key: 'pmax',       label: 'P(max)',            align: 'right', sort: r => r.p_max_profit, firstDir: 'desc' },
  { key: 'collateral', label: 'Collateral',        align: 'right', sort: r => r.leg_c_strike, firstDir: 'desc', hideBelowXl: true },
]
const SORTABLE = Object.fromEntries(COLUMNS.filter(c => c.sort).map(c => [c.key, c]))

const PAGE = 50

/**
 * RankedTable — the scan's rows in the scanner's order by default. A user sort
 * is an override App owns (`sort` = {key, dir} | null) so it can persist across
 * rescans and reset on a fresh scan context. Selection and keyboard nav: click
 * or ↑/↓ select, Enter opens the editor.
 */
export default function RankedTable({
  rows, sort, onSort, onResetSort,
  selectedKey, onSelect, onOpen,
  minPP, metric, metricLabel,
  totalEvaluated, dimmed = false,
}) {
  const [shown, setShown] = useState(PAGE)
  const bodyRef = useRef(null)

  // Apply the override (stable sort on top of the scanner's order).
  const sorted = sort && SORTABLE[sort.key]
    ? [...rows].sort((a, b) => {
        const va = SORTABLE[sort.key].sort(a), vb = SORTABLE[sort.key].sort(b)
        const c = va < vb ? -1 : va > vb ? 1 : 0
        return sort.dir === 'asc' ? c : -c
      })
    : rows
  const visible = sorted.slice(0, shown)

  function clickHeader(col) {
    if (!col.sort) return
    if (!sort || sort.key !== col.key) onSort({ key: col.key, dir: col.firstDir })
    else if (sort.dir === col.firstDir) onSort({ key: col.key, dir: col.firstDir === 'desc' ? 'asc' : 'desc' })
    else onResetSort()
  }

  // Keyboard: ↑/↓ move the selection within the visible order; Enter opens.
  function onKeyDown(e) {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return
    const idx = sorted.findIndex(r => rowKey(r) === selectedKey)
    if (e.key === 'Enter') { const r = sorted[idx]; if (r) { e.preventDefault(); onOpen?.(r) } return }
    e.preventDefault()
    const next = e.key === 'ArrowDown' ? Math.min(sorted.length - 1, idx + 1) : Math.max(0, idx - 1)
    const r = sorted[next]
    if (r) { onSelect?.(r); if (next >= shown) setShown(s => s + PAGE) }
  }

  // Keep the selected row in view when selection changes via keyboard.
  useEffect(() => {
    const el = bodyRef.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedKey])

  const sortedCol = sort ? COLUMNS.find(c => c.key === sort.key) : null

  return (
    <section
      aria-label="Ranked setups"
      className={`bg-lc-card rounded-lc shadow-lc flex flex-col min-h-0 transition-opacity ${dimmed ? 'opacity-60' : ''}`}
      aria-busy={dimmed || undefined}
    >
      {/* Bar */}
      <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display font-bold text-[1.3rem] leading-none tracking-[-0.01em]">Ranked setups</h2>
          <span className="text-[0.85rem] text-lc-ink-2 [font-variant-numeric:tabular-nums]">
            {rows.length.toLocaleString()} of {Number(totalEvaluated || 0).toLocaleString()} evaluated
          </span>
        </div>
        <div className="flex items-center gap-2 text-[0.85rem]">
          {sortedCol ? (
            <>
              <span className="text-lc-ink-2">Sorted by {sortedCol.label} {sort.dir === 'desc' ? '↓' : '↑'}</span>
              <button type="button" onClick={onResetSort} className="font-semibold text-lc-violet hover:underline">Back to ranked</button>
            </>
          ) : (
            <span className="text-lc-ink-2">Ranked by the scanner</span>
          )}
        </div>
      </div>
      <p className="px-6 pb-2 -mt-1 text-[0.8rem] text-lc-ink-2">All dollars per contract · the bar under Max profit is the credit as a share of max profit (the ranking).</p>

      {/* Table */}
      <div
        ref={bodyRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Ranked setups table. Use the arrow keys to move the selection and Enter to open the editor."
        className="overflow-auto flex-1 min-h-0 px-3 max-lc:px-1.5 pb-3 rounded-b-lc outline-none focus-visible:ring-[3px] focus-visible:ring-lc-violet focus-visible:ring-inset"
      >
        <table className="w-full border-collapse text-[0.95rem] [font-variant-numeric:tabular-nums]">
          <thead>
            <tr>
              {COLUMNS.map(col => {
                const active = sort?.key === col.key
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={`sticky top-0 z-10 bg-lc-card text-[0.78rem] font-semibold tracking-[0.03em] text-lc-ink-2 border-b border-lc-line px-2 py-2.5 whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.hideBelowXl ? 'max-lc:hidden' : ''}`}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {col.sort ? (
                      <button type="button" onClick={() => clickHeader(col)} className={`inline-flex items-center gap-1 hover:text-lc-ink ${active ? 'text-lc-violet' : ''}`}>
                        {col.label}<SortIcon dir={active ? sort.dir : undefined} />
                      </button>
                    ) : col.label}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map(r => {
              const k = rowKey(r)
              const selected = k === selectedKey
              const f = rowFigures(r)
              const exp = expiryInfo(r.expiration)
              const borderline = minPP != null && r.p_max_profit >= minPP && r.p_max_profit <= minPP + 0.10
              return (
                <tr
                  key={k}
                  data-selected={selected ? 'true' : undefined}
                  onClick={() => !dimmed && onSelect?.(r)}
                  onDoubleClick={() => !dimmed && onOpen?.(r)}
                  aria-current={selected ? 'true' : undefined}
                  className={`cursor-pointer border-b border-lc-line/70 transition-colors ${selected ? 'bg-lc-violet-soft' : 'hover:bg-lc-ground'}`}
                >
                  <td className="px-2 max-lc:px-1.5 py-2.5">
                    <span className={`inline-grid place-items-center w-[26px] h-[26px] rounded-lc text-[0.8rem] font-bold ${selected ? 'bg-lc-violet text-lc-card' : r.rank === 1 ? 'bg-lc-lime text-lc-ink' : 'bg-lc-ground text-lc-ink-2'}`}>{r.rank}</span>
                  </td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 font-display font-bold text-[1.05rem] text-lc-ink">{r.ticker}</td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 whitespace-nowrap">
                    <span className="text-lc-ink">{exp.short}</span><span className="text-lc-ink-2 max-lc:hidden"> · W{r.week}</span><span className="text-lc-ink-2">{exp.dte != null ? ` · ${exp.dte}d` : ''}</span>
                  </td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 whitespace-nowrap text-lc-ink-2 max-lc:text-[0.9rem] [font-variant-numeric:tabular-nums]">
                    {r.leg_c_strike} / <span className="text-lc-ink font-semibold">{r.leg_a_strike}</span> / {r.leg_b_strike}
                  </td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 text-right font-bold text-lc-ink whitespace-nowrap">{fmtMoney0(f.credit)}</td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 text-right whitespace-nowrap">
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-lc-ink">{fmtMoney0(f.maxProfit)}</span>
                      <MetricBar value={metric(r)} label={metricLabel} className="w-[4.5rem] max-lc:w-[3.5rem]" />
                    </div>
                  </td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 text-right whitespace-nowrap">
                    <span className="text-lc-ink">{fmtPct0(r.p_max_profit)}</span>
                    {borderline && <Pill tone="quiet" size="sm" className="ml-1.5 max-lc:hidden" title={`Within 10 points of your ${Math.round(minPP * 100)}% minimum`}>borderline</Pill>}
                  </td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 text-right text-lc-ink whitespace-nowrap max-lc:hidden">{fmtMoney0(f.collateral)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {sorted.length > shown && (
          <div className="flex justify-center py-3">
            <button type="button" onClick={() => setShown(s => s + PAGE)} className="text-[0.9rem] font-semibold text-lc-violet hover:underline">
              Show {Math.min(PAGE, sorted.length - shown)} more of {sorted.length.toLocaleString()}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
