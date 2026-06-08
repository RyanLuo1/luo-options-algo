import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import useAuth from '../hooks/useAuth'

export default function LoginPage() {
  const navigate         = useNavigate()
  const { user, loading } = useAuth()

  const [mode]                  = useState('signin')  // sign-in only (UI shows no sign-up); handler branch preserved
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(null)
  const [busy,     setBusy]     = useState(false)
  const [showPw,   setShowPw]   = useState(false)     // UI-only password reveal

  // Redirect if already logged in
  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true })
  }, [user, loading, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null

  return (
    <div className="min-h-screen flex bg-base text-primary">

      {/* ── Left — sign-in form (vertically centered) ──────────────────────── */}
      <div className="relative flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">

          {/* Lockup */}
          <div className="flex items-center gap-2.5 mb-12">
            <BrandMark />
            <span className="font-bold text-lg tracking-tight text-primary">Luo Capital</span>
          </div>

          {/* Heading */}
          <h1 className="text-2xl font-bold text-primary tracking-tight">Welcome back.</h1>
          <p className="text-secondary text-sm mt-1.5 mb-8">Sign in to the screener.</p>

          {/* Form — same handlers as before */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-[11px] font-medium text-secondary">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={busy}
                placeholder="you@example.com"
                autoComplete="email"
                className="h-[42px] bg-surface-raised text-primary border border-subtle rounded-md px-3
                           text-sm placeholder-tertiary transition-colors
                           focus:outline-none focus:border-accent disabled:opacity-50"
              />
            </div>

            {/* Password — with show/hide toggle */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-[11px] font-medium text-secondary">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  disabled={busy}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full h-[42px] bg-surface-raised text-primary border border-subtle rounded-md pl-3 pr-16
                             text-sm placeholder-tertiary transition-colors
                             focus:outline-none focus:border-accent disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  tabIndex={-1}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-[11px] font-medium
                             text-tertiary hover:text-secondary transition-colors"
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Inline error — muted loss-red */}
            {error && (
              <p className="text-loss text-xs -mt-0.5">{error}</p>
            )}

            {/* Primary action — accent purple */}
            <button
              type="submit"
              disabled={busy}
              className="mt-2 h-[42px] bg-accent hover:bg-accent-hover text-primary text-sm font-semibold
                         rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="absolute bottom-6 inset-x-0 text-center text-tertiary text-[11px]">
          © 2026 · Luo Capital
        </div>
      </div>

      {/* ── Right — brand visual (hidden on narrow screens) ────────────────── */}
      <div className="hidden lg:block relative flex-1 overflow-hidden border-l border-subtle bg-[#0B1220]">
        <CandleMotif />

        {/* Faint purple glow */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(60% 50% at 50% 42%, rgba(124,92,255,0.18), transparent 70%)' }}
        />

        {/* Centered lockup over the motif */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
          <div className="text-primary font-bold text-3xl tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
            Luo Capital
          </div>
          <div className="text-secondary text-sm mt-2 tracking-wide">Options Screener</div>
        </div>
      </div>

    </div>
  )
}

/* Small accent-purple brand mark — a candlestick glyph in the accent color. */
function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
      <rect x="2" y="2" width="18" height="18" rx="5" fill="var(--accent)" fillOpacity="0.16" />
      <line x1="11" y1="4" x2="11" y2="18" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="8" y="7" width="6" height="8" rx="1.5" fill="var(--accent)" />
    </svg>
  )
}

/*
 * CandleMotif — a low-opacity candlestick scene for the brand panel.
 * SVG + CSS only (no WebGL / video / images). A few candle groups drift
 * slowly via the .candle-a/b/c keyframes in index.css (~6–8s loops).
 * Slate wicks, profit-green / loss-red bodies, a faint grid underneath.
 */
function CandleMotif() {
  // [x, wickTop, wickBottom, bodyTop, bodyH, up]
  const candles = [
    [ 60,  120, 470, 200, 150, false],
    [120,   80, 430, 150, 120, true ],
    [180,  160, 510, 240, 130, true ],
    [240,  100, 420, 170, 110, false],
    [300,  150, 520, 230, 180, true ],
    [350,  130, 470, 210, 120, false],
  ]
  const groupOf = i => (i % 3 === 0 ? 'candle-a' : i % 3 === 1 ? 'candle-b' : 'candle-c')

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 400 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {/* Faint grid */}
      <g stroke="var(--border-subtle)" strokeWidth="1" opacity="0.18">
        {[0, 100, 200, 300, 400, 500, 600].map(y => (
          <line key={`h${y}`} x1="0" y1={y} x2="400" y2={y} />
        ))}
        {[0, 100, 200, 300, 400].map(x => (
          <line key={`v${x}`} x1={x} y1="0" x2={x} y2="600" />
        ))}
      </g>

      {/* Candles */}
      <g opacity="0.22">
        {candles.map((c, i) => {
          const [x, wTop, wBot, bTop, bH, up] = c
          const color = up ? 'var(--profit)' : 'var(--loss)'
          return (
            <g key={i} className={groupOf(i)} style={{ transformBox: 'fill-box' }}>
              <line x1={x} y1={wTop} x2={x} y2={wBot} stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round" />
              <rect x={x - 9} y={bTop} width="18" height={bH} rx="2" fill={color} />
            </g>
          )
        })}
      </g>
    </svg>
  )
}
