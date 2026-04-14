import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import useAuth from '../hooks/useAuth'

export default function LoginPage() {
  const navigate         = useNavigate()
  const { user, loading } = useAuth()

  const [mode,     setMode]     = useState('signin')  // 'signin' | 'signup'
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(null)
  const [busy,     setBusy]     = useState(false)

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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Branding */}
        <div className="text-center mb-8">
          <div className="text-white font-bold text-3xl tracking-tight">Luo Capital</div>
          <div className="text-gray-500 text-sm mt-1">Options Screener</div>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg px-6 py-8">
          <div className="text-gray-300 text-sm font-semibold mb-6">
            {mode === 'signin' ? 'Sign in to your account' : 'Create an account'}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-500 font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={busy}
                placeholder="you@example.com"
                className="bg-gray-800 text-gray-100 border border-gray-700 rounded px-3 py-2
                           text-sm placeholder-gray-600
                           focus:outline-none focus:border-indigo-500
                           disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-500 font-medium">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                disabled={busy}
                placeholder="••••••••"
                className="bg-gray-800 text-gray-100 border border-gray-700 rounded px-3 py-2
                           text-sm placeholder-gray-600
                           focus:outline-none focus:border-indigo-500
                           disabled:opacity-50"
              />
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-950/40 border border-red-800/50 rounded px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700
                         disabled:text-gray-500 text-white text-sm font-semibold rounded
                         transition-colors disabled:cursor-not-allowed"
            >
              {busy
                ? (mode === 'signin' ? 'Signing in…' : 'Creating account…')
                : (mode === 'signin' ? 'Sign In' : 'Create Account')}
            </button>
          </form>

          {/* Toggle signin/signup */}
          <div className="mt-5 text-center text-xs text-gray-600">
            {mode === 'signin' ? (
              <>
                Don't have an account?{' '}
                <button
                  onClick={() => { setMode('signup'); setError(null) }}
                  className="text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  onClick={() => { setMode('signin'); setError(null) }}
                  className="text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
