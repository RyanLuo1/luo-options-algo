import { useState } from 'react'

const COLUMNS = [
  { key: 'rank',         label: 'Rank',         align: 'right' },
  { key: 'ticker',       label: 'Ticker',       align: 'left'  },
  { key: 'expiration',   label: 'Expiration',   align: 'left'  },
  { key: 'week',         label: 'Wk',           align: 'left'  },
  { key: 'leg_a_strike', label: 'Leg A Strike', align: 'right' },
  { key: 'leg_a_prem',   label: 'Leg A Prem',   align: 'right' },
  { key: 'leg_b_strike', label: 'Leg B Strike', align: 'right' },
  { key: 'leg_b_prem',   label: 'Leg B Prem',   align: 'right' },
  { key: 'leg_c_strike', label: 'Leg C Strike', align: 'right' },
  { key: 'leg_c_prem',   label: 'Leg C Prem',   align: 'right' },
  { key: 'net_premium',  label: 'Net Prem',     align: 'right' },
  { key: 'spread_width', label: 'Spread Width', align: 'right' },
  { key: 'score',        label: 'Score',        align: 'right' },
  { key: 'p_max_profit', label: 'P(Profit)%',  align: 'right' },
  { key: 'fair_value',   label: 'Fair Value',   align: 'right' },
]

export default function V3Table({ rows, totalEvaluated, weeksUsed, minPremiumUsed, minPProfitUsed }) {
  const [sortKey, setSortKey] = useState('rank')
  const [sortAsc, setSortAsc] = useState(true)

  if (!rows || rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-gray-500 text-sm">No valid triplets found.</p>
        <p className="text-gray-600 text-xs">
          Try lowering min premium, reducing min P(profit), or adding more weeks.
        </p>
      </div>
    )
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
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
    <div className="flex flex-col">

      {/* metadata bar */}
      <div className="px-6 py-2 flex items-center gap-4 text-xs text-gray-500 border-b border-gray-800 flex-wrap">
        <span>Algorithm: <span className="text-gray-400">V3 — Call Spread Risk Reversal</span></span>
        {weeksUsed != null && (
          <><span>·</span><span>Weeks: <span className="text-gray-400">{weeksUsed}</span></span></>
        )}
        {minPremiumUsed != null && (
          <><span>·</span><span>Min Premium: <span className="text-gray-400">${minPremiumUsed.toFixed(2)}</span></span></>
        )}
        {minPProfitUsed != null && (
          <><span>·</span><span>Min P(Profit): <span className="text-gray-400">{(minPProfitUsed * 100).toFixed(0)}%</span></span></>
        )}
        <span>·</span>
        <span>{rows.length} triplets ranked</span>
        {totalEvaluated > 0 && (
          <><span>·</span><span className="text-gray-600">{totalEvaluated.toLocaleString()} evaluated</span></>
        )}
      </div>

      {/* legend */}
      <div className="px-6 py-1.5 flex items-center gap-4 text-xs border-b border-gray-800 bg-gray-900/50">
        <span className="text-gray-500">Legend:</span>
        <span className="text-sky-400">Leg A Prem</span>
        <span className="text-gray-600">=</span>
        <span className="text-gray-500">you pay (long call)</span>
        <span className="text-gray-600">·</span>
        <span className="text-emerald-400">Leg B &amp; C Prem</span>
        <span className="text-gray-600">=</span>
        <span className="text-gray-500">you collect</span>
        <span className="text-gray-600">·</span>
        <span className="text-red-400">Red = borderline P(profit)</span>
        <span className="text-gray-600">·</span>
        <span className="text-yellow-400">Yellow = no fair value</span>
      </div>

      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-900">
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`
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
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => (
              <V3Row
                key={`${row.ticker}-${row.expiration}-${row.leg_a_strike}-${row.leg_b_strike}-${row.leg_c_strike}`}
                row={row}
                idx={idx}
                minPP={minPP}
              />
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}

function V3Row({ row, idx, minPP }) {
  const borderline = row.p_max_profit >= minPP && row.p_max_profit <= minPP + 0.10
  const noFV       = !row.fv_available

  const rowBg = borderline
    ? 'bg-red-950/30 hover:bg-red-950/50'
    : noFV
      ? 'bg-yellow-950/20 hover:bg-yellow-950/30'
      : idx % 2 === 0
        ? 'bg-gray-950 hover:bg-gray-900'
        : 'bg-gray-900/50 hover:bg-gray-900'

  return (
    <tr className={`border-b border-gray-800/60 transition-colors ${rowBg}`}>

      {/* Rank */}
      <td className="px-3 py-2 text-right text-gray-500">{row.rank}</td>

      {/* Ticker */}
      <td className="px-3 py-2 text-left font-bold text-gray-100">{row.ticker}</td>

      {/* Expiration */}
      <td className="px-3 py-2 text-left text-gray-300">{row.expiration}</td>

      {/* Week */}
      <td className="px-3 py-2 text-left text-gray-500">W{row.week}</td>

      {/* Leg A Strike */}
      <td className="px-3 py-2 text-right text-gray-300">
        ${row.leg_a_strike?.toFixed(2) ?? '—'}
      </td>

      {/* Leg A Prem — blue (you pay) */}
      <td className="px-3 py-2 text-right text-sky-400 font-semibold">
        ${row.leg_a_prem?.toFixed(4) ?? '—'}
      </td>

      {/* Leg B Strike */}
      <td className="px-3 py-2 text-right text-gray-300">
        ${row.leg_b_strike?.toFixed(2) ?? '—'}
      </td>

      {/* Leg B Prem — emerald (you collect) */}
      <td className="px-3 py-2 text-right text-emerald-400 font-semibold">
        ${row.leg_b_prem?.toFixed(4) ?? '—'}
      </td>

      {/* Leg C Strike */}
      <td className="px-3 py-2 text-right text-gray-300">
        ${row.leg_c_strike?.toFixed(2) ?? '—'}
      </td>

      {/* Leg C Prem — emerald (you collect) */}
      <td className="px-3 py-2 text-right text-emerald-400 font-semibold">
        ${row.leg_c_prem?.toFixed(4) ?? '—'}
      </td>

      {/* Net Prem — bold white */}
      <td className="px-3 py-2 text-right text-white font-bold">
        ${row.net_premium?.toFixed(4) ?? '—'}
      </td>

      {/* Spread Width */}
      <td className="px-3 py-2 text-right text-gray-400">
        {row.spread_width?.toFixed(2) ?? '—'}
      </td>

      {/* Score — emerald */}
      <td className="px-3 py-2 text-right text-emerald-400 font-bold">
        {row.score?.toFixed(6) ?? '—'}
      </td>

      {/* P(Profit)% */}
      <td className="px-3 py-2 text-right text-gray-300">
        {row.p_max_profit != null ? `${(row.p_max_profit * 100).toFixed(2)}%` : '—'}
      </td>

      {/* Fair Value */}
      <td className="px-3 py-2 text-right">
        {row.fv_available
          ? <span className="text-gray-400">${row.fair_value?.toFixed(2)}</span>
          : <span className="text-yellow-500">N/A</span>
        }
      </td>

    </tr>
  )
}
