import { useEffect, useRef } from 'react'

/** Thin maroon reading-progress line pinned to the top of the viewport. */
export default function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? window.scrollY / max : 0
      if (ref.current) ref.current.style.transform = `scaleX(${p})`
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf) }
  }, [])
  return (
    <div aria-hidden="true" className="fixed top-0 left-0 right-0 h-[3px] z-[60] pointer-events-none">
      <div ref={ref} className="h-full origin-left bg-gradient-to-r from-[#B01848] to-[#5E0921]" style={{ transform: 'scaleX(0)' }} />
    </div>
  )
}
