import { FaceMesh } from '@mediapipe/face_mesh'

const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` })

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,  // enables iris tracking (landmarks 468–477)
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
})

faceMesh.onResults((results) => {
  if (!results.multiFaceLandmarks || !results.multiFaceLandmarks[0]) return
  const landmarks = results.multiFaceLandmarks[0]

  // Iris landmarks: left iris center = 468, right iris center = 473
  // Eye bounding box landmarks: left eye = [33,133], right eye = [362,263]
  const leftIris = landmarks[468]
  const leftEyeLeft = landmarks[33]
  const leftEyeRight = landmarks[133]

  if (!leftIris || !leftEyeLeft || !leftEyeRight) return

  const gaze_x = (leftIris.x - leftEyeLeft.x) / (leftEyeRight.x - leftEyeLeft.x)
  const gaze_y = (leftIris.y - leftEyeLeft.y) / (leftEyeRight.y - leftEyeLeft.y)
  const delta = Math.sqrt(Math.pow(gaze_x - 0.5, 2) + Math.pow(gaze_y - 0.5, 2))

  // Head pose from PnP on 6 landmarks: 1(nose tip), 33(left eye), 263(right eye),
  // 61(mouth left), 291(mouth right), 199(chin)
  // Send to main thread every 500ms
  self.postMessage({ type: 'GAZE', gaze_x, gaze_y, delta, timestamp: Date.now() })
})

// Process frames via OffscreenCanvas
self.onmessage = async (e: MessageEvent) => {
  if (e.data.type === 'FRAME' && e.data.bitmap) {
    try {
      await faceMesh.send({ image: e.data.bitmap })
    } catch (err) {
      console.error("FaceMesh processing error:", err)
    } finally {
      if (e.data.bitmap.close) {
        e.data.bitmap.close()
      }
    }
  }
}
