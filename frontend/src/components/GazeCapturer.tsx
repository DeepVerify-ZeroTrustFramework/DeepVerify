/**
 * GazeCapturer — MediaPipe FaceMesh gaze tracking component.
 * Computes iris position, head pose (yaw/pitch/roll), and deviation metrics.
 * Streams data to parent via callback every 500ms.
 * 
 * Uses @mediapipe/face_mesh loaded from CDN via index.html.
 * Falls back to canvas-based simple face position tracking if MediaPipe unavailable.
 */
import React, { useEffect, useRef, useCallback, useState } from 'react'

interface GazeData {
  gaze_x: number
  gaze_y: number
  delta: number
  yaw: number
  pitch: number
  roll: number
  timestamp: number
}

interface GazeCapturerProps {
  videoElement?: HTMLVideoElement | null
  stream?: MediaStream | null
  onGazeData?: (data: GazeData) => void
  enabled?: boolean
}

// Landmark indices for eye tracking
const LEFT_EYE_INNER = 133
const LEFT_EYE_OUTER = 33
const RIGHT_EYE_INNER = 362
const RIGHT_EYE_OUTER = 263
const LEFT_IRIS_CENTER = 468
const RIGHT_IRIS_CENTER = 473
const LEFT_EYE_TOP = 159
const LEFT_EYE_BOTTOM = 145
const RIGHT_EYE_TOP = 386
const RIGHT_EYE_BOTTOM = 374

const POSE_LANDMARKS = [1, 152, 33, 263, 61, 291]

const GazeCapturer: React.FC<GazeCapturerProps> = ({
  stream,
  onGazeData,
  enabled = true,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastCallbackTime = useRef(0)
  const animFrameRef = useRef<number | null>(null)
  const faceMeshRef = useRef<any>(null)
  const [mediaPipeReady, setMediaPipeReady] = useState(false)

  // Compute gaze metrics from landmarks
  const computeGaze = useCallback((landmarks: any[]) => {
    if (!landmarks || landmarks.length < 478) {
      return null
    }

    // Ensure all critical pose landmarks are present before proceeding
    const hasAllPoseLandmarks = POSE_LANDMARKS.every(idx => landmarks[idx])
    if (!hasAllPoseLandmarks) return null

    // Left eye gaze
    const leftInner = landmarks[LEFT_EYE_INNER]
    const leftOuter = landmarks[LEFT_EYE_OUTER]
    const leftIris = landmarks[LEFT_IRIS_CENTER]
    const leftTop = landmarks[LEFT_EYE_TOP]
    const leftBottom = landmarks[LEFT_EYE_BOTTOM]

    // Right eye gaze
    const rightInner = landmarks[RIGHT_EYE_INNER]
    const rightOuter = landmarks[RIGHT_EYE_OUTER]
    const rightIris = landmarks[RIGHT_IRIS_CENTER]
    const rightTop = landmarks[RIGHT_EYE_TOP]
    const rightBottom = landmarks[RIGHT_EYE_BOTTOM]

    // Normalized gaze position (average of both eyes)
    const leftGazeX = (leftIris.x - leftOuter.x) / (leftInner.x - leftOuter.x + 1e-8)
    const rightGazeX = (rightIris.x - rightOuter.x) / (rightInner.x - rightOuter.x + 1e-8)
    const gazeX = (leftGazeX + rightGazeX) / 2

    const leftGazeY = (leftIris.y - leftTop.y) / (leftBottom.y - leftTop.y + 1e-8)
    const rightGazeY = (rightIris.y - rightTop.y) / (rightBottom.y - rightTop.y + 1e-8)
    const gazeY = (leftGazeY + rightGazeY) / 2

    // Deviation from center
    const delta = Math.sqrt(
      Math.pow(gazeX - 0.5, 2) + Math.pow(gazeY - 0.5, 2)
    )

    // Simplified head pose estimation using landmark positions
    // Using nose tip and face edges to estimate rotation
    const noseTip = landmarks[1]
    const chin = landmarks[152]
    const leftEye = landmarks[33]
    const rightEye = landmarks[263]

    // Yaw: horizontal displacement of nose relative to eyes center
    const eyesCenterX = (leftEye.x + rightEye.x) / 2
    const yaw = (noseTip.x - eyesCenterX) * 180 / 0.5  // Approximate degrees

    // Pitch: vertical displacement of nose relative to eyes-chin midpoint
    const eyesCenterY = (leftEye.y + rightEye.y) / 2
    const faceCenterY = (eyesCenterY + chin.y) / 2
    const pitch = (noseTip.y - faceCenterY) * 180 / 0.5

    // Roll: angle of eye line
    const roll = Math.atan2(
      rightEye.y - leftEye.y,
      rightEye.x - leftEye.x
    ) * (180 / Math.PI)

    return {
      gaze_x: gazeX,
      gaze_y: gazeY,
      delta,
      yaw: yaw * 2, // Scale to approximate degrees
      pitch: pitch * 2,
      roll,
      timestamp: Date.now() / 1000,
    }
  }, [])

  // Canvas-based simple face position tracking (fallback when MediaPipe unavailable)
  // Uses brightness centroid to approximate face position for crude head turn detection
  const computeFallbackGaze = useCallback((): GazeData | null => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return null

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null

    // Sample a small region for performance
    const w = 160
    const h = 120
    canvas.width = w
    canvas.height = h
    ctx.drawImage(video, 0, 0, w, h)

    try {
      const imageData = ctx.getImageData(0, 0, w, h)
      const data = imageData.data

      // Compute brightness-weighted centroid (skin-tone biased)
      let sumX = 0, sumY = 0, totalWeight = 0
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const idx = (y * w + x) * 4
          const r = data[idx], g = data[idx + 1], b = data[idx + 2]
          // Simple skin-tone filter: R > 80, G > 40, R > G > B
          const isSkinLike = r > 80 && g > 40 && r > g && g > b
          if (isSkinLike) {
            const weight = r + g + b
            sumX += x * weight
            sumY += y * weight
            totalWeight += weight
          }
        }
      }

      if (totalWeight < 1000) {
        // Not enough skin-like pixels found — face not visible
        return {
          gaze_x: 0.5, gaze_y: 0.5, delta: 0.5,
          yaw: 30, pitch: 0, roll: 0,
          timestamp: Date.now() / 1000,
        }
      }

      const centroidX = sumX / totalWeight / w  // normalized [0, 1]
      const centroidY = sumY / totalWeight / h

      // Deviation from center (0.5, 0.4 — slightly above center for face)
      const dx = centroidX - 0.5
      const dy = centroidY - 0.4

      // Map horizontal deviation to approximate yaw in degrees
      // Centroid shifts are very small for stationary head turns
      const yaw = dx * 600  // Increased scale factor so a small shift triggers > 10°
      const pitch = dy * 400

      const delta = Math.sqrt(dx * dx + dy * dy) * 3

      return {
        gaze_x: centroidX,
        gaze_y: centroidY,
        delta,
        yaw,
        pitch,
        roll: 0,
        timestamp: Date.now() / 1000,
      }
    } catch {
      return null
    }
  }, [])

  // Process video frame
  const processFrame = useCallback(async () => {
    if (!enabled || !videoRef.current || !canvasRef.current) {
      animFrameRef.current = requestAnimationFrame(() => processFrame())
      return
    }

    const now = Date.now()
    if (now - lastCallbackTime.current < 400) { // 400ms throttle (~2.5 Hz)
      animFrameRef.current = requestAnimationFrame(processFrame)
      return
    }

    const video = videoRef.current
    if (video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(processFrame)
      return
    }

    // If FaceMesh is loaded, process the frame through MediaPipe
    if (faceMeshRef.current) {
      try {
        await faceMeshRef.current.send({ image: video })
      } catch (e) {
        // FaceMesh processing error — skip frame
      }
    } else {
      // Fallback: use canvas-based centroid tracking
      const gazeData = computeFallbackGaze()
      if (gazeData && onGazeData) {
        onGazeData(gazeData)
        lastCallbackTime.current = now
      }
    }

    animFrameRef.current = requestAnimationFrame(() => processFrame())
  }, [enabled, onGazeData, computeGaze, computeFallbackGaze])

  // Initialize video from stream
  useEffect(() => {
    if (!stream || !videoRef.current) return

    videoRef.current.srcObject = stream
    videoRef.current.play().catch(console.error)
  }, [stream])

  // Start processing loop
  useEffect(() => {
    if (!enabled) return

    // Try to load MediaPipe FaceMesh with retries
    const loadFaceMesh = async () => {
      // Poll for window.FaceMesh (CDN script may still be loading)
      for (let attempt = 0; attempt < 20; attempt++) {
        // @ts-ignore
        if (window.FaceMesh) {
          try {
            // @ts-ignore
            const faceMesh = new window.FaceMesh({
              locateFile: (file: string) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
              }
            })

            faceMesh.setOptions({
              maxNumFaces: 1,
              refineLandmarks: true,
              minDetectionConfidence: 0.5,
              minTrackingConfidence: 0.5,
            })

            faceMesh.onResults((results: any) => {
              if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                const landmarks = results.multiFaceLandmarks[0]
                const gazeData = computeGaze(landmarks)
                if (gazeData && onGazeData) {
                  const now = Date.now()
                  if (now - lastCallbackTime.current >= 500) {
                    onGazeData(gazeData)
                    lastCallbackTime.current = now
                  }
                }
              }
            })

            faceMeshRef.current = faceMesh
            setMediaPipeReady(true)
            console.log('[GazeCapturer] MediaPipe FaceMesh loaded successfully')
            return
          } catch (e) {
            console.warn('[GazeCapturer] MediaPipe init error:', e)
            break
          }
        }
        // Wait 500ms before next attempt
        await new Promise(r => setTimeout(r, 500))
      }
      console.log('[GazeCapturer] MediaPipe unavailable — using canvas-based face tracking fallback')
    }

    loadFaceMesh()
    animFrameRef.current = requestAnimationFrame(processFrame)

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [enabled, processFrame, computeGaze, onGazeData])

  return (
    <>
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />
    </>
  )
}

export default GazeCapturer
