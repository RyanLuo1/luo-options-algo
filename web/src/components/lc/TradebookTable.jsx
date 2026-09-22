import { useEffect, useMemo, useRef, useState } from 'react'
import { Pill, SortIcon } from './ui'
import { fmtMoney0, fmtSigned0, expiryInfo, rowFigures, zoneShort, fmtDay, tradeKey as rowKeyOf, defaultTradeOrder as defaultOrder } from './format'

// The Tradebook's table: the Screener's row grammar applied to saved trades.
// Default order: open first (nearest expiration on top, grading-pending among
// them), then graded, newest expiration first. Column sorts are overrides with
// "Back to default"; ↑/↓ select, Enter opens the editor.
const COLUMNS = [
  { key: 'status',     label: 'Status',            align: 'left',  sort: t => statusRank(t),        firstDir: 'asc' },
  { key: 'ticker',     label: 'Ticker',            align: 'left',  sort: t => t.ticker,             firstDir: 'asc' },
  { key: 'expiration', label: 'Expires',           align: 'left',  sort: t => t.expiration,         firstDir: 'asc' },
  { key: 'strikes',    label: 'Put / Call / Call', align: 'left'  },
  { key: 'credit',     label: 'Credit /ct',        align: 'right', sort: t => t.net_premium,        firstDir: 'desc' },
  { key: 'collateral', label: 'Collateral',        align: 'right', sort: t => t.leg_c_strike,       firstDir: 'desc', hideBelowXl: true },
  { key: 'pnl',        label: 'P&L /ct',           align: 'right', sort: t => t.outcome ? Number(t.outcome.pnl_per_contract) : -Infinity, firstDir: 'desc' },
  { key: 'zone',       label: 'Zone',              align: 'left',  hideBelowXl: true },
  { key: 'saved',      label: 'Saved',             align: 'left',  sort: t => t.saved_at,           firstDir: 'desc', hideBelowXl: true },
]
const SORTABLE = Object.fromEntries(COLUMNS.filter(c => c.sort).map(c => [c.key, c]))
const PAGE = 50
const statusRank = t => (t.status === 'open' ? 0 : t.status === 'pending' ? 1 : 2)

export function StatusPill({ trade, size = 'sm' }) {
  if (trade.status === 'open') return <Pill tone="violet" size={size}>Open</Pill>
  if (trade.status === 'pending') return <Pill tone="quiet" size={size} title="Grades after the next close">Grading pending</Pill>
  return <Pill tone="lime" size={size}>Graded</Pill>   // the theme's yellow, as the landing's "graded" chips (owner, 2026-09-22)
}

export default function TradebookTable({ trades, sort, onSort, onResetSort, selectedKey, onSelect, onOpen, dimmed = false }) {
  const [shown, setShown] = useState(PAGE)
  const bodyRef = useRef(null)

  const ordered = useMemo(() => {
    const base = defaultOrder(trades)
    if (!(sort && SORTABLE[sort.key])) return base
    const acc = SORTABLE[sort.key].sort
    return [...base].sort((a, b) => { const va = acc(a), vb = acc(b); const c = va < vb ? -1 : va > vb ? 1 : 0; return sort.dir === 'asc' ? c : -c })
  }, [trades, sort])
  const page = ordered.slice(0, shown)

  function clickHeader(col) {
    if (!col.sort) return
    if (!sort || sort.key !== col.key) onSort({ key: col.key, dir: col.firstDir })
    else if (sort.dir === col.firstDir) onSort({ key: col.key, dir: col.firstDir === 'desc' ? 'asc' : 'desc' })
    else onResetSort()
  }
  function onKeyDown(e) {
    if (dimmed) return
    const idx = ordered.findIndex(t => rowKeyOf(t) === selectedKey)
    if (e.key === 'Enter') { const t = ordered[idx]; if (t) { e.preventDefault(); onOpen?.(t) } return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = e.key === 'ArrowDown' ? Math.min(ordered.length - 1, idx + 1) : Math.max(0, idx - 1)
    const t = ordered[next]
    if (t) { onSelect?.(t); if (next >= shown) setShown(s => s + PAGE) }
  }
  useEffect(() => { bodyRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [selectedKey])

  const sortedCol = sort ? COLUMNS.find(c => c.key === sort.key) : null
  const openCount = trades.filter(t => t.status !== 'graded').length

  return (
    <section aria-label="Saved trades" className={`bg-lc-card rounded-lc shadow-lc flex flex-col min-h-0 transition-opacity ${dimmed ? 'opacity-60' : ''}`} aria-busy={dimmed || undefined}>
      <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display font-bold text-[1.3rem] leading-none tracking-[-0.01em]">Your trades</h2>
          <span className="text-[0.85rem] text-lc-ink-2 [font-variant-numeric:tabular-nums]">{trades.length.toLocaleString()} saved · {openCount} open</span>
        </div>
        <div className="flex items-center gap-2 text-[0.85rem]">
          {sortedCol ? (
            <>
              <span className="text-lc-ink-2">Sorted by {sortedCol.label} {sort.dir === 'desc' ? '↓' : '↑'}</span>
              <button type="button" onClick={onResetSort} className="font-semibold text-lc-violet hover:underline">Back to default</button>
            </>
          ) : (
            <span className="text-lc-ink-2">Open first, nearest expiration on top (grading-pending leads) · then graded, newest first</span>
          )}
        </div>
      </div>
      <p className="px-6 pb-2 -mt-1 text-[0.8rem] text-lc-ink-2">All dollars per contract · realized P&L is the graded outcome, always signed.</p>

      <div ref={bodyRef} tabIndex={0} onKeyDown={onKeyDown}
        aria-label="Saved trades table. Arrow keys move the selection, Enter opens the editor."
        className="overflow-auto flex-1 min-h-0 px-3 max-lc:px-1.5 pb-3 rounded-b-lc outline-none focus-visible:ring-[3px] focus-visible:ring-lc-violet focus-visible:ring-inset">
        <table className="w-full border-collapse text-[0.95rem] [font-variant-numeric:tabular-nums]">
          <thead>
            <tr>
              {COLUMNS.map(col => {
                const active = sort?.key === col.key
                return (
                  <th key={col.key} scope="col"
                    className={`sticky top-0 z-10 bg-lc-card text-[0.78rem] font-semibold tracking-[0.03em] text-lc-ink-2 border-b border-lc-line px-1.5 py-2.5 whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.hideBelowXl ? 'max-lc:hidden' : ''}`}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
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
            {page.map(t => {
              const k = rowKeyOf(t), selected = k === selectedKey
              const f = rowFigures(t), exp = expiryInfo(t.expiration)
              const pnl = t.outcome ? Number(t.outcome.pnl_per_contract) : null
              const pnlInk = pnl == null ? 'text-lc-ink-2' : pnl > 0 ? 'text-lc-profit' : pnl < 0 ? 'text-lc-loss' : 'text-lc-ink'
              return (
                <tr key={k} data-selected={selected ? 'true' : undefined} data-status={t.status}
                  onClick={() => !dimmed && onSelect?.(t)} onDoubleClick={() => !dimmed && onOpen?.(t)} aria-current={selected ? 'true' : undefined}
                  className={`cursor-pointer border-b border-lc-line/70 transition-colors ${selected ? 'bg-lc-violet-soft' : 'hover:bg-lc-ground'}`}>
                  <td className="px-1.5 py-2.5 whitespace-nowrap"><StatusPill trade={t} /></td>
                  <td className="px-1.5 py-2.5 font-display font-bold text-[1.05rem] text-lc-ink whitespace-nowrap">{t.ticker}{t.mode === 'upside' && <Pill tone="quiet" size="sm" className="ml-2 font-figtree font-semibold align-middle">Upside</Pill>}</td>
                  <td className="px-1.5 py-2.5 whitespace-nowrap">
                    <span className="text-lc-ink">{exp.short}</span>
                    <span className="text-lc-ink-2">{t.status === 'graded' ? ' · settled' : t.status === 'pending' ? ' · expired' : exp.dte != null ? ` · ${exp.dte}d` : ''}</span>
                  </td>
                  <td className="px-1.5 py-2.5 whitespace-nowrap text-lc-ink-2 text-[0.9rem]">
                    {t.leg_c_strike} / <span className="text-lc-ink font-semibold">{t.leg_a_strike}</span> / {t.leg_b_strike}
                  </td>
                  <td className="px-1.5 py-2.5 text-right font-bold text-lc-ink whitespace-nowrap">{fmtMoney0(f.credit)}</td>
                  <td className="px-1.5 py-2.5 text-right text-lc-ink whitespace-nowrap max-lc:hidden">{fmtMoney0(f.collateral)}</td>
                  <td className={`px-1.5 py-2.5 text-right font-bold whitespace-nowrap ${pnlInk}`}>
                    {t.status === 'graded' ? fmtSigned0(pnl) : t.status === 'pending' ? <span className="font-normal text-lc-ink-2">pending</span> : <span className="font-normal text-lc-ink-2">—</span>}
                  </td>
                  <td className="px-1.5 py-2.5 whitespace-nowrap text-lc-ink-2 max-lc:hidden">{t.status === 'graded' ? zoneShort(t.outcome.outcome_type) : '—'}</td>
                  <td className="px-1.5 py-2.5 whitespace-nowrap text-lc-ink-2 max-lc:hidden">{fmtDay(t.saved_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {ordered.length > shown && (
          <div className="flex justify-center py-3">
            <button type="button" onClick={() => setShown(s => s + PAGE)} className="text-[0.9rem] font-semibold text-lc-violet hover:underline">
              Show {Math.min(PAGE, ordered.length - shown)} more of {ordered.length.toLocaleString()}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
