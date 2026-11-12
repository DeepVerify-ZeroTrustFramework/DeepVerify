import { useEffect, useState } from 'react'

export type PhotoStatus = 'none' | 'loading' | 'ok' | 'broken'

/**
 * Reports whether a saved photo URL actually loads, rather than just existing.
 * Used for the identity-photo readiness check and the "enrolled" badge.
 */
export function usePhotoStatus(src?: string | null): PhotoStatus {
  const [status, setStatus] = useState<PhotoStatus>(src ? 'loading' : 'none')
  useEffect(() => {
    if (!src) { setStatus('none'); return }
    let alive = true
    setStatus('loading')
    const img = new Image()
    img.onload = () => { if (alive) setStatus(img.naturalWidth > 0 ? 'ok' : 'broken') }
    img.onerror = () => { if (alive) setStatus('broken') }
    img.src = src
    return () => { alive = false; img.onload = null; img.onerror = null }
  }, [src])
  return status
}
