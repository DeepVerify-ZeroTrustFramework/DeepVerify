import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Smooth page transitions for every route change (home → page, page → home, …).
 * The app-wide background stays still while the new page fades in over it.
 * Only the wrapper's opacity is animated — no remounting, no change to routing —
 * and opacity (unlike transform/filter) keeps fixed-position navbars in place.
 * New pages start at the top, so you never land half-way down a page.
 */
export default function RouteTransition({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  const first = useRef(true)

  useLayoutEffect(() => {
    if (first.current) { first.current = false; return }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    const el = ref.current
    if (!el || typeof el.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' })
  }, [pathname])

  return <div ref={ref}>{children}</div>
}
