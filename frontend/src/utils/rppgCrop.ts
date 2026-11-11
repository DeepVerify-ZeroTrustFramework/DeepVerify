// rPPG face-crop stream.
//
// The server sends FACE_BOX messages ({x, y, w, h} normalised to the full video
// frame) on the frames WebSocket. This helper crops that box from the camera's
// own pixels ~15 times a second, scales it to at most 160 px, and sends it as
// b'DVRP' + JPEG. The pulse is then read from cleaner, more frequent samples
// than the 10 fps 320x240 frames. Stops by itself when the socket closes.

type FaceBox = { x: number; y: number; w: number; h: number; t: number }

const RPPG_FPS = 15
const MAX_SIDE = 160

export function startRppgCropStream(
  ws: WebSocket,
  getVideo: () => HTMLVideoElement | null,
  enabled: () => boolean = () => true,
): () => void {
  let box: FaceBox | null = null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  const onMessage = (ev: MessageEvent) => {
    if (typeof ev.data !== 'string') return
    try {
      const m = JSON.parse(ev.data)
      if (m && m.type === 'FACE_BOX') box = { x: m.x, y: m.y, w: m.w, h: m.h, t: Date.now() }
    } catch {
      // not JSON — ignore
    }
  }
  ws.addEventListener('message', onMessage)

  const stop = () => {
    clearInterval(timer)
    ws.removeEventListener('message', onMessage)
  }

  const timer = setInterval(() => {
    if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      stop()
      return
    }
    if (ws.readyState !== WebSocket.OPEN || !enabled() || !ctx) return
    // Skip when the socket is backed up (slow uplink) so crops stay real-time
    if (ws.bufferedAmount > 256 * 1024) return
    if (!box || Date.now() - box.t > 3000) return // no recent face position
    if (ws.bufferedAmount > 512 * 1024) return     // network can't keep up: skip
    const video = getVideo()
    if (!video || video.readyState < 2 || video.paused || video.ended) return
    const vw = video.videoWidth
    const vh = video.videoHeight
    const sx = Math.max(0, Math.floor(box.x * vw))
    const sy = Math.max(0, Math.floor(box.y * vh))
    const sw = Math.min(vw - sx, Math.floor(box.w * vw))
    const sh = Math.min(vh - sy, Math.floor(box.h * vh))
    if (sw < 24 || sh < 24) return
    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh))
    canvas.width = Math.max(1, Math.round(sw * scale))
    canvas.height = Math.max(1, Math.round(sh * scale))
    try {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    } catch {
      return
    }
    canvas.toBlob((blob) => {
      if (!blob || ws.readyState !== WebSocket.OPEN) return
      blob.arrayBuffer().then((jpeg) => {
        const packet = new Uint8Array(4 + jpeg.byteLength)
        packet.set([0x44, 0x56, 0x52, 0x50]) // 'DVRP'
        packet.set(new Uint8Array(jpeg), 4)
        if (ws.readyState === WebSocket.OPEN && enabled()) ws.send(packet.buffer)
      })
    }, 'image/jpeg', 0.92)
  }, 1000 / RPPG_FPS)

  return stop
}
