export default function TrustGauge({ score = 100 }: { score?: number }) {
  const safeScore = typeof score === 'number' && !isNaN(score) ? Math.min(100, Math.max(0, score)) : 100

  const getScoreColor = (s: number) => {
    if (s >= 80) return '#1A6B3C' // Success
    if (s >= 60) return '#92400E' // Warning
    return '#991B1B' // Danger
  }

  const getScoreStatus = (s: number) => {
    if (s >= 80) return 'Verified'
    if (s >= 60) return 'Caution'
    return 'Critical Alert'
  }

  const color = getScoreColor(safeScore)
  const status = getScoreStatus(safeScore)
  const circumference = 2 * Math.PI * 54 // r=54
  const offset = circumference - (safeScore / 100) * circumference

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[160px] h-[160px] mb-2" style={{ '--ring-circumference': circumference } as React.CSSProperties}>
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle cx="60" cy="60" r="54" fill="none" stroke="#EFEFF0" strokeWidth="6" />
          <circle
            cx="60" cy="60" r="54" fill="none"
            stroke={color} strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700 ease-out"
            style={{ animation: score === 100 ? 'ringStroke 1s ease-out' : 'none' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span 
            className="text-4xl font-bold font-mono tracking-tighter"
            style={{ color, transition: 'color 0.5s' }}
          >
            {Math.round(score)}
          </span>
          <span className="text-[10px] text-[#6B6B6B] uppercase tracking-widest mt-1">
            Trust
          </span>
        </div>
      </div>
      
      <div className="text-center animate-fade-in">
        <span 
          className="inline-block px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-full transition-colors"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {status}
        </span>
      </div>
    </div>
  )
}
