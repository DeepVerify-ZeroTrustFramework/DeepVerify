import { useEffect, useRef, useState, type ReactNode } from 'react'

type Variant = 'up' | 'scale' | 'left' | 'right' | 'fade'

/** Reveals its children (rise + un-blur + fade) the first time they scroll into view. */
export default function Reveal({ children, className = '', delay = 0, variant = 'up' }: {
  children: ReactNode; className?: string; delay?: number; variant?: Variant
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!('IntersectionObserver' in window)) { setShown(true); return }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); io.disconnect() }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`reveal reveal-${variant} ${shown ? 'is-in' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}
