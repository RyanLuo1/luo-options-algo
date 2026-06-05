import { useState } from 'react'

// Scannable decision columns only (5). Score is the backend sort order but is
// NOT shown; P(profit), the full leg breakdown (strikes / prems / deltas),
// spread width, and fair value all live in the right-hand detail panel
// (SetupDetail) — the row objects still carry that data, it's just not rendered
// inline. `max_profit` is derived: (net_premium + spread_width) × 100.
//
// Layout: the table uses `table-fixed` with a <colgroup> that pins each column
// to its `width`; a trailing spacer <col> (no width) then absorbs ALL leftover
// space. So the 5 columns sit at fixed widths grouped on the left — identifier
// columns (Rank, Ticker, Expiration) left-aligned, numeric (Net Premium, Max
// Profit) right-aligned — with no stretching and no dead gaps between them,
// regardless of how wide the table panel is.
// Widths sized to fit each column's header (incl. the sort arrow) and its data,
// so `table-fixed` never clips a header (e.g. "Rank ↑"). The sum (33rem) is the
// table's natural width; the table column hugs it so there's no dead space after
// Max Profit.
const COLUMNS = [
  { key: 'rank',         label: 'Rank',        align: 'left',  width: '4.5rem' },
  { key: 'ticker',       label: 'Ticker',      align: 'left',  width: '5.5rem' },
  { key: 'expiration',   label: 'Expiration',  align: 'left',  width: '8rem'   },
  { key: 'net_premium',  label: 'Net Premium', align: 'right', width: '7.5rem' },
  { key: 'max_profit',   label: 'Max Profit',  align: 'right', width: '7.5rem' },
]

export function rowKey(row) {
  return `${row.ticker}-${row.expiration}-${row.leg_a_strike}-${row.leg_b_strike}-${row.leg_c_strike}`
}

// Whole-dollar per-contract money (one option contract = 100 shares).
function money0(n) {
  return Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function sortVal(r, key) {
  if (key === 'max_profit') return (r.net_premium ?? 0) + (r.spread_width ?? 0)
  return r[key] ?? ''
}

export default function ResultsTable({ rows, totalEvaluated, weeksMinUsed, weeksMaxUsed, minPremiumUsed, minPProfitUsed, onRowSelect, selectedKey }) {
  const [sortKey, setSortKey] = useState('rank')
  const [sortAsc, setSortAsc] = useState(true)

  if (!rows || rows.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-gray-500 text-sm">No valid triplets found.</p>
        <p className="text-gray-600 text-xs">
          Try lowering min premium, reducing min P(profit), or adding more weeks.
        </p>
      </div>
    )
  }

  const sorted = [...rows].sort((a, b) => {
    const av = sortVal(a, sortKey)
    const bv = sortVal(b, sortKey)
    if (av < bv) return sortAsc ? -1 : 1
    if (av > bv) return sortAsc ?  1 : -1
    return 0
  })

  function toggleSort(key) {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  const minPP = minPProfitUsed ?? 0.50

  return (
    // Fills the parent <main>, owns its own internal scroll. Metadata + legend
    // stay fixed; only the table wrapper below scrolls.
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

      {/* metadata bar */}
      <div className="shrink-0 px-6 py-2 flex items-center gap-4 text-xs text-gray-500 border-b border-gray-800 flex-wrap">
        <span>Algorithm: <span className="text-gray-400">Call Spread Risk Reversal</span></span>
        {weeksMinUsed != null && weeksMaxUsed != null && (
          <><span>·</span><span>Weeks: <span className="text-gray-400">
            {weeksMinUsed === weeksMaxUsed ? `W${weeksMinUsed}` : `W${weeksMinUsed} – W${weeksMaxUsed}`}
          </span></span></>
        )}
        {minPremiumUsed != null && (
          <><span>·</span><span>Min Premium: <span className="text-gray-400">${minPremiumUsed.toFixed(2)}</span></span></>
        )}
        {minPProfitUsed != null && (
          <><span>·</span><span>Min P(Profit): <span className="text-gray-400">{(minPProfitUsed * 100).toFixed(0)}%</span></span></>
        )}
        <span>·</span>
        <span><span className="num">{rows.length}</span> triplets ranked</span>
        {totalEvaluated > 0 && (
          <><span>·</span><span className="text-gray-600"><span className="num">{totalEvaluated.toLocaleString()}</span> evaluated</span></>
        )}
      </div>

      {/* Scrollable table body. */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs font-mono border-collapse table-fixed">
          {/* Fixed column widths; the trailing spacer <col> (no width) absorbs
              all leftover space so the 5 columns never stretch. */}
          <colgroup>
            {COLUMNS.map(col => <col key={col.key} style={{ width: col.width }} />)}
            <col />
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`
                    sticky top-0 z-10 bg-gray-900 border-b border-gray-700
                    px-3 py-2.5 font-semibold text-gray-400 cursor-pointer select-none
                    hover:text-gray-200 whitespace-nowrap
                    ${col.align === 'right' ? 'text-right' : 'text-left'}
                    ${sortKey === col.key ? 'text-indigo-400' : ''}
                  `}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1 text-indigo-400">{sortAsc ? '↑' : '↓'}</span>
                  )}
                </th>
              ))}
              {/* Spacer header cell — sits over the leftover-width <col>. */}
              <th aria-hidden="true" className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 p-0" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => (
              <ResultsRow
                key={rowKey(row)}
                row={row}
                idx={idx}
                minPP={minPP}
                selected={selectedKey != null && rowKey(row) === selectedKey}
                onRowClick={onRowSelect}
              />
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}

function ResultsRow({ row, idx, minPP, selected, onRowClick }) {
  const borderline = row.p_max_profit >= minPP && row.p_max_profit <= minPP + 0.10
  const noFV       = !row.fv_available

  const rowBg = selected
    ? 'bg-gray-700/60'
    : borderline
      ? 'bg-red-950/30 hover:bg-red-950/50'
      : noFV
        ? 'bg-yellow-950/20 hover:bg-yellow-950/30'
        : idx % 2 === 0
          ? 'bg-gray-950 hover:bg-gray-900'
          : 'bg-gray-900/50 hover:bg-gray-900'

  const collected = (row.net_premium ?? 0) * 100
  const maxProfit = ((row.net_premium ?? 0) + (row.spread_width ?? 0)) * 100

  return (
    <tr
      onClick={() => onRowClick?.(row)}
      className={`border-b border-gray-800/60 transition-colors cursor-pointer ${rowBg}`}
    >
      {/* Rank — carries the accent left-marker when this row is the open setup */}
      <td className={`px-3 py-2 text-left text-gray-500 num border-l-2 ${selected ? 'border-accent' : 'border-transparent'}`}>
        {row.rank}
      </td>

      {/* Ticker */}
      <td className="px-3 py-2 text-left font-bold text-gray-100">{row.ticker}</td>

      {/* Expiration (with Wk) */}
      <td className="px-3 py-2 text-left text-gray-300 num whitespace-nowrap">
        {row.expiration}
        <span className="ml-2 text-gray-500">W{row.week}</span>
      </td>

      {/* Net Premium — collected credit, per contract */}
      <td className="px-3 py-2 text-right text-profit font-semibold num">
        +${money0(collected)}
      </td>

      {/* Max Profit — (net_premium + spread_width) × 100 */}
      <td className="px-3 py-2 text-right text-profit font-bold num">
        ${money0(maxProfit)}
      </td>

      {/* Flexible spacer — absorbs the leftover width (matches the header spacer). */}
      <td aria-hidden="true" className="p-0" />
    </tr>
  )
}
