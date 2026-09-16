import { useEffect, useMemo, useRef, useState } from 'react'
import MetricBar from './MetricBar'
import { Pill, SortIcon, InfoTip } from './ui'
import { fmtMoney0, fmtPct0, expiryInfo, rowFigures, rowKey, rocOf, shortsWorthless, moveToMax, MODES, NOT_BACKTESTED } from './format'

// Columns. `sort` names the accessor for user overrides; money columns sort
// descending first. Rank is the scanner's order and is not a user sort.
const COLUMNS = [
  { key: 'rank',       label: 'Rank',              align: 'left'  },
  { key: 'ticker',     label: 'Ticker',            align: 'left'  },
  { key: 'expiration', label: 'Expires',           align: 'left',  sort: r => r.expiration, firstDir: 'asc' },
  { key: 'strikes',    label: 'Put / Call / Call', align: 'left'  },
  { key: 'credit',     label: 'Credit /ct',        align: 'right', sort: r => r.net_premium, firstDir: 'desc' },
  { key: 'max',        label: 'Max profit /ct',    short: 'Max /ct', align: 'right', sort: r => r.net_premium + r.spread_width, firstDir: 'desc' },
  { key: 'pmax',       label: 'Shorts worthless', title: 'Chance the short legs expire worthless: 1 − δ short call − δ short put', align: 'right', sort: r => shortsWorthless(r), firstDir: 'desc' },
  { key: 'collateral', label: 'Collateral',        align: 'right', sort: r => r.leg_c_strike, firstDir: 'desc', hideBelowXl: true },
]
// Upside adds one descriptive column: the rise from spot to the short call.
const MOVE_COL = { key: 'move', label: 'Move to max', short: 'Move', align: 'right', sort: r => moveToMax(r) ?? Infinity, firstDir: 'asc' }
const columnsFor = mode => (mode === 'upside' ? [...COLUMNS.slice(0, 6), MOVE_COL, ...COLUMNS.slice(6)] : COLUMNS)
const SORTABLE = Object.fromEntries([...COLUMNS, MOVE_COL].filter(c => c.sort).map(c => [c.key, c]))
const PAGE = 50

/**
 * RankedTable — the scan's rows in the scanner's order by default. A user sort
 * is an override App owns (`sort` = {key, dir} | null) so it can persist across
 * rescans and reset on a fresh scan context. Two modes: grouped (each ticker's
 * best setup as one row, "+N more" expands its variants; algorithm order kept
 * across and within tickers) and flat. Click or ↑/↓ select, Enter opens,
 * → / ← expand or collapse a ticker. Key the component on the scan context so
 * paging and expansion reset with a fresh scan.
 */
export default function RankedTable({
  rows, sort, onSort, onResetSort,
  grouped, onToggleGrouped,
  selectedKey, onSelect, onOpen,
  metric, metricLabel,
  totalEvaluated, dimmed = false,
  mode = 'income', otherHeads = null,   // otherHeads: Map ticker → the other mode's best row (grouped view's second head)
}) {
  const COLS = columnsFor(mode)
  const NCOLS = COLS.length
  const [shown, setShown] = useState(PAGE)
  const [expanded, setExpanded] = useState(() => new Set())
  const bodyRef = useRef(null)

  const sorted = useMemo(() => {
    if (!(sort && SORTABLE[sort.key])) return rows
    const acc = SORTABLE[sort.key].sort
    return [...rows].sort((a, b) => { const va = acc(a), vb = acc(b); const c = va < vb ? -1 : va > vb ? 1 : 0; return sort.dir === 'asc' ? c : -c })
  }, [rows, sort])

  // Grouped: each ticker's head is ALWAYS its algorithm-best row (first in `rows`, the
  // scanner's order). A user sort reorders the groups by the head's value and the
  // variants within a group; it never changes which row is the head.
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of rows) { if (!m.has(r.ticker)) m.set(r.ticker, { best: r, variants: [] }); else m.get(r.ticker).variants.push(r) }
    let list = [...m.values()]
    if (sort && SORTABLE[sort.key]) {
      const acc = SORTABLE[sort.key].sort
      const cmp = (a, b) => { const va = acc(a), vb = acc(b); const c = va < vb ? -1 : va > vb ? 1 : 0; return sort.dir === 'asc' ? c : -c }
      list = list.map(g => ({ ...g, variants: [...g.variants].sort(cmp) })).sort((a, b) => cmp(a.best, b.best))
    }
    return list
  }, [rows, sort])

  const visible = useMemo(() => {
    if (!grouped) return sorted.map(r => ({ row: r, kind: 'flat' }))
    const out = []
    for (const g of groups) {
      out.push({ row: g.best, kind: 'best', more: g.variants.length, paired: !!otherHeads?.has(g.best.ticker) })
      const other = otherHeads?.get(g.best.ticker)
      if (other) out.push({ row: other, kind: 'other', more: 0 })
      if (expanded.has(g.best.ticker)) g.variants.forEach(v => out.push({ row: v, kind: 'variant' }))
    }
    return out
  }, [grouped, sorted, groups, expanded, otherHeads])
  const page = visible.slice(0, shown)

  function clickHeader(col) {
    if (!col.sort) return
    if (!sort || sort.key !== col.key) onSort({ key: col.key, dir: col.firstDir })
    else if (sort.dir === col.firstDir) onSort({ key: col.key, dir: col.firstDir === 'desc' ? 'asc' : 'desc' })
    else onResetSort()
  }
  function toggleExpand(t) { setExpanded(prev => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n }) }

  function onKeyDown(e) {
    if (dimmed) return
    const idx = visible.findIndex(v => rowKey(v.row) === selectedKey)
    const cur = visible[idx]
    if (e.key === 'Enter') { if (cur) { e.preventDefault(); onOpen?.(cur.row) } return }
    if (grouped && cur?.kind === 'best' && cur.more > 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault(); const t = cur.row.ticker
      setExpanded(prev => { const n = new Set(prev); if (e.key === 'ArrowRight') n.add(t); else n.delete(t); return n }); return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = e.key === 'ArrowDown' ? Math.min(visible.length - 1, idx + 1) : Math.max(0, idx - 1)
    const v = visible[next]
    if (v) { onSelect?.(v.row); if (next >= shown) setShown(s => s + PAGE) }
  }

  useEffect(() => { bodyRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [selectedKey])

  const sortedCol = sort ? COLS.find(c => c.key === sort.key) : null

  return (
    <section aria-label="Ranked setups" className={`bg-lc-card rounded-lc shadow-lc flex flex-col min-h-0 transition-opacity ${dimmed ? 'opacity-60' : ''}`} aria-busy={dimmed || undefined}>
      <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <span className="inline-flex items-center gap-1.5"><h2 className="font-display font-bold text-[1.3rem] leading-none tracking-[-0.01em]">Ranked setups</h2><InfoTip id="lc-table-tip" text="All dollars are per contract. Rank is the scanner’s order after your return floor. The bar under Max profit is the credit as a share of max profit, which is what the ranking follows. In the grouped view a ticker’s head row is its scanner-best setup." /></span>
          {mode === 'upside' && <Pill tone="quiet" size="sm" title="The Income ranking is the backtested product; Upside is the same three legs built for a wide call spread.">{NOT_BACKTESTED}</Pill>}
          <span className="text-[0.85rem] text-lc-ink-2 [font-variant-numeric:tabular-nums]">
            {grouped ? `${groups.length} ${groups.length === 1 ? 'ticker' : 'tickers'} · ${rows.length.toLocaleString()} setups` : `${rows.length.toLocaleString()} setups`} of {Number(totalEvaluated || 0).toLocaleString()} evaluated
          </span>
        </div>
        <div className="flex items-center gap-3 text-[0.85rem] flex-wrap">
          {sortedCol ? (
            <>
              <span className="text-lc-ink-2">Sorted by {sortedCol.label} {sort.dir === 'desc' ? '↓' : '↑'}</span>
              <button type="button" onClick={onResetSort} className="font-semibold text-lc-violet hover:underline">Back to ranked</button>
            </>
          ) : (
            <span className="text-lc-ink-2">Ranked by the scanner</span>
          )}
          <span className="inline-flex rounded-lc bg-lc-ground p-0.5" role="group" aria-label="Table view">
            <button type="button" onClick={() => !grouped && onToggleGrouped()} aria-pressed={grouped} className={`h-7 px-3 rounded-lc text-[0.8rem] font-semibold ${grouped ? 'bg-lc-card text-lc-ink shadow-lc' : 'text-lc-ink-2 hover:text-lc-ink'}`}>Best per ticker</button>
            <button type="button" onClick={() => grouped && onToggleGrouped()} aria-pressed={!grouped} className={`h-7 px-3 rounded-lc text-[0.8rem] font-semibold ${!grouped ? 'bg-lc-card text-lc-ink shadow-lc' : 'text-lc-ink-2 hover:text-lc-ink'}`}>Flat list</button>
          </span>
        </div>
      </div>

      <div ref={bodyRef} tabIndex={0} onKeyDown={onKeyDown}
        aria-label={`Ranked setups table. Arrow keys move the selection${grouped ? ', right and left expand or collapse a ticker' : ''}, Enter opens the editor.`}
        className="overflow-auto flex-1 min-h-0 px-3 max-lc:px-1.5 pb-3 rounded-b-lc outline-none focus-visible:ring-[3px] focus-visible:ring-lc-violet focus-visible:ring-inset">
        <table className="w-full border-collapse text-[0.95rem] [font-variant-numeric:tabular-nums]">
          <thead>
            <tr>
              {COLS.map(col => {
                const active = sort?.key === col.key
                return (
                  <th key={col.key} scope="col" title={col.title}
                    className={`sticky top-0 z-10 bg-lc-card text-[0.78rem] font-semibold tracking-[0.03em] text-lc-ink-2 border-b border-lc-line px-2 py-2.5 whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.hideBelowXl ? 'max-lc:hidden' : ''}`}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {col.sort ? (
                      <button type="button" onClick={() => clickHeader(col)} className={`inline-flex items-center gap-1 hover:text-lc-ink ${active ? 'text-lc-violet' : ''}`}>
                        {col.short ? <><span className="max-lc:hidden">{col.label}</span><span className="lc:hidden">{col.short}</span></> : col.label}<SortIcon dir={active ? sort.dir : undefined} />
                      </button>
                    ) : col.label}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {page.map(v => {
              const r = v.row, k = rowKey(r), selected = k === selectedKey
              const f = rowFigures(r), exp = expiryInfo(r.expiration)
              const isVariant = v.kind === 'variant', isOther = v.kind === 'other'
              const pick = isOther ? MODES[r.mode]?.pick : v.paired ? MODES[mode].pick : null
              return [
                <tr key={k} data-selected={selected ? 'true' : undefined} data-kind={v.kind} data-mode={r.mode ?? mode} data-db={r.leg_b_delta} data-dc={r.leg_c_delta}
                  onClick={() => !dimmed && onSelect?.(r)} onDoubleClick={() => !dimmed && onOpen?.(r)} aria-current={selected ? 'true' : undefined}
                  className={`cursor-pointer border-b border-lc-line/70 transition-colors ${selected ? 'bg-lc-violet-soft' : 'hover:bg-lc-ground'}`}>
                  <td className="px-2 max-lc:px-1.5 py-2.5">
                    {isOther ? <span className="inline-grid place-items-center w-[26px] h-[26px] text-lc-ink-3" title="The other mode’s pick — not ranked in this list">·</span> : <span title={`${r.rank} of ${rows.length} in the scanner’s order`} className={`inline-grid place-items-center w-[26px] h-[26px] rounded-lc text-[0.8rem] font-bold ${selected ? 'bg-lc-violet text-lc-card' : r.rank === 1 ? 'bg-lc-lime text-lc-ink' : 'bg-lc-ground text-lc-ink-2'}`}>{r.rank}</span>}
                  </td>
                  <td aria-label={r.ticker} className={`px-2 max-lc:px-1.5 py-2.5 font-display font-bold text-[1.05rem] whitespace-nowrap ${isVariant ? 'text-lc-ink-2 pl-6' : 'text-lc-ink'}`}>
                    {isVariant ? '↳' : r.ticker}
                    {pick && <Pill tone="quiet" size="sm" className="ml-2 font-figtree font-semibold align-middle">{pick}</Pill>}
                  </td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 whitespace-nowrap">
                    <span className="text-lc-ink">{exp.short}</span><span className="text-lc-ink-2 max-lc:hidden"> · W{r.week}</span><span className="text-lc-ink-2">{exp.dte != null ? ` · ${exp.dte}d` : ''}</span>
                  </td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 whitespace-nowrap text-lc-ink-2 max-lc:text-[0.9rem] [font-variant-numeric:tabular-nums]">
                    {r.leg_c_strike} / <span className="text-lc-ink font-semibold">{r.leg_a_strike}</span> / {r.leg_b_strike}
                  </td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 text-right whitespace-nowrap">
                    <div className="flex flex-col items-end"><span className="font-bold text-lc-ink">{fmtMoney0(f.credit)}</span><span className="text-[0.72rem] text-lc-ink-2 max-lc:hidden">{(rocOf(r) * 100).toFixed(1)}% of collateral</span></div>
                  </td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 text-right whitespace-nowrap">
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-lc-ink">{fmtMoney0(f.maxProfit)}</span>
                      <MetricBar value={metric(r)} label={metricLabel} className="w-[4.5rem] max-lc:w-[3rem]" />
                    </div>
                  </td>
                  {mode === 'upside' && <td className="px-2 max-lc:px-1.5 py-2.5 text-right whitespace-nowrap text-lc-ink">{moveToMax(r) == null ? '—' : `+${(moveToMax(r) * 100).toFixed(1)}%`}</td>}
                  <td className="px-2 max-lc:px-1.5 py-2.5 text-right whitespace-nowrap text-lc-ink">{fmtPct0(shortsWorthless(r))}</td>
                  <td className="px-2 max-lc:px-1.5 py-2.5 text-right text-lc-ink whitespace-nowrap max-lc:hidden">{fmtMoney0(f.collateral)}</td>
                </tr>,
                v.kind === 'best' && v.more > 0 && (
                  <tr key={`${k}-more`} className="border-b border-lc-line/70">
                    <td colSpan={NCOLS} className="px-2 py-1.5">
                      <button type="button" onClick={() => toggleExpand(r.ticker)} aria-expanded={expanded.has(r.ticker)}
                        className="text-[0.82rem] font-semibold text-lc-violet hover:underline pl-[34px]">
                        {expanded.has(r.ticker) ? `Show fewer ${r.ticker} setups` : `+${v.more} more ${r.ticker} ${v.more === 1 ? 'setup' : 'setups'}`}
                      </button>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
        {visible.length > shown && (
          <div className="flex justify-center py-3">
            <button type="button" onClick={() => setShown(s => s + PAGE)} className="text-[0.9rem] font-semibold text-lc-violet hover:underline">
              Show {Math.min(PAGE, visible.length - shown)} more of {visible.length.toLocaleString()}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
