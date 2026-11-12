import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ShieldCheck, Loader2, Code2, AlertCircle, Clock, AlertTriangle,
  Monitor, Users, Smartphone, Maximize2, Minimize2, Camera,
  CheckCircle2, XCircle, RefreshCw, UploadCloud, Lock, LogOut, Home,
  Mic, MicOff, Video, VideoOff, Eye, EyeOff, Play, Terminal, Check,
  ArrowLeft, ArrowRight, X
} from 'lucide-react'
import Editor from '@monaco-editor/react'
import { useWebRTC } from '../hooks/useWebRTC'
import { useBehavioralSocket } from '../hooks/useBehavioralSocket'
import { getWsUrl } from '../utils/apiConfig'
import { checkActiveTrackForVirtual, findPhysicalVideoDevices } from '../utils/deviceCheck'
import GazeCapturer from '../components/GazeCapturer'
import type { GazeData } from '../components/GazeCapturer'
import ObjectDetector from '../components/ObjectDetector'
import type { ProhibitedObject } from '../components/ObjectDetector'
import { startRppgCropStream } from '../utils/rppgCrop'
import { startFrameTiming } from '../utils/frameTiming'
import { attachSnapshotResponder } from '../utils/snapshot'

// ── Language templates ──
const LANGUAGE_TEMPLATES: Record<string, { lang: string; template: string }> = {
  'Python': {
    lang: 'python',
    template: `# Write your solution here...\n\ndef solution():\n    pass\n`,
  },
  'JavaScript': {
    lang: 'javascript',
    template: `// Write your solution here...\n\nfunction solution() {\n  \n}\n`,
  },
  'TypeScript': {
    lang: 'typescript',
    template: `// Write your solution here...\n\nfunction solution(): void {\n  \n}\n`,
  },
  'Java': {
    lang: 'java',
    template: `// Write your solution here...\n\npublic class Solution {\n    public static void main(String[] args) {\n        \n    }\n}\n`,
  },
  'C': {
    lang: 'c',
    template: `// Write your solution here...\n\n#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}\n`,
  },
  'C++': {
    lang: 'cpp',
    template: `// Write your solution here...\n\n#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n`,
  },
  'Go': {
    lang: 'go',
    template: `// Write your solution here...\n\npackage main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello")\n}\n`,
  },
  'Rust': {
    lang: 'rust',
    template: `// Write your solution here...\n\nfn main() {\n    \n}\n`,
  },
}

interface ToastViolation {
  id: string
  message: string
  type: string
  timestamp: number
}

// Max bytes allowed to sit unsent in the forensic-frames WebSocket before new
// frames are dropped. Keeps analysis real-time on slow / shared uplinks.
const FRAME_WS_MAX_BUFFERED = 256 * 1024

export default function CandidateSession() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)

  // Editor & Compiler state
  const [selectedLang, setSelectedLang] = useState('Python')
  const [editorCode, setEditorCode] = useState(LANGUAGE_TEMPLATES['Python'].template)
  const [isRunningCode, setIsRunningCode] = useState(false)
  const [codeOutput, setCodeOutput] = useState<{ stdout: string; stderr: string; executionTime?: number; status?: string } | null>(null)
  const [showTerminal, setShowTerminal] = useState(false)
  const codeDebounceRef = useRef<any>(null)
  const rtcSendDataRef = useRef<((msg: any) => boolean) | null>(null)

  // Virtual Camera / OBS detection
  const [virtualCamBlocked, setVirtualCamBlocked] = useState(false)
  const [virtualCamName, setVirtualCamName] = useState('')
  const [physicalDevices, setPhysicalDevices] = useState<MediaDeviceInfo[]>([])
  const [switchingCam, setSwitchingCam] = useState(false)

  // Timer
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Telemetry indicators
  const [gazeDelta, setGazeDelta] = useState(0)
  const [faceCount, setFaceCount] = useState(1)
  const [detectedItem, setDetectedItem] = useState<string | null>(null)
  const [reflectionAlert, setReflectionAlert] = useState(false)

  // ── Face Verification States ──
  const [faceVerified, setFaceVerified] = useState(false)
  const [faceSimilarity, setFaceSimilarity] = useState<number | null>(null)
  const [faceVerificationStatus, setFaceVerificationStatus] = useState<'PENDING' | 'VERIFIED' | 'FAILED' | 'ERROR'>('PENDING')
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null)
  const [, setLiveSnapshotUrl] = useState<string | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [, setVerificationMessage] = useState<string | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [showVerificationModal, setShowVerificationModal] = useState(true)
  const [, setShowReuploadModal] = useState(false)
  const [reuploading, setReuploading] = useState(false)
  const [reuploadError, setReuploadError] = useState<string | null>(null)

  const selfVideoRef = useRef<HTMLVideoElement | null>(null)
  const modalLiveVideoRef = useRef<HTMLVideoElement | null>(null)
  const reuploadInputRef = useRef<HTMLInputElement | null>(null)

  // ── Exit Interview States ──
  const [showEndModal, setShowEndModal] = useState(false)
  const [isEnded, setIsEnded] = useState(false)
  const [endingSession, setEndingSession] = useState(false)

  const frameWsRef = useRef<WebSocket | null>(null)
  const frameIntervalRef = useRef<any>(null)

  // ── Active liveness challenge (issued + verified by the server on the frames socket) ──
  // No time limit: the check stays open until it passes or the candidate closes it.
  // It never blocks the interview - the panel floats above it.
  const [livenessProgress, setLivenessProgress] = useState<null | { face: boolean; armed: boolean; progress: number; wrongWay: boolean }>(null)
  const [livenessChallenge, setLivenessChallenge] = useState<null | {
    id: string; step: number; of: number; direction: 'LEFT' | 'RIGHT'
    instruction: string; note: string | null; origin: string; key: number
  }>(null)
  const [livenessFailNotice, setLivenessFailNotice] = useState<string | null>(null)

  const [livenessResult, setLivenessResult] = useState<null | { passed: boolean; message: string }>(null)
  const livenessResultTimerRef = useRef<any>(null)

  // Candidate local media controls
  const [camEnabled, setCamEnabled] = useState(true)
  const [micEnabled, setMicEnabled] = useState(true)
  const [selfViewHidden, setSelfViewHidden] = useState(false)
  const camEnabledRef = useRef(true)
  const telemetryRef = useRef<any>(null)

  const toggleCandidateCam = useCallback(() => {
    if (!localStream) return
    const next = !camEnabled
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = next
    })
    setCamEnabled(next)
    camEnabledRef.current = next

    // Instantly notify backend frames socket
    if (frameWsRef.current && frameWsRef.current.readyState === WebSocket.OPEN) {
      frameWsRef.current.send(JSON.stringify({ type: 'CAMERA_STATUS', enabled: next }))
    }
    // Instantly notify telemetry socket
    telemetryRef.current?.sendEvent('CAMERA_STATUS', { enabled: next, video_enabled: next })
  }, [localStream, camEnabled])

  const toggleCandidateMic = useCallback(() => {
    if (!localStream) return
    const next = !micEnabled
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = next
    })
    setMicEnabled(next)
  }, [localStream, micEnabled])

  // Instant exit teardown
  const handleEndInterview = async () => {
    setEndingSession(true)
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
    if (frameWsRef.current) {
      try { frameWsRef.current.close() } catch {}
      frameWsRef.current = null
    }
    if (timerRef.current) clearInterval(timerRef.current)
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop())
    }
    rtc.stop()
    setShowEndModal(false)
    setIsEnded(true)

    try {
      if (session?.session_id) {
        await fetch(`/api/sessions/${session.session_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'COMPLETED' }),
        })
      }
    } catch (e) {
      console.warn('Failed to mark session completed', e)
    } finally {
      setEndingSession(false)
    }
  }

  // Candidate warning toasts
  const [violations, setViolations] = useState<ToastViolation[]>([])

  const addViolationToast = useCallback((message: string, type: string) => {
    const id = `${Date.now()}-${Math.random()}`
    setViolations((prev) => [...prev.slice(-3), { id, message, type, timestamp: Date.now() }])
    setTimeout(() => {
      setViolations((prev) => prev.filter((v) => v.id !== id))
    }, 4500)
  }, [])

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(`/api/sessions/by-token/${token}`)
        if (!res.ok) throw new Error('Invalid or expired link')
        const data = await res.json()

        // Gate check
        if (!data.check_completed) {
          navigate(`/check/${token}`, { replace: true })
          return
        }

        setSession(data)

        // Initialize face verification status from session
        if (data.face_verification) {
          if (data.face_verification.reference_image_url) {
            setReferenceImageUrl(data.face_verification.reference_image_url)
          }
          if (data.face_verification.live_snapshot_url) {
            setLiveSnapshotUrl(data.face_verification.live_snapshot_url)
          }
          if (data.face_verification.verified) {
            setFaceVerified(true)
            setFaceSimilarity(data.face_verification.similarity)
            setFaceVerificationStatus('VERIFIED')
            setShowVerificationModal(false)
          } else if (data.face_verification.status === 'FAILED') {
            setFaceVerificationStatus('FAILED')
            setFaceSimilarity(data.face_verification.similarity)
            setVerificationError(data.face_verification.message || 'Face verification failed.')
            setShowVerificationModal(true)
          }
        }

        // Get camera for WebRTC
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
          setLocalStream(stream)
        } catch (e1) {
          try {
            const videoOnly = await navigator.mediaDevices.getUserMedia({ video: true })
            setLocalStream(videoOnly)
          } catch (e2) {
            setError('Camera access is required. Please check permissions.')
          }
        }
      } catch (err) {
        setError('Invalid or expired session link.')
      } finally {
        setLoading(false)
      }
    }
    init()

    return () => {
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop())
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, navigate])

  // Session timer
  useEffect(() => {
    if (!session) return
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1)
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [session])

  // ── Real-Time Video Frame Streaming to Backend (/ws/frames/{sessionId}) ──
  useEffect(() => {
    if (!session?.session_id || !localStream) return

    const wsUrl = getWsUrl(`/ws/frames/${session.session_id}`)
    const frameWs = new WebSocket(wsUrl)
    frameWsRef.current = frameWs
    frameWs.binaryType = 'arraybuffer'

    // Server → candidate messages on the same socket (liveness challenges)
    frameWs.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      let msg: any
      try { msg = JSON.parse(event.data) } catch { return }
      if (msg.type === 'LIVENESS_CHALLENGE') {
        setLivenessResult(null)
        if (msg.step === 1 && !msg.retry) setLivenessFailNotice(null)
        setLivenessProgress(null)
        setLivenessChallenge({
          id: msg.challenge_id, step: msg.step, of: msg.of,
          direction: msg.direction === 'RIGHT' ? 'RIGHT' : 'LEFT',
          instruction: msg.instruction, note: msg.note || null,
          origin: msg.origin || '', key: Date.now(),
        })
        // Spoken prompt too, in case the candidate is looking at the code editor
        try {
          if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel()
            const text = msg.note === 'wrong_way'
              ? `That was the other way. Let's try again. ${msg.instruction}`
              : msg.instruction
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
          }
        } catch { /* speech is optional */ }
      } else if (msg.type === 'LIVENESS_PROGRESS') {
        setLivenessProgress({ face: !!msg.face, armed: !!msg.armed, progress: Number(msg.progress) || 0, wrongWay: !!msg.wrong_way })
      } else if (msg.type === 'LIVENESS_CHECK_FAILED') {
        // Interviewer has been told; the check stays open and the interview goes on.
        setLivenessFailNotice(msg.message || 'Your interviewer has been notified. You can keep trying or close this check.')
      } else if (msg.type === 'LIVENESS_CHALLENGE_RESULT') {
        setLivenessProgress(null)
        setLivenessChallenge(null)
        setLivenessFailNotice(null)
        setLivenessResult({ passed: !!msg.passed, message: msg.message || '' })
        if (livenessResultTimerRef.current) clearTimeout(livenessResultTimerRef.current)
        livenessResultTimerRef.current = setTimeout(() => setLivenessResult(null), 4000)
      }
    }

    frameWs.onopen = () => {
      console.log('[Frames WS] Connected for real-time PRNU & rPPG forensic analysis')

      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      const ctx = canvas.getContext('2d')

      // PRNU needs the camera's own pixels: a 320x240 centre crop at NATIVE
      // resolution (no scaling), sent ~3x/s as b'DVPR' + camW + camH + JPEG.
      const prnuCanvas = document.createElement('canvas')
      prnuCanvas.width = 320
      prnuCanvas.height = 240
      const prnuCtx = prnuCanvas.getContext('2d')
      let tick = 0

      // 100ms interval = 10 FPS
      const frameInterval = setInterval(() => {
        if (!camEnabledRef.current) return // Do NOT capture or transmit frames when camera is disabled
        if (!frameWs || frameWs.readyState !== WebSocket.OPEN) return
        // Back-pressure: if earlier frames are still queued (slow uplink), skip
        // this tick instead of piling up seconds of stale frames.
        if (frameWs.bufferedAmount > FRAME_WS_MAX_BUFFERED) return
        const video = selfVideoRef.current
        if (!video || video.readyState < 2) return

        tick += 1
        const vw = video.videoWidth
        const vh = video.videoHeight
        if (tick % 3 === 0 && prnuCtx && vw >= 320 && vh >= 240) {
          try {
            prnuCtx.drawImage(video, Math.floor((vw - 320) / 2), Math.floor((vh - 240) / 2), 320, 240, 0, 0, 320, 240)
            prnuCanvas.toBlob((blob) => {
              if (!blob || frameWs.readyState !== WebSocket.OPEN || !camEnabledRef.current) return
              blob.arrayBuffer().then((jpeg) => {
                const header = new Uint8Array(8)
                header.set([0x44, 0x56, 0x50, 0x52]) // 'DVPR'
                new DataView(header.buffer).setUint16(4, vw)
                new DataView(header.buffer).setUint16(6, vh)
                const packet = new Uint8Array(8 + jpeg.byteLength)
                packet.set(header, 0)
                packet.set(new Uint8Array(jpeg), 8)
                if (frameWs.readyState === WebSocket.OPEN && camEnabledRef.current) frameWs.send(packet.buffer)
              })
            }, 'image/jpeg', 0.95)
          } catch {
            // ignore crop glitches
          }
        }

        try {
          ctx?.drawImage(video, 0, 0, 320, 240)
          canvas.toBlob(
            (blob) => {
              if (blob && frameWs && frameWs.readyState === WebSocket.OPEN && camEnabledRef.current) {
                blob.arrayBuffer().then((buffer) => {
                  if (frameWs && frameWs.readyState === WebSocket.OPEN && camEnabledRef.current) {
                    frameWs.send(buffer)
                  }
                })
              }
            },
            'image/jpeg',
            0.85
          )
        } catch {
          // Ignore drawing glitches
        }
      }, 100)
      frameIntervalRef.current = frameInterval

      // rPPG: ~15 fps native-resolution face crops (stops when the socket closes)
      startRppgCropStream(frameWs, () => selfVideoRef.current, () => camEnabledRef.current, FRAME_WS_MAX_BUFFERED)
      // Jitter: the camera's own frame timing
      startFrameTiming(frameWs, () => selfVideoRef.current, () => camEnabledRef.current)
      // AI face check: answer the server's occasional snapshot requests
      attachSnapshotResponder(frameWs, () => selfVideoRef.current, () => camEnabledRef.current)
    }

    frameWs.onerror = (err) => {
      console.warn('[Frames WS] Error:', err)
    }

    frameWs.onclose = () => {
      console.log('[Frames WS] Disconnected')

      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
    }

    return () => {
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current)
        frameIntervalRef.current = null
      }
      if (frameWsRef.current) {
        frameWsRef.current.close()
        frameWsRef.current = null
      }
    }
  }, [session?.session_id, localStream])

  // Fullscreen & Tab Focus states
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showTabWarning, setShowTabWarning] = useState(false)

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { })
      setIsFullscreen(true)
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => { })
      }
      setIsFullscreen(false)
    }
  }, [])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      if (!active) {
        addViolationToast('Exited Fullscreen mode — integrity warning logged.', 'FULLSCREEN')
      }
    }
    const handleVisibilityChange = () => {
      // Tell the server so a liveness check pauses instead of failing
      const fws = frameWsRef.current
      if (fws && fws.readyState === WebSocket.OPEN) {
        fws.send(JSON.stringify({ type: 'TAB_VISIBILITY', hidden: document.hidden }))
      }
      if (document.hidden) {
        addViolationToast('Tab switched or minimized — integrity warning logged.', 'TAB_SWITCH')
        setShowTabWarning(true)
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [addViolationToast])

  // Liveness head-turn checks are switched off for interviews (demo pages only).
  // The panel below stays dormant: the server never issues a check here.

  const skipLiveness = useCallback(() => {
    const fws = frameWsRef.current
    if (fws && fws.readyState === WebSocket.OPEN) {
      fws.send(JSON.stringify({ type: 'LIVENESS_SKIP' }))
    }
    try { window.speechSynthesis?.cancel() } catch { /* optional */ }
  }, [])

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  // Initialize WebRTC
  const rtc = useWebRTC(session?.session_id || '', 'candidate', localStream)
  rtcSendDataRef.current = rtc.sendData

  // Initialize Behavioral Socket with violation callbacks
  const telemetry = useBehavioralSocket(session?.session_id || '', !!session, {
    onViolation: addViolationToast,
  })

  useEffect(() => {
    telemetryRef.current = telemetry
  }, [telemetry])

  // Only (re)initialize when the session appears or the camera first becomes
  // available. Later stream changes (camera switch / toggle) are swapped into
  // the live connection by useWebRTC via replaceTrack — no reconnect needed.
  const hasLocalStream = !!localStream
  useEffect(() => {
    if (session && hasLocalStream) {
      rtc.initialize()
    }
    return () => {
      rtc.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, hasLocalStream])

  // Session completion polling (Interviewer ends session)
  useEffect(() => {
    if (!session || isEnded) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/by-token/${token}`)
        if (res.ok) {
          const data = await res.json()
          if (data.status === 'COMPLETED') {
            setIsEnded(true)
            if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
            if (frameWsRef.current) {
              try { frameWsRef.current.close() } catch {}
            }
            if (timerRef.current) clearInterval(timerRef.current)
            if (localStream) {
              localStream.getTracks().forEach(t => t.stop())
            }
            rtc.stop()
            setShowEndModal(false)
          }
        }
      } catch (e) {
        // ignore
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [session, isEnded, token, localStream, rtc])

  // Track real suspicious actions for telemetry degradation
  const suspicionRef = useRef({ tabSwitches: 0, pastes: 0, blurTime: 0, lastBlur: 0 })

  // Handle REAL gaze and multi-face telemetry from GazeCapturer
  const handleGaze = useCallback(
    (data: GazeData) => {
      if (!camEnabledRef.current) return

      setGazeDelta(data.delta)
      setFaceCount(data.faceCount)
      setReflectionAlert(data.screenReflection.detected)

      // Notify candidate if multiple faces or absence detected
      if (data.isMultiFace) {
        addViolationToast(
          `Multiple faces detected (${data.faceCount}). Only one person may be in frame.`,
          'MULTI_FACE'
        )
      } else if (data.isAbsent) {
        addViolationToast('Face not visible in camera. Please remain in frame.', 'ABSENCE')
      }

      telemetry.sendGaze(data.delta, data.yaw, data.pitch, {
        faceCount: data.faceCount,
        isAbsent: data.isAbsent,
        isMultiFace: data.isMultiFace,
        screenReflection: data.screenReflection,
      })

      // Real behavioral metrics sent to backend
      const s = suspicionRef.current
      // Decay suspicion counters
      if (s.tabSwitches > 0 && Math.random() < 0.05) s.tabSwitches = Math.max(0, s.tabSwitches - 1)
      if (s.blurTime > 0 && Math.random() < 0.1) s.blurTime = Math.max(0, s.blurTime - 1000)
      if (s.pastes > 0 && Math.random() < 0.03) s.pastes = Math.max(0, s.pastes - 1)
    },
    [telemetry, addViolationToast]
  )

  // Handle Prohibited Objects from ObjectDetector
  const handleObjectDetected = useCallback(
    (item: ProhibitedObject) => {
      setDetectedItem(item.object)
      telemetry.sendProhibitedObject(item)
    },
    [telemetry]
  )

  const handleObjectCleared = useCallback(() => {
    setDetectedItem(null)
  }, [])

  // ── Face Verification Capture & Compare Action ──
  const triggerFaceVerification = async () => {
    const video = modalLiveVideoRef.current || selfVideoRef.current
    if (!video || !localStream) {
      setVerificationError('Camera feed not ready. Please ensure camera permissions are allowed.')
      return
    }

    setIsVerifying(true)
    setVerificationError(null)
    setVerificationMessage(null)

    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 480
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not access canvas context')

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const base64Data = canvas.toDataURL('image/jpeg', 0.92)

      const formData = new FormData()
      formData.append('snapshot_base64', base64Data)

      const res = await fetch(`/api/face-verification/verify/${session.session_id}`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        const msg = data?.detail?.message || (typeof data?.detail === 'string' ? data.detail : 'Face comparison service error.')
        setFaceVerificationStatus('ERROR')
        setVerificationError(msg)
        return
      }

      setLiveSnapshotUrl(data.live_snapshot_url)
      setFaceSimilarity(data.similarity)
      setVerificationMessage(data.message)

      if (data.verified) {
        setFaceVerified(true)
        setFaceVerificationStatus('VERIFIED')
        setVerificationError(null)
        setTimeout(() => {
          setShowVerificationModal(false)
        }, 1800)
      } else {
        setFaceVerified(false)
        setFaceVerificationStatus('FAILED')
        setVerificationError(data.message || 'Face does not match the uploaded reference photograph.')
      }
    } catch (err: any) {
      setFaceVerificationStatus('ERROR')
      setVerificationError(err.message || 'Face verification request failed. Please check network.')
    } finally {
      setIsVerifying(false)
    }
  }

  // Handle re-upload of reference photo
  const handleReuploadReferencePhoto = async (file: File) => {
    setReuploading(true)
    setReuploadError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`/api/face-verification/reference-photo/${session.session_id}`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        const errorMsg = data?.detail?.message || (typeof data?.detail === 'string' ? data.detail : 'Photo face validation failed.')
        setReuploadError(errorMsg)
        return
      }

      setReferenceImageUrl(data.reference_image_url)
      setShowReuploadModal(false)
      setFaceVerificationStatus('PENDING')
      setVerificationError(null)
      setVerificationMessage('New reference photo uploaded. Please capture a live snapshot to verify.')
    } catch (err: any) {
      setReuploadError('Failed to upload new reference photo.')
    } finally {
      setReuploading(false)
    }
  }

  // Check stream for virtual camera
  const checkStreamForVirtualCamera = useCallback(async (stream: MediaStream | null) => {
    if (!stream) return true
    const videoTracks = stream.getVideoTracks()
    for (const track of videoTracks) {
      const { isVirtual, name } = checkActiveTrackForVirtual(track)
      if (isVirtual) {
        setVirtualCamBlocked(true)
        setVirtualCamName(name || 'OBS / Virtual Camera')
        track.enabled = false
        telemetryRef.current?.sendEvent('VIRTUAL_CAMERA_DETECTED', { device: name || 'OBS / Virtual Camera' })
        const physicals = await findPhysicalVideoDevices()
        setPhysicalDevices(physicals)
        return false
      }
    }
    return true
  }, [])

  // Monitor device change and continuous track inspection
  useEffect(() => {
    if (!localStream) return
    checkStreamForVirtualCamera(localStream)

    const onDeviceChange = async () => {
      if (localStream && camEnabledRef.current) {
        await checkStreamForVirtualCamera(localStream)
      }
    }
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange)

    const interval = setInterval(() => {
      if (localStream && camEnabledRef.current) {
        checkStreamForVirtualCamera(localStream)
      }
    }, 2500)

    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange)
      clearInterval(interval)
    }
  }, [localStream, checkStreamForVirtualCamera])

  const handleSelectPhysicalCamera = async (deviceId?: string) => {
    setSwitchingCam(true)
    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: true,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      const { isVirtual, name } = checkActiveTrackForVirtual(stream.getVideoTracks()[0])
      if (isVirtual) {
        stream.getTracks().forEach((t) => t.stop())
        alert(`Selected camera "${name}" is also a virtual camera. Please select a physical webcam.`)
        return
      }
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop())
      }
      setLocalStream(stream)
      setVirtualCamBlocked(false)
      setVirtualCamName('')
      telemetryRef.current?.sendEvent('VIRTUAL_CAMERA_RESOLVED', {})
    } catch (err: any) {
      alert('Unable to access camera: ' + (err.message || 'Permission denied'))
    } finally {
      setSwitchingCam(false)
    }
  }

  // Broadcast code to interviewer — THROTTLED (not debounced): while the
  // candidate types continuously, an update still goes out every ~40ms.
  // Sent peer-to-peer over the WebRTC data channel (lowest latency) AND over the
  // telemetry WebSocket (persistence + fallback). The interviewer keeps whichever
  // copy has the highest `seq`, so duplicates are harmless.
  const codeSeqRef = useRef(0)
  const pendingCodeRef = useRef<{ code: string; lang: string } | null>(null)
  const lastCodeSentAtRef = useRef(0)
  const flushCode = useCallback(() => {
    codeDebounceRef.current = null
    const pending = pendingCodeRef.current
    if (!pending) return
    pendingCodeRef.current = null
    lastCodeSentAtRef.current = performance.now()
    const payload = {
      code: pending.code,
      language: LANGUAGE_TEMPLATES[pending.lang]?.lang || pending.lang.toLowerCase(),
      seq: ++codeSeqRef.current,
      timestamp: new Date().toISOString(),
    }
    rtcSendDataRef.current?.({ type: 'CODE_CHANGE', ...payload })
    telemetryRef.current?.sendEvent('CODE_CHANGE', payload)
  }, [])
  const broadcastCodeChange = useCallback((newCode: string, lang: string) => {
    pendingCodeRef.current = { code: newCode, lang }
    if (codeDebounceRef.current) return
    const wait = Math.max(0, 40 - (performance.now() - lastCodeSentAtRef.current))
    codeDebounceRef.current = setTimeout(flushCode, wait)
  }, [flushCode])

  const handleEditorCodeChange = (value: string | undefined) => {
    const val = value || ''
    setEditorCode(val)
    broadcastCodeChange(val, selectedLang)
  }

  // Language change handler
  const handleLanguageChange = (lang: string) => {
    setSelectedLang(lang)
    const newTemplate = LANGUAGE_TEMPLATES[lang].template
    setEditorCode(newTemplate)
    broadcastCodeChange(newTemplate, lang)
  }

  const handleRunCode = async () => {
    if (!session?.session_id || isRunningCode) return
    setIsRunningCode(true)
    setShowTerminal(true)
    try {
      const res = await fetch('/api/compiler/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: session.session_id,
          code: editorCode,
          language: LANGUAGE_TEMPLATES[selectedLang].lang,
        }),
      })
      const data = await res.json()
      setCodeOutput({
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        executionTime: data.execution_time,
        status: data.status,
      })
    } catch (err: any) {
      setCodeOutput({
        stdout: '',
        stderr: err.message || 'Execution request failed',
        status: 'ERROR',
      })
    } finally {
      setIsRunningCode(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-tile !w-16 !h-16 !rounded-[20px]"><Loader2 className="animate-spin text-[#A4123F]" /></div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center p-6">
        <div className="glass-strong liquid rounded-[32px] px-12 py-12 flex flex-col items-center max-w-md w-full">
        <div className="glass-tile !w-16 !h-16 !rounded-[20px] mb-5"><AlertCircle className="text-[#991B1B] w-8 h-8" /></div>
        <h1 className="text-[22px] font-bold text-[#141114] tracking-[-0.02em] mb-2">Error</h1>
        <p className="text-[15px] text-[#67636C]">{error}</p>
        </div>
      </div>
    )
  }

  if (isEnded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center font-sans">
        <div className="w-full max-w-[640px] glass-strong liquid rounded-[36px] p-10 sm:p-12 flex flex-col items-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-b from-[#22874D] to-[#145530] flex items-center justify-center text-white mb-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_14px_30px_-12px_rgba(26,107,60,0.7)]">
            <CheckCircle2 size={40} />
          </div>
          <p className="glass-label !text-[#A4123F] mb-3">Submitted</p>
          <h1 className="text-[clamp(28px,2.8vw,38px)] font-bold text-[#141114] tracking-[-0.035em] mb-3">Interview Concluded</h1>
          <p className="text-[15px] text-[#67636C] mb-8 max-w-md leading-relaxed">
            Thank you, <strong className="text-[#141114] font-semibold">{session?.candidate_name || 'Candidate'}</strong>! Your technical interview session has been successfully finalized and submitted.
          </p>

          <div className="w-full rounded-[22px] glass-inset p-1.5 mb-8 text-left divide-y divide-[rgba(20,17,20,0.06)]">
            <div className="flex justify-between items-center gap-4 px-4 py-3.5 text-[14px]">
              <span className="text-[#67636C]">Session ID:</span>
              <span className="font-mono font-semibold text-[#141114]">{session?.session_id}</span>
            </div>
            <div className="flex justify-between items-center gap-4 px-4 py-3.5 text-[14px]">
              <span className="text-[#67636C]">Role:</span>
              <span className="font-semibold text-[#141114] text-right">{session?.role || 'Software Engineer'}</span>
            </div>
            <div className="flex justify-between items-center gap-4 px-4 py-3.5 text-[14px]">
              <span className="text-[#67636C]">Identity Verification:</span>
              <span className="inline-flex items-center gap-1 font-semibold text-[#1A6B3C]">
                <CheckCircle2 size={14} /> {faceVerified ? 'Verified via AWS Rekognition' : 'Submitted'}
              </span>
            </div>
            <div className="flex justify-between items-center gap-4 px-4 py-3.5 text-[14px]">
              <span className="text-[#67636C]">Total Duration:</span>
              <span className="font-mono font-semibold text-[#141114]">{formatTime(elapsed)}</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <button
              onClick={() => navigate('/student/inbox')}
              className="flex-1 glass-btn-primary !rounded-full py-3.5 px-6 text-[14.5px] cursor-pointer"
            >
              <Home size={16} /> Return to Portal
            </button>
            <button
              onClick={() => navigate('/')}
              className="glass-btn !rounded-full py-3.5 px-6 text-[14.5px] cursor-pointer"
            >
              Exit to Homepage
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* FULLSCREEN ENFORCEMENT OVERLAY — only after identity verification, so the
          AWS Rekognition step happens first, without full-screen prompts on top */}
      {faceVerified && !isFullscreen && (
        <div className="fixed inset-0 z-[9999] bg-[rgba(244,243,241,0.82)] backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center animate-fade-in">
          <div className="glass-strong liquid rounded-[36px] px-10 py-12 sm:px-14 max-w-[560px] w-full flex flex-col items-center">
          <div className="glass-tile !w-16 !h-16 !rounded-[20px] text-[#A4123F] mb-6">
            <Maximize2 size={28} />
          </div>
          <h1 className="text-[clamp(26px,2.6vw,34px)] font-bold text-[#141114] tracking-[-0.03em] mb-3">Full Screen Required</h1>
          <p className="text-[15px] text-[#67636C] max-w-md mb-8 leading-relaxed">
            This technical interview requires your browser to be in full screen mode at all times to ensure an isolated testing environment.
          </p>
          <button
            onClick={toggleFullscreen}
            className="glass-btn-primary !rounded-full px-8 py-3.5 text-[15px] cursor-pointer"
          >
            <Monitor size={18} />
            <span>Enter Full Screen to Continue</span>
          </button>
          </div>
        </div>
      )}

      {/* TAB SWITCH WARNING OVERLAY */}
      {showTabWarning && isFullscreen && (
        <div className="fixed inset-0 z-[9998] bg-[rgba(244,243,241,0.82)] backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center animate-fade-in">
          <div className="glass-strong liquid rounded-[36px] px-10 py-12 sm:px-14 max-w-[560px] w-full flex flex-col items-center ring-1 ring-[#991B1B]/20">
          <div className="glass-tile !w-16 !h-16 !rounded-[20px] text-[#991B1B] mb-6">
            <AlertTriangle size={28} />
          </div>
          <h1 className="text-[clamp(26px,2.6vw,34px)] font-bold text-[#141114] tracking-[-0.03em] mb-3">Focus Lost</h1>
          <p className="text-[15px] text-[#67636C] max-w-md mb-8 leading-relaxed">
            You switched tabs or minimized the window. Leaving the interview environment is strictly prohibited. This incident has been logged and flagged on your trust score.
          </p>
          <button
            onClick={() => setShowTabWarning(false)}
            className="glass-btn-primary !rounded-full px-8 py-3.5 text-[15px] cursor-pointer"
          >
            <Check size={18} />
            <span>I Understand, Return to Interview</span>
          </button>
          </div>
        </div>
      )}

      {/* ACTIVE LIVENESS CHECK — floats above everything but never blocks the
          interview. No time limit; the candidate can close it (interviewer is told). */}
      {livenessChallenge && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[10000] w-[min(92vw,540px)] pointer-events-none animate-fade-in">
          <div className="relative pointer-events-auto rounded-[28px] bg-[rgba(255,255,255,0.94)] border border-[#A4123F]/30 shadow-[0_0_0_4px_rgba(164,18,63,0.08),0_30px_70px_-24px_rgba(20,14,18,0.45)] px-7 py-6 text-center">
            <button
              onClick={skipLiveness}
              title="Close the liveness check (your interviewer will be notified)"
              className="absolute top-3.5 right-3.5 glass-icon-btn !w-8 !h-8 !rounded-full"
            >
              <X size={15} />
            </button>
            <p className="glass-label !text-[10.5px] !text-[#A4123F] mb-3 px-6">
              {livenessChallenge.origin === 'interviewer' ? 'Requested by your interviewer · ' :
                livenessChallenge.origin === 'start' ? 'Before we begin · ' : ''}
              Liveness check · step {livenessChallenge.step} of {livenessChallenge.of}
            </p>
            {livenessChallenge.note === 'wrong_way' && (
              <p className="text-[13px] font-semibold text-[#92400E] mb-2">That was the other way - let's try again.</p>
            )}
            {livenessProgress && livenessProgress.face && !livenessProgress.armed ? (
              <p className="text-[22px] font-bold text-[#141114] tracking-[-0.02em] mb-3">Look straight at the camera</p>
            ) : (
              <div className="flex items-center justify-center gap-4 mb-3">
                {livenessChallenge.direction === 'LEFT' && <ArrowLeft size={44} className="text-[#A4123F] animate-pulse shrink-0" />}
                <p className="text-[26px] font-bold text-[#141114] tracking-[-0.025em]">{livenessChallenge.instruction}</p>
                {livenessChallenge.direction === 'RIGHT' && <ArrowRight size={44} className="text-[#A4123F] animate-pulse shrink-0" />}
              </div>
            )}
            <p className="text-[13px] text-[#67636C] mb-3">
              Take your time - there is no time limit. Turn clearly, then face the screen again.
            </p>
            {livenessProgress && (
              <div className="mt-2 mb-1">
                {livenessProgress.face ? (
                  livenessProgress.armed && (
                    <>
                      <div className="flex justify-between text-[12px] text-[#55515A] mb-1.5">
                        <span>{livenessProgress.wrongWay ? 'Other way - turn to the arrow side' : 'Turn detected'}</span>
                        <span className="font-mono font-semibold">{Math.round(Math.min(1, livenessProgress.progress) * 100)}%</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-[rgba(20,17,20,0.08)] overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-200 ${livenessProgress.progress >= 1 ? 'bg-[#1A6B3C]' : 'bg-gradient-to-r from-[#B01848] to-[#7A0D2E]'}`}
                          style={{ width: `${Math.min(100, livenessProgress.progress * 100)}%` }} />
                      </div>
                    </>
                  )
                ) : (
                  <p className="text-[13px] font-semibold text-[#92400E]">Face not detected - keep your face in view and well lit</p>
                )}
              </div>
            )}
            {livenessFailNotice && (
              <p className="mt-3 text-[13px] text-[#92400E] bg-[rgba(254,243,199,0.8)] border border-[#FDE68A] rounded-[14px] px-3.5 py-2.5">
                {livenessFailNotice}
              </p>
            )}
          </div>
        </div>
      )}
      {livenessResult && !livenessChallenge && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[10000] w-[min(92vw,480px)] pointer-events-none animate-fade-in">
          <div className={`rounded-[22px] px-5 py-4 flex items-center gap-3 shadow-[0_24px_60px_-24px_rgba(20,14,18,0.45)] border bg-[rgba(255,255,255,0.95)] ${
            livenessResult.passed ? 'border-[#1A6B3C]/35' : 'border-[#D97706]/40'
          }`}>
            {livenessResult.passed
              ? <CheckCircle2 size={22} className="text-[#1A6B3C] shrink-0" />
              : <AlertTriangle size={22} className="text-[#D97706] shrink-0" />}
            <p className="text-[14px] font-medium text-[#141114]">{livenessResult.message}</p>
          </div>
        </div>
      )}

      <div className="h-screen flex flex-col overflow-hidden text-[#141114] font-sans relative">
      {/* Violation Alert Toasts */}
      <div className="fixed top-24 right-6 z-50 flex flex-col gap-2.5 pointer-events-none max-w-sm">
        {violations.map((v) => (
          <div
            key={v.id}
            className="flex items-start gap-3 px-4 py-3.5 rounded-[18px] bg-[rgba(255,255,255,0.96)] border border-[#991B1B]/25 text-[#141114] shadow-[0_0_0_3px_rgba(153,27,27,0.06),0_20px_44px_-20px_rgba(20,14,18,0.45)] animate-fade-in pointer-events-auto"
          >
            <span className="w-7 h-7 rounded-full bg-[rgba(153,27,27,0.08)] flex items-center justify-center shrink-0">
              <AlertTriangle className="text-[#991B1B]" size={15} />
            </span>
            <div className="flex-1 text-[13px] leading-snug text-[#4A464E]">
              <span className="font-bold text-[#991B1B] block uppercase text-[10.5px] tracking-[0.12em] mb-0.5">
                Integrity Notice · {v.type.replace('_', ' ')}
              </span>
              {v.message}
            </div>
          </div>
        ))}
      </div>

      {/* Top bar */}
      <div className="shrink-0 z-10 px-4 pt-4">
        <div className="min-h-16 rounded-[24px] glass-static liquid flex flex-wrap items-center justify-between gap-3 pl-3 pr-3 py-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="glass-tile-maroon !w-10 !h-10 !rounded-[12px] shrink-0">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <div className="glass-chip !px-3 !py-1.5 !text-[12px] text-[#1A6B3C]">
            <ShieldCheck size={13} /> Active Proctored Session
          </div>

          {/* AWS Rekognition Face Verification Badge */}
          {faceVerified ? (
            <div className="glass-chip !px-3 !py-1.5 !text-[12px] text-[#1A6B3C]">
              <CheckCircle2 size={13} />
              <span>✓ Face Verified ({faceSimilarity ? `${faceSimilarity}%` : 'Match'})</span>
            </div>
          ) : faceVerificationStatus === 'FAILED' ? (
            <button
              onClick={() => setShowVerificationModal(true)}
              className="glass-chip !px-3 !py-1.5 !text-[12px] !bg-[rgba(254,226,226,0.8)] !border-[#FCA5A5] text-[#991B1B] hover:!bg-[rgba(254,226,226,1)] transition-colors cursor-pointer"
            >
              <XCircle size={13} />
              <span>✗ Verification Failed · Retry</span>
            </button>
          ) : (
            <button
              onClick={() => setShowVerificationModal(true)}
              className="glass-chip !px-3 !py-1.5 !text-[12px] !bg-[rgba(254,243,199,0.85)] !border-[#FDE68A] text-[#92400E] hover:!bg-[rgba(254,243,199,1)] transition-colors cursor-pointer animate-pulse"
            >
              <Camera size={13} />
              <span>Verify Face via Rekognition</span>
            </button>
          )}

          <span className="text-[15px] font-semibold text-[#141114] tracking-[-0.01em] ml-1.5">{session.interview_type} Interview</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={toggleFullscreen}
            className="glass-btn !rounded-full px-3.5 py-2 text-[13px]"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
          </button>
          <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/50 border border-white/90 text-[#4A464E] shadow-[inset_0_1px_0_#fff]">
            <Clock size={14} className="text-[#A4123F]" />
            <span className="font-mono text-[13px] font-semibold">{formatTime(elapsed)}</span>
          </div>

          <button
            onClick={() => setShowEndModal(true)}
            className="glass-btn-primary !rounded-full px-4 py-2 text-[13px] cursor-pointer"
            title="End Interview"
          >
            <LogOut size={14} />
            <span>End Interview</span>
          </button>
        </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex gap-4 overflow-hidden p-4">
        {/* Left: Video Area */}
        <div className="flex-1 min-w-0 relative flex flex-col glass-static liquid rounded-[30px] p-2.5">
          <div className="flex-1 bg-[radial-gradient(120%_90%_at_50%_0%,#F7F5F3_0%,#E9E6E3_60%,#DFDBD7_100%)] rounded-[24px] relative overflow-hidden flex items-center justify-center shadow-[inset_0_1px_3px_rgba(20,14,18,0.08)]">
            {/* Interviewer Video */}
            {rtc.remoteStream ? (
              <video
                autoPlay
                playsInline
                ref={(v) => {
                  if (v && v.srcObject !== rtc.remoteStream) {
                    v.srcObject = rtc.remoteStream
                  }
                }}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center flex flex-col items-center">
                <div className="glass-tile !w-16 !h-16 !rounded-[20px] mb-4">
                  <Loader2 size={28} className="animate-spin text-[#A4123F]" />
                </div>
                <p className="text-[#55515A] text-[15px] font-medium">
                  {rtc.state === 'error' ? rtc.error : 'Waiting for interviewer to join...'}
                </p>
              </div>
            )}

            {/* Self view PiP & Candidate Toolbar */}
            <div className="absolute bottom-5 right-5 flex flex-col items-end gap-2.5">
              {!selfViewHidden && (
                <div className="w-60 aspect-video bg-black rounded-[16px] overflow-hidden relative shadow-[0_0_0_3px_rgba(255,255,255,0.85),0_18px_40px_-14px_rgba(0,0,0,0.7)]">
                  {localStream && (
                    <>
                      {camEnabled ? (
                        <video
                          autoPlay
                          playsInline
                          muted
                          ref={(v) => {
                            selfVideoRef.current = v
                            if (v && v.srcObject !== localStream) v.srcObject = localStream
                          }}
                          className="w-full h-full object-cover scale-x-[-1]"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-[#1E1B20] text-white/60 text-[11px] gap-1">
                          <VideoOff size={16} className="text-[#F87171]" />
                          <span>Camera Off</span>
                        </div>
                      )}
                      {/* Real-time Gaze, Multi-Face, and Reflection tracking */}
                      <GazeCapturer stream={localStream} onGazeData={handleGaze} />

                      {/* Real-time Prohibited Object Detection */}
                      <ObjectDetector
                        stream={localStream}
                        onObjectDetected={handleObjectDetected}
                        onObjectCleared={handleObjectCleared}
                      />
                    </>
                  )}

                  {/* Status badges on PiP */}
                  {faceVerified ? (
                    <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full bg-[#1A6B3C] text-white text-[9.5px] font-bold flex items-center gap-1 shadow-sm">
                      <CheckCircle2 size={10} /> ID VERIFIED
                    </div>
                  ) : (
                    <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full bg-[#B45309] text-white text-[9.5px] font-bold flex items-center gap-1 shadow-sm">
                      <Lock size={10} /> UNVERIFIED
                    </div>
                  )}

                  {faceCount !== 1 && (
                    <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-full bg-[#991B1B] text-white text-[9.5px] font-bold flex items-center gap-1">
                      <Users size={10} /> {faceCount === 0 ? 'NO FACE' : `${faceCount} FACES`}
                    </div>
                  )}
                  {detectedItem && (
                    <div className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full bg-[#B45309] text-white text-[9.5px] font-bold flex items-center gap-1">
                      <Smartphone size={10} /> {detectedItem.toUpperCase()}
                    </div>
                  )}
                </div>
              )}

              {/* Floating Candidate Media Controls */}
              <div className="flex items-center gap-1.5 bg-[rgba(255,255,255,0.88)] px-2 py-1.5 rounded-full border border-white shadow-[0_12px_30px_-12px_rgba(0,0,0,0.55)]">
                <button
                  type="button"
                  onClick={toggleCandidateMic}
                  title={micEnabled ? "Mute Microphone" : "Unmute Microphone"}
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                    micEnabled ? 'bg-[rgba(20,17,20,0.05)] text-[#141114] hover:bg-[rgba(20,17,20,0.10)]' : 'bg-[#991B1B] text-white hover:bg-[#7F1D1D]'
                  }`}
                >
                  {micEnabled ? <Mic size={15} /> : <MicOff size={15} />}
                </button>
                <button
                  type="button"
                  onClick={toggleCandidateCam}
                  title={camEnabled ? "Turn Off Camera" : "Turn On Camera"}
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                    camEnabled ? 'bg-[rgba(20,17,20,0.05)] text-[#141114] hover:bg-[rgba(20,17,20,0.10)]' : 'bg-[#991B1B] text-white hover:bg-[#7F1D1D]'
                  }`}
                >
                  {camEnabled ? <Video size={15} /> : <VideoOff size={15} />}
                </button>
                <button
                  type="button"
                  onClick={() => setSelfViewHidden(!selfViewHidden)}
                  title={selfViewHidden ? "Show Self Video" : "Minimize / Hide Self Video"}
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                    selfViewHidden ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[rgba(20,17,20,0.05)] text-[#141114] hover:bg-[rgba(20,17,20,0.10)]'
                  }`}
                >
                  {selfViewHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Candidate Name overlay */}
            <div className="absolute bottom-5 left-5 px-3.5 py-2 bg-[rgba(255,255,255,0.88)] rounded-full text-[13px] font-semibold text-[#141114] border border-white shadow-[0_12px_30px_-12px_rgba(0,0,0,0.55)] flex items-center gap-2">
              <span>{session.candidate_name}</span>
              {reflectionAlert && (
                <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                  Glare Detected
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Code Editor with Monaco */}
        <div className="w-[520px] shrink-0 glass-static liquid rounded-[30px] overflow-hidden flex flex-col">
          {/* Editor Header */}
          <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 text-[14px] font-semibold text-[#141114]">
              <div className="glass-tile !w-9 !h-9 !rounded-[11px]"><Code2 size={16} className="text-[#A4123F]" /></div>
              <span>Workspace</span>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedLang}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="glass-input !w-auto !py-1.5 !px-3 !text-[13px] !rounded-full font-medium cursor-pointer ![backdrop-filter:none] ![-webkit-backdrop-filter:none]"
              >
                {Object.keys(LANGUAGE_TEMPLATES).map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>

              <button
                onClick={handleRunCode}
                disabled={isRunningCode || !faceVerified}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-white text-[13px] font-semibold bg-gradient-to-b from-[#22874D] to-[#145530] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_18px_-8px_rgba(26,107,60,0.7)] hover:brightness-110 transition-all disabled:opacity-50 cursor-pointer active:scale-95"
                title="Compile and Run Code"
              >
                {isRunningCode ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    <span>Running...</span>
                  </>
                ) : (
                  <>
                    <Play size={12} className="fill-white" />
                    <span>Run</span>
                  </>
                )}
              </button>

              <button
                onClick={() => setShowTerminal(!showTerminal)}
                className={`glass-icon-btn !w-9 !h-9 !rounded-full gap-1 text-xs ${
                  showTerminal ? '!text-[#A4123F] !bg-white' : ''
                }`}
                title="Toggle Terminal Output"
              >
                <Terminal size={14} />
                {codeOutput && <span className="w-1.5 h-1.5 rounded-full bg-[#1A6B3C]"></span>}
              </button>
            </div>
          </div>

          {/* Monaco Editor */}
          <div className="flex-1 overflow-hidden relative mx-3 rounded-[20px] bg-white border border-[rgba(20,17,20,0.06)] shadow-[inset_0_1px_2px_rgba(20,14,18,0.04)]">
            {!faceVerified && (
              <div className="absolute inset-0 z-20 bg-[rgba(250,249,248,0.86)] backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
                <div className="glass-tile !w-14 !h-14 !rounded-[18px] text-[#A4123F] mb-4">
                  <Lock size={22} />
                </div>
                <h3 className="text-[17px] font-bold text-[#141114] tracking-[-0.015em] mb-2">Coding Workspace Locked</h3>
                <p className="text-[13px] text-[#67636C] max-w-xs mb-6 leading-relaxed">
                  Identity face verification via AWS Rekognition is required before you can access the code editor and interview questions.
                </p>
                <button
                  onClick={() => setShowVerificationModal(true)}
                  className="glass-btn-primary !rounded-full px-5 py-2.5 text-[13.5px] cursor-pointer"
                >
                  <Camera size={14} /> Open Face Verification
                </button>
              </div>
            )}
            <Editor
              height="100%"
              language={LANGUAGE_TEMPLATES[selectedLang].lang}
              value={editorCode}
              onChange={handleEditorCodeChange}
              theme="light"
              onMount={(editor, monaco) => {
                // Intercept and disable Paste Command
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {
                  addViolationToast('Pasting code is disabled during the interview.', 'CLIPBOARD')
                })
                // Intercept and disable Copy Command
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => {
                  addViolationToast('Copying code is disabled.', 'CLIPBOARD')
                })
                // Intercept and disable Cut Command
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => {
                  addViolationToast('Cutting code is disabled.', 'CLIPBOARD')
                })
                // Intercept Shift+Insert (Windows/Linux Paste)
                editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Insert, () => {
                  addViolationToast('Pasting is disabled.', 'CLIPBOARD')
                })
                // Prevent paste and drop events in DOM node of editor
                const domNode = editor.getDomNode()
                if (domNode) {
                  domNode.addEventListener(
                    'paste',
                    (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      addViolationToast('Pasting code is blocked.', 'CLIPBOARD')
                    },
                    true
                  )
                  domNode.addEventListener(
                    'drop',
                    (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    },
                    true
                  )
                }
              }}
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                renderLineHighlight: 'line',
                tabSize: 4,
                insertSpaces: true,
                automaticLayout: true,
                wordWrap: 'on',
                padding: { top: 16, bottom: 16 },
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                bracketPairColorization: { enabled: true },
                contextmenu: false, // Disables editor context menu
                dragAndDrop: false,
              }}
            />
          </div>

          {/* Collapsible Terminal Output Pane */}
          {showTerminal && (
            <div className="h-52 mx-3 mt-3 rounded-[18px] border border-[rgba(20,17,20,0.07)] bg-[rgba(255,255,255,0.7)] flex flex-col font-mono text-xs animate-fade-in shrink-0 overflow-hidden">
              <div className="h-9 border-b border-[rgba(20,17,20,0.06)] px-3.5 flex items-center justify-between text-[11.5px] text-[#67636C]">
                <div className="flex items-center gap-2">
                  <Terminal size={13} className="text-[#A4123F]" />
                  <span className="font-semibold text-[#141114] font-sans">Terminal Output</span>
                  {codeOutput?.status && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      codeOutput.status === 'SUCCESS' ? 'bg-[rgba(26,107,60,0.08)] text-[#1A6B3C] border border-[#1A6B3C]/25' : 'bg-[rgba(153,27,27,0.08)] text-[#991B1B] border border-[#991B1B]/25'
                    }`}>
                      {codeOutput.status}
                    </span>
                  )}
                  {codeOutput?.executionTime !== undefined && (
                    <span className="text-[10.5px] text-[#9A979E]">
                      ({codeOutput.executionTime}s)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 font-sans">
                  <button
                    onClick={() => setCodeOutput(null)}
                    className="text-[#67636C] hover:text-[#A4123F] text-[11px] font-semibold px-2 py-0.5 rounded-full hover:bg-white cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setShowTerminal(false)}
                    className="text-[#67636C] hover:text-[#141114] cursor-pointer w-6 h-6 rounded-full hover:bg-white"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="flex-1 p-3.5 overflow-y-auto font-mono text-[12.5px] leading-relaxed select-text">
                {isRunningCode ? (
                  <div className="flex items-center gap-2 text-[#67636C] py-2">
                    <Loader2 size={14} className="animate-spin text-[#A4123F]" />
                    <span>Compiling and executing code in sandbox...</span>
                  </div>
                ) : codeOutput ? (
                  <div>
                    {codeOutput.stdout && (
                      <pre className="text-[#145530] whitespace-pre-wrap font-mono">{codeOutput.stdout}</pre>
                    )}
                    {codeOutput.stderr && (
                      <pre className="text-[#991B1B] whitespace-pre-wrap mt-1 font-mono">{codeOutput.stderr}</pre>
                    )}
                    {!codeOutput.stdout && !codeOutput.stderr && (
                      <span className="text-[#9A979E] italic">Program finished with no stdout output.</span>
                    )}
                  </div>
                ) : (
                  <span className="text-[#9A979E] italic">Click 'Run' to execute. Terminal output is mirrored to the interviewer in real-time.</span>
                )}
              </div>
            </div>
          )}

          {/* Telemetry Strip */}
          <div className="shrink-0 m-3 px-3 py-2 rounded-full glass-inset flex items-center gap-2 text-[10.5px] font-mono text-[#67636C] tracking-[0.06em]">
            <div className="px-2.5 py-1 rounded-full bg-white/70">GAZE Δ {gazeDelta.toFixed(3)}</div>
            <div className="px-2.5 py-1 rounded-full bg-white/70">rPPG MONITOR ACTIVE</div>
            <div className="px-2.5 py-1 rounded-full bg-white/70 flex items-center gap-1">
              <Users size={12} className={faceCount === 1 ? 'text-[#1A6B3C]' : 'text-[#991B1B]'} />
              <span>{faceCount} FACE</span>
            </div>
            <div className="ml-auto pr-1 text-[#1A6B3C] font-semibold flex items-center gap-1">
              <Monitor size={12} /> SECURE
            </div>
          </div>
        </div>
      </div>

      {/* Synchronize localStream to modal video when modal is active */}
      <input
        type="file"
        ref={reuploadInputRef}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleReuploadReferencePhoto(file)
        }}
      />

      {/* ── AWS Rekognition Identity Verification Checkpoint Modal ── */}
      {showVerificationModal && (
        <div className="fixed inset-0 z-50 bg-[#141114]/30 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-strong liquid !bg-[rgba(255,255,255,0.86)] rounded-[32px] max-w-3xl w-full overflow-hidden flex flex-col animate-fade-in">
            {/* Modal Header */}
            <div className="px-7 pt-6 pb-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="glass-tile-maroon !w-11 !h-11 !rounded-[13px] shrink-0">
                  <ShieldCheck size={19} />
                </div>
                <div>
                  <h2 className="text-[17px] font-bold text-[#141114] tracking-[-0.015em] flex items-center gap-2">
                    Identity Verification <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[rgba(164,18,63,0.08)] text-[#A4123F] font-mono border border-[#A4123F]/20">AWS Rekognition</span>
                  </h2>
                  <p className="text-[13px] text-[#67636C]">
                    Compare your live video feed against your reference photograph to unlock the interview.
                  </p>
                </div>
              </div>

              {faceVerified && (
                <button
                  onClick={() => setShowVerificationModal(false)}
                  className="glass-btn !rounded-full px-3.5 py-2 text-[12.5px]"
                >
                  Close
                </button>
              )}
            </div>

            {/* Modal Body: Two Column Comparison */}
            <div className="px-7 pb-7 pt-2 flex flex-col gap-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* 1. Stored Reference Photograph */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[13px] font-semibold text-[#2A262C]">
                    <span>1. Reference Photograph</span>
                    <button
                      onClick={() => reuploadInputRef.current?.click()}
                      className="text-[12px] text-[#A4123F] hover:underline transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw size={11} className={reuploading ? 'animate-spin' : ''} />
                      <span>{referenceImageUrl ? 'Replace Photo' : 'Upload Photo'}</span>
                    </button>
                  </div>

                  <div className="aspect-[4/3] rounded-[20px] glass-inset overflow-hidden relative flex items-center justify-center">
                    {referenceImageUrl ? (
                      <img
                        src={referenceImageUrl}
                        alt="Reference Candidate Portrait"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div
                        onClick={() => reuploadInputRef.current?.click()}
                        className="flex flex-col items-center justify-center p-4 text-center cursor-pointer hover:bg-white/60 transition-colors w-full h-full"
                      >
                        <UploadCloud size={28} className="text-[#A4123F] mb-2" />
                        <p className="text-[13px] font-semibold text-[#141114]">No reference photo uploaded</p>
                        <p className="text-[11.5px] text-[#85818A] mt-1">Click to upload identity photo</p>
                      </div>
                    )}
                    <div className="absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-full bg-white/90 text-[10.5px] font-semibold text-[#4A464E] border border-white shadow-sm">
                      Source Image (ID)
                    </div>
                  </div>
                  {reuploadError && (
                    <p className="text-[12px] text-[#991B1B] mt-0.5">{reuploadError}</p>
                  )}
                </div>

                {/* 2. Live Webcam Target Feed */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[13px] font-semibold text-[#2A262C]">
                    <span>2. Live Interview Snapshot</span>
                    <span className="text-[11.5px] font-mono text-[#85818A]">Target Image</span>
                  </div>

                  <div className="aspect-[4/3] rounded-[20px] bg-[#141114] overflow-hidden relative flex items-center justify-center shadow-[0_14px_30px_-16px_rgba(20,14,18,0.6)]">
                    {localStream ? (
                      <>
                        <video
                          autoPlay
                          playsInline
                          muted
                          ref={(v) => {
                            modalLiveVideoRef.current = v
                            if (v && v.srcObject !== localStream) {
                              v.srcObject = localStream
                            }
                          }}
                          className="w-full h-full object-cover scale-x-[-1]"
                        />
                        {/* Oval Face Guide Frame */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className={`w-36 h-48 rounded-[50%] border-2 border-dashed transition-colors ${faceCount === 1 ? 'border-emerald-400/80 shadow-[0_0_15px_rgba(52,211,153,0.3)]' : 'border-red-400/80'
                            }`} />
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-white/55">
                        <Loader2 size={24} className="animate-spin mb-2" />
                        <span className="text-[12px]">Initializing camera...</span>
                      </div>
                    )}

                    {/* Live status pill */}
                    <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full bg-white/90 text-[10.5px] font-semibold text-[#141114] border border-white flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626] animate-pulse" />
                      <span>Live Video</span>
                    </div>

                    <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-full bg-white/90 text-[10.5px] font-semibold border border-white flex items-center gap-1">
                      <Users size={10} className={faceCount === 1 ? 'text-[#1A6B3C]' : 'text-[#991B1B]'} />
                      <span className={faceCount === 1 ? 'text-[#1A6B3C]' : 'text-[#991B1B]'}>
                        {faceCount === 0 ? 'No Face Detected' : faceCount === 1 ? '1 Face Positioned' : `${faceCount} Faces Detected`}
                      </span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Status & Feedback Banner */}
              {isVerifying && (
                <div className="px-4 py-3.5 rounded-[18px] bg-[rgba(164,18,63,0.06)] border border-[#A4123F]/20 flex items-center gap-3 text-[#4A464E] text-[13px] animate-pulse">
                  <Loader2 size={18} className="animate-spin text-[#A4123F] shrink-0" />
                  <div>
                    <span className="font-semibold text-[#141114] block">Calling AWS Rekognition CompareFaces...</span>
                    Extracting facial landmarks and computing identity similarity score.
                  </div>
                </div>
              )}

              {/* SUCCESS RESULT */}
              {faceVerified && (
                <div className="px-4 py-4 rounded-[18px] bg-[rgba(230,244,237,0.8)] border border-[#B7E1CD] flex items-start gap-3 text-[#145530] animate-fade-in">
                  <CheckCircle2 size={20} className="text-[#1A6B3C] shrink-0 mt-0.5" />
                  <div className="flex-1 text-[13px]">
                    <span className="font-bold text-[#145530] text-[14.5px] block mb-0.5">
                      ✓ Face Verification Successful
                    </span>
                    <p className="text-[#1A6B3C] leading-relaxed">
                      AWS Rekognition confirmed candidate identity match with <strong className="font-bold">{faceSimilarity}%</strong> similarity score.
                    </p>
                    <p className="text-[12px] text-[#1A6B3C]/80 mt-1">
                      Workspace unlocked. You may now proceed with your coding interview.
                    </p>
                  </div>
                </div>
              )}

              {/* FAILURE RESULT */}
              {!isVerifying && faceVerificationStatus === 'FAILED' && (
                <div className="px-4 py-4 rounded-[18px] bg-[rgba(254,226,226,0.75)] border border-[#FCA5A5] flex items-start gap-3 text-[#7F1D1D] animate-fade-in">
                  <XCircle size={20} className="text-[#991B1B] shrink-0 mt-0.5" />
                  <div className="flex-1 text-[13px]">
                    <span className="font-bold text-[#991B1B] text-[14.5px] block mb-0.5">
                      ✗ Face Verification Failed
                    </span>
                    <p className="leading-relaxed">
                      The live candidate does not appear to match the uploaded reference photograph.
                      {faceSimilarity !== null && (
                        <span> (Similarity score: <strong className="font-semibold">{faceSimilarity}%</strong>, required: 80.0%)</span>
                      )}
                    </p>
                    <p className="text-[12px] text-[#991B1B]/80 mt-1">
                      Access is blocked until verification succeeds. Please ensure good lighting, align your face inside the guide frame, or re-upload a clearer reference photograph.
                    </p>
                  </div>
                </div>
              )}

              {/* ERROR RESULT */}
              {!isVerifying && faceVerificationStatus === 'ERROR' && verificationError && (
                <div className="px-4 py-3.5 rounded-[18px] bg-[rgba(254,243,199,0.8)] border border-[#FDE68A] flex items-start gap-3 text-[#92400E] text-[13px] animate-fade-in">
                  <AlertTriangle size={18} className="text-[#D97706] shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold block mb-0.5">Verification Error</span>
                    {verificationError}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-1">
                {!faceVerified ? (
                  <>
                    <button
                      type="button"
                      onClick={() => reuploadInputRef.current?.click()}
                      className="glass-btn !rounded-full px-5 py-2.5 text-[13.5px] cursor-pointer"
                    >
                      Re-upload Photo
                    </button>
                    <button
                      type="button"
                      onClick={triggerFaceVerification}
                      disabled={isVerifying || !localStream || !referenceImageUrl}
                      className="glass-btn-primary !rounded-full px-6 py-2.5 text-[13.5px] cursor-pointer"
                    >
                      {isVerifying ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Verifying with AWS...</span>
                        </>
                      ) : (
                        <>
                          <Camera size={14} />
                          <span>{faceVerificationStatus === 'FAILED' ? 'Retake & Re-verify' : 'Capture Photo & Verify Face'}</span>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowVerificationModal(false)}
                    className="px-6 py-2.5 rounded-full text-white text-[13.5px] font-semibold bg-gradient-to-b from-[#22874D] to-[#145530] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_22px_-10px_rgba(26,107,60,0.75)] hover:brightness-110 transition-all cursor-pointer flex items-center gap-2"
                  >
                    <CheckCircle2 size={14} />
                    <span>Enter Workspace</span>
                  </button>
                )}
              </div>

            </div>
          </div>
        </div>
      )}

      {/* End Interview Confirmation Modal */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 bg-[#141114]/30 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md glass-strong liquid !bg-[rgba(255,255,255,0.86)] rounded-[32px] p-8 animate-fade-in text-[#141114]">
            <div className="flex items-center gap-3.5 mb-5">
              <div className="glass-tile !w-12 !h-12 !rounded-[15px] text-[#991B1B]">
                <LogOut size={20} />
              </div>
              <div>
                <h3 className="text-[18px] font-bold tracking-[-0.02em]">Conclude & Submit Interview?</h3>
                <p className="text-[12.5px] text-[#67636C]">This action will finalize your session</p>
              </div>
            </div>

            <p className="text-[14px] text-[#55515A] mb-7 leading-relaxed">
              Are you sure you want to end your interview? Your camera feed, code submissions, and identity verification logs will be saved and finalized for review.
            </p>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowEndModal(false)}
                disabled={endingSession}
                className="glass-btn !rounded-full px-5 py-2.5 text-[13.5px] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEndInterview}
                disabled={endingSession}
                className="glass-btn-primary !rounded-full px-5 py-2.5 text-[13.5px] cursor-pointer"
              >
                {endingSession ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <LogOut size={14} />
                    <span>Yes, End Interview</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mid-Stream Virtual Camera / OBS Security Blocker Modal ── */}
      {virtualCamBlocked && (
        <div className="fixed inset-0 z-50 bg-[rgba(244,243,241,0.85)] backdrop-blur-xl flex items-center justify-center p-6 animate-fade-in">
          <div className="glass-strong liquid !bg-[rgba(255,255,255,0.88)] rounded-[36px] max-w-lg w-full p-9 text-center flex flex-col items-center ring-1 ring-[#991B1B]/25">
            <div className="glass-tile !w-16 !h-16 !rounded-[20px] text-[#991B1B] mb-5">
              <Camera size={28} />
            </div>

            <h2 className="text-[22px] font-bold text-[#141114] tracking-[-0.025em] mb-3">
              Unauthorized Video Source Detected
            </h2>

            <p className="text-[12.5px] text-[#991B1B] font-semibold mb-4 bg-[rgba(254,226,226,0.8)] border border-[#FCA5A5] px-3.5 py-1.5 rounded-full font-mono">
              Prohibited: {virtualCamName || 'OBS / Virtual Camera'}
            </p>

            <p className="text-[13.5px] text-[#55515A] mb-6 leading-relaxed">
              DeepVerify zero-trust proctoring requires direct raw sensor access for PRNU hardware fingerprinting and biological liveness. Virtual cameras, OBS loopbacks, and synthetic software feeds are strictly prohibited.
            </p>

            <div className="w-full space-y-3 mb-6">
              <p className="glass-label !text-[10.5px] text-left">
                Available Physical Webcams
              </p>
              {physicalDevices.length > 0 ? (
                <div className="space-y-2">
                  {physicalDevices.map((dev) => (
                    <button
                      key={dev.deviceId}
                      onClick={() => handleSelectPhysicalCamera(dev.deviceId)}
                      disabled={switchingCam}
                      className="w-full px-4 py-3 rounded-[16px] glass-btn !justify-between text-[13px] cursor-pointer"
                    >
                      <span className="truncate">{dev.label || 'Physical Webcam'}</span>
                      <Check size={14} className="text-[#1A6B3C] shrink-0" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-4 rounded-[16px] glass-inset text-[#67636C] text-[13px]">
                  No physical webcam detected. Please plug in or enable your physical camera hardware.
                </div>
              )}
            </div>

            <button
              onClick={() => handleSelectPhysicalCamera()}
              disabled={switchingCam}
              className="w-full glass-btn-primary !rounded-full py-3.5 text-[14px] cursor-pointer"
            >
              {switchingCam ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Connecting to Physical Webcam...</span>
                </>
              ) : (
                <>
                  <RefreshCw size={14} />
                  <span>Scan & Connect to Hardware Camera</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

    </div>
    </>
  )
}
