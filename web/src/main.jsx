import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import TradePage from './pages/TradePage.jsx'
import TradebookPage from './pages/TradebookPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import useAuth from './hooks/useAuth.js'
import { readStoredTheme } from './hooks/useTheme.js'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  // Bounce to /login and say where from, so a successful login lands back here.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return children
}

// ThemeScope — route-scoped theming (pathless layout route wrapping all pages).
// /login honors the stored 'luo-theme' preference; every OTHER route force-adds
// the `dark` class WITHOUT overwriting the stored preference, so the app can
// never appear light outside /login. Remove the force-dark branch when
// app-wide light mode ships.
function ThemeScope() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (pathname === '/login') {
      document.documentElement.classList.toggle('dark', readStoredTheme() !== 'light')
    } else {
      document.documentElement.classList.add('dark')
    }
  }, [pathname])
  return <Outlet />
}

const router = createBrowserRouter([
  {
    element: <ThemeScope />,
    children: [
      { path: '/login',     element: <LoginPage /> },
      { path: '/app',       element: <ProtectedRoute><App /></ProtectedRoute> },
      { path: '/trade',     element: <ProtectedRoute><TradePage /></ProtectedRoute> },
      { path: '/tradebook', element: <ProtectedRoute><TradebookPage /></ProtectedRoute> },
      // Removed surfaces (product decision 2026-09-22): the old paths land on the screener.
      { path: '/picks',       element: <Navigate to="/app" replace /> },
      { path: '/performance', element: <Navigate to="/app" replace /> },
    ],
  },
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
