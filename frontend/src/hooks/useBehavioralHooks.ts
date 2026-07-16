import { useEffect } from 'react'

export function useBehavioralHooks(ws: WebSocket | null, sessionId: string) {
  useEffect(() => {
    if (!ws) return

    const report = (type: string, meta?: object) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, sessionId, timestamp: Date.now(), ...meta }))
      }
    }

    // Tab visibility
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') report('TAB_SWITCH')
    }
    // Window blur (switching apps)
    const onBlur = () => report('WINDOW_BLUR')

    // Large clipboard paste — likely AI-generated content
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') ?? ''
      if (text.length > 200) report('LARGE_PASTE', { charCount: text.length })
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    document.addEventListener('paste', onPaste)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('paste', onPaste)
    }
  }, [ws, sessionId])
}
