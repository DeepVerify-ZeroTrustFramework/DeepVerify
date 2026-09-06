import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Upload, Play, Pause, RotateCcw, AlertCircle,
  Loader2, Film, Cpu, HeartPulse, Activity, Eye, Home,
  CheckCircle2, XCircle, Clock, Zap, FileVideo
} from 'lucide-react'
import TrustGauge from '../components/TrustGauge'
import ModuleBreakdown from '../components/ModuleBreakdown'
import AlertFeed from '../components/AlertFeed'
import { useTrustScore } from '../hooks/useTrustScore'
import { getApiUrl, getWsUrl } from '../utils/apiConfig'

type DemoPhase = 'UPLOAD' | 'READY' | 'ANALYZING' | 'COMPLETE'

export default function DemoMode() {
  // ── Phase & file state ──
  const [phase, setPhase] = useState<DemoPhase>('UPLOAD')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Session state ──
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)

  // ── Playback state ──
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [framesSent, setFramesSent] = useState(0)
  const [wsConnected, setWsConnected] = useState(false)

  // ── Refs ──
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameWsRef = useRef<WebSocket | null>(null)
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dropZoneRef = useRef<HTMLDivElement | null>(null)

  // ── Trust score (reuse existing hook) ──
  const { score, breakdown, raw, alerts, acknowledgeAlert } = useTrustScore(sessionId || '')

  // ── Create demo session on the backend ──
  const createDemoSession = useCallback(async () => {
    setCreatingSession(true)
    setError(null)
    try {
      const res = await fetch(getApiUrl('/api/sessions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_name: 'Demo Analysis',
          candidate_email: 'demo@deepverify.local',
          interviewer_name: 'Demo Inspector',
          role: 'Demo Mode',
          duration: 30,
          interview_type: 'Demo',
          modules: { prnu: true, rppg: true, jitter: true },
        }),
      })
      if (!res.ok) throw new Error(`Session creation failed: ${res.status}`)
      const data = await res.json()
      setSessionId(data.session_id)
      return data.session_id
    } catch (e: any) {
      setError(`Failed to create demo session: ${e.message}`)
      return null
    } finally {
      setCreatingSession(false)
    }
  }, [])

  // ── Handle file selection ──
  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) {
      setError('Please select a valid video file (.mp4, .webm, .mov)')
      return
    }
    if (file.size > 500 * 1024 * 1024) {
      setError('File is too large. Maximum size is 500MB.')
      return
    }
    setError(null)
    setVideoFile(file)
    const url = URL.createObjectURL(file)
    setVideoUrl(url)
    setPhase('READY')
  }, [])

  // ── Drag & drop handlers ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dropZoneRef.current?.classList.add('border-[#A4123F]', 'bg-[#FDF2F5]')
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dropZoneRef.current?.classList.remove('border-[#A4123F]', 'bg-[#FDF2F5]')
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dropZoneRef.current?.classList.remove('border-[#A4123F]', 'bg-[#FDF2F5]')
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  // ── Connect WebSocket & start streaming frames ──
  const startAnalysis = useCallback(async () => {
    if (!videoRef.current || !videoUrl) return

    // Create session if not already created
    let sid = sessionId
    if (!sid) {
      sid = await createDemoSession()
      if (!sid) return
    }

    setPhase('ANALYZING')
    setFramesSent(0)

    // Connect the frame WebSocket
    const wsUrl = getWsUrl(`/ws/frames/${sid}`)
    const frameWs = new WebSocket(wsUrl)
    frameWs.binaryType = 'arraybuffer'
    frameWsRef.current = frameWs

    frameWs.onopen = () => {
      console.log('[Demo] Frame WS connected')
      setWsConnected(true)

      // Start playing the video
      videoRef.current?.play()
      setIsPlaying(true)

      // Create offscreen canvas for frame extraction
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      const ctx = canvas.getContext('2d')

      // Extract and send frames at 10 FPS
      const interval = setInterval(() => {
        if (!frameWs || frameWs.readyState !== WebSocket.OPEN) return
        const video = videoRef.current
        if (!video || video.paused || video.ended || video.readyState < 2) return

        try {
          ctx?.drawImage(video, 0, 0, 320, 240)
          canvas.toBlob(
            (blob) => {
              if (blob && frameWs && frameWs.readyState === WebSocket.OPEN) {
                blob.arrayBuffer().then((buffer) => {
                  if (frameWs && frameWs.readyState === WebSocket.OPEN) {
                    frameWs.send(buffer)
                    setFramesSent((prev) => prev + 1)
                  }
                })
              }
            },
            'image/jpeg',
            0.85
          )
        } catch {
          // Ignore drawing errors
        }
      }, 100) // 10 FPS

      frameIntervalRef.current = interval
    }

    frameWs.onerror = (err) => {
      console.warn('[Demo] Frame WS Error:', err)
      setError('WebSocket connection failed. Make sure the backend is running.')
    }

    frameWs.onclose = () => {
      console.log('[Demo] Frame WS disconnected')
      setWsConnected(false)
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
    }
  }, [videoUrl, sessionId, createDemoSession])

  // ── Video event handlers ──
  const handleVideoEnd = useCallback(() => {
    setIsPlaying(false)
    setPhase('COMPLETE')

    // Keep WS open for a few more seconds to get final fusion
    setTimeout(() => {
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current)
        frameIntervalRef.current = null
      }
      if (frameWsRef.current) {
        frameWsRef.current.close()
        frameWsRef.current = null
      }
    }, 5000)
  }, [])

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play()
      setIsPlaying(true)
    } else {
      video.pause()
      setIsPlaying(false)
    }
  }, [])

  const resetDemo = useCallback(() => {
    // Stop everything
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current)
      frameIntervalRef.current = null
    }
    if (frameWsRef.current) {
      frameWsRef.current.close()
      frameWsRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl)

    setVideoFile(null)
    setVideoUrl(null)
    setSessionId(null)
    setPhase('UPLOAD')
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setFramesSent(0)
    setWsConnected(false)
    setError(null)
  }, [videoUrl])

  // Re-analyze: replay the same video with a fresh backend session
  const reAnalyze = useCallback(async () => {
    // Stop current connections
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current)
      frameIntervalRef.current = null
    }
    if (frameWsRef.current) {
      frameWsRef.current.close()
      frameWsRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }

    // Reset state but keep the video file
    setSessionId(null)
    setIsPlaying(false)
    setCurrentTime(0)
    setFramesSent(0)
    setWsConnected(false)
    setError(null)
    setPhase('READY')

    // Create a fresh session and restart analysis after a short delay
    setTimeout(async () => {
      const sid = await createDemoSession()
      if (!sid || !videoRef.current || !videoUrl) return
      // Trigger startAnalysis flow
      setPhase('ANALYZING')
      setFramesSent(0)

      const wsUrl = getWsUrl(`/ws/frames/${sid}`)
      const frameWs = new WebSocket(wsUrl)
      frameWs.binaryType = 'arraybuffer'
      frameWsRef.current = frameWs

      frameWs.onopen = () => {
        setWsConnected(true)
        videoRef.current!.currentTime = 0
        videoRef.current!.play()
        setIsPlaying(true)

        const canvas = canvasRef.current!
        const ctx = canvas.getContext('2d')!
        canvas.width = 320
        canvas.height = 240

        const interval = setInterval(() => {
          if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) return
          ctx.drawImage(videoRef.current, 0, 0, 320, 240)
          canvas.toBlob((blob) => {
            if (blob && frameWs.readyState === WebSocket.OPEN) {
              blob.arrayBuffer().then(buf => {
                frameWs.send(buf)
                setFramesSent(p => p + 1)
              })
            }
          }, 'image/jpeg', 0.7)
        }, 100)
        frameIntervalRef.current = interval
      }

      frameWs.onerror = () => setError('WebSocket connection failed.')
      frameWs.onclose = () => {
        setWsConnected(false)
        if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
      }
    }, 300)
  }, [videoUrl, createDemoSession])

  // ── Track video time ──
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleTimeUpdate = () => setCurrentTime(video.currentTime)
    const handleLoadedMetadata = () => setDuration(video.duration)

    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('ended', handleVideoEnd)

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('ended', handleVideoEnd)
    }
  }, [videoUrl, handleVideoEnd])

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current)
      if (frameWsRef.current) frameWsRef.current.close()
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
  }, [videoUrl])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  // ── Score color helpers ──
  const getScoreColor = (s: number) => {
    if (s >= 80) return '#1A6B3C'
    if (s >= 60) return '#92400E'
    return '#991B1B'
  }

  const getScoreLabel = (s: number) => {
    if (s >= 80) return 'AUTHENTIC'
    if (s >= 60) return 'SUSPICIOUS'
    return 'DEEPFAKE DETECTED'
  }

  return (
    <div className="min-h-screen bg-[#F7F7F8]">
      {/* ── Floating glass island Navbar ── */}
      <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
        <nav className="w-full max-w-[1100px] pointer-events-auto rounded-[1.25rem] bg-white/75 backdrop-blur-xl border border-white/80 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
          <div className="px-6 h-[4.5rem] flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#A4123F] flex items-center justify-center shadow-[0_4px_12px_rgba(164,18,63,0.3)]">
                <ShieldCheck size={20} className="text-white" />
              </div>
              <div>
                <p className="text-[17px] font-bold text-[#0F0F0F] tracking-tight leading-none">DeepVerify</p>
                <p className="text-[11px] text-[#6B6B6B] mt-0.5">Demo Mode — Forensic Video Analysis</p>
              </div>
            </Link>

            <div className="flex items-center gap-3">
              {phase === 'ANALYZING' && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#FDF2F5] border border-[#EDD0D8]">
                  <div className="w-2 h-2 rounded-full bg-[#A4123F] animate-pulse" />
                  <span className="text-[11px] font-semibold text-[#A4123F]">LIVE ANALYSIS</span>
                </div>
              )}
              {wsConnected && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#E6F4ED]">
                  <Zap size={12} className="text-[#1A6B3C]" />
                  <span className="text-[10px] font-semibold text-[#1A6B3C]">WS Connected</span>
                </div>
              )}
              <Link
                to="/"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-black/5 transition-colors"
              >
                <Home size={14} /> Home
              </Link>
            </div>
          </div>
        </nav>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 pt-32 pb-8">
        {/* ── Error Banner ── */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-[#FEE2E2] border border-[#FCA5A5] flex items-start gap-3 animate-fade-in">
            <AlertCircle size={18} className="text-[#991B1B] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-[#991B1B]">Error</p>
              <p className="text-[13px] text-[#991B1B]/80">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="ml-auto text-[#991B1B]/60 hover:text-[#991B1B]">
              <XCircle size={16} />
            </button>
          </div>
        )}

        {/* ═══ UPLOAD PHASE ═══ */}
        {phase === 'UPLOAD' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <div className="w-full max-w-xl">
              <div className="text-center mb-8">
                <div className="w-16 h-16 rounded-2xl bg-[#A4123F] flex items-center justify-center mx-auto mb-4">
                  <Film size={28} className="text-white" />
                </div>
                <h1 className="text-2xl font-bold text-[#0F0F0F] mb-2">
                  Forensic Video Analysis
                </h1>
                <p className="text-[14px] text-[#6B6B6B] max-w-md mx-auto">
                  Upload any video to test DeepVerify's forensic algorithms. The system will analyze
                  PRNU fingerprints, rPPG liveness signals, and behavioral patterns in real-time.
                </p>
              </div>

              <div
                ref={dropZoneRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className="border-2 border-dashed border-[#D0D0D3] rounded-2xl p-12 text-center hover:border-[#A4123F] hover:bg-[#FDF2F5]/50 transition-all duration-200 cursor-pointer group"
                onClick={() => document.getElementById('demo-video-input')?.click()}
              >
                <div className="w-14 h-14 rounded-xl bg-[#F7F7F8] group-hover:bg-[#FDF2F5] flex items-center justify-center mx-auto mb-4 transition-colors">
                  <Upload size={24} className="text-[#9B9B9B] group-hover:text-[#A4123F] transition-colors" />
                </div>
                <p className="text-[15px] font-semibold text-[#3A3A3A] mb-1">
                  Drop your video file here
                </p>
                <p className="text-[13px] text-[#9B9B9B] mb-4">
                  or click to browse • Supports MP4, WebM, MOV
                </p>
                <div className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#A4123F] text-white text-sm font-semibold rounded-xl hover:bg-[#8B0F35] transition-colors">
                  <FileVideo size={16} /> Select Video
                </div>
              </div>

              <input
                id="demo-video-input"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFileSelect(file)
                }}
              />

              {/* Info cards */}
              <div className="grid grid-cols-3 gap-3 mt-6">
                {[
                  { icon: Cpu, label: 'PRNU Analysis', desc: 'Camera fingerprint verification' },
                  { icon: HeartPulse, label: 'rPPG Liveness', desc: 'Biological pulse detection' },
                  { icon: Eye, label: 'Behavioral AI', desc: 'Anomaly pattern detection' },
                ].map((item) => (
                  <div key={item.label} className="p-3 rounded-xl bg-white border border-[#E4E4E6] text-center">
                    <item.icon size={18} className="text-[#A4123F] mx-auto mb-2" />
                    <p className="text-[11px] font-bold text-[#3A3A3A]">{item.label}</p>
                    <p className="text-[10px] text-[#9B9B9B]">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ READY / ANALYZING / COMPLETE ═══ */}
        {(phase === 'READY' || phase === 'ANALYZING' || phase === 'COMPLETE') && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ── LEFT: Video Panel ── */}
            <div className="lg:col-span-2 space-y-4">
              {/* Video player */}
              <div className="rounded-2xl bg-white border border-[#E4E4E6] overflow-hidden">
                <div className="p-4 border-b border-[#E4E4E6] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#FDF2F5] flex items-center justify-center">
                      <Film size={16} className="text-[#A4123F]" />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-[#0F0F0F]">
                        {videoFile?.name || 'Video'}
                      </p>
                      <p className="text-[10px] text-[#9B9B9B]">
                        {videoFile ? `${(videoFile.size / (1024 * 1024)).toFixed(1)} MB` : ''}
                        {duration > 0 && ` • ${formatTime(duration)} duration`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {phase === 'READY' && (
                      <button
                        onClick={startAnalysis}
                        disabled={creatingSession}
                        className="flex items-center gap-2 px-4 py-2 bg-[#A4123F] text-white text-sm font-semibold rounded-xl hover:bg-[#8B0F35] transition-colors disabled:opacity-50"
                      >
                        {creatingSession ? (
                          <><Loader2 size={14} className="animate-spin" /> Creating session…</>
                        ) : (
                          <><Play size={14} /> Start Analysis</>
                        )}
                      </button>
                    )}
                    {phase === 'ANALYZING' && (
                      <button
                        onClick={togglePlayPause}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#EFEFF0] text-[#3A3A3A] text-xs font-semibold rounded-lg hover:bg-[#E4E4E6] transition-colors"
                      >
                        {isPlaying ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Resume</>}
                      </button>
                    )}
                    {phase === 'COMPLETE' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={reAnalyze}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#A4123F] text-white text-xs font-semibold rounded-lg hover:bg-[#8B0F35] transition-colors"
                        >
                          <RotateCcw size={13} /> Re-analyze
                        </button>
                        <button
                          onClick={resetDemo}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#EFEFF0] text-[#3A3A3A] text-xs font-semibold rounded-lg hover:bg-[#E4E4E6] transition-colors"
                        >
                          <RotateCcw size={13} /> New Video
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative bg-[#0A0A0A] aspect-video">
                  <video
                    ref={videoRef}
                    src={videoUrl || undefined}
                    className="w-full h-full object-contain"
                    playsInline
                    muted
                  />
                  {/* Overlay for READY state */}
                  {phase === 'READY' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <button
                        onClick={startAnalysis}
                        disabled={creatingSession}
                        className="w-20 h-20 rounded-full bg-[#A4123F] flex items-center justify-center hover:bg-[#8B0F35] transition-all hover:scale-105"
                      >
                        {creatingSession ? (
                          <Loader2 size={32} className="text-white animate-spin" />
                        ) : (
                          <Play size={32} className="text-white ml-1" />
                        )}
                      </button>
                    </div>
                  )}

                  {/* COMPLETE overlay */}
                  {phase === 'COMPLETE' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <div className="text-center">
                        <div
                          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3"
                          style={{ backgroundColor: `${getScoreColor(score)}20` }}
                        >
                          {score >= 60 ? (
                            <CheckCircle2 size={32} style={{ color: getScoreColor(score) }} />
                          ) : (
                            <XCircle size={32} style={{ color: getScoreColor(score) }} />
                          )}
                        </div>
                        <p className="text-xl font-bold text-white mb-1">Analysis Complete</p>
                        <p
                          className="text-sm font-bold"
                          style={{ color: getScoreColor(score) }}
                        >
                          {getScoreLabel(score)} — Score: {Math.round(score)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Progress bar */}
                {(phase === 'ANALYZING' || phase === 'COMPLETE') && (
                  <div className="px-4 py-3 border-t border-[#E4E4E6]">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-mono text-[#6B6B6B]">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </span>
                      <span className="text-[11px] font-mono text-[#6B6B6B]">
                        {framesSent} frames sent
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#EFEFF0] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#A4123F] transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ── Raw Telemetry Cards ── */}
              {(phase === 'ANALYZING' || phase === 'COMPLETE') && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'PCE Score', value: raw.pce.toFixed(2), icon: Cpu, desc: 'PRNU correlation' },
                    { label: 'SNR (dB)', value: raw.snr_rppg.toFixed(1), icon: HeartPulse, desc: 'rPPG signal-to-noise' },
                    { label: 'CV Jitter', value: raw.cv_jitter.toFixed(3), icon: Activity, desc: 'Frame timing consistency' },
                    { label: 'Heart Rate', value: `${raw.hr_bpm.toFixed(0)} BPM`, icon: HeartPulse, desc: 'Detected pulse rate' },
                  ].map((t) => (
                    <div key={t.label} className="p-4 rounded-xl bg-white border border-[#E4E4E6]">
                      <div className="flex items-center gap-2 mb-2">
                        <t.icon size={14} className="text-[#A4123F]" />
                        <span className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wide">{t.label}</span>
                      </div>
                      <p className="text-xl font-bold font-mono text-[#0F0F0F]">{t.value}</p>
                      <p className="text-[10px] text-[#9B9B9B] mt-1">{t.desc}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── RIGHT: Trust Dashboard ── */}
            <div className="space-y-4">
              {/* Trust Score */}
              <div className="rounded-2xl bg-white border border-[#E4E4E6] p-6">
                <div className="flex items-center gap-2 mb-4">
                  <ShieldCheck size={16} className="text-[#A4123F]" />
                  <span className="text-[13px] font-bold text-[#0F0F0F]">Fusion Trust Score</span>
                </div>
                <TrustGauge score={score} />

                {phase === 'ANALYZING' && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-[#A4123F] font-medium">
                    <Loader2 size={12} className="animate-spin" />
                    Analyzing in real-time…
                  </div>
                )}

                {phase === 'COMPLETE' && (
                  <div className="mt-4 text-center">
                    <span
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase"
                      style={{
                        color: getScoreColor(score),
                        backgroundColor: `${getScoreColor(score)}15`,
                      }}
                    >
                      {score >= 60 ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      {getScoreLabel(score)}
                    </span>
                  </div>
                )}

                {phase === 'READY' && (
                  <div className="mt-4 text-center text-[12px] text-[#9B9B9B]">
                    Waiting for analysis to begin…
                  </div>
                )}
              </div>

              {/* Module Breakdown */}
              <div className="rounded-2xl bg-white border border-[#E4E4E6] p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Activity size={16} className="text-[#A4123F]" />
                  <span className="text-[13px] font-bold text-[#0F0F0F]">Module Breakdown</span>
                </div>
                <ModuleBreakdown breakdown={breakdown} />
              </div>

              {/* Alert Feed */}
              <div className="rounded-2xl bg-white border border-[#E4E4E6] p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} className="text-[#A4123F]" />
                    <span className="text-[13px] font-bold text-[#0F0F0F]">Forensic Alerts</span>
                  </div>
                  {alerts.length > 0 && (
                    <span className="px-2 py-0.5 bg-[#FEE2E2] text-[#991B1B] text-[10px] font-bold rounded-full">
                      {alerts.length}
                    </span>
                  )}
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  <AlertFeed alerts={alerts} onAcknowledge={acknowledgeAlert} />
                </div>
              </div>

              {/* Session info */}
              {sessionId && (
                <div className="rounded-2xl bg-white border border-[#E4E4E6] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock size={14} className="text-[#9B9B9B]" />
                    <span className="text-[11px] font-bold text-[#6B6B6B] uppercase">Session Details</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-[11px] text-[#9B9B9B]">Session ID</span>
                      <span className="text-[11px] font-mono text-[#3A3A3A]">{sessionId.slice(0, 12)}…</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[11px] text-[#9B9B9B]">Mode</span>
                      <span className="text-[11px] font-semibold text-[#A4123F]">Demo Analysis</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[11px] text-[#9B9B9B]">Frames Sent</span>
                      <span className="text-[11px] font-mono text-[#3A3A3A]">{framesSent}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Hidden canvas for reference (not needed in DOM but useful for debugging) */}
      <canvas ref={canvasRef} width={320} height={240} className="hidden" />
    </div>
  )
}
