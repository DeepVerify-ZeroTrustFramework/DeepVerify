import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ShieldCheck, Loader2, Code2, AlertCircle, Clock, AlertTriangle,
  Monitor, Users, Smartphone, Maximize2, Minimize2, Camera,
  CheckCircle2, XCircle, RefreshCw, UploadCloud, Lock, LogOut, Home,
  Mic, MicOff, Video, VideoOff, Eye, EyeOff
} from 'lucide-react'
import Editor from '@monaco-editor/react'
import { useWebRTC } from '../hooks/useWebRTC'
import { useBehavioralSocket } from '../hooks/useBehavioralSocket'
import GazeCapturer from '../components/GazeCapturer'
import type { GazeData } from '../components/GazeCapturer'
import ObjectDetector from '../components/ObjectDetector'
import type { ProhibitedObject } from '../components/ObjectDetector'

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

export default function CandidateSession() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)

  // Editor state
  const [selectedLang, setSelectedLang] = useState('Python')
  const [editorCode, setEditorCode] = useState(LANGUAGE_TEMPLATES['Python'].template)

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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/frames/${session.session_id}`
    const frameWs = new WebSocket(wsUrl)
    frameWsRef.current = frameWs
    frameWs.binaryType = 'arraybuffer'

    frameWs.onopen = () => {
      console.log('[Frames WS] Connected for real-time PRNU & rPPG forensic analysis')

      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      const ctx = canvas.getContext('2d')

      // 100ms interval = 10 FPS
      const frameInterval = setInterval(() => {
        if (!camEnabledRef.current) return // Do NOT capture or transmit frames when camera is disabled
        if (!frameWs || frameWs.readyState !== WebSocket.OPEN) return
        const video = selfVideoRef.current
        if (!video || video.readyState < 2) return

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

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false)

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
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [addViolationToast])

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  // Initialize WebRTC
  const rtc = useWebRTC(session?.session_id || '', 'candidate', localStream)

  // Initialize Behavioral Socket with violation callbacks
  const telemetry = useBehavioralSocket(session?.session_id || '', !!session, {
    onViolation: addViolationToast,
  })

  useEffect(() => {
    telemetryRef.current = telemetry
  }, [telemetry])

  useEffect(() => {
    if (session && localStream) {
      rtc.initialize()
    }
    return () => {
      rtc.stop()
    }
  }, [session, localStream])

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

  // Language change handler
  const handleLanguageChange = (lang: string) => {
    setSelectedLang(lang)
    setEditorCode(LANGUAGE_TEMPLATES[lang].template)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader2 className="animate-spin text-white" />
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center text-center p-6">
        <AlertCircle className="text-red-500 w-12 h-12 mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">Error</h1>
        <p className="text-gray-400">{error}</p>
      </div>
    )
  }

  if (isEnded) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex flex-col items-center justify-center p-6 text-center font-sans">
        <div className="w-full max-w-lg bg-white border border-[#EAEAEA] rounded-3xl p-10 shadow-lg flex flex-col items-center">
          <div className="w-20 h-20 rounded-full bg-[#F0FDF4] border-2 border-[#16A34A] flex items-center justify-center text-[#16A34A] mb-6 shadow-md shadow-green-100">
            <CheckCircle2 size={42} />
          </div>
          <h1 className="text-2xl font-bold text-[#0F0F0F] mb-2">Interview Concluded</h1>
          <p className="text-sm text-[#555] mb-6 max-w-md leading-relaxed">
            Thank you, <strong className="text-[#0F0F0F]">{session?.candidate_name || 'Candidate'}</strong>! Your technical interview session has been successfully finalized and submitted.
          </p>

          <div className="w-full bg-[#F9F9FB] border border-[#E5E5E8] rounded-2xl p-5 mb-8 text-left space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#6B6B6B]">Session ID:</span>
              <span className="font-mono font-bold text-[#0F0F0F]">{session?.session_id}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#6B6B6B]">Role:</span>
              <span className="font-semibold text-[#0F0F0F]">{session?.role || 'Software Engineer'}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#6B6B6B]">Identity Verification:</span>
              <span className="inline-flex items-center gap-1 font-bold text-[#1A6B3C]">
                <CheckCircle2 size={13} /> {faceVerified ? 'Verified via AWS Rekognition' : 'Submitted'}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#6B6B6B]">Total Duration:</span>
              <span className="font-mono font-bold text-[#0F0F0F]">{formatTime(elapsed)}</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <button
              onClick={() => navigate('/student/inbox')}
              className="flex-1 py-3 px-5 rounded-xl bg-[#A4123F] hover:bg-[#850E32] text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <Home size={15} /> Return to Portal
            </button>
            <button
              onClick={() => navigate('/')}
              className="py-3 px-5 rounded-xl border border-[#D5D5D7] hover:bg-gray-50 text-xs font-semibold text-[#3A3A3A] transition-colors cursor-pointer"
            >
              Exit to Homepage
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-[#0A0A0A] flex flex-col overflow-hidden text-white font-sans relative">
      {/* Violation Alert Toasts */}
      <div className="fixed top-16 right-6 z-50 flex flex-col gap-2 pointer-events-none max-w-sm">
        {violations.map((v) => (
          <div
            key={v.id}
            className="flex items-start gap-2.5 p-3 rounded-lg bg-[#2A0808] border border-[#DC2626] text-white shadow-2xl animate-fade-in pointer-events-auto"
          >
            <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={16} />
            <div className="flex-1 text-[12px] leading-snug">
              <span className="font-bold text-red-300 block uppercase text-[10px] tracking-wider mb-0.5">
                Integrity Notice · {v.type.replace('_', ' ')}
              </span>
              {v.message}
            </div>
          </div>
        ))}
      </div>

      {/* Top bar */}
      <div className="h-14 bg-[#0F0F0F] border-b border-[#1A1A1A] flex items-center justify-between px-6 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#1A6B3C]/10 border border-[#1A6B3C]/30 text-[#4CAF50] text-[11px] font-medium">
            <ShieldCheck size={14} /> Active Proctored Session
          </div>

          {/* AWS Rekognition Face Verification Badge */}
          {faceVerified ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-semibold">
              <CheckCircle2 size={13} />
              <span>✓ Face Verified ({faceSimilarity ? `${faceSimilarity}%` : 'Match'})</span>
            </div>
          ) : faceVerificationStatus === 'FAILED' ? (
            <button
              onClick={() => setShowVerificationModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/15 border border-red-500/40 text-red-400 text-[11px] font-semibold hover:bg-red-500/25 transition-colors cursor-pointer"
            >
              <XCircle size={13} />
              <span>✗ Verification Failed · Retry</span>
            </button>
          ) : (
            <button
              onClick={() => setShowVerificationModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] font-semibold hover:bg-amber-500/25 transition-colors cursor-pointer animate-pulse"
            >
              <Camera size={13} />
              <span>Verify Face via Rekognition</span>
            </button>
          )}

          <span className="text-sm font-medium text-gray-300 ml-2">{session.interview_type} Interview</span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <button
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A1A1A] hover:bg-[#252525] text-xs font-medium text-gray-300 border border-[#333] transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
          </button>
          <div className="flex items-center gap-1.5 text-gray-400">
            <Clock size={14} />
            <span className="font-mono">{formatTime(elapsed)}</span>
          </div>

          <button
            onClick={() => setShowEndModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 text-xs font-semibold transition-colors cursor-pointer"
            title="End Interview"
          >
            <LogOut size={14} />
            <span>End Interview</span>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Video Area */}
        <div className="flex-1 relative flex flex-col p-4">
          <div className="flex-1 bg-[#11131A] rounded-xl border border-[#1A1A1A] relative overflow-hidden flex items-center justify-center">
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
                <Loader2 size={32} className="animate-spin text-gray-500 mb-4" />
                <p className="text-gray-400 text-sm">
                  {rtc.state === 'error' ? rtc.error : 'Waiting for interviewer to join...'}
                </p>
              </div>
            )}

            {/* Self view PiP & Candidate Toolbar */}
            <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2">
              {!selfViewHidden && (
                <div className="w-48 aspect-video bg-black rounded-lg border border-gray-700 overflow-hidden shadow-2xl relative">
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
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 text-gray-400 text-[10px] gap-1">
                          <VideoOff size={16} className="text-red-400" />
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
                    <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-emerald-600/90 text-white text-[9px] font-bold flex items-center gap-1 shadow-sm">
                      <CheckCircle2 size={9} /> ID VERIFIED
                    </div>
                  ) : (
                    <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-amber-600/90 text-white text-[9px] font-bold flex items-center gap-1 shadow-sm">
                      <Lock size={9} /> UNVERIFIED
                    </div>
                  )}

                  {faceCount !== 1 && (
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-red-600/90 text-white text-[9px] font-bold flex items-center gap-1">
                      <Users size={10} /> {faceCount === 0 ? 'NO FACE' : `${faceCount} FACES`}
                    </div>
                  )}
                  {detectedItem && (
                    <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-amber-600/90 text-white text-[9px] font-bold flex items-center gap-1">
                      <Smartphone size={10} /> {detectedItem.toUpperCase()}
                    </div>
                  )}
                </div>
              )}

              {/* Floating Candidate Media Controls */}
              <div className="flex items-center gap-1.5 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 shadow-lg">
                <button
                  type="button"
                  onClick={toggleCandidateMic}
                  title={micEnabled ? "Mute Microphone" : "Unmute Microphone"}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    micEnabled ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
                  }`}
                >
                  {micEnabled ? <Mic size={14} /> : <MicOff size={14} />}
                </button>
                <button
                  type="button"
                  onClick={toggleCandidateCam}
                  title={camEnabled ? "Turn Off Camera" : "Turn On Camera"}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    camEnabled ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
                  }`}
                >
                  {camEnabled ? <Video size={14} /> : <VideoOff size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => setSelfViewHidden(!selfViewHidden)}
                  title={selfViewHidden ? "Show Self Video" : "Minimize / Hide Self Video"}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    selfViewHidden ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {selfViewHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Candidate Name overlay */}
            <div className="absolute bottom-6 left-6 px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded-md text-[13px] font-medium border border-white/10 flex items-center gap-2">
              <span>{session.candidate_name}</span>
              {reflectionAlert && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Glare Detected
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Code Editor with Monaco */}
        <div className="w-[450px] border-l border-[#1A1A1A] bg-[#11131A] flex flex-col">
          {/* Editor Header */}
          <div className="h-12 border-b border-[#1A1A1A] flex items-center justify-between px-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
              <Code2 size={16} className="text-blue-400" />
              Shared Workspace (Clipboard Protected)
            </div>
            <select
              value={selectedLang}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="bg-[#0A0A0A] border border-[#333] rounded px-2 py-1 text-xs text-gray-300 outline-none cursor-pointer"
            >
              {Object.keys(LANGUAGE_TEMPLATES).map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          {/* Monaco Editor */}
          <div className="flex-1 overflow-hidden relative">
            {!faceVerified && (
              <div className="absolute inset-0 z-20 bg-[#0A0A0A]/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4 text-amber-400">
                  <Lock size={22} />
                </div>
                <h3 className="text-base font-bold text-white mb-2">Coding Workspace Locked</h3>
                <p className="text-xs text-gray-400 max-w-xs mb-5 leading-relaxed">
                  Identity face verification via AWS Rekognition is required before you can access the code editor and interview questions.
                </p>
                <button
                  onClick={() => setShowVerificationModal(true)}
                  className="px-5 py-2.5 bg-[#A4123F] hover:bg-[#850E32] text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-[#A4123F]/25 cursor-pointer"
                >
                  <Camera size={14} /> Open Face Verification
                </button>
              </div>
            )}
            <Editor
              height="100%"
              language={LANGUAGE_TEMPLATES[selectedLang].lang}
              value={editorCode}
              onChange={(value) => setEditorCode(value || '')}
              theme="vs-dark"
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

          {/* Telemetry Strip */}
          <div className="h-10 border-t border-[#1A1A1A] bg-[#0A0A0A] flex items-center px-4 gap-4 text-[10px] font-mono text-gray-500 tracking-wider">
            <div>GAZE Δ {gazeDelta.toFixed(3)}</div>
            <div>rPPG MONITOR ACTIVE</div>
            <div className="flex items-center gap-1">
              <Users size={12} className={faceCount === 1 ? 'text-green-500' : 'text-red-500'} />
              <span>{faceCount} FACE</span>
            </div>
            <div className="ml-auto text-green-700 font-semibold flex items-center gap-1">
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
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#12141C] border border-[#232736] rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col animate-fade-in">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#232736] flex items-center justify-between bg-[#171A24]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#A4123F] flex items-center justify-center text-white">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    Identity Verification <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono border border-purple-500/30">AWS Rekognition</span>
                  </h2>
                  <p className="text-[11px] text-gray-400">
                    Compare your live video feed against your reference photograph to unlock the interview.
                  </p>
                </div>
              </div>

              {faceVerified && (
                <button
                  onClick={() => setShowVerificationModal(false)}
                  className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded bg-[#232736] hover:bg-[#2F3447] transition-colors"
                >
                  Close
                </button>
              )}
            </div>

            {/* Modal Body: Two Column Comparison */}
            <div className="p-6 flex flex-col gap-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* 1. Stored Reference Photograph */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-gray-300">
                    <span>1. Reference Photograph</span>
                    <button
                      onClick={() => reuploadInputRef.current?.click()}
                      className="text-[11px] text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw size={11} className={reuploading ? 'animate-spin' : ''} />
                      <span>{referenceImageUrl ? 'Replace Photo' : 'Upload Photo'}</span>
                    </button>
                  </div>

                  <div className="aspect-[4/3] rounded-xl bg-[#0A0B0E] border border-[#232736] overflow-hidden relative flex items-center justify-center">
                    {referenceImageUrl ? (
                      <img
                        src={referenceImageUrl}
                        alt="Reference Candidate Portrait"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div
                        onClick={() => reuploadInputRef.current?.click()}
                        className="flex flex-col items-center justify-center p-4 text-center cursor-pointer hover:bg-[#151822] transition-colors w-full h-full"
                      >
                        <UploadCloud size={28} className="text-gray-500 mb-2" />
                        <p className="text-xs font-medium text-gray-300">No reference photo uploaded</p>
                        <p className="text-[10px] text-gray-500 mt-1">Click to upload identity photo</p>
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-xs text-[10px] font-medium text-gray-300 border border-white/10">
                      Source Image (ID)
                    </div>
                  </div>
                  {reuploadError && (
                    <p className="text-[11px] text-red-400 mt-0.5">{reuploadError}</p>
                  )}
                </div>

                {/* 2. Live Webcam Target Feed */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-gray-300">
                    <span>2. Live Interview Snapshot</span>
                    <span className="text-[11px] font-mono text-gray-400">Target Image</span>
                  </div>

                  <div className="aspect-[4/3] rounded-xl bg-black border border-[#232736] overflow-hidden relative flex items-center justify-center">
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
                      <div className="flex flex-col items-center justify-center text-gray-500">
                        <Loader2 size={24} className="animate-spin mb-2" />
                        <span className="text-xs">Initializing camera...</span>
                      </div>
                    )}

                    {/* Live status pill */}
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-xs text-[10px] font-medium border border-white/10 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      <span>Live Video</span>
                    </div>

                    <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-xs text-[10px] font-semibold border border-white/10 flex items-center gap-1">
                      <Users size={10} className={faceCount === 1 ? 'text-emerald-400' : 'text-red-400'} />
                      <span className={faceCount === 1 ? 'text-emerald-300' : 'text-red-300'}>
                        {faceCount === 0 ? 'No Face Detected' : faceCount === 1 ? '1 Face Positioned' : `${faceCount} Faces Detected`}
                      </span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Status & Feedback Banner */}
              {isVerifying && (
                <div className="p-3.5 rounded-xl bg-purple-950/40 border border-purple-500/30 flex items-center gap-3 text-purple-200 text-xs animate-pulse">
                  <Loader2 size={18} className="animate-spin text-purple-400 shrink-0" />
                  <div>
                    <span className="font-semibold block">Calling AWS Rekognition CompareFaces...</span>
                    Extracting facial landmarks and computing identity similarity score.
                  </div>
                </div>
              )}

              {/* SUCCESS RESULT */}
              {faceVerified && (
                <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-start gap-3 text-emerald-200 animate-fade-in">
                  <CheckCircle2 size={20} className="text-emerald-400 shrink-0 mt-0.5" />
                  <div className="flex-1 text-xs">
                    <span className="font-bold text-emerald-300 text-sm block mb-0.5">
                      ✓ Face Verification Successful
                    </span>
                    <p className="text-emerald-200/90 leading-relaxed">
                      AWS Rekognition confirmed candidate identity match with <strong className="font-bold text-emerald-300">{faceSimilarity}%</strong> similarity score.
                    </p>
                    <p className="text-[11px] text-emerald-400/80 mt-1">
                      Workspace unlocked. You may now proceed with your coding interview.
                    </p>
                  </div>
                </div>
              )}

              {/* FAILURE RESULT */}
              {!isVerifying && faceVerificationStatus === 'FAILED' && (
                <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 flex items-start gap-3 text-red-200 animate-fade-in">
                  <XCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1 text-xs">
                    <span className="font-bold text-red-300 text-sm block mb-0.5">
                      ✗ Face Verification Failed
                    </span>
                    <p className="text-red-200/90 leading-relaxed">
                      The live candidate does not appear to match the uploaded reference photograph.
                      {faceSimilarity !== null && (
                        <span> (Similarity score: <strong className="font-semibold">{faceSimilarity}%</strong>, required: 80.0%)</span>
                      )}
                    </p>
                    <p className="text-[11px] text-red-300/80 mt-1">
                      Access is blocked until verification succeeds. Please ensure good lighting, align your face inside the guide frame, or re-upload a clearer reference photograph.
                    </p>
                  </div>
                </div>
              )}

              {/* ERROR RESULT */}
              {!isVerifying && faceVerificationStatus === 'ERROR' && verificationError && (
                <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 flex items-start gap-3 text-amber-200 text-xs animate-fade-in">
                  <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold text-amber-300 block mb-0.5">Verification Error</span>
                    {verificationError}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                {!faceVerified ? (
                  <>
                    <button
                      type="button"
                      onClick={() => reuploadInputRef.current?.click()}
                      className="px-4 py-2.5 rounded-xl border border-[#333748] text-xs font-semibold text-gray-300 hover:bg-[#1D212E] hover:text-white transition-colors cursor-pointer"
                    >
                      Re-upload Photo
                    </button>
                    <button
                      type="button"
                      onClick={triggerFaceVerification}
                      disabled={isVerifying || !localStream || !referenceImageUrl}
                      className="px-6 py-2.5 rounded-xl bg-[#A4123F] hover:bg-[#850E32] disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold text-white transition-all shadow-lg shadow-[#A4123F]/30 flex items-center gap-2 cursor-pointer"
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
                    className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white transition-colors cursor-pointer flex items-center gap-2"
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#16181F] border border-gray-800 rounded-2xl p-6 shadow-2xl animate-fade-in text-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center">
                <LogOut size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold">Conclude & Submit Interview?</h3>
                <p className="text-xs text-gray-400">This action will finalize your session</p>
              </div>
            </div>

            <p className="text-xs text-gray-300 mb-6 leading-relaxed">
              Are you sure you want to end your interview? Your camera feed, code submissions, and identity verification logs will be saved and finalized for review.
            </p>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowEndModal(false)}
                disabled={endingSession}
                className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-gray-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEndInterview}
                disabled={endingSession}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-bold text-white transition-colors flex items-center gap-2 cursor-pointer shadow-lg shadow-red-600/20"
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

    </div>
  )
}
