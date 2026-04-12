import { useState } from 'react'

const COLUMNS = [
  { key: 'rank',         label: 'Rank',        align: 'right'  },
  { key: 'ticker',       label: 'Ticker',      align: 'left'   },
  { key: 'side',         label: 'Side',        align: 'left'   },
  { key: 'expiration',   label: 'Expiration',  align: 'left'   },
  { key: 'week',         label: 'Wk',          align: 'left'   },
  { key: 'dist_pct',     label: 'Dist%',       align: 'right'  },
  { key: 'delta',        label: 'Delta',       align: 'right'  },
  { key: 'strike',       label: 'Strike',      align: 'right'  },
  { key: 'premium',      label: 'Premium',     align: 'right'  },
  { key: 'price',        label: 'Stock Price', align: 'right'  },
  { key: 'volume',       label: 'Volume',      align: 'right'  },
  { key: 'oi',           label: 'OI',          align: 'right'  },
  { key: 'ratio',        label: 'Ratio',       align: 'right'  },
  { key: 'earnings_flag',label: 'Earnings',    align: 'left'   },
]

function fmtDist(d) {
  const pct = d * 100
  return `${parseFloat(pct.toPrecision(4))}%`
}

export default function RankedTable({ rows, duplicatesRemoved, distancesUsed, weeksUsed }) {
  const [sortKey, setSortKey]   = useState('rank')
  const [sortAsc, setSortAsc]   = useState(true)

  if (!rows || rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-gray-500 text-sm">No data yet.</p>
        <p className="text-gray-600 text-xs">Enter tickers and click Run Scan.</p>
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

  return (
    <div className="flex flex-col">

      {/* metadata bar */}
      <div className="px-6 py-2 flex items-center gap-4 text-xs text-gray-500 border-b border-gray-800 flex-wrap">
        <span>Algorithm: <span className="text-gray-400">V2 — Delta Adjusted</span></span>
        <span>·</span>
        <span>Min delta: <span className="text-gray-400">0.05</span></span>
        <span>·</span>
        <span>Duplicates removed: <span className="text-gray-400">{duplicatesRemoved ?? 0}</span></span>
        <span>·</span>
        <span>{rows.length} data points ranked</span>
        {distancesUsed && distancesUsed.length > 0 && (
          <>
            <span>·</span>
            <span>Distances: <span className="text-gray-400">{distancesUsed.map(fmtDist).join(', ')}</span></span>
          </>
        )}
        {weeksUsed != null && (
          <>
            <span>·</span>
            <span>Weeks: <span className="text-gray-400">{weeksUsed}</span></span>
          </>
        )}
      </div>

      {/* liquidity legend */}
      <div className="px-6 py-1.5 flex items-center gap-4 text-xs border-b border-gray-800 bg-gray-900/50">
        <span className="text-gray-500">Liquidity:</span>
        <span className="text-red-400">Volume &lt; 10 flagged red</span>
        <span className="text-gray-600">·</span>
        <span className="text-red-400">OI &lt; 100 flagged red</span>
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
              <TableRow key={`${row.ticker}-${row.side}-${row.expiration}-${row.dist_pct}`} row={row} idx={idx} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TableRow({ row, idx }) {
  const isTopFive   = row.rank <= 5
  const isCall      = row.side === 'Call'
  const isPut       = row.side === 'Put'
  const lowVolume   = row.volume !== null && row.volume !== undefined && row.volume < 10
  const lowOI       = row.oi !== null && row.oi !== undefined && row.oi < 100
  const hasEarnings = row.earnings_flag && row.earnings_flag !== 'CLEAR'

  const rowBg = isTopFive
    ? 'bg-indigo-950/30 hover:bg-indigo-950/50'
    : idx % 2 === 0
      ? 'bg-gray-950 hover:bg-gray-900'
      : 'bg-gray-900/50 hover:bg-gray-900'

  const wk = row.week ? row.week.replace('Week ', 'W') : '—'

  return (
    <tr className={`border-b border-gray-800/60 transition-colors ${rowBg}`}>

      {/* Rank */}
      <td className="px-3 py-2 text-right text-gray-500">
        {isTopFive
          ? <span className="text-indigo-400 font-bold">{row.rank}</span>
          : row.rank}
      </td>

      {/* Ticker */}
      <td className="px-3 py-2 text-left font-bold text-gray-100">{row.ticker}</td>

      {/* Side */}
      <td className="px-3 py-2 text-left">
        <span className={`font-semibold ${isCall ? 'text-sky-400' : isPut ? 'text-rose-400' : 'text-gray-300'}`}>
          {row.side}
        </span>
      </td>

      {/* Expiration */}
      <td className="px-3 py-2 text-left text-gray-300">{row.expiration}</td>

      {/* Week */}
      <td className="px-3 py-2 text-left text-gray-500">{wk}</td>

      {/* Dist% */}
      <td className="px-3 py-2 text-right text-gray-400">{row.dist_pct}</td>

      {/* Delta */}
      <td className="px-3 py-2 text-right text-gray-300">
        {row.delta?.toFixed(4) ?? '—'}
      </td>

      {/* Strike */}
      <td className="px-3 py-2 text-right text-gray-300">
        ${row.strike?.toFixed(2) ?? '—'}
      </td>

      {/* Premium */}
      <td className="px-3 py-2 text-right text-gray-100 font-semibold">
        ${row.premium?.toFixed(4) ?? '—'}
      </td>

      {/* Stock Price */}
      <td className="px-3 py-2 text-right text-gray-400">
        ${row.price?.toFixed(2) ?? '—'}
      </td>

      {/* Volume */}
      <td className={`px-3 py-2 text-right ${lowVolume ? 'text-red-400 font-semibold' : 'text-gray-400'}`}>
        {row.volume !== null && row.volume !== undefined ? row.volume.toLocaleString() : 'N/A'}
      </td>

      {/* OI */}
      <td className={`px-3 py-2 text-right ${lowOI ? 'text-red-400 font-semibold' : 'text-gray-400'}`}>
        {row.oi !== null && row.oi !== undefined ? row.oi.toLocaleString() : 'N/A'}
      </td>

      {/* Ratio */}
      <td className="px-3 py-2 text-right text-emerald-400 font-bold">
        {row.ratio?.toFixed(6) ?? '—'}
      </td>

      {/* Earnings */}
      <td className="px-3 py-2 text-left">
        {hasEarnings
          ? <span className="text-amber-400 font-semibold">{row.earnings_flag}</span>
          : <span className="text-gray-600">CLEAR</span>}
      </td>

    </tr>
  )
}
