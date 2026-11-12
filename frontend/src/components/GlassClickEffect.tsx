import { useEffect } from 'react'

const TARGETS = 'button, a[href], [role="button"], input[type="submit"], input[type="button"], summary, label[for]'

/**
 * Site-wide liquid-glass press feedback.
 * On pointer-down over any button/link it renders a frosted ripple in a separate
 * fixed overlay clipped to the element's shape, plus a tiny additive "squish".
 * It never edits the element's own classes, styles or handlers, so it cannot change
 * behaviour or layout. Disabled controls and reduced-motion users are skipped.
 */
export default function GlassClickEffect() {
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const el = (e.target as Element | null)?.closest?.(TARGETS) as HTMLElement | null
      if (!el) return
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return

      const rect = el.getBoundingClientRect()
      if (rect.width < 4 || rect.height < 4) return
      const cs = getComputedStyle(el)

      // Overlay host, clipped to the control's rounded shape
      const host = document.createElement('span')
      host.className = 'glass-ripple-host'
      host.style.left = rect.left + 'px'
      host.style.top = rect.top + 'px'
      host.style.width = rect.width + 'px'
      host.style.height = rect.height + 'px'
      host.style.borderRadius = cs.borderRadius

      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const r = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) * 2
      const ripple = document.createElement('span')
      ripple.className = 'glass-ripple'
      ripple.style.left = x + 'px'
      ripple.style.top = y + 'px'
      ripple.style.width = r + 'px'
      ripple.style.height = r + 'px'

      const glint = document.createElement('span')
      glint.className = 'glass-glint'

      host.appendChild(glint)
      host.appendChild(ripple)
      document.body.appendChild(host)
      window.setTimeout(() => host.remove(), 750)

      // Additive squish — composes with any transform the element already has
      if (rect.width < 640 && typeof el.animate === 'function') {
        try {
          el.animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(0.965)' }, { transform: 'scale(1.01)' }, { transform: 'scale(1)' }],
            { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)', composite: 'add' } as KeyframeAnimationOptions,
          )
        } catch { /* older browsers without composite: skip squish */ }
      }
    }

    document.addEventListener('pointerdown', onDown, { passive: true, capture: true })
    return () => document.removeEventListener('pointerdown', onDown, { capture: true } as EventListenerOptions)
  }, [])

  return null
}
