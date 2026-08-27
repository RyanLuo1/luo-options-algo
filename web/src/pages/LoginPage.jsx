import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import useAuth from '../hooks/useAuth'
import ThemeToggle from '../components/ThemeToggle'

const FEATURES = [
  {
    Icon: RankedIcon,
    title: 'Ranked Risk-Reversal Setups',
    desc: 'Every ticker and expiration scanned, scored, and ranked on live bid-ask pricing.',
    chipClass: 'bg-accent/10 text-accent',
  },
  {
    Icon: LedgerIcon,
    title: 'Tradebook & Realized Outcomes',
    desc: 'Log fills, follow open structures, and measure results against the scan that found them.',
    chipClass: 'bg-link/10 text-link',
  },
  {
    Icon: CandlesIcon,
    title: 'TradingView Charts, In Context',
    desc: "Full charting on the underlying, right beside each setup's strikes and detail.",
    chipClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
]

export default function LoginPage() {
  const navigate         = useNavigate()
  const { user, loading } = useAuth()
  const [searchParams]   = useSearchParams()

  const [mode,        setMode]        = useState(searchParams.get('mode') === 'signup' ? 'signup' : 'signin')  // 'signin' | 'signup'
  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const [confirmPw,   setConfirmPw]   = useState('')
  const [error,       setError]       = useState(null)       // inline loss-red error
  const [notice,      setNotice]      = useState(null)       // on-brand confirmation message
  const [busy,        setBusy]        = useState(false)
  const [showPw,      setShowPw]       = useState(false)      // UI-only password reveal

  const isSignup = mode === 'signup'

  // Redirect if already logged in
  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true })
  }, [user, loading, navigate])

  function switchMode(target) {
    setMode(target)
    setError(null)
    setNotice(null)
    setConfirmPw('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    // Client-side validation: passwords must match before submitting a sign-up
    if (isSignup && password !== confirmPw) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          // Unconfirmed email → guide the user to verify, not a generic error
          if (error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message)) {
            setNotice('Your email isn’t confirmed yet — check your inbox for the confirmation link, then sign in.')
            return
          }
          throw error
        }
        navigate('/', { replace: true })
      } else {
        // Existing signUp path — surfaced, not rewritten.
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) {
          if (/already registered|already exists/i.test(error.message)) {
            setError('An account with this email already exists — sign in instead.')
            return
          }
          throw error  // surfaces weak-password and other Supabase errors inline
        }
        // With email confirmation on, Supabase returns an obfuscated user with no
        // identities when the email is already registered (no error, to prevent
        // enumeration). Treat that as "account exists".
        if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError('An account with this email already exists — sign in instead.')
          return
        }
        // If a session came back, email confirmation is OFF — the user is already
        // logged in, so route straight into the screener like a normal sign-in.
        if (data?.session) {
          navigate('/', { replace: true })
          return
        }
        // No session → email confirmation is ON. Do NOT log in; tell the user to
        // confirm via email, then switch back to sign-in.
        setMode('signin')
        setPassword('')
        setConfirmPw('')
        setNotice('Check your email to confirm your account, then sign in.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null

  return (
    <div className="min-h-screen bg-base text-primary flex flex-col lg:flex-row">
      <ThemeToggle />

      {/* ── Mobile hero (hidden ≥ lg) ──────────────────────────────────────── */}
      <div className="lg:hidden relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/10 dark:from-accent/15 via-base to-base pointer-events-none" />
        <div className="absolute top-0 left-0 w-64 h-64 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 px-6 pt-10 pb-6">
          <div className="flex items-center gap-2.5 mb-5">
            <BrandMark />
            <span className="font-black text-xl tracking-tight text-primary">
              Luo <span className="text-accent">Capital</span>
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black leading-tight mb-3">
            Stop Guessing.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-link">
              Start Screening.
            </span>
          </h1>
          <p className="text-sm text-secondary mb-4 leading-relaxed max-w-md">
            Scan, score, and rank Call Spread Risk Reversals on live quotes.
          </p>
          <div className="flex gap-4 text-[11px] text-tertiary">
            {[
              { Icon: RankedIcon,  label: 'Ranked Setups' },
              { Icon: LedgerIcon,  label: 'Tradebook' },
              { Icon: CandlesIcon, label: 'Live Charts' },
            ].map(({ Icon, label }) => (
              <span key={label} className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-accent" /> {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Left — brand panel (hidden < lg) ───────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-center flex-1 py-12 px-[6vw] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/10 dark:from-accent/15 via-base to-base pointer-events-none" />
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <CandleMotif />
        </div>
        <div className="absolute top-20 left-10 w-72 h-72 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-20 right-0 w-56 h-56 bg-link/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-xl w-full">
          <div className="flex items-center gap-2.5 mb-8">
            <BrandMark />
            <span className="font-bold text-lg tracking-tight text-primary">
              Luo <span className="text-accent">Capital</span>
            </span>
          </div>

          <h1 className="text-4xl lg:text-5xl font-black leading-[1.1] mb-5 tracking-tight">
            Stop Guessing.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-link">
              Start Screening.
            </span>
          </h1>
          <p className="text-secondary text-base lg:text-lg leading-relaxed mb-10 max-w-lg">
            Scan the options chain for Call Spread Risk Reversals, score every structure
            on live bid-ask quotes, and track what you actually trade.
          </p>

          <div className="space-y-4 max-w-lg">
            {FEATURES.map(f => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>

          <p className="text-tertiary text-xs mt-8">
            Personal research platform · Not investment advice
          </p>
        </div>
      </div>

      {/* ── Right — auth card ──────────────────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-4 sm:px-[6vw] pt-6 pb-10 lg:py-12 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] bg-accent/5 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-md rounded-2xl bg-white/60 dark:bg-white/[0.04] border border-slate-200/60 dark:border-white/[0.08] backdrop-blur-xl shadow-2xl shadow-black/5 dark:shadow-black/30 p-6 sm:p-8">

          {/* Segmented mode toggle */}
          <div className="flex bg-surface rounded-xl p-1 border border-subtle mb-8">
            {[
              { value: 'signin', label: 'Sign In' },
              { value: 'signup', label: 'Create Account' },
            ].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => switchMode(value)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                  mode === value
                    ? 'bg-accent text-white shadow-lg shadow-accent/40'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-primary tracking-tight">
              {isSignup ? 'Create your account.' : 'Welcome back.'}
            </h2>
            <p className="text-secondary text-sm mt-1">
              {isSignup ? 'Sign up to access the screener.' : 'Sign in to the screener.'}
            </p>
          </div>

          {/* On-brand confirmation / info notice */}
          {notice && (
            <div className="mb-4 p-4 rounded-xl bg-accent/10 border border-accent/30 text-sm text-secondary flex items-start gap-3 anim-fade-in-up">
              <span className="p-1 rounded-full bg-accent/20 text-accent mt-0.5 shrink-0">
                <span className="flex items-center justify-center w-4 h-4 text-[10px] font-bold">i</span>
              </span>
              <span>{notice}</span>
            </div>
          )}

          {/* Inline error — loss-red */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-loss/10 border border-loss/20 text-loss text-sm flex items-start gap-2 anim-shake">
              <AlertIcon className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Form — same handlers as before */}
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-tertiary uppercase tracking-wider mb-1.5">
                Email
              </label>
              <div className="relative">
                <MailIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-tertiary pointer-events-none" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={busy}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full bg-surface-raised text-primary border border-subtle rounded-xl pl-10 pr-4 py-3
                             text-sm placeholder-tertiary/50 transition-all
                             focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Password — with show/hide toggle */}
            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-tertiary uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <LockIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-tertiary pointer-events-none" />
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  disabled={busy}
                  placeholder="••••••••"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  className="w-full bg-surface-raised text-primary border border-subtle rounded-xl pl-10 pr-11 py-3
                             text-sm placeholder-tertiary/50 transition-all
                             focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  tabIndex={-1}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-tertiary hover:text-secondary transition-colors"
                >
                  {showPw ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm password — sign-up only; mirrors showPw, no eye button */}
            {isSignup && (
              <div>
                <label htmlFor="confirm-password" className="block text-xs font-semibold text-tertiary uppercase tracking-wider mb-1.5">
                  Confirm password
                </label>
                <div className="relative">
                  <LockIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-tertiary pointer-events-none" />
                  <input
                    id="confirm-password"
                    type={showPw ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    required
                    disabled={busy}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="w-full bg-surface-raised text-primary border border-subtle rounded-xl pl-10 pr-4 py-3
                               text-sm placeholder-tertiary/50 transition-all
                               focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-50"
                  />
                </div>
              </div>
            )}

            {/* Primary action — accent purple */}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed
                         text-white font-bold text-sm transition-all flex items-center justify-center gap-2
                         shadow-lg shadow-accent/30"
            >
              {busy && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {busy
                ? (isSignup ? 'Creating account…' : 'Signing in…')
                : (isSignup ? 'Create account' : 'Sign in')}
            </button>
          </form>

          {/* Footer */}
          <p className="text-tertiary text-[11px] text-center mt-6">
            © 2026 · Luo Capital
          </p>
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

/* Feature row on the brand panel — icon chip + title + one-line description. */
function FeatureCard({ Icon, title, desc, chipClass }) {
  return (
    <div className="flex items-start gap-4 p-4 rounded-xl bg-surface/30 border border-subtle/30 backdrop-blur-sm transition-all hover:bg-surface/50">
      <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 border border-slate-200/50 dark:border-white/5 ${chipClass}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-sm font-bold text-primary tracking-wide">{title}</div>
        <div className="text-xs text-secondary mt-1 leading-relaxed">{desc}</div>
      </div>
    </div>
  )
}

/* ── Inline stroke icons (no icon dependency) ────────────────────────────── */

function IconBase({ className, children }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function MailIcon({ className }) {
  return (
    <IconBase className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 5L2 7" />
    </IconBase>
  )
}

function LockIcon({ className }) {
  return (
    <IconBase className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </IconBase>
  )
}

function EyeIcon({ className }) {
  return (
    <IconBase className={className}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  )
}

function EyeOffIcon({ className }) {
  return (
    <IconBase className={className}>
      <path d="M17.94 17.94A10.6 10.6 0 0 1 12 19c-6.5 0-10-7-10-7a17.9 17.9 0 0 1 4.06-4.94" />
      <path d="M9.9 5.24A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17.9 17.9 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </IconBase>
  )
}

function AlertIcon({ className }) {
  return (
    <IconBase className={className}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </IconBase>
  )
}

/* Ranked list — numbered rows */
function RankedIcon({ className }) {
  return (
    <IconBase className={className}>
      <line x1="10" y1="6" x2="21" y2="6" />
      <line x1="10" y1="12" x2="21" y2="12" />
      <line x1="10" y1="18" x2="21" y2="18" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </IconBase>
  )
}

/* Ledger — open book */
function LedgerIcon({ className }) {
  return (
    <IconBase className={className}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </IconBase>
  )
}

/* Candlesticks */
function CandlesIcon({ className }) {
  return (
    <IconBase className={className}>
      <line x1="7" y1="3" x2="7" y2="8" />
      <rect x="5" y="8" width="4" height="7" rx="1" />
      <line x1="7" y1="15" x2="7" y2="21" />
      <line x1="17" y1="4" x2="17" y2="9" />
      <rect x="15" y="9" width="4" height="7" rx="1" />
      <line x1="17" y1="16" x2="17" y2="20" />
    </IconBase>
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
