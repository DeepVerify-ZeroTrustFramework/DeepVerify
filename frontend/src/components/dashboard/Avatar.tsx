import { useEffect, useState } from 'react'

/** Photo avatar with a clean initials fallback when there's no photo or it fails to load. */
export default function Avatar({ src, name, size = 44, rounded = 14, ring = false, className = '' }: {
  src?: string | null; name?: string | null; size?: number; rounded?: number; ring?: boolean; className?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  const initials = (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
  const style = { width: size, height: size, borderRadius: rounded }
  const ringCls = ring ? 'ring-2 ring-[#1A6B3C]/50 ring-offset-2 ring-offset-white/60' : ''
  if (src && !failed) {
    return <img src={src} alt={name || ''} onError={() => setFailed(true)} style={style}
      className={`object-cover shrink-0 shadow-[0_6px_16px_-8px_rgba(20,14,18,0.4)] ${ringCls} ${className}`} />
  }
  return (
    <span style={{ ...style, fontSize: Math.round(size * 0.36) }}
      className={`shrink-0 inline-flex items-center justify-center font-semibold text-white bg-gradient-to-br from-[#B01848] to-[#5E0921] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_6px_16px_-8px_rgba(94,9,33,0.6)] ${ringCls} ${className}`}>
      {initials}
    </span>
  )
}
