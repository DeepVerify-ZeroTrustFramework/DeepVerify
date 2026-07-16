import { useState, useEffect, useRef } from 'react'

export interface TrustAlert {
  alertId: string
  alertType: string
  module: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  description: string
  value: number
  timestamp: string
}

export interface TrustBreakdown {
  prnu: number
  rppg: number
  jitter: number
  behavioral: number
}

export interface RawTelemetry {
  pce: number
  snr_rppg: number
  cv_jitter: number
  behavioral_score: number
  hr_bpm: number
}

export function useTrustScore(sessionId: string) {
  const [score, setScore] = useState(100)
  const [breakdown, setBreakdown] = useState<TrustBreakdown>({
    prnu: 30, rppg: 30, jitter: 15, behavioral: 25
  })
  const [raw, setRaw] = useState<RawTelemetry>({
    pce: 85, snr_rppg: 8, cv_jitter: 0.05, behavioral_score: 1.0, hr_bpm: 72
  })
  
  // Start with EMPTY alerts per BUG 3 FIX
  const [alerts, setAlerts] = useState<TrustAlert[]>([])
  const [status, setStatus] = useState<string>('WAITING')
  
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!sessionId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/dashboard/${sessionId}`
    
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        
        if (msg.type === 'TRUST_UPDATE') {
          setScore(msg.trust_score)
          if (msg.breakdown) setBreakdown(msg.breakdown)
          if (msg.raw) setRaw(msg.raw)
        } 
        else if (msg.type === 'ALERT') {
          setAlerts(prev => {
            // Prevent duplicates
            if (prev.find(a => a.alertId === msg.alertId)) return prev
            return [msg, ...prev]
          })
        }
        else if (msg.type === 'STATUS_CHANGE') {
          setStatus(msg.status)
        }
        else if (msg.type === 'CONNECTED') {
          setStatus('CONNECTED')
        }
      } catch (e) {
        console.error('Failed to parse WS message', e)
      }
    }

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)

    return () => {
      clearInterval(pingInterval)
      ws.close()
    }
  }, [sessionId])

  const acknowledgeAlert = (alertId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'ACKNOWLEDGE_ALERT',
        alertId
      }))
    }
    setAlerts(prev => prev.filter(a => a.alertId !== alertId))
  }

  return {
    score,
    breakdown,
    raw,
    alerts,
    status,
    acknowledgeAlert
  }
}
