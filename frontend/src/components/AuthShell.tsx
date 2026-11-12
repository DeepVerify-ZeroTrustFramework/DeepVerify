import type { ReactNode } from 'react'
import Navbar from './Navbar'

export type AuthPoint = { icon: ReactNode; text: string }

/**
 * Shared glass layout for the candidate / company sign-in and sign-up pages.
 * Purely presentational: the page passes its own form (fields, handlers, links)
 * as children, so all behaviour stays in the page file.
 */
export default function AuthShell({
  tone = 'maroon', eyebrowIcon, eyebrow, titleLead, titleAccent, description,
  points, pointsLabel, steps, proof, footnote, children, formWidth = 600,
}: {
  tone?: 'maroon' | 'graphite'
  eyebrowIcon: ReactNode
  eyebrow: string
  titleLead: ReactNode
  titleAccent: ReactNode
  description: string
  points?: AuthPoint[]
  pointsLabel?: string
  steps?: { step: string; label: string }[]
  proof?: ReactNode
  footnote?: ReactNode
  children: ReactNode
  formWidth?: number
}) {
  const graphite = tone === 'graphite'
  return (
    <div className="min-h-screen relative overflow-x-clip">
      <Navbar />

      <main className="relative z-10 max-w-[1400px] mx-auto px-6 pt-32 pb-16 min-h-screen grid grid-cols-1 lg:grid-cols-2 gap-8 xl:gap-10 items-stretch content-center">
        {/* ── Brand panel ── */}
        <section className="intro-fade hidden lg:flex flex-col justify-center rounded-[32px] glass-strong liquid p-10 xl:p-12" style={{ animationDelay: '0.02s' }}>
          <div className="intro-fade flex items-center gap-3 mb-7" style={{ animationDelay: '0.05s' }}>
            <span className={graphite ? 'auth-tile-graphite' : 'glass-tile-maroon !w-12 !h-12 !rounded-[15px]'}>{eyebrowIcon}</span>
            <span className="glass-label">{eyebrow}</span>
          </div>
          <h2 className="intro-fade text-[clamp(40px,3.9vw,64px)] font-bold text-[#141114] leading-[1.02] tracking-[-0.05em] mb-6" style={{ animationDelay: '0.12s' }}>
            {titleLead}<br />
            <span className={graphite ? 'auth-accent-graphite' : 'intro-verify'}>{titleAccent}</span>
          </h2>
          <p className="intro-fade text-[16.5px] text-[#55515A] leading-relaxed max-w-[560px] mb-8" style={{ animationDelay: '0.2s' }}>
            {description}
          </p>

          {steps && (
            <div className="intro-fade grid grid-cols-2 gap-3 max-w-[620px] mb-6" style={{ animationDelay: '0.28s' }}>
              {steps.map(s => (
                <div key={s.step} className="flex items-start gap-3 p-4 rounded-[18px] glass">
                  <span className={`font-mono text-[12px] font-semibold mt-0.5 ${graphite ? 'text-[#141114]' : 'text-[#A4123F]'}`}>{s.step}</span>
                  <span className="text-[13.5px] font-medium text-[#2A262C] leading-snug">{s.label}</span>
                </div>
              ))}
            </div>
          )}

          {points && (
            <div className="intro-fade max-w-[620px] mb-6" style={{ animationDelay: '0.34s' }}>
              {pointsLabel && <p className="glass-label !text-[10.5px] mb-3">{pointsLabel}</p>}
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(points.length, 3)}, minmax(0, 1fr))` }}>
                {points.map(pt => (
                  <div key={pt.text} className="flex flex-col items-start gap-3 px-4 py-4 rounded-[18px] glass">
                    <span className={`glass-tile !w-9 !h-9 !rounded-[11px] shrink-0 ${graphite ? 'text-[#141114]' : 'text-[#A4123F]'}`}>{pt.icon}</span>
                    <span className="text-[13px] font-semibold text-[#2A262C] leading-snug">{pt.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {proof && <div className="intro-fade max-w-[620px]" style={{ animationDelay: '0.42s' }}>{proof}</div>}

          {footnote && <div className="intro-fade mt-7 text-[14px] text-[#67636C]" style={{ animationDelay: '0.5s' }}>{footnote}</div>}
        </section>

        {/* ── Form card ── */}
        <section className="intro-fade w-full justify-self-center flex" style={{ maxWidth: formWidth, animationDelay: '0.1s' }}>
          <div className="relative w-full rounded-[32px] glass-strong liquid p-8 sm:p-10 flex flex-col justify-center">
            <div>{children}</div>
          </div>
        </section>
      </main>
    </div>
  )
}

/** Illustrative "live proof" card shown on the brand panel. */
export function ProofCard({ title, rows, tone = 'maroon' }: { title: string; rows: { k: string; v: string; ok?: boolean }[]; tone?: 'maroon' | 'graphite' }) {
  return (
    <div className="rounded-[22px] glass-dark liquid p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/55">{title}</span>
        <span className="flex items-center gap-1.5 text-[10.5px] font-semibold text-[#4ADE80]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] live-dot" /> Live
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {rows.map(r => (
          <div key={r.k} className="px-3.5 py-3 rounded-[14px] bg-white/[0.06] border border-white/10">
            <p className="font-mono text-[10px] tracking-[0.14em] text-white/50 mb-1">{r.k}</p>
            <p className={`font-mono text-[15px] font-semibold ${r.ok === false ? 'text-[#FCA5A5]' : tone === 'graphite' ? 'text-white' : 'text-white'}`}>{r.v}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
