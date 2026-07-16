import { useEffect, useRef, useCallback } from 'react'

export function useBehavioralSocket(sessionId: string, active: boolean) {
  const wsRef = useRef<WebSocket | null>(null)
  
  // Establish connection
  useEffect(() => {
    if (!active || !sessionId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    // Connect to Vite proxy which forwards to backend
    const wsUrl = `${protocol}//${window.location.host}/ws/candidate/${sessionId}`
    
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => console.log('[Behavioral] Connected to telemetry socket')
    ws.onclose = () => console.log('[Behavioral] Disconnected')
    ws.onerror = (e) => console.error('[Behavioral] Socket error', e)

    // Ping interval to keep alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)

    return () => {
      clearInterval(pingInterval)
      ws.close()
    }
  }, [sessionId, active])

  // Send generic event
  const sendEvent = useCallback((type: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...data }))
    }
  }, [])

  // DOM Event Hooks
  useEffect(() => {
    if (!active) return

    let blurStartTime = 0

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab switch
        sendEvent('TAB_SWITCH', { metadata: { url: window.location.href } })
      } else {
        // Returned to tab
        sendEvent('TAB_RETURNED', { metadata: {} })
      }
    }

    const handleBlur = () => {
      blurStartTime = Date.now()
    }

    const handleFocus = () => {
      if (blurStartTime > 0) {
        const duration = Date.now() - blurStartTime
        sendEvent('WINDOW_BLUR', { duration_ms: duration })
        blurStartTime = 0
      }
    }

    const handlePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') || ''
      if (text.length > 50) { // Large paste threshold
        sendEvent('LARGE_PASTE', { char_count: text.length })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('paste', handlePaste)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('paste', handlePaste)
    }
  }, [active, sendEvent])

  // Send Gaze event (called by MediaPipe worker or mock)
  const sendGaze = useCallback((delta: number, yaw: number, pitch: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'GAZE',
        delta,
        yaw,
        pitch,
        timestamp: performance.now()
      }))
    }
  }, [])

  // Send Frame Metrics (PCE, rPPG SNR, Jitter CV)
  const sendFrameMetrics = useCallback((metrics: { pce?: number, snr_rppg?: number, cv_jitter?: number, hr_bpm?: number }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'FRAME_METRICS',
        ...metrics,
        timestamp: performance.now()
      }))
    }
  }, [])

  return {
    sendEvent,
    sendGaze,
    sendFrameMetrics
  }
}
