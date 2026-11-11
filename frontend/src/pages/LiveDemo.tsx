// Live Demo: the real interview pipeline, with a choice of video source.
//
// 1. Enroll: fingerprint the real webcam (like the system check).
// 2. Pick a source: any camera (incl. OBS Virtual Camera) or a video file played
//    as the camera. Switch sources at any time while streaming.
// 3. Stream: frames, PRNU crops, rPPG face crops and frame timing go to the same
//    backend as a live interview; head-turn liveness challenges appear here.
//    The server judges every source against the enrolled webcam.

import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Camera, Upload, Play, Square, ArrowLeft, ArrowRight,
  CheckCircle2, XCircle, Loader2, Home,
} from 'lucide-react'
import TrustGauge from '../components/TrustGauge'
import ModuleBreakdown from '../components/ModuleBreakdown'
import AlertFeed from '../components/AlertFeed'
import { useTrustScore } from '../hooks/useTrustScore'
import { getApiUrl, getWsUrl } from '../utils/apiConfig'
import { startRppgCropStream } from '../utils/rppgCrop'
import { startFrameTiming } from '../utils/frameTiming'
import { attachSnapshotResponder } from '../utils/snapshot'

type Phase = 'SETUP' | 'ENROLLING' | 'READY' | 'LIVE'
type Source = { kind: 'camera'; deviceId: string; label: string } | { kind: 'file'; url: string; label: string }
type Challenge = { step: number; of: number; direction: 'LEFT' | 'RIGHT'; instruction: string; timeoutMs: number; key: number }

export default function LiveDemo() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('SETUP')
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [enrollDevice, setEnrollDevice] = useState<string>('')
  const [enrollPct, setEnrollPct] = useState(0)
  const [source, setSource] = useState<Source | null>(null)
  const [framesSent, setFramesSent] = useState(0)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [result, setResult] = useState<{ passed: boolean; message: string } | null>(null)
  const [livenessProgress, setLivenessProgress] = useState<null | { face: boolean; progress: number; wrongWay: boolean }>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<any>(null)
  const stopFnsRef = useRef<(() => void)[]>([])
  const resultTimerRef = useRef<any>(null)
  const sourceKindRef = useRef<'camera' | 'file'>('camera')

  // Tell the server whether the source is a camera or a video file (files get
  // no head-turn challenges: a played-back clip can't respond to prompts).
  const sendSourceKind = () => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SOURCE_KIND', kind: sourceKindRef.current }))
  }

  const { score, breakdown, alerts, acknowledgeAlert } = useTrustScore(sessionId || '')

  // ── Session ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(getApiUrl('/api/sessions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidate_name: 'Live Demo',
            candidate_email: 'demo@deepverify.local',
            interviewer_name: 'Demo Inspector',
            role: 'Live Demo',
            duration: 30,
            interview_type: 'LiveDemo',
            modules: { prnu: true, rppg: true, jitter: true },
          }),
        })
        if (!res.ok) throw new Error(`Session creation failed: ${res.status}`)
        const data = await res.json()
        setSessionId(data.session_id)
      } catch (e: any) {
        setError(e.message || 'Could not create a demo session. Is the backend running?')
      }
    })()
    return () => stopAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices()
    const cams = all.filter((d) => d.kind === 'videoinput')
    setDevices(cams)
    if (!enrollDevice && cams[0]) setEnrollDevice(cams[0].deviceId)
  }, [enrollDevice])

  useEffect(() => {
    // Ask once so device labels are visible, then list cameras
    navigator.mediaDevices.getUserMedia({ video: true })
      .then((s) => { s.getTracks().forEach((t) => t.stop()); return refreshDevices() })
      .catch(() => setError('Camera permission is needed for the live demo.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Source handling (one <video> element; the streaming loops always read it) ──
  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  const applySource = async (s: Source) => {
    const v = videoRef.current
    if (!v) return
    setError(null)
    try {
      if (s.kind === 'camera') {
        const stream = await navigator.mediaDevices.getUserMedia({
          // Same capture mode as the interview (camera default, usually 640x480).
          // Higher modes on USB 2.0 webcams are often JPEG-compressed inside the
          // camera, which erases most of the sensor fingerprint in every frame.
          video: { deviceId: { exact: s.deviceId } },
        })
        stopStream()
        streamRef.current = stream
        v.removeAttribute('src')
        v.loop = false
        v.srcObject = stream
      } else {
        stopStream()
        v.srcObject = null
        v.src = s.url
        v.loop = true
      }
      v.muted = true
      await v.play()
      setSource(s)
      sourceKindRef.current = s.kind
      sendSourceKind()
    } catch (e: any) {
      setError(`Could not open that source: ${e.message || e}`)
    }
  }

  // ── Step 1: enroll the real webcam's fingerprint (same as the system check) ──
  const enroll = async (): Promise<boolean> => {
    if (!sessionId || !enrollDevice) return false
    setPhase('ENROLLING')
    setEnrollPct(0)
    const label = devices.find((d) => d.deviceId === enrollDevice)?.label || 'Webcam'
    await applySource({ kind: 'camera', deviceId: enrollDevice, label })
    const v = videoRef.current!
    for (let i = 0; i < 20 && (!v.videoWidth || !v.videoHeight); i++) await new Promise((r) => setTimeout(r, 50))
    const camW = v.videoWidth, camH = v.videoHeight
    if (camW < 320 || camH < 240) {
      setError('This camera resolution is too low for PRNU enrollment.')
      setPhase('SETUP')
      return false
    }
    const c = document.createElement('canvas')
    c.width = 320; c.height = 240
    const ctx = c.getContext('2d')!
    const form = new FormData()
    let n = 0
    for (let i = 0; i < 30; i++) {
      ctx.drawImage(v, Math.floor((camW - 320) / 2), Math.floor((camH - 240) / 2), 320, 240, 0, 0, 320, 240)
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.95))
      if (blob) { form.append('frames', blob, `frame_${i}.jpg`); n++ }
      setEnrollPct(Math.round(((i + 1) / 30) * 100))
      await new Promise((r) => setTimeout(r, 120))
    }
    form.append('mode', 'crop')
    form.append('cam_width', String(camW))
    form.append('cam_height', String(camH))
    const res = n >= 5 ? await fetch(getApiUrl(`/api/enroll/${sessionId}`), { method: 'POST', body: form }) : null
    if (!res || !res.ok) {
      setError('Enrollment failed. Check that the backend is running and try again.')
      setPhase('SETUP')
      return false
    }
    setPhase('READY')
    return true
  }

  // One click: enroll the webcam, keep it as the source, start streaming
  const quickStart = async () => {
    if (await enroll()) startLive()
  }

  // ── Step 3: stream to the interview pipeline ──
  const startLive = () => {
    if (!sessionId) return
    const ws = new WebSocket(getWsUrl(`/ws/frames/${sessionId}`))
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let m: any
      try { m = JSON.parse(ev.data) } catch { return }
      if (m.type === 'LIVENESS_CHALLENGE') {
        setResult(null)
        setChallenge({
          step: m.step, of: m.of, direction: m.direction === 'RIGHT' ? 'RIGHT' : 'LEFT',
          instruction: m.instruction, timeoutMs: m.timeout_ms || 8000, key: Date.now(),
        })
        try {
          if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel()
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(m.instruction))
          }
        } catch { /* optional */ }
      } else if (m.type === 'LIVENESS_PROGRESS') {
        setLivenessProgress({ face: !!m.face, progress: Number(m.progress) || 0, wrongWay: !!m.wrong_way })
      } else if (m.type === 'LIVENESS_CHALLENGE_RESULT') {
        setLivenessProgress(null)
        setChallenge(null)
        setResult({ passed: !!m.passed, message: m.message || '' })
        if (resultTimerRef.current) clearTimeout(resultTimerRef.current)
        resultTimerRef.current = setTimeout(() => setResult(null), 4000)
      }
    }

    ws.onopen = () => {
      setPhase('LIVE')
      sendSourceKind()
      const frame = document.createElement('canvas')
      frame.width = 320; frame.height = 240
      const fctx = frame.getContext('2d')!
      const crop = document.createElement('canvas')
      crop.width = 320; crop.height = 240
      const cctx = crop.getContext('2d')!
      let tick = 0

      timerRef.current = setInterval(() => {
        const v = videoRef.current
        if (!v || ws.readyState !== WebSocket.OPEN || v.readyState < 2 || v.paused) return
        tick += 1
        const vw = v.videoWidth, vh = v.videoHeight
        // PRNU: native-resolution centre crop, ~3/s
        if (tick % 3 === 0 && vw >= 320 && vh >= 240) {
          cctx.drawImage(v, Math.floor((vw - 320) / 2), Math.floor((vh - 240) / 2), 320, 240, 0, 0, 320, 240)
          crop.toBlob((b) => {
            if (!b || ws.readyState !== WebSocket.OPEN) return
            b.arrayBuffer().then((jpeg) => {
              const pk = new Uint8Array(8 + jpeg.byteLength)
              pk.set([0x44, 0x56, 0x50, 0x52]) // 'DVPR'
              new DataView(pk.buffer).setUint16(4, vw)
              new DataView(pk.buffer).setUint16(6, vh)
              pk.set(new Uint8Array(jpeg), 8)
              if (ws.readyState === WebSocket.OPEN) ws.send(pk.buffer)
            })
          }, 'image/jpeg', 0.95)
        }
        // Main frame 320x240 @ 10 fps (face tracking, head-turn checks)
        fctx.drawImage(v, 0, 0, 320, 240)
        frame.toBlob((b) => {
          if (!b || ws.readyState !== WebSocket.OPEN) return
          b.arrayBuffer().then((buf) => {
            if (ws.readyState === WebSocket.OPEN) { ws.send(buf); setFramesSent((p) => p + 1) }
          })
        }, 'image/jpeg', 0.85)
      }, 100)

      stopFnsRef.current = [
        startRppgCropStream(ws, () => videoRef.current),
        startFrameTiming(ws, () => videoRef.current),
        attachSnapshotResponder(ws, () => videoRef.current),
      ]
    }
    ws.onerror = () => setError('Live connection failed. Is the backend running?')
    ws.onclose = () => { if (timerRef.current) clearInterval(timerRef.current) }
  }

  const stopAll = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    stopFnsRef.current.forEach((f) => f())
    stopFnsRef.current = []
    wsRef.current?.close()
    wsRef.current = null
    stopStream()
  }

  const stopLive = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    stopFnsRef.current.forEach((f) => f())
    stopFnsRef.current = []
    wsRef.current?.close()
    wsRef.current = null
    setChallenge(null)
    setPhase('READY')
  }

  // Pause challenges while this tab is hidden (same rule as the interview)
  useEffect(() => {
    const onVis = () => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'TAB_VISIBILITY', hidden: document.hidden }))
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    applySource({ kind: 'file', url: URL.createObjectURL(f), label: f.name })
    e.target.value = ''
  }

  const mirrored = source?.kind === 'camera'
  const canPickSource = phase === 'READY' || phase === 'LIVE'

  return (
    <div className="min-h-screen bg-[#F7F7F8]">
      <nav className="max-w-6xl mx-auto px-4 pt-4">
        <div className="flex items-center justify-between bg-white rounded-2xl shadow-sm px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#A4123F] flex items-center justify-center">
              <ShieldCheck size={18} className="text-white" />
            </div>
            <div>
              <div className="text-[15px] font-bold text-[#0F0F0F]">DeepVerify</div>
              <div className="text-[11px] text-[#6B6B6B]">Live Demo - same pipeline as a live interview</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#6B6B6B] hover:bg-black/5">
              <Home size={14} /> Home
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-5 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        {/* Left: video + controls */}
        <div className="space-y-4">
          {error && <div className="px-4 py-3 rounded-xl bg-[#FDECEC] text-[#991B1B] text-sm">{error}</div>}

          <div className="relative bg-black rounded-2xl overflow-hidden aspect-video">
            <video ref={videoRef} playsInline muted className="w-full h-full object-contain"
              style={mirrored ? { transform: 'scaleX(-1)' } : undefined} />
            {!source && (
              <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
                Enroll your webcam to begin
              </div>
            )}
            {source && (
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 text-white text-[11px]">
                {source.kind === 'camera' ? 'Camera' : 'Video file'}: {source.label}
              </div>
            )}
            {phase === 'LIVE' && (
              <div className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-[#A4123F] text-white text-[11px] font-semibold">
                LIVE - {framesSent} frames
              </div>
            )}
            {challenge && (
              <div key={challenge.key} className="absolute inset-x-0 bottom-0 bg-black/75 text-white px-5 py-4 flex items-center gap-4">
                {challenge.direction === 'LEFT' && <ArrowLeft size={40} className="text-[#FF4D7E] animate-pulse shrink-0" />}
                <div className="flex-1">
                  <div className="text-[11px] uppercase tracking-wide text-white/60">Liveness check - step {challenge.step} of {challenge.of}</div>
                  <div className="text-lg font-bold">{challenge.instruction}</div>
                  {livenessProgress && (
                    <div className="mt-2 mb-1">
                      {livenessProgress.face ? (
                        <>
                          <div className="flex justify-between text-[11px] text-gray-300 mb-1">
                            <span>{livenessProgress.wrongWay ? 'Other way - turn to the arrow side' : 'Turn detected'}</span>
                            <span>{Math.round(Math.min(1, livenessProgress.progress) * 100)}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                            <div className={`h-full transition-all duration-200 ${livenessProgress.progress >= 1 ? 'bg-emerald-400' : 'bg-amber-400'}`}
                                    style={{ width: `${Math.min(100, livenessProgress.progress * 100)}%` }} />
                          </div>
                        </>
                      ) : (
                        <p className="text-[12px] font-semibold text-amber-300">Face not detected - keep your face in view and well lit</p>
                      )}
                    </div>
                  )}
                </div>
                {challenge.direction === 'RIGHT' && <ArrowRight size={40} className="text-[#FF4D7E] animate-pulse shrink-0" />}
              </div>
            )}
            {result && (
              <div className={`absolute inset-x-0 bottom-0 px-5 py-3 flex items-center gap-3 text-white ${result.passed ? 'bg-[#1A6B3C]/90' : 'bg-[#991B1B]/90'}`}>
                {result.passed ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                <span className="text-sm font-semibold">{result.message}</span>
              </div>
            )}
          </div>

          {/* Quick start */}
          {phase === 'SETUP' && (
            <div className="bg-[#0F0F0F] rounded-2xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[14px] font-bold text-white">Verify my live webcam</div>
                <p className="text-[12px] text-white/60">Enrolls your camera, then streams it continuously like a genuine interview candidate.</p>
              </div>
              <button onClick={quickStart} disabled={!sessionId || !enrollDevice}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A6B3C] text-white text-sm font-semibold disabled:opacity-40">
                <Play size={15} /> Start live webcam
              </button>
            </div>
          )}

          {/* Step 1 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-[13px] font-bold text-[#0F0F0F] mb-1">1. Enroll your real webcam</div>
            <p className="text-[12px] text-[#6B6B6B] mb-3">
              Records this camera's sensor fingerprint (about 4 seconds), like the system check before an interview.
              Every source you stream is then compared against it.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={enrollDevice} onChange={(e) => setEnrollDevice(e.target.value)} disabled={phase !== 'SETUP'}
                className="text-sm border border-[#E5E5E5] rounded-lg px-3 py-2 min-w-[220px]">
                {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
              </select>
              <button onClick={enroll} disabled={!sessionId || phase !== 'SETUP' || !enrollDevice}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#A4123F] text-white text-sm font-semibold disabled:opacity-40">
                {phase === 'ENROLLING' ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
                {phase === 'ENROLLING' ? `Enrolling ${enrollPct}%` : phase === 'SETUP' ? 'Enroll webcam' : 'Enrolled'}
              </button>
            </div>
          </div>

          {/* Step 2 */}
          <div className={`bg-white rounded-2xl p-5 shadow-sm ${canPickSource ? '' : 'opacity-50 pointer-events-none'}`}>
            <div className="text-[13px] font-bold text-[#0F0F0F] mb-1">2. Genuine candidate or cheating attempt?</div>
            <p className="text-[12px] text-[#6B6B6B] mb-3">
              Any camera (including OBS Virtual Camera) or a video file played as the camera. You can switch while streaming.
            </p>
            <div className="flex flex-wrap gap-2">
              {devices.map((d) => (
                <button key={d.deviceId} onClick={() => applySource({ kind: 'camera', deviceId: d.deviceId, label: d.label || 'Camera' })}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${source?.kind === 'camera' && source.deviceId === d.deviceId ? 'border-[#A4123F] text-[#A4123F] bg-[#FDF2F5]' : 'border-[#E5E5E5] text-[#3A3A3A]'}`}>
                  <Camera size={14} /> <span className="text-[#1A6B3C] font-semibold">Genuine:</span> {d.label || 'Camera'}
                </button>
              ))}
              <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${source?.kind === 'file' ? 'border-[#A4123F] text-[#A4123F] bg-[#FDF2F5]' : 'border-[#E5E5E5] text-[#3A3A3A]'}`}>
                <Upload size={14} /> <span className="text-[#991B1B] font-semibold">Simulate cheating:</span> {source?.kind === 'file' ? source.label : 'play a pre-recorded or AI video'}
                <input type="file" accept="video/*" className="hidden" onChange={onFile} />
              </label>
            </div>
          </div>

          {/* Step 3 */}
          <div className={`bg-white rounded-2xl p-5 shadow-sm ${canPickSource ? '' : 'opacity-50 pointer-events-none'}`}>
            <div className="text-[13px] font-bold text-[#0F0F0F] mb-1">3. Stream and verify</div>
            <p className="text-[12px] text-[#6B6B6B] mb-3">
              Runs PRNU, rPPG, jitter and random head-turn checks exactly as in an interview. The first head-turn check comes after about 10 seconds,
              then every 30-45 seconds. A video file can't respond, so it fails them - that's how replays are caught.
            </p>
            {phase !== 'LIVE' ? (
              <button onClick={startLive} disabled={!source}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0F0F0F] text-white text-sm font-semibold disabled:opacity-40">
                <Play size={15} /> Start live verification
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button onClick={stopLive} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#EFEFF0] text-[#0F0F0F] text-sm font-semibold">
                  <Square size={15} /> Stop
                </button>
                <button
                  onClick={() => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ type: 'LIVENESS_REQUEST' }))}
                  disabled={!source || !!challenge}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#A4123F] text-white text-sm font-semibold disabled:opacity-40">
                  <ArrowLeft size={15} /> Run head-turn check now
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: live results */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-[13px] font-bold text-[#0F0F0F] mb-3">Fusion Trust Score</div>
            <TrustGauge score={score} />
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-[13px] font-bold text-[#0F0F0F] mb-3">Module Breakdown</div>
            <ModuleBreakdown breakdown={breakdown} />
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-[13px] font-bold text-[#0F0F0F] mb-3">Forensic Alerts</div>
            <AlertFeed alerts={alerts} onAcknowledge={acknowledgeAlert} />
          </div>
        </div>
      </div>
    </div>
  )
}
