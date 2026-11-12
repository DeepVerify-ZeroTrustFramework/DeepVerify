import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Cpu, HeartPulse, Activity, Eye, ArrowRight, Check, X, Play,
  ScanFace, MonitorPlay, Repeat, UserX, Bot, MonitorSmartphone, GraduationCap, Building2,
  BookOpen, Lock, Laptop, Search, Bell, ChevronDown, Radio, Fingerprint, Timer } from 'lucide-react'
import Navbar from '../components/Navbar'
import Intro from '../components/landing/Intro'
import ScrollWords from '../components/landing/ScrollWords'
import StickyStory from '../components/landing/StickyStory'
import ScrollProgress from '../components/landing/ScrollProgress'
import Reveal from '../components/landing/Reveal'

/* ── Animated trust score counter ─── */
function useCounter(target: number, duration = 1400) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let start = 0
    const step = (ts: number) => {
      if (!start) start = ts
      const progress = Math.min((ts - start) / duration, 1)
      setValue(Math.round(progress * target))
      if (progress < 1) requestAnimationFrame(step)
    }
    const id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [target, duration])
  return value
}

/* ── Mini progress bar ─── */
function MiniBar({ label, value, color, delay = 0 }: { label: string; value: number; color: string; delay?: number }) {
  const [w, setW] = useState(0)
  useEffect(() => { const t = setTimeout(() => setW(value), 200 + delay); return () => clearTimeout(t) }, [value, delay])
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#85818A]">{label}</span>
        <span className={`text-[10px] font-medium`} style={{ color }}>{value}%</span>
      </div>
      <div className="h-[5px] rounded-full bg-white/60 shadow-[inset_0_1px_2px_rgba(122,13,46,0.12)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  )
}

/* ── Feature card ─── */
function FeatureCard({ icon: Icon, iconBg, iconColor, title, desc, weight, layer }: {
  icon: React.ElementType; iconBg: string; iconColor: string;
  title: string; desc: string; weight: string; layer: string
}) {
  return (
    <div className="h-full p-6 rounded-[24px] glass liquid glass-hover group">
      <div className={`glass-tile mb-5 ${iconBg}`}>
        <Icon size={20} className={iconColor} />
      </div>
      <h3 className="text-[16px] font-semibold text-[#141114] mb-1.5 tracking-[-0.01em]">{title}</h3>
      <p className="text-[13px] text-[#67636C] leading-relaxed mb-4">{desc}</p>
      <div className="flex items-center gap-2">
        <span className="glass-chip !text-[10px] text-[#A4123F]">{weight}</span>
        <span className="glass-chip !text-[10px] text-[#67636C]">{layer}</span>
      </div>
    </div>
  )
}

/* ── Comparison row ─── */
function CompRow({ label, dv, others }: { label: string; dv: boolean; others: boolean[] }) {
  return (
    <tr className="border-b border-white/60 last:border-0 hover:bg-white/30 transition-colors">
      <td className="py-3.5 px-5 text-[13px] font-medium text-[#2A262C]">{label}</td>
      {others.map((v, i) => (
        <td key={i} className="py-3.5 px-4 text-center">
          {v ? <Check size={16} className="mx-auto text-[#1A6B3C]" /> : <X size={16} className="mx-auto text-[#C4C1C6]" />}
        </td>
      ))}
      <td className="py-3.5 px-4 text-center bg-[#A4123F]/[0.07]">
        {dv ? <Check size={16} className="mx-auto text-[#A4123F]" /> : <X size={16} className="mx-auto text-[#C4C1C6]" />}
      </td>
    </tr>
  )
}

/* ── "What we catch" marquee ─── */
const CATCH = ['Face-swap deepfakes', 'Virtual cameras (OBS)', 'Replayed recordings', 'Proxy interviewers', 'Hidden AI assistants', 'Second-screen coaching', 'Injected video streams', 'Synthetic faces']
function CatchMarquee() {
  const items = [...CATCH, ...CATCH]
  return (
    <section className="relative z-10 pb-6">
      <div className="max-w-[1100px] mx-auto px-6">
        <Reveal variant="fade"><div className="glass liquid rounded-full py-3 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
          <div className="flex w-max gap-3 animate-marquee">
            {items.map((t, i) => (
              <span key={i} className="glass-chip !text-[12px] !py-1.5 !px-4 text-[#4A464E] whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-[#A4123F]" /> {t}
              </span>
            ))}
          </div>
        </div></Reveal>
      </div>
    </section>
  )
}

/* ── Threat grid ─── */
const THREATS = [
  { icon: ScanFace, title: 'Face-swap deepfakes', desc: 'A real-time face swap still has to come from somewhere — it never carries the enrolled camera’s sensor fingerprint or a consistent live pulse.', by: ['PRNU', 'rPPG'] },
  { icon: MonitorPlay, title: 'Virtual camera injection', desc: 'OBS and virtual-camera feeds replace the physical sensor, so the hardware noise and frame timing stop matching the device that enrolled.', by: ['PRNU', 'Jitter'] },
  { icon: Repeat, title: 'Replayed recordings', desc: 'Pre-recorded clips lose their sensor fingerprint to compression and can’t respond to a randomised head-turn challenge.', by: ['PRNU', 'Liveness'] },
  { icon: UserX, title: 'Proxy interviewers', desc: 'Identity is checked against the candidate’s ID photo before the session starts, then watched continuously.', by: ['Identity', 'Behavioral'] },
  { icon: Bot, title: 'Hidden AI assistants', desc: 'Off-screen reading, tab switches and focus loss show up in gaze and activity telemetry as they happen.', by: ['Behavioral'] },
  { icon: MonitorSmartphone, title: 'Second-screen coaching', desc: 'Sustained gaze deviation and phones in frame are flagged to the recruiter in the live alert feed.', by: ['Gaze', 'Objects'] },
]
function ThreatGrid() {
  return (
    <section className="py-20 relative z-10">
      <div className="max-w-[1100px] mx-auto px-6">
        <Reveal><p className="glass-label !text-[#A4123F] mb-3">Threat coverage</p>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-12">
          <h2 className="text-[34px] font-bold text-[#141114] tracking-[-0.03em] max-w-xl leading-tight">
            Every way an interview gets faked. Covered.
          </h2>
          <p className="text-[14px] text-[#55515A] max-w-sm leading-relaxed">
            Each attack is caught by at least one independent signal — and most by two — so beating one check is never enough.
          </p>
        </div></Reveal>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {THREATS.map((t, i) => (
            <Reveal key={t.title} variant="scale" delay={(i % 3) * 110}>
            <div className="h-full p-6 rounded-[24px] glass liquid glass-hover">
              <div className="flex items-start justify-between mb-5">
                <div className="glass-tile text-[#A4123F]"><t.icon size={20} /></div>
                <span className="glass-label !text-[9.5px]">Caught by</span>
              </div>
              <h3 className="text-[16px] font-semibold text-[#141114] mb-2 tracking-[-0.01em]">{t.title}</h3>
              <p className="text-[13px] text-[#67636C] leading-relaxed mb-4">{t.desc}</p>
              <div className="flex flex-wrap gap-1.5">
                {t.by.map(b => <span key={b} className="glass-chip !text-[10px] text-[#A4123F]">{b}</span>)}
              </div>
            </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Live telemetry preview (recruiter view) ─── */
function useTicker(base: number, spread: number, ms = 1400, decimals = 0) {
  const [hist, setHist] = useState<number[]>(() => Array.from({ length: 24 }, () => base + (Math.random() - 0.5) * spread))
  useEffect(() => {
    const id = setInterval(() => {
      setHist(h => {
        const last = h[h.length - 1]
        let next = last + (Math.random() - 0.5) * spread * 0.6
        next = Math.max(base - spread, Math.min(base + spread, next))
        return [...h.slice(1), next]
      })
    }, ms)
    return () => clearInterval(id)
  }, [base, spread, ms])
  const f = Math.pow(10, decimals)
  return { value: Math.round(hist[hist.length - 1] * f) / f, hist }
}
function Spark({ data, color }: { data: number[]; color: string }) {
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${28 - ((v - min) / rng) * 24}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-[96px] h-[30px] overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ transition: 'all .6s ease' }} />
    </svg>
  )
}
function Kpi({ label, value, unit, hist, color, chip, chipColor }: { label: string; value: number | string; unit?: string; hist: number[]; color: string; chip: string; chipColor: string }) {
  return (
    <div className="p-4 rounded-[20px] glass-soft">
      <div className="flex items-start justify-between mb-3">
        <span className="glass-label !text-[9.5px]">{label}</span>
        <Spark data={hist} color={color} />
      </div>
      <div className="flex items-end justify-between">
        <p className="text-[26px] font-bold text-[#141114] font-mono tabular-nums leading-none">{value}<span className="text-[12px] font-semibold text-[#85818A] ml-1">{unit}</span></p>
        <span className="text-[11px] font-semibold" style={{ color: chipColor }}>{chip}</span>
      </div>
    </div>
  )
}
const FEED = [
  { t: '00:14:02', sev: '#1A6B3C', title: 'Camera fingerprint matched', sub: 'PRNU · PCE well above match threshold' },
  { t: '00:12:47', sev: '#92400E', title: 'Gaze anomaly · watch', sub: 'Sustained left deviation for 4 s' },
  { t: '00:09:30', sev: '#1A6B3C', title: 'Head-turn check passed', sub: 'Liveness · 3/3 steps' },
  { t: '00:03:11', sev: '#1A6B3C', title: 'Pulse detected', sub: 'rPPG · stable signal from skin patches' },
]
function TelemetryPreview() {
  const trust = useTicker(88, 4, 1500)
  const bpm = useTicker(74, 5, 1100)
  const pce = useTicker(420, 120, 1300)
  const jit = useTicker(0.06, 0.02, 1200, 2)
  return (
    <section className="py-20 relative z-10">
      <div className="max-w-[1100px] mx-auto px-6">
        <Reveal><p className="glass-label !text-[#A4123F] mb-3">Recruiter view</p>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
          <h2 className="text-[34px] font-bold text-[#141114] tracking-[-0.03em] max-w-xl leading-tight">
            Watch the physics while you interview.
          </h2>
          <p className="text-[14px] text-[#55515A] max-w-sm leading-relaxed">
            A live trust score, per-signal breakdown and an alert feed sit beside the call — no tab-switching, no post-session guesswork.
          </p>
        </div></Reveal>

        <Reveal variant="scale"><div className="rounded-[32px] glass-strong liquid p-4 md:p-5">
          {/* Shell header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 flex items-center gap-3 px-4 h-11 rounded-[16px] glass-soft">
              <Search size={16} className="text-[#85818A]" />
              <span className="text-[13px] text-[#85818A]">Session DV-7Q2K · Frontend Engineer · Round 2</span>
            </div>
            <span className="glass-chip !py-2 !px-3 text-[#1A6B3C] !text-[11px]"><span className="w-1.5 h-1.5 rounded-full bg-[#1A6B3C] live-dot" /> Live</span>
            <span className="glass-icon-btn"><Bell size={16} /></span>
            <span className="hidden sm:flex items-center gap-2 pl-1 pr-3 h-11 rounded-[16px] glass-soft">
              <span className="glass-tile-maroon !w-8 !h-8 !rounded-[10px] text-[11px] font-bold">HR</span>
              <span className="text-left">
                <span className="block glass-label !text-[9px] leading-none mb-0.5">Recruiter</span>
                <span className="block text-[12px] font-semibold text-[#141114] leading-none">Hiring panel</span>
              </span>
              <ChevronDown size={14} className="text-[#85818A]" />
            </span>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <Kpi label="Trust score" value={trust.value} unit="/100" hist={trust.hist} color="#1A6B3C" chip="Verified" chipColor="#1A6B3C" />
            <Kpi label="Heart rate" value={bpm.value} unit="bpm" hist={bpm.hist} color="#A4123F" chip="Live pulse" chipColor="#A4123F" />
            <Kpi label="PRNU · PCE" value={pce.value} hist={pce.hist} color="#1A6B3C" chip="Match ≥ 60" chipColor="#1A6B3C" />
            <Kpi label="Frame jitter" value={jit.value.toFixed(2)} unit="CV" hist={jit.hist} color="#6E6A72" chip="Real camera" chipColor="#1A6B3C" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            {/* Module breakdown */}
            <div className="lg:col-span-2 p-5 rounded-[20px] glass-soft">
              <div className="flex items-center justify-between mb-4">
                <span className="glass-label">Signal breakdown</span>
                <span className="text-[11px] font-semibold text-[#85818A]">weights</span>
              </div>
              <div className="flex flex-col gap-3.5">
                {[
                  { icon: Fingerprint, name: 'PRNU', pts: 30, max: 30 },
                  { icon: HeartPulse, name: 'rPPG', pts: 27, max: 30 },
                  { icon: Timer, name: 'Jitter', pts: 14, max: 15 },
                  { icon: Eye, name: 'Behavioral', pts: 17, max: 25 },
                ].map(m => (
                  <div key={m.name} className="flex items-center gap-3">
                    <span className="glass-tile !w-8 !h-8 !rounded-[10px] text-[#A4123F]"><m.icon size={14} /></span>
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-[12px] font-semibold text-[#2A262C]">{m.name}</span>
                        <span className="text-[11px] font-mono text-[#67636C]">{m.pts}/{m.max}</span>
                      </div>
                      <div className="h-[5px] rounded-full bg-white/60 shadow-[inset_0_1px_2px_rgba(122,13,46,0.12)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(m.pts / m.max) * 100}%`, background: m.pts / m.max > 0.8 ? '#1A6B3C' : '#92400E' }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Alert feed */}
            <div className="lg:col-span-3 p-5 rounded-[20px] glass-soft">
              <div className="flex items-center justify-between mb-3">
                <span className="glass-label">Alert feed · last 15 min</span>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#85818A]"><Radio size={12} /> streaming</span>
              </div>
              <div className="flex flex-col">
                {FEED.map(a => (
                  <div key={a.t} className="flex items-start gap-3 py-2.5 border-b border-white/60 last:border-0">
                    <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: a.sev }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#141114]">{a.title}</p>
                      <p className="text-[11.5px] text-[#67636C]">{a.sub}</p>
                    </div>
                    <span className="text-[11px] font-mono text-[#85818A] shrink-0">{a.t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[10.5px] text-[#85818A]">Sample session · illustrative values</p>
        </div></Reveal>
      </div>
    </section>
  )
}

/* ── Built for both sides ─── */
function BothSides() {
  const sides = [
    { icon: GraduationCap, label: 'For candidates', title: 'Prove it’s really you — once.', to: '/auth/candidate/login', cta: 'Open candidate portal', dark: false,
      points: ['Upload your ID photo and build a verified profile', 'See recruiter invitations in one inbox', 'One-click system check: camera, pulse and timing', 'Consent is recorded before any analysis starts'] },
    { icon: Building2, label: 'For companies', title: 'Hire with evidence, not hunches.', to: '/auth/recruiter/login', cta: 'Open company portal', dark: true,
      points: ['Search verified candidate profiles', 'Send direct interview invites', 'Live trust score and alert feed during the call', 'Per-candidate thresholds calibrated at system check'] },
  ]
  return (
    <section className="py-20 relative z-10">
      <div className="max-w-[1100px] mx-auto px-6">
        <Reveal><p className="glass-label !text-[#A4123F] mb-3">Two portals</p>
        <h2 className="text-[34px] font-bold text-[#141114] tracking-[-0.03em] mb-10">Built for both sides of the call.</h2></Reveal>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sides.map(sd => (
            <Reveal key={sd.label} variant={sd.dark ? 'right' : 'left'}>
            <div className={`h-full p-7 rounded-[28px] liquid ${sd.dark ? 'glass-dark' : 'glass'}`}>
              <div className="flex items-center gap-3 mb-5">
                <span className={sd.dark ? 'inline-flex items-center justify-center w-11 h-11 rounded-[14px] bg-white/10 border border-white/15 text-white' : 'glass-tile text-[#A4123F]'}><sd.icon size={20} /></span>
                <span className={`glass-label ${sd.dark ? '!text-white/60' : ''}`}>{sd.label}</span>
              </div>
              <h3 className={`text-[22px] font-bold tracking-[-0.02em] mb-5 ${sd.dark ? 'text-white' : 'text-[#141114]'}`}>{sd.title}</h3>
              <ul className="flex flex-col gap-2.5 mb-7">
                {sd.points.map(pt => (
                  <li key={pt} className={`flex items-start gap-2.5 text-[13.5px] ${sd.dark ? 'text-white/75' : 'text-[#55515A]'}`}>
                    <Check size={16} className={`mt-0.5 shrink-0 ${sd.dark ? 'text-white/60' : 'text-[#A4123F]'}`} /> {pt}
                  </li>
                ))}
              </ul>
              <Link to={sd.to} className={`${sd.dark ? 'glass-btn !bg-white/95 !text-[#141114]' : 'glass-btn-primary'} px-5 py-2.5 text-[13px] !rounded-full`}>
                {sd.cta} <ArrowRight size={15} />
              </Link>
            </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Research · consent · no install ─── */
function TrustStrip() {
  const items = [
    { icon: BookOpen, title: 'Peer-reviewed research', desc: 'The DeepVerify method is published as a paper accepted at IEEE ICOSAAS 2026.' },
    { icon: Lock, title: 'Consent first', desc: 'Candidates see exactly what is analysed and consent is logged before the session begins.' },
    { icon: Laptop, title: 'Nothing to install', desc: 'Runs in the browser with a standard webcam — no plugins, drivers or desktop apps.' },
  ]
  return (
    <section className="py-12 relative z-10">
      <div className="max-w-[1100px] mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {items.map((it, i) => (
          <Reveal key={it.title} variant="up" delay={i * 110}>
          <div className="h-full flex items-start gap-4 p-5 rounded-[24px] glass liquid">
            <span className="glass-tile shrink-0 text-[#A4123F]"><it.icon size={19} /></span>
            <div>
              <p className="text-[14px] font-semibold text-[#141114] mb-1">{it.title}</p>
              <p className="text-[12.5px] text-[#67636C] leading-relaxed">{it.desc}</p>
            </div>
          </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ── FAQ ─── */
const FAQS = [
  { q: 'Does the candidate need to install anything?', a: 'No. Everything runs in a modern browser with the webcam they already have. The system check takes a couple of minutes before the interview.' },
  { q: 'Can a perfect-looking deepfake get through?', a: 'Looking real is not enough. DeepVerify checks signals a generator cannot see or copy: the physical sensor noise of the enrolled camera, a live pulse in the skin, and the timing of real camera frames. A fake has to defeat all of them at once.' },
  { q: 'What does the recruiter actually see?', a: 'A continuous 0–100 trust score, a breakdown of each forensic signal, and a live alert feed — right next to the video call.' },
  { q: 'What happens if a check fails?', a: 'A single failed check lowers the score and raises an alert; the score only drops sharply when independent signals agree. The recruiter always makes the final call.' },
]
function Faq() {
  return (
    <section className="py-20 relative z-10">
      <div className="max-w-[820px] mx-auto px-6">
        <Reveal><p className="glass-label !text-[#A4123F] mb-3 text-center">FAQ</p>
        <h2 className="text-[34px] font-bold text-[#141114] tracking-[-0.03em] mb-10 text-center">Questions, answered.</h2></Reveal>
        <div className="flex flex-col gap-3">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * 90}>
            <details className="group rounded-[22px] glass liquid open:shadow-[0_20px_50px_-20px_rgba(122,13,46,0.3)]">
              <summary className="flex items-center justify-between gap-4 px-6 py-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden rounded-[22px]">
                <span className="text-[14.5px] font-semibold text-[#141114]">{f.q}</span>
                <span className="glass-icon-btn !w-8 !h-8 !rounded-[10px] shrink-0 transition-transform group-open:rotate-180"><ChevronDown size={15} /></span>
              </summary>
              <p className="px-6 pb-5 -mt-1 text-[13.5px] text-[#55515A] leading-relaxed">{f.a}</p>
            </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

export default function Landing() {
  const score = useCounter(87)
  const [liveScore] = useState(87)

  return (
    <div className="min-h-screen relative overflow-x-clip">
      <ScrollProgress />
      <Navbar />

      {/* ─── INTRO: wordmark + slogan ─── */}
      <Intro />

      {/* ─── WHAT IT IS: words light up on scroll ─── */}
      <ScrollWords />

      {/* ─── HERO ──────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-6 pt-16 pb-20 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left */}
          <Reveal variant="left">


            <p className="glass-label !text-[#A4123F] mb-4">Get started</p>
            <h2 className="text-[56px] font-bold text-[#141114] leading-[1.04] tracking-[-0.045em] mb-6">
              Verify the person,<br />not just the<br />
              <span className="bg-gradient-to-b from-[#B01848] via-[#8E1036] to-[#5E0921] bg-clip-text text-transparent">pixels.</span>
            </h2>

            <p className="text-[16px] text-[#55515A] leading-relaxed max-w-[450px] mb-9">
              DeepVerify verifies the physics of a video call — camera sensor noise, biological pulse, and network timing. No deepfake, proxy, or AI assistant gets through.
            </p>

            {/* Dual Portal Gateways */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
              <Link
                to="/auth/candidate/login"
                className="p-4 rounded-[20px] glass liquid glass-hover group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-bold text-[#141114] group-hover:text-[#A4123F] transition-colors flex items-center gap-1.5">
                    Candidate Portal
                  </span>
                  <span className="glass-icon-btn !w-7 !h-7 !rounded-[9px]"><ArrowRight size={13} className="group-hover:translate-x-0.5 group-hover:text-[#A4123F] transition-all" /></span>
                </div>
                <p className="text-[11.5px] text-[#67636C] leading-normal">
                  Upload ID photo, view recruiter invitations & complete zero-trust checks.
                </p>
              </Link>

              <Link
                to="/auth/recruiter/login"
                className="p-4 rounded-[20px] glass-dark liquid glass-hover group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-bold text-white flex items-center gap-1.5">
                    Company Portal
                  </span>
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-[9px] bg-white/10 border border-white/15"><ArrowRight size={13} className="text-white/70 group-hover:translate-x-0.5 group-hover:text-white transition-all" /></span>
                </div>
                <p className="text-[11.5px] text-white/60 leading-normal">
                  Search verified candidate profiles, issue direct invites & watch live telemetry.
                </p>
              </Link>
            </div>

            <Link
              to="/demo"
              className="flex items-center justify-between p-4 mb-8 rounded-[20px] glass liquid glass-hover group !border-[#A4123F]/20"
            >
              <div className="flex items-center gap-3">
                <div className="glass-tile-maroon shrink-0">
                  <Play size={18} className="text-white ml-0.5" />
                </div>
                <div>
                  <span className="text-[13px] font-bold text-[#A4123F] block mb-0.5">
                    Try Demo Mode
                  </span>
                  <span className="text-[11.5px] text-[#7A0D2E]/80 block leading-tight">
                    Upload a video to test our live forensic deepfake detection algorithms.
                  </span>
                </div>
              </div>
              <span className="glass-icon-btn !w-9 !h-9 !rounded-[11px] text-[#A4123F]"><ArrowRight size={16} className="group-hover:translate-x-0.5 transition-all" /></span>
            </Link>

            <p className="glass-chip !text-[11px] !font-medium text-[#6E6A72]">
              Passive Forensics: PRNU Wavelet Denoising · POS rPPG Pulse · Scapy Jitter Profiling
            </p>
          </Reveal>

          {/* Right — animated trust card */}
          <Reveal variant="right" delay={150}>
          <div
            className="relative"
            style={{ animation: 'floatA 4s ease-in-out infinite' }}
          >
            <div className="rounded-[28px] glass-strong liquid overflow-hidden">
              {/* Maroon accent bar */}
              <div className="h-[3px] bg-gradient-to-r from-transparent via-[#A4123F] to-transparent" />

              {/* Scan line */}
              <div className="relative">
                <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[#A4123F] to-transparent animate-scan-line" style={{ position: 'absolute' }} />
              </div>

              <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2 glass-label">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1A6B3C] animate-pulse-glow" />
                    Live session · active
                  </div>
                  <span className="glass-chip !text-[10px] text-[#1A6B3C]">
                    Session verified
                  </span>
                </div>

                {/* Score ring + module bars */}
                <div className="flex items-start gap-6 p-4 rounded-[20px] glass-soft">
                  {/* SVG Ring */}
                  <div className="relative w-[130px] h-[130px] shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(164,18,63,0.10)" strokeWidth="6" />
                      <circle
                        cx="50" cy="50" r="42" fill="none"
                        stroke="#1A6B3C" strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray="264"
                        strokeDashoffset={264 - (264 * liveScore / 100)}
                        className="animate-gauge-fill"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-bold text-[#141114] font-mono tabular-nums">{score}</span>
                      <span className="text-[9px] font-semibold text-[#85818A] uppercase tracking-[0.18em]">Trust</span>
                    </div>
                  </div>

                  {/* Module bars */}
                  <div className="flex-1 flex flex-col gap-3 pt-1">
                    <MiniBar label="PRNU" value={93} color="#1A6B3C" delay={0} />
                    <MiniBar label="rPPG" value={89} color="#1A6B3C" delay={100} />
                    <MiniBar label="Jitter" value={91} color="#1A6B3C" delay={200} />
                    <MiniBar label="Behavioral" value={72} color="#92400E" delay={300} />
                  </div>
                </div>

                {/* Alert card */}
                <div className="mt-4 p-3.5 rounded-[18px] glass-soft !bg-[linear-gradient(135deg,rgba(254,243,199,0.75),rgba(255,255,255,0.5))]">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-1 h-4 rounded-full bg-[#92400E]" />
                    <span className="text-[11px] font-semibold text-[#92400E]">Gaze anomaly · Watch</span>
                  </div>
                  <p className="text-[11px] text-[#92400E]/80 pl-3">Δ = 0.41 · sustained left deviation</p>
                </div>
              </div>
            </div>
          </div>
          </Reveal>
        </div>
      </section>

      <CatchMarquee />
      <StickyStory />
      <ThreatGrid />

      {/* ─── FEATURES ──────────────────────────────── */}
      <section className="py-20 relative z-10">
        <div className="max-w-[1100px] mx-auto px-6">
          <Reveal><p className="glass-label !text-[#A4123F] mb-3">
            Four-module forensic pipeline
          </p>
          <h2 className="text-[34px] font-bold text-[#141114] tracking-[-0.03em] mb-3">
            Physics beats pixels. Always.
          </h2>
          <p className="text-[15px] text-[#55515A] max-w-xl mb-12 leading-relaxed">
            Visual deepfake detectors fail as generators improve. DeepVerify attacks signals that cannot be faked — camera hardware, blood flow, and network timing.
          </p></Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Reveal variant="scale" delay={0}><FeatureCard icon={Cpu}        iconBg=""  iconColor="text-[#A4123F]"  title="PRNU" desc="Camera hardware fingerprinting" weight="Weight 30%" layer="Identity layer" /></Reveal>
            <Reveal variant="scale" delay={100}><FeatureCard icon={HeartPulse} iconBg=""    iconColor="text-[#A4123F]"    title="rPPG" desc="Biological liveness detection"  weight="Weight 30%" layer="Biology layer" /></Reveal>
            <Reveal variant="scale" delay={200}><FeatureCard icon={Activity}   iconBg=""   iconColor="text-[#A4123F]"   title="Jitter" desc="Network rendering detection"  weight="Weight 15%" layer="Network layer" /></Reveal>
            <Reveal variant="scale" delay={300}><FeatureCard icon={Eye}        iconBg=""  iconColor="text-[#A4123F]"  title="Behavioral" desc="Gaze & activity telemetry" weight="Weight 25%" layer="Behavior layer" /></Reveal>
          </div>
        </div>
      </section>

      <TelemetryPreview />

      {/* ─── HOW IT WORKS ──────────────────────────── */}
      <section id="how-it-works" className="py-20 relative z-10">
        <div className="max-w-[1100px] mx-auto px-6">
          <Reveal><p className="glass-label !text-[#A4123F] mb-3">How it works</p>
          <h2 className="text-[34px] font-bold text-[#141114] tracking-[-0.03em] mb-12">Five steps to verified integrity</h2></Reveal>
          <Reveal variant="scale">

          <div className="flex items-center justify-between max-w-3xl mx-auto px-10 py-7 rounded-[28px] glass liquid">
            {[
              { n: '1', label: 'Recruiter creates', done: true },
              { n: '2', label: 'Device enrolled', done: true },
              { n: '3', label: 'Baselines calibrated', done: true },
              { n: '4', label: 'Consent logged', done: true },
              { n: '5', label: 'Live session', done: false },
            ].map((step, i) => (
              <div key={i} className="flex flex-col items-center step-indicator">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold mb-2 ${
                  step.done ? 'glass-tile-maroon !w-10 !h-10 !rounded-full' : 'glass-tile !w-10 !h-10 !rounded-full text-[#67636C]'
                }`}>
                  {step.done ? <Check size={16} /> : step.n}
                </div>
                <span className="text-[11px] font-medium text-[#55515A] text-center">{step.label}</span>
              </div>
            ))}
          </div>
          </Reveal>
        </div>
      </section>

      <BothSides />

      {/* ─── COMPARISON TABLE ──────────────────────── */}
      <section className="py-20 relative z-10">
        <div className="max-w-[1100px] mx-auto px-6">
          <Reveal><h2 className="text-[34px] font-bold text-[#141114] tracking-[-0.03em] mb-2">
            The only platform that checks if the video is real.
          </h2>
          <p className="text-[15px] text-[#55515A] mb-10">
            Competitors monitor behavior. We verify physics.
          </p></Reveal>
          <Reveal variant="scale">

          <div className="rounded-[28px] glass-strong liquid overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/70 bg-white/30">
                  <th className="py-4 px-4 glass-label">Capability</th>
                  <th className="py-4 px-4 glass-label text-center">HackerRank / Mettl</th>
                  <th className="py-4 px-4 glass-label text-center">Onfido / Jumio</th>
                  <th className="py-4 px-4 glass-label text-center">ProctorU</th>
                  <th className="py-4 px-4 glass-label !text-[#A4123F] text-center bg-[#A4123F]/[0.08]">DeepVerify</th>
                </tr>
              </thead>
              <tbody>
                <CompRow label="PRNU hardware fingerprint" dv={true} others={[false, false, false]} />
                <CompRow label="rPPG biological liveness" dv={true} others={[false, false, false]} />
                <CompRow label="Jitter rendering detection" dv={true} others={[false, false, false]} />
                <CompRow label="Virtual camera detection" dv={true} others={[false, false, true]} />
                <CompRow label="Continuous trust score 0–100" dv={true} others={[false, false, false]} />
                <CompRow label="Per-candidate threshold calibration" dv={true} others={[false, false, false]} />
                <CompRow label="Gaze & tab monitoring" dv={true} others={[true, false, true]} />
              </tbody>
            </table>
          </div>
          </Reveal>
        </div>
      </section>

      {/* ─── STATS STRIP ───────────────────────────── */}
      <section className="py-16 relative z-10">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { n: '275ms', label: 'Forensic cycle' },
              { n: '>98%', label: 'Identity fraud precision' },
              { n: '>94%', label: 'Overall detection accuracy' },
              { n: '4', label: 'Independent signals fused' },
            ].map((s, i) => (
              <Reveal key={s.label} variant="up" delay={i * 100}>
              <div className="h-full text-center p-6 rounded-[24px] glass liquid glass-hover">
                <p className="text-2xl font-bold text-[#A4123F] font-mono mb-1">{s.n}</p>
                <p className="glass-label !text-[10px]">{s.label}</p>
              </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <TrustStrip />
      <Faq />

      {/* ─── CTA BANNER ────────────────────────────── */}
      <section className="py-16 px-6 relative z-10">
        <Reveal variant="scale"><div className="max-w-[1100px] mx-auto liquid on-color rounded-[32px] p-12 text-center border border-white/25 bg-[linear-gradient(140deg,#9A1140_0%,#7A0D2E_50%,#4A0719_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_30px_70px_-30px_rgba(74,7,25,0.6)] overflow-hidden">
          <h2 className="text-3xl font-bold text-white mb-3">
            Ready to verify your next interview?
          </h2>
          <p className="text-[15px] text-white/70 mb-8 max-w-lg mx-auto">
            Create a session in under a minute. No installation on the candidate's side.
          </p>
          <Link
            to="/create"
            className="glass-btn px-8 py-3.5 text-sm !font-bold !text-[#A4123F] !rounded-full !bg-white/95"
          >
            Create a session <ArrowRight size={16} />
          </Link>
        </div></Reveal>
      </section>

      {/* ─── FOOTER ────────────────────────────────── */}
      <footer className="relative z-10 pb-8 pt-4">
        <div className="max-w-[1100px] mx-auto px-6 py-5 rounded-[24px] glass flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[12px] text-[#85818A]">
            © 2025 DeepVerify · Amrita Vishwa Vidyapeetham
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="glass-link">Privacy</a>
            <a href="#" className="glass-link">Research paper</a>
            <a href="#" className="glass-link">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
