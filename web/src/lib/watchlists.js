// web/src/lib/watchlists.js
// Pure helpers for the named-watchlists feature: ticker parsing, watchlist-name
// validation/normalization, and @-syntax resolution for the scan input. Kept
// dependency-free and side-effect-free so they're easy to reason about and test.

// Split raw text on commas/whitespace → uppercased symbols, leading $ stripped.
// (Same rules the scan input has always used.)
export function parseTickers(raw) {
  return (raw || '')
    .split(/[,\s]+/)
    .map(t => t.trim().toUpperCase().replace(/^\$/, ''))
    .filter(Boolean)
}

// parseTickers + de-dupe, preserving first-seen order. Used when saving a
// watchlist's ticker set.
export function parseTickersUnique(raw) {
  return [...new Set(parseTickers(raw))]
}

// Watchlist names are stored and matched lowercase, so @Semis and @semis refer
// to the same watchlist.
export function normalizeWatchlistName(raw) {
  return (raw || '').trim().toLowerCase()
}

// Validate a watchlist name at creation/edit time. Returns an error string, or
// null when valid. Rules: non-empty, no leading '@' (the @ is only used when
// referencing), no spaces, letters/digits/_/- only, max 32 chars.
export function validateWatchlistName(raw) {
  const t = (raw || '').trim()
  if (!t) return 'Enter a watchlist name.'
  if (t.startsWith('@')) return "Don't include @ in the name — use @name only when scanning."
  if (/\s/.test(t)) return 'Name cannot contain spaces.'
  if (!/^[A-Za-z0-9_-]+$/.test(t)) return 'Use only letters, numbers, _ or - in the name.'
  if (t.length > 32) return 'Name is too long (max 32 characters).'
  return null
}

// Resolve raw scan input into a final, de-duped ticker list, expanding any
// @watchlist references against the user's loaded watchlists.
//   - "@name" token → expand to that watchlist's tickers (case-insensitive).
//                      Unknown name → { tickers: [], error: '...' } (caller must
//                      NOT run the scan).
//   - bare token    → treated as a literal ticker (same as today).
// Mixing works: "@semis, TSLA, @core" → union of both lists + TSLA, deduped.
// Blank input → { tickers: [], error: null } (caller falls back to the default
// watchlist, same as today).
export function resolveScanTickers(raw, watchlists) {
  const tokens = (raw || '').split(/[,\s]+/).map(t => t.trim()).filter(Boolean)
  const out = []
  const seen = new Set()
  const add = (sym) => {
    const s = (sym || '').toUpperCase().replace(/^\$/, '')
    if (s && !seen.has(s)) { seen.add(s); out.push(s) }
  }

  for (const tok of tokens) {
    if (tok.startsWith('@')) {
      const name = tok.slice(1).toLowerCase()
      if (!name) return { tickers: [], error: 'Type a watchlist name after @ (e.g. @semis).' }
      const wl = (watchlists || []).find(w => (w.name || '').toLowerCase() === name)
      if (!wl) return { tickers: [], error: `No watchlist named "${name}". Create it in Controls.` }
      for (const sym of (wl.tickers || [])) add(sym)
    } else {
      add(tok)
    }
  }
  return { tickers: out, error: null }
}
