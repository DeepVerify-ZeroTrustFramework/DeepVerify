import { useEffect, useRef, useCallback } from 'react'

export interface BehavioralSocketOptions {
  onViolation?: (message: string, type: string) => void
}

export function useBehavioralSocket(
  sessionId: string,
  active: boolean,
  options?: BehavioralSocketOptions
) {
  const wsRef = useRef<WebSocket | null>(null)
  const onViolationRef = useRef(options?.onViolation)

  useEffect(() => {
    onViolationRef.current = options?.onViolation
  }, [options?.onViolation])

  // Establish connection
  useEffect(() => {
    if (!active || !sessionId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/candidate/${sessionId}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => console.log('[Behavioral] Connected to telemetry socket')
    ws.onclose = () => console.log('[Behavioral] Disconnected')
    ws.onerror = (e) => console.error('[Behavioral] Socket error', e)

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
  const sendEvent = useCallback((type: string, data: any = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...data }))
    }
  }, [])

  // ── Multi-Tab Shield (BroadcastChannel Detection) ──
  useEffect(() => {
    if (!active || !sessionId) return

    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(`deepverify_tab_lock_${sessionId}`)
      
      // Announce this tab is open
      channel.postMessage({ type: 'PING_TAB', tabId: Date.now() })

      channel.onmessage = (event) => {
        if (event.data?.type === 'PING_TAB' || event.data?.type === 'TAB_ACTIVE') {
          sendEvent('MULTI_TAB_VIOLATION', {
            message: 'Duplicate candidate tab opened',
            timestamp: Date.now(),
          })
          if (onViolationRef.current) {
            onViolationRef.current(
              'Multiple session tabs detected. Only one tab is permitted.',
              'MULTI_TAB'
            )
          }
        }
      }
    } catch (e) {
      // BroadcastChannel not available
    }

    return () => {
      if (channel) channel.close()
    }
  }, [active, sessionId, sendEvent])

  // ── Multi-Monitor & Screen Configuration Detection ──
  useEffect(() => {
    if (!active) return

    const checkMultiMonitor = () => {
      try {
        // 1. Check Window Management API
        // @ts-ignore
        const isExtended = Boolean(window.screen?.isExtended)

        // 2. Check virtual desktop geometry offsets (secondary screen placements)
        const screenAny = window.screen as any
        const hasOffset = (screenAny?.availLeft && screenAny.availLeft !== 0) || (screenAny?.availTop && screenAny.availTop !== 0)
        const isSpanned = window.screen.availWidth > window.screen.width * 1.5

        if (isExtended || hasOffset || isSpanned) {
          sendEvent('MULTI_MONITOR', {
            is_extended: isExtended,
            has_offset: Boolean(hasOffset),
            avail_width: window.screen.availWidth,
            screen_width: window.screen.width,
            avail_height: window.screen.availHeight,
          })
          if (onViolationRef.current) {
            onViolationRef.current(
              'Multiple displays/monitors detected. Please disconnect secondary displays.',
              'MULTI_MONITOR'
            )
          }
        }
      } catch (err) {
        // Ignore API permission checks
      }
    }

    checkMultiMonitor()
    const interval = setInterval(checkMultiMonitor, 4000)

    return () => {
      clearInterval(interval)
    }
  }, [active, sendEvent])

  // ── DOM Event Hooks: Strict Copy/Paste/Cut Blocking, Context Menu & Shortcut Trapping ──
  useEffect(() => {
    if (!active) return

    let blurStartTime = 0

    // Tab Switch (Page Visibility API)
    const handleVisibilityChange = () => {
      if (document.hidden) {
        sendEvent('TAB_SWITCH', { metadata: { url: window.location.href } })
        if (onViolationRef.current) {
          onViolationRef.current('Tab switch logged as an integrity violation.', 'TAB_SWITCH')
        }
      } else {
        sendEvent('TAB_RETURNED', { metadata: {} })
      }
    }

    // Window Blur (User clicked outside the browser window or switched desktop)
    const handleBlur = () => {
      blurStartTime = Date.now()
    }

    const handleFocus = () => {
      if (blurStartTime > 0) {
        const duration = Date.now() - blurStartTime
        sendEvent('WINDOW_BLUR', { duration_ms: duration })
        if (duration > 1200 && onViolationRef.current) {
          onViolationRef.current(
            `Window lost focus for ${(duration / 1000).toFixed(1)}s (clicked outside test window).`,
            'WINDOW_BLUR'
          )
        }
        blurStartTime = 0
      }
    }

    // Strictly Block Right-Click Context Menu
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      sendEvent('CONTEXT_MENU_BLOCKED', { action: 'RIGHT_CLICK' })
      if (onViolationRef.current) {
        onViolationRef.current('Right-click context menu is disabled.', 'CONTEXT_MENU')
      }
      return false
    }

    // Strictly Block Copying
    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      sendEvent('CLIPBOARD_VIOLATION', { action: 'COPY_ATTEMPT' })
      if (onViolationRef.current) {
        onViolationRef.current('Copying text is disabled during the interview.', 'CLIPBOARD')
      }
      return false
    }

    // Strictly Block Cutting
    const handleCut = (e: ClipboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      sendEvent('CLIPBOARD_VIOLATION', { action: 'CUT_ATTEMPT' })
      if (onViolationRef.current) {
        onViolationRef.current('Cut action is disabled during the interview.', 'CLIPBOARD')
      }
      return false
    }

    // Strictly Block Pasting (Ctrl+V, Right Click Paste, Middle Click Paste)
    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      sendEvent('CLIPBOARD_VIOLATION', { action: 'PASTE_ATTEMPT' })
      if (onViolationRef.current) {
        onViolationRef.current('Pasting text/code is disabled during the interview.', 'CLIPBOARD')
      }
      return false
    }

    // Strictly Block Drag and Drop of text/files
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (onViolationRef.current) {
        onViolationRef.current('Dragging and dropping content is disabled.', 'CLIPBOARD')
      }
    }

    // Strictly Intercept Suspicious Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e || !e.key) return
      const isCtrlOrCmd = e.ctrlKey || e.metaKey
      const key = (e.key || '').toLowerCase()

      // Block Developer Tools shortcuts (F12, Ctrl+Shift+I/J/C, Ctrl+U)
      if (
        e.key === 'F12' ||
        (isCtrlOrCmd && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) ||
        (isCtrlOrCmd && key === 'u')
      ) {
        e.preventDefault()
        e.stopPropagation()
        sendEvent('DEVTOOLS_ATTEMPT', { shortcut: e.key })
        if (onViolationRef.current) {
          onViolationRef.current('Developer tools are disabled.', 'DEVTOOLS')
        }
        return false
      }

      // Block Copy (Ctrl+C, Ctrl+Insert), Cut (Ctrl+X), Paste (Ctrl+V, Shift+Insert), Print (Ctrl+P), Save (Ctrl+S)
      if (
        (isCtrlOrCmd && (key === 'c' || key === 'v' || key === 'x' || key === 'p' || key === 's')) ||
        (e.shiftKey && e.key === 'Insert') ||
        (e.ctrlKey && e.key === 'Insert')
      ) {
        e.preventDefault()
        e.stopPropagation()
        const actionLabel = key === 'v' || e.key === 'Insert' ? 'Paste' : key === 'c' ? 'Copy' : key === 'x' ? 'Cut' : 'Shortcut'
        sendEvent('CLIPBOARD_VIOLATION', { shortcut: `Ctrl+${key.toUpperCase()}` })
        if (onViolationRef.current) {
          onViolationRef.current(`${actionLabel} shortcut (Ctrl+${key.toUpperCase()}) is disabled.`, 'CLIPBOARD')
        }
        return false
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange, true)
    window.addEventListener('blur', handleBlur, true)
    window.addEventListener('focus', handleFocus, true)
    document.addEventListener('contextmenu', handleContextMenu, true)
    document.addEventListener('copy', handleCopy, true)
    document.addEventListener('cut', handleCut, true)
    document.addEventListener('paste', handlePaste, true)
    document.addEventListener('dragover', handleDragOver, true)
    document.addEventListener('drop', handleDrop, true)
    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange, true)
      window.removeEventListener('blur', handleBlur, true)
      window.removeEventListener('focus', handleFocus, true)
      document.removeEventListener('contextmenu', handleContextMenu, true)
      document.removeEventListener('copy', handleCopy, true)
      document.removeEventListener('cut', handleCut, true)
      document.removeEventListener('paste', handlePaste, true)
      document.removeEventListener('dragover', handleDragOver, true)
      document.removeEventListener('drop', handleDrop, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [active, sendEvent])

  // Send Gaze and Facial Telemetry
  const sendGaze = useCallback(
    (
      delta: number,
      yaw: number,
      pitch: number,
      extra: {
        faceCount?: number
        isAbsent?: boolean
        isMultiFace?: boolean
        screenReflection?: { detected: boolean; glareRatio: number; blueRatio: number }
      } = {}
    ) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'GAZE',
            delta,
            yaw,
            pitch,
            face_count: extra.faceCount ?? 1,
            is_absent: extra.isAbsent ?? false,
            is_multi_face: extra.isMultiFace ?? false,
            screen_reflection: extra.screenReflection ?? {
              detected: false,
              glareRatio: 0,
              blueRatio: 0,
            },
            timestamp: performance.now(),
          })
        )
      }
    },
    []
  )

  // Send Prohibited Object Detection
  const sendProhibitedObject = useCallback(
    (data: { object: string; score: number; bbox?: number[] }) => {
      sendEvent('PROHIBITED_OBJECT', {
        object: data.object,
        score: data.score,
        bbox: data.bbox || [],
        timestamp: performance.now(),
      })
      if (onViolationRef.current) {
        onViolationRef.current(
          `Prohibited item detected: ${data.object.toUpperCase()} (${Math.round(data.score * 100)}% confidence)`,
          'PROHIBITED_OBJECT'
        )
      }
    },
    [sendEvent]
  )

  // Send Frame Metrics
  const sendFrameMetrics = useCallback(
    (metrics: { pce?: number; snr_rppg?: number; cv_jitter?: number; hr_bpm?: number }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'FRAME_METRICS',
            ...metrics,
            timestamp: performance.now(),
          })
        )
      }
    },
    []
  )

  return {
    sendEvent,
    sendGaze,
    sendProhibitedObject,
    sendFrameMetrics,
  }
}
