/**
 * Utility to resolve WebSocket and API URLs across local dev and deployed environments (Vercel / Render).
 */

export function getWsUrl(endpoint: string): string {
  const envWs = import.meta.env.VITE_WS_URL
  const cleanPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`

  if (envWs && envWs.trim() !== '') {
    // If user specified full protocol (wss:// or ws://), use it
    let base = envWs.trim().replace(/\/+$/, '')
    if (!base.startsWith('ws://') && !base.startsWith('wss://')) {
      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://'
      base = `${protocol}${base.replace(/^https?:\/\//, '')}`
    }
    return `${base}${cleanPath}`
  }

  // Fallback to current host (for localhost dev via Vite proxy)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${cleanPath}`
}

export function getApiUrl(endpoint: string): string {
  const envApi = import.meta.env.VITE_API_URL
  const cleanPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`

  if (envApi && envApi.trim() !== '') {
    const base = envApi.trim().replace(/\/+$/, '')
    return `${base}${cleanPath}`
  }

  return cleanPath
}
