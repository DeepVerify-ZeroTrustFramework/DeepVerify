import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Play } from 'lucide-react'

/* Instrument read-outs placed around the wordmark (desktop only) */
const READOUTS = [
  { k: 'PRNU', v: 'PCE 412', s: 'Sensor fingerprint · match', pos: 'left-[6%] top-[27%]', d: 140, delay: 0.9 },
  { k: 'rPPG', v: '74 BPM', s: 'Live pulse · stable', pos: 'right-[6%] top-[23%]', d: 220, delay: 1.05 },
  { k: 'JITTER', v: 'CV 0.06', s: 'Frame timing · real camera', pos: 'left-[9%] bottom-[19%]', d: 260, delay: 1.2 },
  { k: 'TRUST', v: '87 / 100', s: 'Fused score · verified', pos: 'right-[9%] bottom-[22%]', d: 180, delay: 1.35 },
]

/** Full-screen opening: wordmark + slogan over a precision "aperture", dissolving on scroll. */
export default function Intro() {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const p = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.85)))
      el.style.setProperty('--p', p.toFixed(4))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [])

  return (
    <section ref={ref} className="intro relative z-10 h-[100svh] min-h-[700px] flex items-center justify-center overflow-hidden">
      {/* Measurement surface: fading dot grid + soft key light + hairline horizon */}
      <div className="intro-grid absolute inset-0" aria-hidden="true" />
      <div className="intro-glow absolute left-1/2 top-1/2 w-[min(90vw,1100px)] h-[520px]" aria-hidden="true" />
      <div className="intro-horizon absolute left-0 right-0 top-1/2" aria-hidden="true" />

      {/* Read-outs */}
      {READOUTS.map(r => (
        <div key={r.k} className={`intro-readout hidden xl:block absolute ${r.pos}`} style={{ ['--d' as string]: r.d } as React.CSSProperties} aria-hidden="true">
          <div className="intro-fade w-[200px] px-4 py-3 rounded-[14px] glass" style={{ animationDelay: `${r.delay}s` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-[10px] tracking-[0.16em] text-[#85818A]">{r.k}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#1A6B3C] live-dot" />
            </div>
            <p className="font-mono text-[19px] font-semibold text-[#141114] leading-none mb-1.5 tabular-nums">{r.v}</p>
            <p className="text-[11px] text-[#85818A]">{r.s}</p>
          </div>
        </div>
      ))}

      {/* Wordmark + slogan */}
      <div className="intro-stage relative text-center px-6">
        <div className="intro-fade flex items-center justify-center gap-3 mb-8" style={{ animationDelay: '0.1s' }}>
          <span className="h-px w-10 bg-[#141114]/20" />
          <span className="glass-label">Zero-trust interview integrity</span>
          <span className="h-px w-10 bg-[#141114]/20" />
        </div>
        <h1 className="intro-word font-bold leading-[0.9] tracking-[-0.055em] text-[clamp(64px,11.5vw,176px)]">
          <span className="text-[#141114]">Deep</span><span className="intro-verify">Verify</span>
        </h1>
        <p className="intro-fade mt-7 text-[clamp(20px,2.1vw,28px)] font-semibold text-[#141114] tracking-[-0.02em]" style={{ animationDelay: '0.45s' }}>
          Interviews you can actually trust.
        </p>
        <p className="intro-fade mt-3 mx-auto max-w-[540px] text-[15px] text-[#67636C] leading-relaxed" style={{ animationDelay: '0.6s' }}>
          Real-time deepfake and proxy detection, verified by camera physics, a live pulse and real frame timing.
        </p>
        <div className="intro-fade mt-9 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: '0.75s' }}>
          <Link to="/demo" className="glass-btn-primary px-6 py-3 text-[14px] !rounded-full">
            <Play size={15} className="ml-0.5" /> Try the live demo
          </Link>
          <a href="#how-it-works" className="glass-btn px-6 py-3 text-[14px] !rounded-full">
            How it works <ArrowRight size={15} />
          </a>
        </div>
        <div className="intro-fade mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[10.5px] tracking-[0.18em] text-[#85818A]" style={{ animationDelay: '0.9s' }}>
          <span>PRNU</span><span className="w-px h-3 bg-[#141114]/15" />
          <span>rPPG</span><span className="w-px h-3 bg-[#141114]/15" />
          <span>JITTER</span><span className="w-px h-3 bg-[#141114]/15" />
          <span>BEHAVIORAL</span>
        </div>
      </div>

      {/* Scroll cue */}
      <div className="intro-cue absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3" aria-hidden="true">
        <span className="glass-label !text-[9.5px]">Scroll</span>
        <span className="relative block w-px h-10 bg-[#141114]/12 overflow-hidden">
          <span className="absolute left-0 top-0 w-px h-4 bg-[#A4123F] scroll-line" />
        </span>
      </div>
    </section>
  )
}
