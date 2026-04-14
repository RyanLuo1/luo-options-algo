import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import TradePage from './pages/TradePage.jsx'
import TradebookPage from './pages/TradebookPage.jsx'

const router = createBrowserRouter([
  { path: '/',          element: <App /> },
  { path: '/trade',     element: <TradePage /> },
  { path: '/tradebook', element: <TradebookPage /> },
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
