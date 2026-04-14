import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import TradePage from './pages/TradePage.jsx'
import TradebookPage from './pages/TradebookPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import useAuth from './hooks/useAuth.js'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

const router = createBrowserRouter([
  { path: '/login',     element: <LoginPage /> },
  { path: '/',          element: <ProtectedRoute><App /></ProtectedRoute> },
  { path: '/trade',     element: <ProtectedRoute><TradePage /></ProtectedRoute> },
  { path: '/tradebook', element: <ProtectedRoute><TradebookPage /></ProtectedRoute> },
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
