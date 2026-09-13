import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import '../index.css'
import { supabase } from '../lib/supabase'
import useAuth from '../hooks/useAuth'
import { Mark } from '../components/lc/AppShell'
import { Button } from '../components/lc/ui'
import { INPUT_CLASS } from '../components/lc/format'

// ── /login — the seam between the landing page and the app ──────────────────
// One card, four states of it: Log in · Create account (a shared form with a
// mode control) · Reset your password (email only) · Set a new password (the
// recovery link lands here). Auth calls are the existing signInWithPassword /
// signUp plus resetPasswordForEmail and updateUser for the reset flow. Every
// error is rewritten in the product's register (problem + recovery); no
// Supabase message is shown verbatim.

// The recovery link's tokens arrive in the URL hash. supabase-js consumes and
// strips them asynchronously after the client initialises, so read the hash at
// module evaluation (synchronous, before any of that) to know we're in recovery.
const INITIAL_HASH = typeof window !== 'undefined' ? window.location.hash : ''
const hashParams = new URLSearchParams(INITIAL_HASH.replace(/^#/, ''))
const ARRIVED_IN_RECOVERY = hashParams.get('type') === 'recovery'
const LINK_ERROR = !!(hashParams.get('error_code') || hashParams.get('error'))

const PASSWORD_MIN = 6                                // Supabase's configured rule (length only)
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RETURNABLE = /^\/(app|trade|tradebook)(\/|\?|$)/  // only routes the guard protects
const FIELD = INPUT_CLASS.replace('h-11', 'h-12') + ' text-[1rem]'   // 48px + 16px type: no iOS zoom
const MODES = ['signin', 'signup', 'reset']           // modes the URL may open (`?mode=`); recovery comes from the hash only
const TITLES = { signin: 'Log in', signup: 'Create account', reset: 'Reset your password', recovery: 'Set a new password' }
const LINK = 'inline-flex items-center min-h-[44px] -my-2.5 text-[0.9rem] font-semibold text-lc-violet hover:underline'   // 44px hit area, no extra layout

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { user, loading } = useAuth()
  const [loggedOut] = useState(() => { try { const v = sessionStorage.getItem('luo-logged-out'); sessionStorage.removeItem('luo-logged-out'); return !!v } catch { return false } })
  const from = loggedOut || location.state?.loggedOut ? null : location.state?.from
  const returnTo = typeof from === 'string' && RETURNABLE.test(from) ? from : '/app'
  // The hash belongs to the initial page load only (router key 'default'); an in-app
  // navigation back here (e.g. after logging out) must not reopen the recovery state.
  const firstLoad = location.key === 'default'
  const arrivedInRecovery = ARRIVED_IN_RECOVERY && firstLoad
  const linkError = LINK_ERROR && !ARRIVED_IN_RECOVERY && firstLoad

  // 'signin' | 'signup' | 'reset' | 'recovery'
  const [mode, setMode] = useState(() => {
    if (arrivedInRecovery) return 'recovery'
    if (linkError) return 'reset'                     // an expired link puts the visitor straight onto the reset form
    const q = searchParams.get('mode')
    return MODES.includes(q) ? q : 'signin'
  })
  // Holds the logged-in redirect: while a new password is being set, or so an expired-link message is read.
  const [recovery, setRecovery] = useState(arrivedInRecovery || linkError)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)             // reset email sent (this visit)
  const [strip, setStrip] = useState(() => (linkError ? { tone: 'error', text: 'That reset link has expired. Enter your email and we’ll send a new one.', focus: 'email', mark: false } : null))   // { tone, text, action?, focus? }
  const emailRef = useRef(null), passwordRef = useRef(null), tabsRef = useRef(null)

  // A second signal for recovery, in case the hash was consumed before this module evaluated.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') { setRecovery(true); setMode('recovery') }
      if (event === 'SIGNED_OUT') setRecovery(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Already signed in (and not mid-recovery): straight back to where they were going.
  useEffect(() => {
    if (!loading && user && !recovery) navigate(returnTo, { replace: true })
  }, [user, loading, recovery, navigate, returnTo])

  // Focus lands on the first field when a card state appears (load, reset, recovery) —
  // not on a Log in ↔ Create account switch, which keeps focus where it is.
  const formKind = mode === 'signin' || mode === 'signup' ? 'form' : mode
  useEffect(() => {
    if (loading) return
    const el = formKind === 'recovery' ? passwordRef.current : emailRef.current
    el?.focus({ preventScroll: true })
  }, [formKind, loading])

  // After an error, focus the offending field — once the form is enabled again.
  useEffect(() => {
    if (!strip?.focus || busy) return
    const el = strip.focus === 'password' ? passwordRef.current : emailRef.current
    el?.focus({ preventScroll: true })
  }, [strip, busy])

  useEffect(() => { document.title = `${TITLES[mode]} · Luo Capital`; return () => { document.title = 'Luo Capital' } }, [mode])

  function switchMode(next) {
    setMode(next); setStrip(null); setShowPw(false); setSent(false)
    if (next !== 'recovery') setPassword('')
  }
  function switchTab(next) {
    switchMode(next)
    // keep focus on the tab strip (ARIA tabs): the newly active tab becomes focusable
    setTimeout(() => tabsRef.current?.querySelector('[aria-selected="true"]')?.focus(), 0)
  }
  function fail(next) { setStrip(next) }
  function act(action) {
    if (action.mode) {
      switchMode(action.mode)
      // the strip (and its button) unmounts: put focus where the new state needs it
      setTimeout(() => (action.mode === 'reset' ? emailRef.current : email ? passwordRef.current : emailRef.current)?.focus({ preventScroll: true }), 0)
    } else if (action.retry) submit()
  }

  async function submit(e) {
    e?.preventDefault?.()
    if (busy) return
    setStrip(null)
    const em = email.trim()

    // Client-side, shared across modes. Same strip as server errors.
    if (mode !== 'recovery' && !EMAIL_SHAPE.test(em)) return fail({ tone: 'error', text: 'That doesn’t look like an email address.', focus: 'email' })
    if (mode !== 'reset' && !password) return fail({ tone: 'error', text: mode === 'signin' ? 'Enter your password.' : 'Choose a password.', focus: 'password' })
    if ((mode === 'signup' || mode === 'recovery') && password.length < PASSWORD_MIN) return fail({ tone: 'error', text: `Passwords need at least ${PASSWORD_MIN} characters.`, focus: 'password' })

    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: em, password })
        if (error) return fail(describe(error, mode))
        setRecovery(false)
        navigate(returnTo, { replace: true })
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: em, password })
        if (error) return fail(describe(error, mode))
        // With confirmations on, Supabase answers an existing email with a user that has no identities (no error, to prevent enumeration).
        if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return fail(EXISTS)
        if (data?.session) { navigate(returnTo, { replace: true }); return }
        // No session → email confirmation is on: don't log in, say what to do.
        setMode('signin'); setPassword('')
        setStrip({ tone: 'notice', text: `Confirm your email first — the link is in ${em}’s inbox — then log in.` })
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: `${window.location.origin}/login` })
        if (error) return fail(describe(error, mode))
        setSent(true)
        setStrip({ tone: 'notice', text: `Check ${em} for a reset link. If nothing arrives, there may be no account under that address — create one instead.`, action: { label: 'Create account', mode: 'signup' } })
      } else if (mode === 'recovery') {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) return fail(describe(error, mode))
        setRecovery(false)
        navigate('/app', { replace: true })
      }
    } catch (err) {
      fail(describe(err, mode))
    } finally {
      setBusy(false)
    }
  }

  const isForm = mode === 'signin' || mode === 'signup'
  const primaryLabel = sent ? 'Link sent' : { signin: 'Log in', signup: 'Create account', reset: 'Send reset link', recovery: 'Set password' }[mode]
  const busyLabel = { signin: 'Logging in…', signup: 'Creating account…', reset: 'Sending…', recovery: 'Saving…' }[mode]
  const invalid = strip?.tone === 'error' && strip.mark !== false ? strip.focus : null   // which field the error belongs to
  const context = isForm && from ? bounceLine(from, mode) : null

  return (
    <div className="lc min-h-screen flex flex-col">
      {/* Wordmark: the app shell's header row (same padding, same 52px row, same size), so it holds still across /login → /app. */}
      <header className="shrink-0 px-6 pt-5">
        <div className="mx-auto max-w-[1400px] h-[52px] flex items-center">
          <a href="/" className="inline-flex items-center gap-2.5 text-lc-ink font-display font-bold text-[1.15rem] tracking-[-0.01em] whitespace-nowrap" aria-label="Luo Capital home">
            <Mark />
            Luo Capital
          </a>
        </div>
      </header>

      {/* Centered on tall viewports; hugs the top on short ones so the phone keyboard never covers the card's actions. */}
      <main className="flex-1 flex items-center [@media(max-height:720px)]:items-start justify-center px-4 pt-6 pb-12">
        {loading ? null : (
          <section className="lc-card-in w-full max-w-[26rem] bg-lc-card rounded-lc shadow-lc p-8 max-[480px]:p-6 flex flex-col gap-5" aria-labelledby="auth-title">
            {isForm ? (
              <div ref={tabsRef} role="tablist" aria-label="Log in or create an account" className="flex p-1.5 bg-lc-ground-deep/60 rounded-lc-plus"
                onKeyDown={e => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; e.preventDefault(); switchTab(mode === 'signin' ? 'signup' : 'signin') }}>
                {[['signin', 'Log in'], ['signup', 'Create account']].map(([id, label]) => {
                  const active = mode === id
                  return (
                    <button key={id} type="button" role="tab" id={active ? 'auth-title' : `tab-${id}`} aria-selected={active} aria-controls="auth-form" tabIndex={active ? 0 : -1}
                      disabled={busy} onClick={() => switchMode(id)}
                      className={`flex-1 h-10 rounded-lc-half font-display font-bold text-[1rem] whitespace-nowrap transition-colors ${active ? 'bg-lc-card text-lc-ink shadow-lc' : 'text-lc-ink-2 hover:text-lc-ink'}`}>
                      {label}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {!(mode === 'reset' && sent) && <button type="button" onClick={() => switchMode('signin')} className={`${LINK} self-start`}>← Back to log in</button>}
                <h1 id="auth-title" className="font-display font-bold text-[1.3rem] leading-[1.05] tracking-[-0.01em] text-lc-ink">{TITLES[mode]}</h1>
                {mode === 'reset' && !sent && <p className="text-[0.95rem] text-lc-ink-2 leading-[1.5]">We’ll email you a link that brings you back here to choose a new password.</p>}
              </div>
            )}

            {context && <p className="text-[0.9rem] text-lc-ink-2 leading-[1.5] -mt-1">{context}</p>}

            <form id="auth-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
              <fieldset disabled={busy || sent} className="contents min-w-0">
                {mode !== 'recovery' && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="auth-email" className="text-[0.8rem] font-semibold tracking-[0.01em] text-lc-ink-2 leading-[1.6]">Email</label>
                    <input ref={emailRef} id="auth-email" type="email" name="email" autoComplete="email" inputMode="email" spellCheck={false} autoCapitalize="none"
                      aria-invalid={invalid === 'email' || undefined} aria-describedby={invalid === 'email' ? 'auth-strip' : undefined}
                      value={email} onChange={e => setEmail(e.target.value)} className={`${FIELD} ${invalid === 'email' ? 'border-lc-loss' : ''}`} placeholder="you@example.com" />
                  </div>
                )}
                {mode !== 'reset' && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="auth-password" className="text-[0.8rem] font-semibold tracking-[0.01em] text-lc-ink-2 leading-[1.6]">{mode === 'recovery' ? 'New password' : 'Password'}</label>
                    <div className="relative">
                      <input ref={passwordRef} id="auth-password" type={showPw ? 'text' : 'password'} name="password"
                        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                        aria-invalid={invalid === 'password' || undefined} aria-describedby={invalid === 'password' ? 'auth-strip' : undefined}
                        value={password} onChange={e => setPassword(e.target.value)} className={`${FIELD} pr-20 ${invalid === 'password' ? 'border-lc-loss' : ''}`} />
                      <button type="button" onClick={() => setShowPw(v => !v)} aria-pressed={showPw} aria-label={showPw ? 'Hide password' : 'Show password'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-11 min-w-[44px] px-3 rounded-lc-half text-[0.85rem] font-semibold text-lc-violet hover:bg-lc-violet-soft">
                        {showPw ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {(mode === 'signup' || mode === 'recovery') && !/^Passwords need/.test(strip?.text || '') && <span className="text-[0.8rem] text-lc-ink-2 leading-[1.45]">At least {PASSWORD_MIN} characters.</span>}
                  </div>
                )}
              </fieldset>

              {strip && <Strip {...strip} onAction={act} />}

              <Button type="submit" variant="primary" size="md" disabled={sent} aria-busy={busy || undefined} aria-disabled={busy || undefined}
                className={`w-full h-12 text-[1rem] mt-1 ${busy ? 'pointer-events-none' : ''}`}>
                {busy ? busyLabel : primaryLabel}
              </Button>

              {mode === 'signin' && <button type="button" onClick={() => switchMode('reset')} className={`${LINK} self-center`}>Forgot password?</button>}
              {mode === 'reset' && sent && <button type="button" onClick={() => switchMode('signin')} className={`${LINK} self-center`}>Back to log in</button>}
              {mode === 'signup' && (
                <p className="text-center text-[0.9rem] text-lc-ink-2 leading-[1.5]">Free account. The screener and tradebook are yours — no card, no trial clock.</p>
              )}
            </form>
          </section>
        )}
      </main>
    </div>
  )
}

// The shared strip: problem + recovery, an inline action when the recovery is a mode switch or a retry.
function Strip({ tone, text, action, onAction }) {
  const error = tone === 'error'
  return (
    <div id="auth-strip" role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}
      className={`rounded-lc-plus px-4 py-3 text-[0.9rem] leading-[1.5] ${error ? 'bg-lc-loss-tint text-lc-loss-ink' : 'bg-lc-violet-soft text-lc-ink'}`}>
      <span className={error ? 'font-semibold' : ''}>{text}</span>
      {action && (
        <>
          {' '}
          <button type="button" onClick={() => onAction(action)} className={`inline-flex items-center min-h-[44px] -my-2.5 font-bold underline underline-offset-2 ${error ? 'text-lc-loss-ink' : 'text-lc-violet'}`}>{action.label}</button>
        </>
      )}
    </div>
  )
}

function bounceLine(from, mode) {
  const place = /^\/tradebook/.test(from) ? 'your tradebook' : /^\/trade/.test(from) ? 'the trade editor' : 'the screener'
  return mode === 'signup' ? `Create an account to open ${place}.` : `Log in to open ${place}.`
}

const EXISTS = { tone: 'error', text: 'An account already exists for that email.', action: { label: 'Log in instead', mode: 'signin' }, focus: 'email' }
const EXPIRED = { tone: 'error', text: 'That reset link has expired.', action: { label: 'Request a new one', mode: 'reset' } }

// Supabase errors → the product's register. Never the message verbatim.
function describe(err, mode) {
  const code = err?.code || err?.error_code || ''
  const msg = String(err?.message || '')
  const network = err instanceof TypeError || /failed to fetch|network|load failed/i.test(msg)
  if (network) return { tone: 'error', text: 'Couldn’t reach the sign-in service. Check your connection and try again.', action: { label: 'Try again', retry: true } }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
    return { tone: 'error', text: 'That email and password don’t match. Check the password, or create an account if you don’t have one yet.', action: { label: 'Create account', mode: 'signup' }, focus: 'password' }
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) {
    return { tone: 'notice', text: 'Confirm your email first — the link is in your inbox — then log in.' }
  }
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered|already exists/i.test(msg)) return EXISTS
  if (code === 'weak_password' || /at least \d+ characters|password should/i.test(msg)) {
    return { tone: 'error', text: `Passwords need at least ${PASSWORD_MIN} characters.`, focus: 'password' }
  }
  if (code === 'same_password') return { tone: 'error', text: 'That’s already your password. Choose a different one.', focus: 'password' }
  if (/rate.?limit|too many requests/i.test(code + ' ' + msg)) return { tone: 'error', text: 'Too many attempts. Wait a minute and try again.' }
  if (code === 'otp_expired' || /expired|invalid.*link/i.test(msg)) return EXPIRED
  if (mode === 'recovery' && /session|auth session missing/i.test(msg)) return EXPIRED
  return { tone: 'error', text: 'Something went wrong on our side. Try again in a moment.', action: { label: 'Try again', retry: true } }
}
