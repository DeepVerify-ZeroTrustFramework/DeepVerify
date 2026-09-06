import { useState, useEffect, useRef } from 'react'
import { getWsUrl } from '../utils/apiConfig'

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

function normalizeAlert(a: any): TrustAlert {
  const alertId = a.alertId || a.alert_id || `alert-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  const alertType = a.alertType || a.alert_type || 'ALERT'
  const moduleName = a.module || 'FORENSIC'
  const severity = (a.severity?.toUpperCase?.() || 'MEDIUM') as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  const description = a.description || a.message || 'Forensic anomaly detected'
  const val = typeof a.value === 'number' && !isNaN(a.value) ? a.value : (Number(a.value) || 0)
  const timestamp = a.timestamp || new Date().toISOString()

  return {
    alertId,
    alertType,
    module: moduleName,
    severity,
    description,
    value: val,
    timestamp,
  }
}

export interface CodeSyncState {
  code: string
  language: string
  isRunning: boolean
  output: string
  executionTime?: number
  status?: string
  lastUpdated?: string
}

export function useTrustScore(sessionId: string) {
  const [score, setScore] = useState(0)
  const [breakdown, setBreakdown] = useState<TrustBreakdown>({
    prnu: 0, rppg: 0, jitter: 0, behavioral: 0
  })
  const [raw, setRaw] = useState<RawTelemetry>({
    pce: 0, snr_rppg: 0, cv_jitter: 0, behavioral_score: 0, hr_bpm: 0
  })

  // Start with EMPTY alerts per BUG 3 FIX
  const [alerts, setAlerts] = useState<TrustAlert[]>([])
  const [status, setStatus] = useState<string>('WAITING')

  // Synchronized candidate code editor & compiler state
  const [codeSync, setCodeSync] = useState<CodeSyncState>({
    code: '',
    language: 'python',
    isRunning: false,
    output: '',
  })

  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!sessionId) return

    const wsUrl = getWsUrl(`/ws/dashboard/${sessionId}`)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        if (msg.type === 'TRUST_UPDATE' || msg.type === 'TRUST_SCORE_UPDATE') {
          if (typeof msg.trust_score === 'number' && !isNaN(msg.trust_score)) {
            setScore(msg.trust_score)
          }
          if (msg.breakdown) {
            setBreakdown(prev => ({
              prnu: typeof msg.breakdown.prnu === 'number' ? msg.breakdown.prnu : prev.prnu,
              rppg: typeof msg.breakdown.rppg === 'number' ? msg.breakdown.rppg : prev.rppg,
              jitter: typeof msg.breakdown.jitter === 'number' ? msg.breakdown.jitter : prev.jitter,
              behavioral: typeof msg.breakdown.behavioral === 'number' ? msg.breakdown.behavioral : prev.behavioral,
            }))
          }
          if (msg.raw) {
            setRaw(prev => ({
              pce: typeof msg.raw.pce === 'number' ? msg.raw.pce : prev.pce,
              snr_rppg: typeof msg.raw.snr_rppg === 'number' ? msg.raw.snr_rppg : prev.snr_rppg,
              cv_jitter: typeof msg.raw.cv_jitter === 'number' ? msg.raw.cv_jitter : prev.cv_jitter,
              behavioral_score: typeof msg.raw.behavioral_score === 'number' ? msg.raw.behavioral_score : prev.behavioral_score,
              hr_bpm: typeof msg.raw.hr_bpm === 'number' ? msg.raw.hr_bpm : prev.hr_bpm,
            }))
          } else if (msg.pce !== undefined || msg.snr_rppg !== undefined) {
            setRaw(prev => ({
              pce: typeof msg.pce === 'number' ? msg.pce : prev.pce,
              snr_rppg: typeof msg.snr_rppg === 'number' ? msg.snr_rppg : prev.snr_rppg,
              cv_jitter: typeof msg.cv_jitter === 'number' ? msg.cv_jitter : prev.cv_jitter,
              behavioral_score: typeof msg.behavioral_score === 'number' ? msg.behavioral_score : prev.behavioral_score,
              hr_bpm: typeof msg.hr_bpm === 'number' ? msg.hr_bpm : prev.hr_bpm,
            }))
          }
        }
        else if (msg.type === 'ALERT') {
          const alert = normalizeAlert(msg)
          setAlerts(prev => {
            // Prevent duplicates
            if (prev.find(a => a.alertId === alert.alertId)) return prev
            return [alert, ...prev]
          })
        }
        else if (msg.type === 'EXISTING_ALERTS' && Array.isArray(msg.alerts)) {
          setAlerts(msg.alerts.map(normalizeAlert))
        }
        else if (msg.type === 'ALERT_ACKNOWLEDGED' || (msg.type === 'COMMAND_ACK' && msg.command === 'ACK_ALERT')) {
          const ackId = msg.alert_id || msg.alertId
          setAlerts(prev => prev.filter(a => a.alertId !== ackId && (a as any).alert_id !== ackId))
          if (typeof msg.new_score === 'number') {
            setScore(msg.new_score)
          }
          if (msg.breakdown) {
            setBreakdown(prev => ({ ...prev, ...msg.breakdown }))
          }
        }
        else if (msg.type === 'CODE_CHANGE') {
          setCodeSync(prev => ({
            ...prev,
            code: msg.code !== undefined ? msg.code : prev.code,
            language: msg.language || prev.language,
            lastUpdated: msg.timestamp || new Date().toISOString(),
          }))
        }
        else if (msg.type === 'CODE_RUNNING') {
          setCodeSync(prev => ({
            ...prev,
            isRunning: true,
            language: msg.language || prev.language,
          }))
        }
        else if (msg.type === 'CODE_OUTPUT') {
          setCodeSync(prev => ({
            ...prev,
            isRunning: false,
            output: msg.stdout || msg.stderr || 'Executed with no terminal output.',
            executionTime: msg.execution_time,
            status: msg.status,
            language: msg.language || prev.language,
          }))
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
        command: 'ACK_ALERT',
        alertId,
        alert_id: alertId,
      }))
    }
    // Optimistically remove alert from feed
    setAlerts(prev => prev.filter(a => a.alertId !== alertId && (a as any).alert_id !== alertId))
  }

  return {
    score,
    breakdown,
    raw,
    alerts,
    status,
    codeSync,
    acknowledgeAlert
  }
}
