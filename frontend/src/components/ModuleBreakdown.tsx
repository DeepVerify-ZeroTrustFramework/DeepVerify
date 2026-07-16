import type { TrustBreakdown } from '../hooks/useTrustScore'
import { Cpu, HeartPulse, Activity, Eye } from 'lucide-react'

export default function ModuleBreakdown({ breakdown }: { breakdown: TrustBreakdown }) {
  const getStatusColor = (val: number, max: number) => {
    const ratio = val / max
    if (ratio >= 0.8) return '#1A6B3C' // Green
    if (ratio >= 0.6) return '#92400E' // Amber
    return '#991B1B' // Red
  }

  const modules = [
    { key: 'prnu', icon: Cpu, label: 'PRNU Identity', val: breakdown.prnu, max: 30 },
    { key: 'rppg', icon: HeartPulse, label: 'rPPG Liveness', val: breakdown.rppg, max: 30 },
    { key: 'behavioral', icon: Eye, label: 'Behavioral', val: breakdown.behavioral, max: 25 },
    { key: 'jitter', icon: Activity, label: 'Jitter Check', val: breakdown.jitter, max: 15 },
  ]

  return (
    <div className="space-y-4">
      {modules.map((m) => {
        const Icon = m.icon
        const color = getStatusColor(m.val, m.max)
        const width = `${(m.val / m.max) * 100}%`

        return (
          <div key={m.key} className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#F7F7F8] flex items-center justify-center shrink-0">
              <Icon size={16} className="text-[#6B6B6B]" />
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-end mb-1">
                <span className="text-[12px] font-semibold text-[#3A3A3A]">{m.label}</span>
                <span className="text-[11px] font-mono text-[#6B6B6B]">
                  {m.val.toFixed(1)} <span className="text-[9px]">/ {m.max}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[#EFEFF0] overflow-hidden">
                <div 
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width, backgroundColor: color }}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
