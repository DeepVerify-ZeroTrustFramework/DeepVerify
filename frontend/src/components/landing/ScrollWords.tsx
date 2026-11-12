import { useEffect, useRef, useState } from 'react'

const TEXT = 'DeepVerify is a zero-trust layer for live interviews. Instead of guessing whether a face looks real, it measures what a real camera, a beating heart and a genuine video stream physically produce — and flags the moment they stop adding up.'
const ACCENT = new Set(['zero-trust', 'camera,', 'heart', 'stream'])

/** Large statement whose words light up one by one as you scroll through it. */
export default function ScrollWords() {
  const ref = useRef<HTMLElement>(null)
  const words = TEXT.split(' ')
  const [lit, setLit] = useState(0)

  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const total = r.height - window.innerHeight
      const p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 1
      setLit(Math.round(p * 1.15 * words.length))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf) }
  }, [words.length])

  return (
    <section ref={ref} className="relative z-10 h-[190vh]">
      <div className="sticky top-0 h-[100svh] flex items-center">
        <div className="max-w-[1000px] mx-auto px-6">
          <p className="glass-label !text-[#A4123F] mb-6">What is DeepVerify</p>
          <p className="text-[clamp(28px,4.2vw,54px)] font-bold leading-[1.15] tracking-[-0.035em]">
            {words.map((w, i) => (
              <span
                key={i}
                className={`scroll-word ${i < lit ? 'is-lit' : ''} ${ACCENT.has(w) ? 'is-accent' : ''}`}
              >
                {w}{' '}
              </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  )
}
