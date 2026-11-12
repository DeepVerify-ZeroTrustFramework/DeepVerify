import type { TrustAlert } from '../hooks/useTrustScore'
import { 
  AlertCircle, ShieldAlert, AlertTriangle, Info, Check, Clock,
  Users, Smartphone, Monitor, EyeOff, Sparkles, Copy
} from 'lucide-react'

// Severity colours for the glass alert cards (accent bar, icon tile, icon, pill).
const TONES: Record<string, { bar: string; tile: string; icon: string; label: string }> = {
  CRITICAL: { bar: '#991B1B', tile: 'rgba(153,27,27,0.10)', icon: '#991B1B', label: 'CRITICAL' },
  HIGH: { bar: '#DC2626', tile: 'rgba(220,38,38,0.09)', icon: '#DC2626', label: 'HIGH' },
  MEDIUM: { bar: '#D97706', tile: 'rgba(217,119,6,0.11)', icon: '#D97706', label: 'MEDIUM' },
  INFO: { bar: '#85818A', tile: 'rgba(20,17,20,0.06)', icon: '#67636C', label: 'INFO' },
}

export default function AlertFeed({ 
  alerts, 
  onAcknowledge 
}: { 
  alerts: TrustAlert[]
  onAcknowledge: (id: string) => void 
}) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-[#67636C]">
        <div className="glass-tile !w-12 !h-12 !rounded-full mb-3">
          <Check size={20} className="text-[#1A6B3C]" />
        </div>
        <p className="text-[13px] font-medium">No alerts detected</p>
        <p className="text-[11px]">System integrity is stable</p>
      </div>
    )
  }

  const getSeverityStyles = (severity: string = '') => {
    switch (severity?.toUpperCase?.()) {
      case 'CRITICAL': return 'text-[#991B1B]'
      case 'HIGH': return 'text-[#B91C1C]'
      case 'MEDIUM': return 'text-[#92400E]'
      default: return 'text-[#4A464E]'
    }
  }

  const getIcon = (alertType: string = '', severity: string = '', className: string = '') => {
    const type = alertType || ''
    if (type.includes('MULTI_FACE')) return <Users size={16} className={className} />
    if (type.includes('PROHIBITED_OBJECT')) return <Smartphone size={16} className={className} />
    if (type.includes('MULTI_MONITOR')) return <Monitor size={16} className={className} />
    if (type.includes('ABSENCE')) return <EyeOff size={16} className={className} />
    if (type.includes('SCREEN_REFLECTION')) return <Sparkles size={16} className={className} />
    if (type.includes('CLIPBOARD') || type.includes('PASTE')) return <Copy size={16} className={className} />

    switch (severity?.toUpperCase?.()) {
      case 'CRITICAL': return <ShieldAlert size={16} className={className} />
      case 'HIGH': return <AlertCircle size={16} className={className} />
      case 'MEDIUM': return <AlertTriangle size={16} className={className} />
      default: return <Info size={16} className={className} />
    }
  }

  const formatTime = (iso?: string) => {
    if (!iso) return ''
    try {
      // Backend timestamps are UTC without a zone suffix (datetime.utcnow().isoformat());
      // without one, the browser would read them as local time. Mark them as UTC.
      const utc = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso) ? `${iso}Z` : iso
      const d = new Date(utc)
      if (isNaN(d.getTime())) return ''
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return ''
    }
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert, idx) => {
        const styles = getSeverityStyles(alert.severity)
        const alertId = alert.alertId || (alert as any).alert_id || `alert-${idx}`
        const alertType = alert.alertType || (alert as any).alert_type || 'ALERT'
        const moduleName = alert.module || 'FORENSIC'
        const desc = alert.description || (alert as any).message || 'Anomaly detected'
        const val = typeof alert.value === 'number' && !isNaN(alert.value) ? alert.value.toFixed(2) : String(alert.value ?? '')

        const ink = styles
        const tone = TONES[(alert.severity || '').toUpperCase()] || TONES.INFO
        return (
          <div 
            key={alertId}
            className="relative overflow-hidden rounded-[20px] liquid bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(255,255,255,0.74))] border border-white shadow-[inset_0_1px_0_#fff,0_10px_24px_-16px_rgba(20,14,18,0.35)] animate-fade-in transition-transform duration-200 hover:-translate-y-0.5"
          >
            {/* severity accent */}
            <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full" style={{ background: tone.bar }} />
            <div className="flex items-start gap-3 pl-4 pr-3.5 py-3.5">
              <div className="mt-0.5 w-9 h-9 shrink-0 rounded-[12px] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]" style={{ background: tone.tile, color: tone.icon }}>
                {getIcon(alertType, alert.severity, '')}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start gap-2 mb-1">
                  <span className={`text-[11px] font-bold uppercase tracking-[0.08em] ${ink}`}>
                    {moduleName} · {alertType.replace(/_/g, ' ')}
                  </span>
                  <span className="flex items-center gap-1 text-[10.5px] text-[#85818A] font-mono shrink-0">
                    <Clock size={10} /> {formatTime(alert.timestamp)}
                  </span>
                </div>
                <p className="text-[13.5px] leading-snug text-[#2A262C]">
                  {desc}
                </p>
                <div className="flex justify-between items-center gap-2 mt-3">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-[9.5px] font-bold tracking-[0.1em] px-2 py-0.5 rounded-full border border-current/20 ${ink}`} style={{ background: tone.tile }}>{tone.label}</span>
                    <span className="text-[11px] font-mono font-medium text-[#67636C] truncate">
                      {val ? `Value: ${val}` : ''}
                    </span>
                  </div>
                  <button 
                    onClick={() => onAcknowledge(alertId)}
                    className="glass-btn !rounded-full !text-[10.5px] !font-bold uppercase tracking-[0.08em] px-3 py-1.5 shrink-0"
                  >
                    Acknowledge
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
