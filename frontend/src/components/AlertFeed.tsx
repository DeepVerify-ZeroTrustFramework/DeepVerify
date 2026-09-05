import type { TrustAlert } from '../hooks/useTrustScore'
import { 
  AlertCircle, ShieldAlert, AlertTriangle, Info, Check, Clock,
  Users, Smartphone, Monitor, EyeOff, Sparkles, Copy
} from 'lucide-react'

export default function AlertFeed({ 
  alerts, 
  onAcknowledge 
}: { 
  alerts: TrustAlert[]
  onAcknowledge: (id: string) => void 
}) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-[#6B6B6B]">
        <div className="w-12 h-12 rounded-full bg-[#F7F7F8] flex items-center justify-center mb-3">
          <Check size={20} className="text-[#1A6B3C]" />
        </div>
        <p className="text-[13px] font-medium">No alerts detected</p>
        <p className="text-[11px]">System integrity is stable</p>
      </div>
    )
  }

  const getSeverityStyles = (severity: string = '') => {
    switch (severity?.toUpperCase?.()) {
      case 'CRITICAL': return 'bg-[#FEE2E2] border-[#FCA5A5] text-[#991B1B] icon-[#991B1B]'
      case 'HIGH': return 'bg-[#FEF2F2] border-[#FECACA] text-[#DC2626] icon-[#DC2626]'
      case 'MEDIUM': return 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E] icon-[#D97706]'
      default: return 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1E3A8A] icon-[#2563EB]'
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
      const d = new Date(iso)
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

        return (
          <div 
            key={alertId}
            className={`p-3 rounded-xl border ${styles} relative overflow-hidden alert-card animate-fade-in`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {getIcon(alertType, alert.severity, styles.split('icon-')[1] || '')}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[12px] font-bold uppercase tracking-wide">
                    {moduleName} · {alertType.replace(/_/g, ' ')}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] opacity-70">
                    <Clock size={10} /> {formatTime(alert.timestamp)}
                  </span>
                </div>
                <p className="text-[13px] leading-snug mb-2 opacity-90">
                  {desc}
                </p>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-[11px] font-mono font-medium opacity-80">
                    {val ? `Value: ${val}` : ''}
                  </span>
                  <button 
                    onClick={() => onAcknowledge(alertId)}
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-black/5 hover:bg-black/10 transition-colors"
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
