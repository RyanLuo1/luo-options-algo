import { useState } from 'react'

/**
 * WatchlistManager — the named-watchlists management UI, rendered inside the
 * controls drawer. Lists the user's watchlists (name + ticker preview), and
 * lets them create / edit / delete. All persistence + in-app state lives in
 * App.jsx; this component is presentation + local form state, calling the
 * async `onCreate(name, tickers)` / `onUpdate(id, name, tickers)` / `onDelete(id)`
 * callbacks (create/update return `{ error }` on failure, falsy on success).
 *
 * Reference a watchlist in the scan input with `@name`.
 */
export default function WatchlistManager({ watchlists, onCreate, onUpdate, onDelete }) {
  const [name, setName]       = useState('')
  const [tickers, setTickers] = useState('')
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState(false)

  const [editingId, setEditingId]   = useState(null)
  const [editName, setEditName]     = useState('')
  const [editTickers, setEditTickers] = useState('')
  const [editError, setEditError]   = useState(null)

  async function handleCreate() {
    if (busy) return
    setBusy(true); setError(null)
    const res = await onCreate(name, tickers)
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    setName(''); setTickers('')
  }

  function startEdit(w) {
    setEditingId(w.id)
    setEditName(w.name)
    setEditTickers((w.tickers || []).join(', '))
    setEditError(null)
  }

  async function handleSaveEdit() {
    if (busy) return
    setBusy(true); setEditError(null)
    const res = await onUpdate(editingId, editName, editTickers)
    setBusy(false)
    if (res?.error) { setEditError(res.error); return }
    setEditingId(null)
  }

  const inputCls = "h-[30px] bg-base border border-subtle rounded px-2 text-xs font-mono " +
                   "text-gray-100 placeholder-gray-600 focus:outline-none focus:border-accent"

  return (
    <div className="flex flex-col gap-2 border-t border-subtle pt-4">
      <div className="flex items-baseline justify-between">
        <label className="text-[11px] font-medium text-secondary">Watchlists</label>
        <span className="text-[10px] text-tertiary">scan with <span className="font-mono text-secondary">@name</span></span>
      </div>

      {/* Existing watchlists */}
      <div className="flex flex-col gap-1.5">
        {watchlists.length === 0 && (
          <p className="text-[11px] text-tertiary">No watchlists yet — create one below.</p>
        )}
        {watchlists.map(w => editingId === w.id ? (
          <div key={w.id} className="flex flex-col gap-1.5 bg-surface-raised border border-subtle rounded-md p-2">
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="name"
              className={inputCls}
            />
            <input
              value={editTickers}
              onChange={e => setEditTickers(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
              placeholder="NVDA, AMD, MU"
              className={inputCls}
            />
            {editError && <p className="text-[11px] text-loss">{editError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleSaveEdit}
                disabled={busy}
                className="px-3 py-1 rounded bg-accent hover:bg-accent-hover text-primary text-xs font-semibold disabled:opacity-50"
              >Save</button>
              <button
                onClick={() => setEditingId(null)}
                disabled={busy}
                className="px-3 py-1 rounded bg-surface-raised border border-subtle text-secondary text-xs hover:text-primary"
              >Cancel</button>
            </div>
          </div>
        ) : (
          <div key={w.id} className="flex items-center justify-between gap-2 bg-surface-raised border border-subtle rounded-md px-2.5 py-1.5">
            <div className="min-w-0">
              <div className="text-xs font-mono text-primary truncate">
                @{w.name} <span className="text-tertiary">· {(w.tickers || []).length}</span>
              </div>
              <div className="text-[10px] text-tertiary truncate">{(w.tickers || []).join(', ') || '—'}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => startEdit(w)}
                title="Edit watchlist"
                className="text-tertiary hover:text-primary text-[11px] px-1.5 py-0.5 rounded hover:bg-base"
              >Edit</button>
              <button
                onClick={() => { if (window.confirm(`Delete watchlist "${w.name}"?`)) onDelete(w.id) }}
                title="Delete watchlist"
                className="text-tertiary hover:text-loss text-sm leading-none px-1.5 py-0.5 rounded hover:bg-base"
              >×</button>
            </div>
          </div>
        ))}
      </div>

      {/* Create form */}
      <div className="flex flex-col gap-1.5 mt-1">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="name (e.g. semis)"
          className="h-[32px] bg-surface-raised border border-subtle rounded-md px-2.5 text-xs font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-accent"
        />
        <input
          value={tickers}
          onChange={e => setTickers(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="tickers (NVDA, AMD, MU)"
          className="h-[32px] bg-surface-raised border border-subtle rounded-md px-2.5 text-xs font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-accent"
        />
        {error && <p className="text-[11px] text-loss">{error}</p>}
        <button
          onClick={handleCreate}
          disabled={busy}
          className="h-[32px] rounded-md bg-accent hover:bg-accent-hover text-primary text-xs font-semibold disabled:opacity-50"
        >
          {busy ? 'Saving…' : '+ Add watchlist'}
        </button>
      </div>
    </div>
  )
}
