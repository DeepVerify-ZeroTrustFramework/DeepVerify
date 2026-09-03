/**
 * ObjectDetector — Browser-side Prohibited Object Detection using TensorFlow.js COCO-SSD.
 * Detects items like cell phones, books, secondary laptops, and tablets in the candidate's camera feed.
 * Uses visible video dimensions to ensure browser decodes frames properly.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'

export interface ProhibitedObject {
  object: string
  score: number
  bbox: [number, number, number, number]
  timestamp: number
}

interface ObjectDetectorProps {
  stream?: MediaStream | null
  enabled?: boolean
  onObjectDetected?: (data: ProhibitedObject) => void
  onObjectCleared?: () => void
}

const PROHIBITED_CLASSES = new Set([
  'cell phone',
  'book',
  'laptop',
  'remote',
  'tablet',
  'mouse',
  'keyboard'
])

// Dynamic script loader helper
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.crossOrigin = 'anonymous'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(script)
  })
}

export const ObjectDetector: React.FC<ObjectDetectorProps> = ({
  stream,
  enabled = true,
  onObjectDetected,
  onObjectCleared,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const modelRef = useRef<any>(null)
  const [modelReady, setModelReady] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastDetectedRef = useRef<string | null>(null)

  // Initialize model dynamically
  useEffect(() => {
    let isMounted = true

    const initCocoSsd = async () => {
      try {
        // 1. Load TensorFlow.js if not already present
        // @ts-ignore
        if (!window.tf) {
          await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js')
        }

        // 2. Load COCO-SSD model script if not already present
        // @ts-ignore
        if (!window.cocoSsd) {
          await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js')
        }

        // @ts-ignore
        if (window.cocoSsd && isMounted) {
          // @ts-ignore
          const model = await window.cocoSsd.load({ base: 'mobilenet_v2' })
          if (isMounted) {
            modelRef.current = model
            setModelReady(true)
            console.log('[ObjectDetector] TensorFlow COCO-SSD model loaded and ready')
          }
        }
      } catch (e) {
        console.warn('[ObjectDetector] Prohibited object detector initialization error:', e)
      }
    }

    initCocoSsd()

    return () => {
      isMounted = false
    }
  }, [])

  // Hook stream to hidden video with proper dimensions
  useEffect(() => {
    if (!stream || !videoRef.current) return
    const video = videoRef.current
    video.srcObject = stream
    video.onloadedmetadata = () => {
      video.play().catch(() => {})
    }
  }, [stream])

  // Run periodic inference
  const runDetection = useCallback(async () => {
    if (!enabled || !modelRef.current || !videoRef.current) return
    const video = videoRef.current
    if (video.readyState < 2 || video.videoWidth === 0) return

    try {
      const predictions = await modelRef.current.detect(video)
      
      const prohibited = predictions.find(
        (p: any) => PROHIBITED_CLASSES.has(p.class.toLowerCase()) && p.score >= 0.45
      )

      if (prohibited) {
        lastDetectedRef.current = prohibited.class
        if (onObjectDetected) {
          onObjectDetected({
            object: prohibited.class,
            score: prohibited.score,
            bbox: prohibited.bbox,
            timestamp: Date.now() / 1000,
          })
        }
      } else {
        if (lastDetectedRef.current && onObjectCleared) {
          onObjectCleared()
        }
        lastDetectedRef.current = null
      }
    } catch (err) {
      // Ignore frame transition errors
    }
  }, [enabled, onObjectDetected, onObjectCleared])

  useEffect(() => {
    if (!enabled || !modelReady) return

    intervalRef.current = setInterval(runDetection, 1000) // Scan every 1s

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [enabled, modelReady, runDetection])

  return (
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
  )
}

export default ObjectDetector
