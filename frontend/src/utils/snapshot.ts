// AI face check snapshots.
//
// When the server sends {type: 'SNAPSHOT_REQUEST'} on the frames WebSocket, reply
// with one full-resolution frame of the camera (longest side capped at 1280 px)
// as b'DVSN' + JPEG. The server forwards it to the external AI face check.
// A few times per session at most. Stops by itself when the socket closes.

export function attachSnapshotResponder(
  ws: WebSocket,
  getVideo: () => HTMLVideoElement | null,
  enabled: () => boolean = () => true,
): () => void {
  const canvas = document.createElement('canvas')
  const onMessage = (ev: MessageEvent) => {
    if (typeof ev.data !== 'string') return
    let m: any
    try { m = JSON.parse(ev.data) } catch { return }
    if (!m || m.type !== 'SNAPSHOT_REQUEST' || !enabled()) return
    const v = getVideo()
    if (!v || v.readyState < 2 || !v.videoWidth) return
    const s = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight))
    canvas.width = Math.round(v.videoWidth * s)
    canvas.height = Math.round(v.videoHeight * s)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob || ws.readyState !== WebSocket.OPEN) return
      blob.arrayBuffer().then((jpeg) => {
        const pk = new Uint8Array(4 + jpeg.byteLength)
        pk.set([0x44, 0x56, 0x53, 0x4e]) // 'DVSN'
        pk.set(new Uint8Array(jpeg), 4)
        if (ws.readyState === WebSocket.OPEN) ws.send(pk.buffer)
      })
    }, 'image/jpeg', 0.92)
  }
  ws.addEventListener('message', onMessage)
  const onClose = () => ws.removeEventListener('message', onMessage)
  ws.addEventListener('close', onClose)
  return () => { ws.removeEventListener('message', onMessage); ws.removeEventListener('close', onClose) }
}
