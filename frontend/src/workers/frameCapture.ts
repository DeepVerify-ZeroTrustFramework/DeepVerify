const postFrameToServer = async (data: Uint8Array, sessionId: string) => {
  try {
    const blob = new Blob([data.buffer as any], { type: 'image/jpeg' })
    const formData = new FormData()
    formData.append('frame_jpeg', blob, 'frame.jpg')

    await fetch(`/api/frames/${sessionId}`, {
      method: 'POST',
      body: formData,
    })
  } catch (err) {
    console.error('Failed to post frame to server:', err)
  }
}

export function startFrameCapture(stream: MediaStream, sessionId: string) {
  const track = stream.getVideoTracks()[0]
  if (!track) throw new Error("No video track found")

  // @ts-ignore
  const processor = new MediaStreamTrackProcessor({ track })
  const reader = processor.readable.getReader()

  let captureActive = true

  const encoder = new VideoEncoder({
    output: (chunk: EncodedVideoChunk) => {
      if (chunk.type === 'key') {  // I-frame only — PRNU only works on keyframes
        // Decode back to ImageBitmap for JPEG encoding
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        // POST to /api/frames/{sessionId} as multipart/form-data JPEG
        postFrameToServer(data, sessionId)
      }
    },
    error: (e) => console.error('Encoder error:', e)
  })

  const trackSettings = track.getSettings()

  encoder.configure({
    codec: 'avc1.42001f',
    width: trackSettings.width || 1280,
    height: trackSettings.height || 720,
    bitrate: 2_000_000,
    framerate: trackSettings.frameRate || 30
  })

  const readChunk = async () => {
    if (!captureActive) return
    const { done, value } = await reader.read()
    if (done) {
      if (encoder.state !== 'closed') encoder.close()
      return
    }
    
    // value is a VideoFrame
    if (encoder.state === 'configured') {
      encoder.encode(value, { keyFrame: true })
    }
    
    value.close()
    
    if (captureActive) {
      requestAnimationFrame(() => readChunk())
    }
  }

  readChunk()

  return () => {
    captureActive = false
    if (encoder.state !== 'closed') encoder.close()
  }
}
