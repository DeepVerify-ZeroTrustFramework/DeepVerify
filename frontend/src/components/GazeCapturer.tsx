/**
 * GazeCapturer — MediaPipe FaceMesh tracking component.
 * Computes:
 * - Gaze iris deviation & Head pose (yaw/pitch/roll)
 * - Multi-Face Detection (detects 0 faces, 1 face, or multiple people in frame)
 * - Screen Reflection / Specular Glare Detection on glasses/eyes
 * 
 * Streams telemetry data to parent callback every ~400-500ms.
 */
import React, { useEffect, useRef, useCallback, useState } from 'react'

export interface ScreenReflectionData {
  detected: boolean
  glareRatio: number
  blueRatio: number
}

export interface GazeData {
  gaze_x: number
  gaze_y: number
  delta: number
  yaw: number
  pitch: number
  roll: number
  timestamp: number
  faceCount: number
  isAbsent: boolean
  isMultiFace: boolean
  screenReflection: ScreenReflectionData
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

// Orbital / Glasses landmarks for reflection analysis
const LEFT_ORBIT_LANDMARKS = [33, 133, 159, 145, 70, 63, 105, 66, 107]
const RIGHT_ORBIT_LANDMARKS = [263, 362, 386, 374, 336, 296, 334, 293, 300]

export const GazeCapturer: React.FC<GazeCapturerProps> = ({
  stream,
  onGazeData,
  enabled = true,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastCallbackTime = useRef(0)
  const isProcessingRef = useRef(false)
  const faceMeshRef = useRef<any>(null)
  const [, setMediaPipeReady] = useState(false)
  const absenceStartRef = useRef<number | null>(null)

  // Analyze specular glare and secondary screen reflections on glasses / eyes
  const analyzeScreenReflection = useCallback((landmarks: any[]): ScreenReflectionData => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2 || !landmarks) {
      return { detected: false, glareRatio: 0, blueRatio: 0 }
    }

    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return { detected: false, glareRatio: 0, blueRatio: 0 }

      const w = 160
      const h = 120
      canvas.width = w
      canvas.height = h
      ctx.drawImage(video, 0, 0, w, h)

      // Sample pixels in the eye & glasses bounding box
      const sampleLandmarks = [...LEFT_ORBIT_LANDMARKS, ...RIGHT_ORBIT_LANDMARKS]
      let glarePixels = 0
      let totalSampled = 0
      let sumBlueRatio = 0

      for (const idx of sampleLandmarks) {
        const pt = landmarks[idx]
        if (!pt) continue

        const px = Math.min(w - 1, Math.max(0, Math.round(pt.x * w)))
        const py = Math.min(h - 1, Math.max(0, Math.round(pt.y * h)))

        // Sample a 5x5 patch around each eye landmark
        const halfSize = 2
        for (let dy = -halfSize; dy <= halfSize; dy++) {
          for (let dx = -halfSize; dx <= halfSize; dx++) {
            const sx = Math.min(w - 1, Math.max(0, px + dx))
            const sy = Math.min(h - 1, Math.max(0, py + dy))
            const pixel = ctx.getImageData(sx, sy, 1, 1).data
            const r = pixel[0]
            const g = pixel[1]
            const b = pixel[2]

            const luminance = 0.299 * r + 0.587 * g + 0.114 * b
            const totalColor = r + g + b + 1e-5
            const blueRatio = b / totalColor

            // Glare: High luminance (> 215) with specular characteristics or strong screen blue/cyan tint
            const isSpecular = luminance > 215 && (Math.max(r, g, b) - Math.min(r, g, b) < 45)
            const isScreenTint = luminance > 160 && blueRatio > 0.38

            if (isSpecular || isScreenTint) {
              glarePixels++
            }
            sumBlueRatio += blueRatio
            totalSampled++
          }
        }
      }

      const glareRatio = totalSampled > 0 ? glarePixels / totalSampled : 0
      const avgBlueRatio = totalSampled > 0 ? sumBlueRatio / totalSampled : 0
      const detected = glareRatio > 0.14 || (glareRatio > 0.08 && avgBlueRatio > 0.40)

      return {
        detected,
        glareRatio: Math.round(glareRatio * 100) / 100,
        blueRatio: Math.round(avgBlueRatio * 100) / 100,
      }
    } catch {
      return { detected: false, glareRatio: 0, blueRatio: 0 }
    }
  }, [])

  // Compute gaze metrics from landmarks
  const computeGaze = useCallback((landmarks: any[], faceCount: number): GazeData | null => {
    if (!landmarks || landmarks.length < 478) {
      return null
    }

    const hasAllPoseLandmarks = POSE_LANDMARKS.every((idx) => landmarks[idx])
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
    const delta = Math.sqrt(Math.pow(gazeX - 0.5, 2) + Math.pow(gazeY - 0.5, 2))

    // Head pose estimation
    const noseTip = landmarks[1]
    const chin = landmarks[152]
    const leftEye = landmarks[33]
    const rightEye = landmarks[263]

    const eyesCenterX = (leftEye.x + rightEye.x) / 2
    const yaw = ((noseTip.x - eyesCenterX) * 180) / 0.5

    const eyesCenterY = (leftEye.y + rightEye.y) / 2
    const faceCenterY = (eyesCenterY + chin.y) / 2
    const pitch = ((noseTip.y - faceCenterY) * 180) / 0.5

    const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI)

    // Analyze ocular reflection
    const reflection = analyzeScreenReflection(landmarks)

    return {
      gaze_x: gazeX,
      gaze_y: gazeY,
      delta,
      yaw: yaw * 2,
      pitch: pitch * 2,
      roll,
      timestamp: Date.now() / 1000,
      faceCount,
      isAbsent: false,
      isMultiFace: faceCount > 1,
      screenReflection: reflection,
    }
  }, [analyzeScreenReflection])

  // Canvas-based simple face position tracking fallback
  const computeFallbackGaze = useCallback((): GazeData | null => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return null

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null

    const w = 160
    const h = 120
    canvas.width = w
    canvas.height = h
    ctx.drawImage(video, 0, 0, w, h)

    try {
      const imageData = ctx.getImageData(0, 0, w, h)
      const data = imageData.data

      let sumX = 0, sumY = 0, totalWeight = 0
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const idx = (y * w + x) * 4
          const r = data[idx], g = data[idx + 1], b = data[idx + 2]
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
        // Face not visible
        return {
          gaze_x: 0.5,
          gaze_y: 0.5,
          delta: 0.5,
          yaw: 0,
          pitch: 0,
          roll: 0,
          timestamp: Date.now() / 1000,
          faceCount: 0,
          isAbsent: true,
          isMultiFace: false,
          screenReflection: { detected: false, glareRatio: 0, blueRatio: 0 },
        }
      }

      const centroidX = sumX / totalWeight / w
      const centroidY = sumY / totalWeight / h

      const dx = centroidX - 0.5
      const dy = centroidY - 0.4
      const yaw = dx * 600
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
        faceCount: 1,
        isAbsent: false,
        isMultiFace: false,
        screenReflection: { detected: false, glareRatio: 0, blueRatio: 0 },
      }
    } catch {
      return null
    }
  }, [])

  // Process video frame loop throttled with mutex
  const processFrame = useCallback(async () => {
    if (!enabled || !videoRef.current || !canvasRef.current) {
      return
    }

    if (isProcessingRef.current) return

    const now = Date.now()
    if (now - lastCallbackTime.current < 200) {
      return
    }

    const video = videoRef.current
    if (video.readyState < 2) {
      return
    }

    isProcessingRef.current = true
    try {
      if (faceMeshRef.current) {
        await faceMeshRef.current.send({ image: video })
      } else {
        const gazeData = computeFallbackGaze()
        if (gazeData && onGazeData) {
          onGazeData(gazeData)
          lastCallbackTime.current = now
        }
      }
    } catch (e) {
      // Skip on temporary mesh error
    } finally {
      isProcessingRef.current = false
    }
  }, [enabled, onGazeData, computeFallbackGaze])

  // Initialize video from stream (guarded to prevent flicker)
  useEffect(() => {
    if (!stream || !videoRef.current) return
    if (videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch(console.error)
    }
  }, [stream])

  // Start processing loop & load FaceMesh
  useEffect(() => {
    if (!enabled) return

    const loadFaceMesh = async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        // @ts-ignore
        if (window.FaceMesh) {
          try {
            // @ts-ignore
            const faceMesh = new window.FaceMesh({
              locateFile: (file: string) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
              },
            })

            // Allow up to 4 faces to catch helpers/accomplices
            faceMesh.setOptions({
              maxNumFaces: 4,
              refineLandmarks: true,
              minDetectionConfidence: 0.5,
              minTrackingConfidence: 0.5,
            })

            faceMesh.onResults((results: any) => {
              const faces = results.multiFaceLandmarks || []
              const faceCount = faces.length

              if (faceCount === 0) {
                if (!absenceStartRef.current) absenceStartRef.current = Date.now()
                const now = Date.now()
                if (now - lastCallbackTime.current >= 500 && onGazeData) {
                  onGazeData({
                    gaze_x: 0.5,
                    gaze_y: 0.5,
                    delta: 0.5,
                    yaw: 0,
                    pitch: 0,
                    roll: 0,
                    timestamp: now / 1000,
                    faceCount: 0,
                    isAbsent: true,
                    isMultiFace: false,
                    screenReflection: { detected: false, glareRatio: 0, blueRatio: 0 },
                  })
                  lastCallbackTime.current = now
                }
                return
              }

              absenceStartRef.current = null
              const primaryLandmarks = faces[0]
              const gazeData = computeGaze(primaryLandmarks, faceCount)

              if (gazeData && onGazeData) {
                const now = Date.now()
                if (now - lastCallbackTime.current >= 450) {
                  onGazeData(gazeData)
                  lastCallbackTime.current = now
                }
              }
            })

            faceMeshRef.current = faceMesh
            setMediaPipeReady(true)
            console.log('[GazeCapturer] MediaPipe FaceMesh loaded with multi-face support')
            return
          } catch (e) {
            console.warn('[GazeCapturer] MediaPipe init error:', e)
            break
          }
        }
        await new Promise((r) => setTimeout(r, 500))
      }
    }

    loadFaceMesh()

    // Steady 5 FPS execution avoids UI thread starvation and video lag
    const interval = setInterval(() => {
      processFrame()
    }, 200)

    return () => {
      clearInterval(interval)
    }
  }, [enabled, processFrame, computeGaze, onGazeData])

  return (
    <>
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          width: 320,
          height: 240,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          width: 160,
          height: 120,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </>
  )
}

export default GazeCapturer
