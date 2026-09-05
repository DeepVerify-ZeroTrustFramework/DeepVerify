import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Global fetch interceptor to route /api requests to VITE_API_URL in production
const apiUrl = import.meta.env.VITE_API_URL
if (apiUrl && apiUrl.trim() !== '') {
  const base = apiUrl.trim().replace(/\/+$/, '')
  const originalFetch = window.fetch
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api')) {
      input = `${base}${input}`
    } else if (input instanceof URL && input.pathname.startsWith('/api')) {
      input = new URL(`${base}${input.pathname}${input.search}`)
    } else if (input instanceof Request && input.url.startsWith('/api')) {
      input = new Request(`${base}${input.url}`, input)
    }
    return originalFetch(input, init)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

