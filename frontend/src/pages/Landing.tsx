import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Cpu, HeartPulse, Activity, Eye, ArrowRight, Check, X } from 'lucide-react'
import Navbar from '../components/Navbar'

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
        <span className="text-[10px] text-[#6B6B6B]">{label}</span>
        <span className={`text-[10px] font-medium`} style={{ color }}>{value}%</span>
      </div>
      <div className="h-[3px] rounded-full bg-[#EFEFF0] overflow-hidden">
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
    <div className="p-6 rounded-2xl bg-white border border-[#E4E4E6] hover:border-[#A4123F] hover:-translate-y-0.5 transition-all duration-200 group">
      <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center mb-4`}>
        <Icon size={20} className={iconColor} />
      </div>
      <h3 className="text-[15px] font-semibold text-[#0F0F0F] mb-1.5">{title}</h3>
      <p className="text-[13px] text-[#6B6B6B] leading-relaxed mb-3">{desc}</p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium text-[#A4123F] px-2 py-0.5 rounded-full bg-[#F9ECF0]">{weight}</span>
        <span className="text-[10px] font-medium text-[#6B6B6B] px-2 py-0.5 rounded-full bg-[#F7F7F8]">{layer}</span>
      </div>
    </div>
  )
}

/* ── Comparison row ─── */
function CompRow({ label, dv, others }: { label: string; dv: boolean; others: boolean[] }) {
  return (
    <tr className="border-b border-[#E4E4E6]">
      <td className="py-3 px-4 text-[13px] text-[#3A3A3A]">{label}</td>
      {others.map((v, i) => (
        <td key={i} className="py-3 px-4 text-center">
          {v ? <Check size={16} className="mx-auto text-[#1A6B3C]" /> : <X size={16} className="mx-auto text-[#D0D0D3]" />}
        </td>
      ))}
      <td className="py-3 px-4 text-center bg-[#F9ECF0]">
        {dv ? <Check size={16} className="mx-auto text-[#A4123F]" /> : <X size={16} className="mx-auto text-[#D0D0D3]" />}
      </td>
    </tr>
  )
}

export default function Landing() {
  const score = useCounter(87)
  const [liveScore] = useState(87)

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      {/* ─── HERO ──────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-6 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left */}
          <div style={{ animation: 'fadeUp 0.4s ease both' }}>
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#E4E4E6] bg-[#F7F7F8] text-[11px] font-medium text-[#6B6B6B] mb-6">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#1A6B3C] opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#1A6B3C]" />
              </span>
              Accepted · IEEE ICOSAAS 2026
            </div>

            <h1 className="text-[52px] font-bold text-[#0F0F0F] leading-[1.08] tracking-[-0.04em] mb-5">
              Interviews you<br />can actually<br />
              <span className="text-[#A4123F]">trust.</span>
            </h1>

            <p className="text-[16px] text-[#6B6B6B] leading-relaxed max-w-[440px] mb-8">
              DeepVerify verifies the physics of a video call — camera sensor noise, biological pulse, and network timing. No deepfake, proxy, or AI assistant gets through.
            </p>

            <div className="flex items-center gap-3 mb-8">
              <Link
                to="/create"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#A4123F] text-white text-sm font-semibold rounded-xl hover:bg-[#7A0D2E] transition-colors"
              >
                Create a session <ArrowRight size={16} />
              </Link>
              <a
                href="#how-it-works"
                className="px-6 py-3 text-sm font-medium text-[#3A3A3A] border border-[#E4E4E6] rounded-xl hover:border-[#D0D0D3] transition-colors"
              >
                See how it works
              </a>
            </div>

            <p className="text-[12px] text-[#9B9B9B]">
              12 sessions verified today · avg trust score 91%
            </p>
          </div>

          {/* Right — animated trust card */}
          <div
            className="relative"
            style={{ animation: 'fadeUp 0.4s 0.15s ease both, floatA 4s ease-in-out infinite' }}
          >
            <div className="rounded-2xl border border-[#E4E4E6] bg-white shadow-xl overflow-hidden">
              {/* Maroon accent bar */}
              <div className="h-[3px] bg-[#A4123F]" />

              {/* Scan line */}
              <div className="relative">
                <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[#A4123F] to-transparent animate-scan-line" style={{ position: 'absolute' }} />
              </div>

              <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2 text-[11px] text-[#6B6B6B]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1A6B3C]" />
                    Live session · active
                  </div>
                  <span className="text-[10px] font-medium text-[#1A6B3C] bg-[#E6F4ED] px-2 py-0.5 rounded-full">
                    Session verified
                  </span>
                </div>

                {/* Score ring + module bars */}
                <div className="flex items-start gap-6">
                  {/* SVG Ring */}
                  <div className="relative w-[130px] h-[130px] shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="#EFEFF0" strokeWidth="6" />
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
                      <span className="text-3xl font-bold text-[#0F0F0F] font-mono tabular-nums">{score}</span>
                      <span className="text-[9px] text-[#9B9B9B] uppercase tracking-widest">Trust</span>
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
                <div className="mt-5 p-3 rounded-xl bg-[#FEF3C7] border border-[#FDE68A]">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-1 h-4 rounded-full bg-[#92400E]" />
                    <span className="text-[11px] font-semibold text-[#92400E]">Gaze anomaly · Watch</span>
                  </div>
                  <p className="text-[11px] text-[#92400E]/80 pl-3">Δ = 0.41 · sustained left deviation</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FEATURES ──────────────────────────────── */}
      <section className="bg-[#F7F7F8] py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <p className="text-[11px] uppercase tracking-widest text-[#A4123F] font-medium mb-3">
            Four-module forensic pipeline
          </p>
          <h2 className="text-3xl font-bold text-[#0F0F0F] mb-3">
            Physics beats pixels. Always.
          </h2>
          <p className="text-[15px] text-[#6B6B6B] max-w-xl mb-12 leading-relaxed">
            Visual deepfake detectors fail as generators improve. DeepVerify attacks signals that cannot be faked — camera hardware, blood flow, and network timing.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <FeatureCard icon={Cpu}        iconBg="bg-amber-50"  iconColor="text-amber-600"  title="PRNU" desc="Camera hardware fingerprinting" weight="Weight 30%" layer="Identity layer" />
            <FeatureCard icon={HeartPulse} iconBg="bg-red-50"    iconColor="text-red-500"    title="rPPG" desc="Biological liveness detection"  weight="Weight 30%" layer="Biology layer" />
            <FeatureCard icon={Activity}   iconBg="bg-blue-50"   iconColor="text-blue-600"   title="Jitter" desc="Network rendering detection"  weight="Weight 15%" layer="Network layer" />
            <FeatureCard icon={Eye}        iconBg="bg-green-50"  iconColor="text-green-600"  title="Behavioral" desc="Gaze & activity telemetry" weight="Weight 25%" layer="Behavior layer" />
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ──────────────────────────── */}
      <section id="how-it-works" className="py-20 bg-white">
        <div className="max-w-[1100px] mx-auto px-6">
          <p className="text-[11px] uppercase tracking-widest text-[#A4123F] font-medium mb-3">How it works</p>
          <h2 className="text-3xl font-bold text-[#0F0F0F] mb-12">Five steps to verified integrity</h2>

          <div className="flex items-center justify-between max-w-3xl mx-auto">
            {[
              { n: '1', label: 'Recruiter creates', done: true },
              { n: '2', label: 'Device enrolled', done: true },
              { n: '3', label: 'Baselines calibrated', done: true },
              { n: '4', label: 'Consent logged', done: true },
              { n: '5', label: 'Live session', done: false },
            ].map((step, i) => (
              <div key={i} className="flex flex-col items-center step-indicator">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold mb-2 ${
                  step.done ? 'bg-[#A4123F] text-white' : 'bg-[#F7F7F8] text-[#6B6B6B] border border-[#E4E4E6]'
                }`}>
                  {step.done ? <Check size={16} /> : step.n}
                </div>
                <span className="text-[11px] text-[#6B6B6B] text-center">{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── COMPARISON TABLE ──────────────────────── */}
      <section className="bg-[#F7F7F8] py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <h2 className="text-3xl font-bold text-[#0F0F0F] mb-2">
            The only platform that checks if the video is real.
          </h2>
          <p className="text-[15px] text-[#6B6B6B] mb-10">
            Competitors monitor behavior. We verify physics.
          </p>

          <div className="rounded-2xl border border-[#E4E4E6] bg-white overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#E4E4E6] bg-[#F7F7F8]">
                  <th className="py-3 px-4 text-[12px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Capability</th>
                  <th className="py-3 px-4 text-[12px] font-semibold text-[#6B6B6B] uppercase tracking-wider text-center">HackerRank / Mettl</th>
                  <th className="py-3 px-4 text-[12px] font-semibold text-[#6B6B6B] uppercase tracking-wider text-center">Onfido / Jumio</th>
                  <th className="py-3 px-4 text-[12px] font-semibold text-[#6B6B6B] uppercase tracking-wider text-center">ProctorU</th>
                  <th className="py-3 px-4 text-[12px] font-semibold text-[#A4123F] uppercase tracking-wider text-center bg-[#F9ECF0]">DeepVerify</th>
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
        </div>
      </section>

      {/* ─── STATS STRIP ───────────────────────────── */}
      <section className="py-16 bg-white">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { n: '275ms', label: 'Forensic cycle' },
              { n: '>98%', label: 'Identity fraud precision' },
              { n: '>94%', label: 'Overall detection accuracy' },
              { n: '4', label: 'Independent signals fused' },
            ].map(s => (
              <div key={s.label} className="text-center p-6 rounded-2xl bg-[#F7F7F8] border border-[#E4E4E6]">
                <p className="text-2xl font-bold text-[#A4123F] font-mono mb-1">{s.n}</p>
                <p className="text-[12px] text-[#6B6B6B]">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA BANNER ────────────────────────────── */}
      <section className="py-16 px-6">
        <div className="max-w-[1100px] mx-auto bg-[#A4123F] rounded-3xl p-12 text-center">
          <h2 className="text-3xl font-bold text-white mb-3">
            Ready to verify your next interview?
          </h2>
          <p className="text-[15px] text-white/70 mb-8 max-w-lg mx-auto">
            Create a session in under a minute. No installation on the candidate's side.
          </p>
          <Link
            to="/create"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-white text-[#A4123F] text-sm font-bold rounded-xl hover:bg-white/90 transition-colors"
          >
            Create a session <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* ─── FOOTER ────────────────────────────────── */}
      <footer className="border-t border-[#E4E4E6] py-8">
        <div className="max-w-[1100px] mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[12px] text-[#9B9B9B]">
            © 2025 DeepVerify · Amrita Vishwa Vidyapeetham · IEEE ICOSAAS 2026
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-[12px] text-[#9B9B9B] hover:text-[#6B6B6B] transition-colors">Privacy</a>
            <a href="#" className="text-[12px] text-[#9B9B9B] hover:text-[#6B6B6B] transition-colors">Research paper</a>
            <a href="#" className="text-[12px] text-[#9B9B9B] hover:text-[#6B6B6B] transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
