// Live Demo: the real interview pipeline, with a choice of video source.
//
// 1. Enroll: fingerprint the real webcam (like the system check).
// 2. Pick a source: any camera (incl. OBS Virtual Camera) or a video file played
//    as the camera. Switch sources at any time while streaming.
// 3. Stream: frames, PRNU crops, rPPG face crops and frame timing go to the same
//    backend as a live interview. (Head-turn liveness checks are switched off.)
//    The server judges every source against the enrolled webcam.

import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Camera, Upload, Play, Square,
  Loader2, Home,
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
  const [, setChallenge] = useState<Challenge | null>(null)
  const [, setResult] = useState<{ passed: boolean; message: string } | null>(null)
  const [, setLivenessProgress] = useState<null | { face: boolean; progress: number; wrongWay: boolean }>(null)

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
    <div className="min-h-screen relative">
      <nav className="max-w-[1480px] mx-auto px-6 pt-6">
        <div className="flex items-center justify-between rounded-[26px] glass liquid pl-3.5 pr-3 h-[4.75rem]">
          <div className="flex items-center gap-3 pl-1">
            <div className="glass-tile-maroon !w-11 !h-11 !rounded-[13px]">
              <ShieldCheck size={20} className="text-white" />
            </div>
            <div>
              <div className="text-[17px] font-bold text-[#141114] leading-tight tracking-[-0.015em]">DeepVerify</div>
              <div className="text-[10.5px] font-semibold text-[#85818A] leading-tight mt-0.5 uppercase tracking-[0.12em]">Live Demo - same pipeline as a live interview</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className="nav-ghost !text-[14px] !px-4 !py-2.5">
              <Home size={16} /> Home
            </Link>
          </div>
        </div>
      </nav>

      <header className="max-w-[1480px] mx-auto px-6 pt-12 pb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="glass-label !text-[#A4123F] mb-3">Live demo · forensic pipeline</p>
          <h1 className="text-[clamp(32px,3.4vw,48px)] font-bold text-[#141114] tracking-[-0.04em] leading-[1.05]">
            Watch DeepVerify verify a camera <span className="intro-verify">in real time.</span>
          </h1>
          <p className="mt-3 text-[15px] text-[#67636C] max-w-[640px] leading-relaxed">
            Enrol your webcam, then stream it — or swap in a recording, an AI video or a virtual camera — and see every signal respond live.
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.16em] text-[#85818A]">
          <span className="glass-chip !px-3 !py-1.5 !text-[11px] !font-mono">PRNU</span>
          <span className="glass-chip !px-3 !py-1.5 !text-[11px] !font-mono">rPPG</span>
          <span className="glass-chip !px-3 !py-1.5 !text-[11px] !font-mono">JITTER</span>
          <span className="glass-chip !px-3 !py-1.5 !text-[11px] !font-mono">BEHAVIORAL</span>
        </div>
      </header>

      <div className="max-w-[1480px] mx-auto px-6 pb-16 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-6 items-start">
        {/* Left: video + controls */}
        <div className="space-y-5">
          {error && <div className="px-5 py-3.5 rounded-[18px] glass-soft !bg-[rgba(254,226,226,0.75)] !border-[#FCA5A5]/60 text-[#991B1B] text-[14px] font-medium">{error}</div>}

          <div className="relative bg-[#0E0C10] rounded-[26px] overflow-hidden aspect-video m-2.5 shadow-[0_0_0_10px_rgba(255,255,255,0.55),0_0_0_11px_rgba(255,255,255,0.95),0_0_0_12px_rgba(20,14,18,0.05),0_40px_90px_-30px_rgba(20,14,18,0.5)]">
            <video ref={videoRef} playsInline muted className="w-full h-full object-contain"
              style={mirrored ? { transform: 'scaleX(-1)' } : undefined} />
            {!source && (
              <div className="absolute inset-0 flex items-center justify-center text-white/55 text-[15px] font-medium tracking-wide bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),transparent_65%)]">
                Enroll your webcam to begin
              </div>
            )}
            {source && (
              <div className="absolute top-4 left-4 px-3.5 py-2 rounded-full bg-black/45 border border-white/15 backdrop-blur-md text-white/90 text-[12px] font-medium">
                {source.kind === 'camera' ? 'Camera' : 'Video file'}: {source.label}
              </div>
            )}
            {phase === 'LIVE' && (
              <div className="absolute top-4 right-4 px-3.5 py-2 rounded-full bg-[#A4123F]/90 border border-white/20 text-white text-[12px] font-semibold font-mono tracking-wide shadow-[0_6px_18px_-6px_rgba(164,18,63,0.8)]">
                LIVE - {framesSent} frames
              </div>
            )}
          </div>

          {/* Quick start */}
          {phase === 'SETUP' && (
            <div className="glass-dark liquid rounded-[28px] px-7 py-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[18px] font-semibold text-white tracking-[-0.015em]">Verify my live webcam</div>
                <p className="text-[14px] text-white/60 mt-1">Enrolls your camera, then streams it continuously like a genuine interview candidate.</p>
              </div>
              <button onClick={quickStart} disabled={!sessionId || !enrollDevice}
                className="glass-btn !bg-white/95 !text-[#141114] px-6 py-3 text-[14.5px] !rounded-full disabled:opacity-40">
                <Play size={15} /> Start live webcam
              </button>
            </div>
          )}

          {/* Step 1 */}
          <div className="glass liquid rounded-[28px] p-7">
            <div className="text-[17px] font-semibold text-[#141114] tracking-[-0.015em] mb-1.5">1. Enroll your real webcam</div>
            <p className="text-[14px] text-[#67636C] leading-relaxed mb-5 max-w-[760px]">
              Records this camera's sensor fingerprint (about 4 seconds), like the system check before an interview.
              Every source you stream is then compared against it.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <select value={enrollDevice} onChange={(e) => setEnrollDevice(e.target.value)} disabled={phase !== 'SETUP'}
                className="glass-input !w-auto !py-3 !px-4 !text-[14.5px] min-w-[280px] disabled:opacity-60">
                {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
              </select>
              <button onClick={enroll} disabled={!sessionId || phase !== 'SETUP' || !enrollDevice}
                className="glass-btn-primary px-6 py-3 text-[14.5px] !rounded-full disabled:opacity-40">
                {phase === 'ENROLLING' ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
                {phase === 'ENROLLING' ? `Enrolling ${enrollPct}%` : phase === 'SETUP' ? 'Enroll webcam' : 'Enrolled'}
              </button>
            </div>
          </div>

          {/* Step 2 */}
          <div className={`glass liquid rounded-[28px] p-7 transition-opacity ${canPickSource ? '' : 'opacity-50 pointer-events-none'}`}>
            <div className="text-[17px] font-semibold text-[#141114] tracking-[-0.015em] mb-1.5">2. Genuine candidate or cheating attempt?</div>
            <p className="text-[14px] text-[#67636C] leading-relaxed mb-5 max-w-[760px]">
              Any camera (including OBS Virtual Camera) or a video file played as the camera. You can switch while streaming.
            </p>
            <div className="flex flex-wrap gap-2.5">
              {devices.map((d) => (
                <button key={d.deviceId} onClick={() => applySource({ kind: 'camera', deviceId: d.deviceId, label: d.label || 'Camera' })}
                  className={`flex items-center gap-2 px-4 py-3 rounded-[16px] border text-[14px] font-medium transition-all ${source?.kind === 'camera' && source.deviceId === d.deviceId ? 'border-[#A4123F]/50 text-[#A4123F] bg-white shadow-[0_0_0_3px_rgba(164,18,63,0.10),0_6px_16px_-8px_rgba(20,14,18,0.25)]' : 'border-white/90 text-[#2A262C] bg-white/55 hover:bg-white/80 shadow-[inset_0_1px_0_#fff]'}`}>
                  <Camera size={16} /> <span className="text-[#1A6B3C] font-semibold">Genuine:</span> {d.label || 'Camera'}
                </button>
              ))}
              <label className={`flex items-center gap-2 px-4 py-3 rounded-[16px] border text-[14px] font-medium cursor-pointer transition-all ${source?.kind === 'file' ? 'border-[#A4123F]/50 text-[#A4123F] bg-white shadow-[0_0_0_3px_rgba(164,18,63,0.10),0_6px_16px_-8px_rgba(20,14,18,0.25)]' : 'border-white/90 text-[#2A262C] bg-white/55 hover:bg-white/80 shadow-[inset_0_1px_0_#fff]'}`}>
                <Upload size={16} /> <span className="text-[#991B1B] font-semibold">Simulate cheating:</span> {source?.kind === 'file' ? source.label : 'play a pre-recorded or AI video'}
                <input type="file" accept="video/*" className="hidden" onChange={onFile} />
              </label>
            </div>
          </div>

          {/* Step 3 */}
          <div className={`glass liquid rounded-[28px] p-7 transition-opacity ${canPickSource ? '' : 'opacity-50 pointer-events-none'}`}>
            <div className="text-[17px] font-semibold text-[#141114] tracking-[-0.015em] mb-1.5">3. Stream and verify</div>
            <p className="text-[14px] text-[#67636C] leading-relaxed mb-5 max-w-[760px]">
              Runs PRNU, rPPG, jitter and random head-turn checks exactly as in an interview. The first head-turn check comes after about 10 seconds,
              then every 30-45 seconds. A video file can't respond, so it fails them - that's how replays are caught.
            </p>
            {phase !== 'LIVE' ? (
              <button onClick={startLive} disabled={!source}
                className="glass-btn-primary px-6 py-3 text-[14.5px] !rounded-full disabled:opacity-40">
                <Play size={15} /> Start live verification
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button onClick={stopLive} className="glass-btn px-6 py-3 text-[14.5px] !rounded-full">
                  <Square size={15} /> Stop
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: live results */}
        <div className="space-y-5 lg:sticky lg:top-6">
          <div className="glass liquid rounded-[28px] p-6">
            <div className="glass-label !text-[11.5px] mb-5">Fusion Trust Score</div>
            <TrustGauge score={score} />
          </div>
          <div className="glass liquid rounded-[28px] p-6">
            <div className="glass-label !text-[11.5px] mb-5">Module Breakdown</div>
            <ModuleBreakdown breakdown={breakdown} />
          </div>
          <div className="glass liquid rounded-[28px] p-6">
            <div className="glass-label !text-[11.5px] mb-5">Forensic Alerts</div>
            <AlertFeed alerts={alerts} onAcknowledge={acknowledgeAlert} />
          </div>
        </div>
      </div>
    </div>
  )
}
