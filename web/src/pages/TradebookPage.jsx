import { useState, useEffect } from 'react'
import Header from '../components/Header'
import { supabase } from '../lib/supabase'
import useAuth from '../hooks/useAuth'

function formatDate(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export default function TradebookPage() {
  const { user } = useAuth()
  const [trades,  setTrades]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    supabase
      .from('tradebook')
      .select('*')
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setTrades(data)
        setLoading(false)
      })
  }, [user])

  async function deleteTrade(id) {
    await supabase.from('tradebook').delete().eq('id', id)
    setTrades(prev => prev.filter(t => t.id !== id))
  }

  async function clearAll() {
    if (!window.confirm('Clear all saved trades?')) return
    if (!user) return
    await supabase.from('tradebook').delete().eq('user_id', user.id)
    setTrades([])
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <Header />

      {/* Page header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <div className="text-white font-semibold text-base">Tradebook</div>
          <div className="text-gray-500 text-xs mt-0.5">
            {loading ? 'Loading…' : `${trades.length} saved ${trades.length === 1 ? 'trade' : 'trades'}`}
          </div>
        </div>
        {trades.length > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-gray-600 hover:text-red-400 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Empty state */}
      {!loading && trades.length === 0 && (
        <div className="flex flex-col items-center justify-center py-32 gap-3 text-center px-6">
          <p className="text-gray-400 text-sm font-medium">No trades saved yet.</p>
          <p className="text-gray-600 text-xs max-w-sm">
            Run a V3 scan and click any row to save a triplet to the tradebook.
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && trades.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-900">
                <th className="px-4 py-2.5 text-left text-gray-400 font-semibold whitespace-nowrap">Date Saved</th>
                <th className="px-4 py-2.5 text-left text-gray-400 font-semibold">Ticker</th>
                <th className="px-4 py-2.5 text-left text-gray-400 font-semibold">Expiration</th>
                <th className="px-4 py-2.5 text-right text-gray-400 font-semibold">Leg A Strike</th>
                <th className="px-4 py-2.5 text-right text-gray-400 font-semibold">Leg B Strike</th>
                <th className="px-4 py-2.5 text-right text-gray-400 font-semibold">Leg C Strike</th>
                <th className="px-4 py-2.5 text-right text-gray-400 font-semibold">Net Premium</th>
                <th className="px-4 py-2.5 text-right text-gray-400 font-semibold">Score</th>
                <th className="px-4 py-2.5 text-right text-gray-400 font-semibold">P(Profit)%</th>
                <th className="px-4 py-2.5 text-center text-gray-600 font-semibold w-8"></th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, idx) => (
                <tr
                  key={trade.id}
                  className={`border-b border-gray-800/60 transition-colors ${
                    idx % 2 === 0 ? 'bg-gray-950 hover:bg-gray-900' : 'bg-gray-900/50 hover:bg-gray-900'
                  }`}
                >
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                    {formatDate(trade.saved_at)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-100 font-bold">
                    {trade.ticker}
                  </td>
                  <td className="px-4 py-2.5 text-gray-300">
                    {trade.expiration}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-300">
                    {trade.leg_a_strike != null ? `$${trade.leg_a_strike.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-300">
                    {trade.leg_b_strike != null ? `$${trade.leg_b_strike.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-300">
                    {trade.leg_c_strike != null ? `$${trade.leg_c_strike.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-white font-bold">
                    {trade.net_premium != null ? `$${trade.net_premium.toFixed(4)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-emerald-400">
                    {trade.score != null ? trade.score.toFixed(6) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-300">
                    {trade.p_max_profit != null ? `${(trade.p_max_profit * 100).toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => deleteTrade(trade.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors leading-none text-sm"
                      title="Remove trade"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}
