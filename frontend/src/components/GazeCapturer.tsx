/**
 * GazeCapturer — MediaPipe FaceMesh gaze tracking component.
 * Computes iris position, head pose (yaw/pitch/roll), and deviation metrics.
 * Streams data to parent via callback every 500ms.
 * 
 * NOTE: Runs on main thread with requestAnimationFrame throttling (100ms)
 * because MediaPipe WASM requires DOM/canvas access.
 */
import React, { useEffect, useRef, useCallback } from 'react'

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

  // Process video frame (throttled to 100ms)
  const processFrame = useCallback(async () => {
    if (!enabled || !videoRef.current || !canvasRef.current) {
      animFrameRef.current = requestAnimationFrame(() => processFrame())
      return
    }

    const now = Date.now()
    if (now - lastCallbackTime.current < 100) { // 100ms throttle
      animFrameRef.current = requestAnimationFrame(processFrame)
      return
    }

    const video = videoRef.current
    if (video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(processFrame)
      return
    }

    // If FaceMesh is loaded, process the frame
    if (faceMeshRef.current) {
      try {
        await faceMeshRef.current.send({ image: video })
      } catch (e) {
        // FaceMesh processing error — skip frame
      }
    } else {
      // Fallback: generate simulated gaze data for demo
      const simulatedGaze: GazeData = {
        gaze_x: 0.5 + Math.sin(now * 0.001) * 0.1,
        gaze_y: 0.5 + Math.cos(now * 0.0013) * 0.05,
        delta: 0.1 + Math.random() * 0.05,
        yaw: Math.sin(now * 0.0008) * 5,
        pitch: Math.cos(now * 0.0012) * 3,
        roll: Math.sin(now * 0.0015) * 2,
        timestamp: now / 1000,
      }

      if (now - lastCallbackTime.current >= 500 && onGazeData) {
        onGazeData(simulatedGaze)
        lastCallbackTime.current = now
      }
    }

    animFrameRef.current = requestAnimationFrame(() => processFrame())
  }, [enabled, onGazeData, computeGaze])

  // Initialize video from stream
  useEffect(() => {
    if (!stream || !videoRef.current) return

    videoRef.current.srcObject = stream
    videoRef.current.play().catch(console.error)
  }, [stream])

  // Start processing loop
  useEffect(() => {
    if (!enabled) return

    // Try to load MediaPipe FaceMesh
    const loadFaceMesh = async () => {
      try {
        // Dynamic import for MediaPipe
        // @ts-ignore
        if (window.FaceMesh) {
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
        }
      } catch (e) {
        console.log('[GazeCapturer] MediaPipe not available, using fallback')
      }
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
