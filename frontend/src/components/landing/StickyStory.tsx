import { useEffect, useId, useRef, useState } from 'react'
import { Fingerprint, HeartPulse, Timer, ShieldCheck } from 'lucide-react'

const STEPS = [
  {
    icon: Fingerprint, tag: 'Layer 1 · Identity', title: 'The camera signs every frame.',
    body: 'Every image sensor has microscopic manufacturing flaws that leave a fixed noise pattern in each frame. DeepVerify enrols that fingerprint during the system check, then keeps matching the live stream against it. A virtual camera, a replayed clip or a deepfake pipeline does not carry it.',
    chips: ['PRNU', 'Wavelet residual', 'PCE match'], stat: 'PCE 412', statSub: 'fingerprint match',
  },
  {
    icon: HeartPulse, tag: 'Layer 2 · Biology', title: 'A real face has a pulse.',
    body: 'Each heartbeat changes the colour of skin by a fraction of a percent. Tracking the forehead and cheeks, DeepVerify recovers that pulse from ordinary webcam video — proof there is a living person in front of the lens.',
    chips: ['rPPG', 'POS method', 'Skin patches'], stat: '74 bpm', statSub: 'live pulse',
  },
  {
    icon: Timer, tag: 'Layer 3 · Timing', title: 'Real cameras keep imperfect time.',
    body: 'Hardware delivers frames with a tiny, natural irregularity. Injected and re-rendered streams arrive too evenly — or wrongly uneven. DeepVerify measures the gap between every frame the browser receives.',
    chips: ['Jitter', 'Frame intervals', 'Local-median CV'], stat: 'CV 0.06', statSub: 'real camera',
  },
  {
    icon: ShieldCheck, tag: 'Fusion', title: 'One score the recruiter can act on.',
    body: 'The signals are weighted and fused with behavioural telemetry into a single 0–100 trust score. It only drops sharply when independent signals agree — so one noisy reading never accuses an honest candidate.',
    chips: ['PRNU 30', 'rPPG 30', 'Jitter 15', 'Behavior 25'], stat: '87', statSub: 'trust score',
  },
]

function Frame({ step }: { step: number }) {
  const uid = useId().replace(/:/g, '')
  const glow = `faceGlow-${uid}`, grain = `grain-${uid}`
  return (
    <div className="relative w-full aspect-[4/5] max-h-[72vh] rounded-[32px] glass-strong liquid p-4">
      <div className="relative w-full h-full rounded-[24px] glass-dark overflow-hidden">
        {/* Camera HUD */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-20">
          <span className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.14em] uppercase text-white/70">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F43F5E] animate-pulse-glow" /> Live · 30 fps
          </span>
          <span className="text-[10.5px] font-mono text-white/50">CAM-01</span>
        </div>
        {/* Corner brackets */}
        {['top-10 left-6 border-l border-t', 'top-10 right-6 border-r border-t', 'bottom-6 left-6 border-l border-b', 'bottom-6 right-6 border-r border-b'].map(c => (
          <span key={c} className={`absolute w-6 h-6 border-white/30 ${c} z-20`} />
        ))}

        {/* Abstract face */}
        <svg viewBox="0 0 200 250" className="absolute inset-0 w-full h-full" aria-hidden="true">
          <defs>
            <radialGradient id={glow} cx="50%" cy="40%" r="50%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.07)" />
              <stop offset="100%" stopColor="rgba(249,201,213,0)" />
            </radialGradient>
            <filter id={grain}><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="7" /><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0" /></filter>
          </defs>
          <rect width="200" height="250" fill={`url(#${glow})`} />
          <ellipse cx="100" cy="105" rx="44" ry="56" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          <path d="M30 250 C 38 190, 70 172, 100 172 C 130 172, 162 190, 170 250" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
          {/* PRNU: sensor noise grain + grid */}
          <g className={`story-layer ${step === 0 ? 'on' : ''}`}>
            <rect width="200" height="250" filter={`url(#${grain})`} opacity="0.22" />
            {Array.from({ length: 9 }).map((_, i) => <line key={'v' + i} x1={20 + i * 20} y1="0" x2={20 + i * 20} y2="250" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />)}
            {Array.from({ length: 11 }).map((_, i) => <line key={'h' + i} x1="0" y1={20 + i * 22} x2="200" y2={20 + i * 22} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />)}
            <rect x="60" y="80" width="80" height="60" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="0.8" strokeDasharray="3 3" className="story-scan" />
          </g>
          {/* rPPG: skin patches */}
          <g className={`story-layer ${step === 1 ? 'on' : ''}`}>
            {[[100, 74, 16], [78, 118, 11], [122, 118, 11]].map(([x, y, r], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r={r} fill="rgba(176,24,72,0.45)" className="story-beat" style={{ animationDelay: `${i * 0.05}s` }} />
                <circle cx={x} cy={y} r={r} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="0.8" />
              </g>
            ))}
          </g>
          {/* Fusion ring */}
          <g className={`story-layer ${step === 3 ? 'on' : ''}`}>
            <circle cx="100" cy="105" r="70" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="5" />
            <circle cx="100" cy="105" r="70" fill="none" stroke="#4ADE80" strokeWidth="5" strokeLinecap="round"
              strokeDasharray="440" strokeDashoffset={step === 3 ? 440 - 440 * 0.87 : 440} transform="rotate(-90 100 105)" style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(.2,.8,.2,1)' }} />
          </g>
        </svg>

        {/* rPPG waveform */}
        <div className={`story-layer absolute left-5 right-5 bottom-20 h-12 z-10 ${step === 1 ? 'on' : ''}`}>
          <svg viewBox="0 0 300 40" preserveAspectRatio="none" className="w-full h-full overflow-visible">
            <path className="story-wave" d="M0 22 L30 22 L38 22 L44 8 L50 34 L56 18 L62 22 L100 22 L108 22 L114 8 L120 34 L126 18 L132 22 L170 22 L178 22 L184 8 L190 34 L196 18 L202 22 L240 22 L248 22 L254 8 L260 34 L266 18 L272 22 L300 22"
              fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>

        {/* Jitter bars */}
        <div className={`story-layer absolute left-5 right-5 bottom-20 h-16 z-10 flex items-end gap-[3px] ${step === 2 ? 'on' : ''}`}>
          {Array.from({ length: 36 }).map((_, i) => (
            <span key={i} className="flex-1 rounded-t-[2px] bg-gradient-to-t from-[#8E1036] to-white/50 story-bar"
              style={{ animationDelay: `${(i * 137) % 900}ms`, height: `${45 + ((i * 53) % 40)}%` }} />
          ))}
        </div>

        {/* Readout */}
        <div className="absolute left-4 right-4 bottom-4 z-20 flex items-center justify-between px-4 py-3 rounded-[16px] bg-white/10 border border-white/15 backdrop-blur-md">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/60">{STEPS[step].statSub}</span>
          <span key={step} className="text-[18px] font-bold font-mono text-white story-pop">{STEPS[step].stat}</span>
        </div>
      </div>
    </div>
  )
}

/** Sticky scrollytelling: pinned camera frame on the left, steps scroll past on the right. */
export default function StickyStory() {
  const [step, setStep] = useState(0)
  const refs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.i))
      })
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 })
    refs.current.forEach(el => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <section className="relative z-10 py-10">
      <div className="max-w-[1100px] mx-auto px-6">
        <p className="glass-label !text-[#A4123F] mb-3">How DeepVerify sees a video</p>
        <h2 className="text-[34px] font-bold text-[#141114] tracking-[-0.03em] max-w-xl leading-tight">
          Three layers of physics. One verdict.
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
          {/* Pinned visual */}
          <div className="hidden lg:block">
            <div className="sticky top-[14vh] pt-6">
              <Frame step={step} />
              {/* Step dots */}
              <div className="mt-5 flex items-center justify-center gap-2">
                {STEPS.map((s, i) => (
                  <span key={s.tag} className={`h-1.5 rounded-full transition-all duration-500 ${i === step ? 'w-8 bg-[#A4123F]' : 'w-1.5 bg-[#A4123F]/25'}`} />
                ))}
              </div>
            </div>
          </div>

          {/* Steps */}
          <div>
            {STEPS.map((s, i) => (
              <div
                key={s.tag}
                ref={el => { refs.current[i] = el }}
                data-i={i}
                className="min-h-[78vh] flex items-center"
              >
                <div className={`w-full p-7 rounded-[28px] glass liquid transition-all duration-700 ${i === step ? 'opacity-100 translate-y-0' : 'opacity-40 translate-y-3'}`}>
                  <div className="flex items-center gap-3 mb-5">
                    <span className={i === step ? 'glass-tile-maroon' : 'glass-tile text-[#A4123F]'}><s.icon size={20} /></span>
                    <span className="glass-label">{s.tag}</span>
                  </div>
                  <h3 className="text-[26px] font-bold text-[#141114] tracking-[-0.025em] leading-tight mb-3">{s.title}</h3>
                  <p className="text-[14.5px] text-[#55515A] leading-relaxed mb-5">{s.body}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {s.chips.map(c => <span key={c} className="glass-chip !text-[10.5px] text-[#A4123F]">{c}</span>)}
                  </div>
                  {/* Mobile visual */}
                  <div className="lg:hidden mt-6"><Frame step={i} /></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
