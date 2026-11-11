// Camera frame timing for the jitter check.
//
// requestVideoFrameCallback fires once per new camera frame and carries the
// frame's own timestamp (captureTime for camera tracks, else mediaTime). The
// intervals between frames are sent to the server every 2 s as
// {type: 'FRAME_TIMING', intervals: [ms...], clock}. A real webcam delivers a
// steady rate; a rendered or injected source shows irregular gaps.
// Stops by itself when the socket closes.

export function startFrameTiming(
  ws: WebSocket,
  getVideo: () => HTMLVideoElement | null,
  enabled: () => boolean = () => true,
): () => void {
  let stopped = false
  let last: number | null = null
  let lastVideo: HTMLVideoElement | null = null
  let clock = ''
  let buf: number[] = []

  const onFrame = (now: number, meta: any) => {
    if (stopped) return
    let t: number
    let c: string
    if (meta && typeof meta.captureTime === 'number' && meta.captureTime > 0) {
      t = meta.captureTime; c = 'capture'
    } else if (meta && typeof meta.mediaTime === 'number' && meta.mediaTime > 0) {
      t = meta.mediaTime * 1000; c = 'media'
    } else {
      t = now; c = 'display'
    }
    if (c !== clock) { clock = c; last = null }   // never mix clocks
    if (last !== null && enabled()) {
      const d = t - last
      if (d > 0 && d < 1000) buf.push(Math.round(d * 100) / 100)
    }
    last = t
    register()
  }

  const register = () => {
    if (stopped) return
    const v = getVideo() as any
    if (v && typeof v.requestVideoFrameCallback === 'function') {
      if (v !== lastVideo) { lastVideo = v; last = null }
      v.requestVideoFrameCallback(onFrame)
    } else {
      setTimeout(register, 500)  // video not ready yet (or browser without the API)
    }
  }

  const sender = setInterval(() => {
    if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      stop()
      return
    }
    if (ws.readyState !== WebSocket.OPEN || buf.length === 0) return
    ws.send(JSON.stringify({ type: 'FRAME_TIMING', intervals: buf.slice(-120), clock }))
    buf = []
  }, 2000)

  const stop = () => {
    stopped = true
    clearInterval(sender)
  }

  register()
  return stop
}
