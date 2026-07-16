import type { TrustAlert } from '../hooks/useTrustScore'
import { AlertCircle, ShieldAlert, AlertTriangle, Info, Check, Clock } from 'lucide-react'

export default function AlertFeed({ 
  alerts, 
  onAcknowledge 
}: { 
  alerts: TrustAlert[]
  onAcknowledge: (id: string) => void 
}) {
  if (alerts.length === 0) {
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

  const getSeverityStyles = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'bg-[#FEE2E2] border-[#FCA5A5] text-[#991B1B] icon-[#991B1B]'
      case 'HIGH': return 'bg-[#FEF2F2] border-[#FECACA] text-[#DC2626] icon-[#DC2626]'
      case 'MEDIUM': return 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E] icon-[#D97706]'
      default: return 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1E3A8A] icon-[#2563EB]'
    }
  }

  const getIcon = (severity: string, className: string) => {
    switch (severity) {
      case 'CRITICAL': return <ShieldAlert size={16} className={className} />
      case 'HIGH': return <AlertCircle size={16} className={className} />
      case 'MEDIUM': return <AlertTriangle size={16} className={className} />
      default: return <Info size={16} className={className} />
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => {
        const styles = getSeverityStyles(alert.severity)
        
        return (
          <div 
            key={alert.alertId}
            className={`p-3 rounded-xl border ${styles} relative overflow-hidden alert-card animate-fade-in`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {getIcon(alert.severity, styles.split('icon-')[1])}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[12px] font-bold uppercase tracking-wide">
                    {alert.module} · {alert.alertType.replace('_', ' ')}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] opacity-70">
                    <Clock size={10} /> {formatTime(alert.timestamp)}
                  </span>
                </div>
                <p className="text-[13px] leading-snug mb-2 opacity-90">
                  {alert.description}
                </p>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-[11px] font-mono font-medium opacity-80">
                    Value: {alert.value.toFixed(2)}
                  </span>
                  <button 
                    onClick={() => onAcknowledge(alert.alertId)}
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
