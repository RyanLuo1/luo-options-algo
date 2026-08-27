import { useCallback, useState } from 'react'

// localStorage key shared with the FOUC guard in index.html and ThemeScope in
// main.jsx. Values: 'light' | 'dark'. Dark is the default when nothing is
// stored (or storage is unavailable, e.g. private mode).
const STORAGE_KEY = 'luo-theme'

export function readStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/**
 * useTheme() → { theme, toggle }
 *
 * Applies/removes the `dark` class on <html> and persists the choice.
 * Currently only surfaced on /login (via ThemeToggle) — every other route is
 * force-dark by ThemeScope in main.jsx until the app-wide light pass ships.
 */
export default function useTheme() {
  const [theme, setTheme] = useState(readStoredTheme)

  const apply = useCallback(next => {
    document.documentElement.classList.toggle('dark', next !== 'light')
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage unavailable — theme still applies for this page view */
    }
    setTheme(next)
  }, [])

  const toggle = useCallback(() => {
    apply(theme === 'dark' ? 'light' : 'dark')
  }, [theme, apply])

  return { theme, toggle }
}
