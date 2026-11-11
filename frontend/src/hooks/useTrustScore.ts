import { useState, useEffect, useRef } from 'react'
import { getWsUrl } from '../utils/apiConfig'

export interface LivenessState {
  // none | requested | active | passed | failed | skipped
  state: string
  origin?: string
  wrongAttempts?: number
  reactionS?: number
  at?: string
}

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
  seq?: number
}

export function useTrustScore(sessionId: string) {
  const [score, setScore] = useState(0)
  // Demo uploads: true when the file has no measurable camera fingerprint
  const [inconclusive, setInconclusive] = useState(false)
  const [breakdown, setBreakdown] = useState<TrustBreakdown>({
    prnu: 0, rppg: 0, jitter: 0, behavioral: 0
  })
  const [raw, setRaw] = useState<RawTelemetry>({
    pce: 0, snr_rppg: 0, cv_jitter: 0, behavioral_score: 0, hr_bpm: 0
  })

  // Start with EMPTY alerts per BUG 3 FIX
  const [alerts, setAlerts] = useState<TrustAlert[]>([])
  const [status, setStatus] = useState<string>('WAITING')
  // Alerts the interviewer cleared from the feed (still counted in totals)
  const [clearedCount, setClearedCount] = useState(0)
  // Live state of the candidate's liveness check (see backend frames.py)
  const [liveness, setLiveness] = useState<LivenessState>({ state: 'none' })
  const [livenessNotice, setLivenessNotice] = useState<string | null>(null)

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

    // Keep the interviewer's live connection up. It used to connect once and never
    // reconnect, so after any drop (server error, Render proxy timeout, network
    // blip) no more alerts arrived while video and code (peer-to-peer) still worked.
    // On reconnect the server re-sends the current alerts and score history.
    let closed = false
    let retry = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
    if (closed) return
    const wsUrl = getWsUrl(`/ws/dashboard/${sessionId}`)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      retry = 0
      console.log('[Dashboard] Connected')
    }
    ws.onclose = (e) => {
      if (wsRef.current === ws) wsRef.current = null
      if (closed) return
      const delay = Math.min(10000, 500 * 2 ** retry++)
      console.warn(`[Dashboard] Disconnected (code ${e.code}) - reconnecting in ${delay}ms`)
      retryTimer = setTimeout(connect, delay)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        if (msg.type === 'TRUST_UPDATE' || msg.type === 'TRUST_SCORE_UPDATE') {
          if (typeof msg.trust_score === 'number' && !isNaN(msg.trust_score)) {
            setScore(msg.trust_score)
          }
          if (typeof msg.inconclusive === 'boolean') {
            setInconclusive(msg.inconclusive)
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
        else if (msg.type === 'LIVENESS_STATUS') {
          setLiveness({
            state: msg.state || 'none',
            origin: msg.origin || undefined,
            wrongAttempts: typeof msg.wrong_attempts === 'number' ? msg.wrong_attempts : undefined,
            reactionS: typeof msg.reaction_s === 'number' ? msg.reaction_s : undefined,
            at: msg.timestamp,
          })
        }
        else if (msg.type === 'COMMAND_ACK' && msg.command === 'RUN_LIVENESS') {
          setLivenessNotice(msg.message || null)
          if (msg.result === 'started') setLiveness(prev => ({ ...prev, state: 'requested', origin: 'interviewer' }))
          setTimeout(() => setLivenessNotice(null), 5000)
        }
        else if (msg.type === 'ALERTS_CLEARED_COUNT' && typeof msg.count === 'number') {
          setClearedCount(msg.count)
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
          setCodeSync(prev => {
            // Ignore out-of-date copies (P2P data channel may already be ahead)
            if (typeof msg.seq === 'number' && typeof prev.seq === 'number' && msg.seq <= prev.seq) return prev
            return {
            ...prev,
            seq: typeof msg.seq === 'number' ? msg.seq : prev.seq,
            code: msg.code !== undefined ? msg.code : prev.code,
            language: msg.language || prev.language,
            lastUpdated: msg.timestamp || new Date().toISOString(),
            }
          })
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

    }
    connect()

    const pingInterval = setInterval(() => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 20000)

    return () => {
      closed = true
      clearInterval(pingInterval)
      if (retryTimer) clearTimeout(retryTimer)
      wsRef.current?.close()
      wsRef.current = null
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

  // Interviewer button: open a liveness check on the candidate's screen now.
  const runLivenessCheck = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'RUN_LIVENESS' }))
    } else {
      setLivenessNotice('Dashboard is not connected - try again in a moment')
      setTimeout(() => setLivenessNotice(null), 5000)
    }
  }

  // Clear the anomaly feed. Purely visual: alerts are not excused and the trust
  // score is untouched. The server remembers it so a page refresh stays clean.
  const clearAlerts = () => {
    const ids = alerts.map(a => a.alertId || (a as any).alert_id).filter(Boolean)
    if (ids.length === 0) return
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'CLEAR_ALERTS', alert_ids: ids }))
    }
    setClearedCount(c => c + ids.length)
    setAlerts(prev => prev.filter(a => !ids.includes(a.alertId || (a as any).alert_id)))
  }

  return {
    score,
    inconclusive,
    breakdown,
    raw,
    alerts,
    status,
    codeSync,
    acknowledgeAlert,
    clearAlerts,
    clearedCount,
    liveness,
    livenessNotice,
    runLivenessCheck,
  }
}
