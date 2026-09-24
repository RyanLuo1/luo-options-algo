import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import TradePage from './pages/TradePage.jsx'
import TradebookPage from './pages/TradebookPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import useAuth from './hooks/useAuth.js'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  // Bounce to /login and say where from, so a successful login lands back here.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return children
}

const router = createBrowserRouter([
  {
    element: <Outlet />,   // one pathless layout route; the app is light-only (the theme path was removed 2026-09-24)
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
