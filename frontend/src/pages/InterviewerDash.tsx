import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { 
  ShieldCheck, Activity, Clock, Loader2, AlertCircle, LogOut, 
  CheckCircle2, XCircle, Camera, Image as ImageIcon, FileText, Home,
  Code2, Play, Terminal, Flag
} from 'lucide-react'
import Editor from '@monaco-editor/react'
import TrustGauge from '../components/TrustGauge'
import ModuleBreakdown from '../components/ModuleBreakdown'
import AlertFeed from '../components/AlertFeed'
import VideoRoom from '../components/VideoRoom'
import { useTrustScore } from '../hooks/useTrustScore'
import { useWebRTC } from '../hooks/useWebRTC'
import { downloadReport as fetchAndSaveReport, fetchReportSummary } from '../utils/downloadReport'
import type { ReportSummary } from '../utils/downloadReport'

// Why the interviewer's camera could not start, in plain words.
function describeMediaError(e: any): string {
  const name = e?.name || ''
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return 'Your camera is being used by another app or browser tab (Zoom, Teams, Camera app, another DeepVerify tab). Close it - the camera will reconnect automatically.'
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera permission is blocked for this site. Click the camera icon in the address bar, allow it, then press Retry.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No camera was found on this device.'
  return `Camera could not start${e?.message ? `: ${e.message}` : ''}.`
}

// Camera + microphone, getting whatever is available. Never throws.
async function getInterviewerMedia(): Promise<{ stream: MediaStream; error: string | null }> {
  const md = navigator.mediaDevices
  if (!md?.getUserMedia) return { stream: new MediaStream(), error: 'This browser cannot access a camera.' }
  try {
    return { stream: await md.getUserMedia({ video: true, audio: true }), error: null }
  } catch (first) {
    let videoErr: any = first
    let video: MediaStreamTrack[] = []
    let audio: MediaStreamTrack[] = []
    try { video = (await md.getUserMedia({ video: true })).getVideoTracks() } catch (e) { videoErr = e }
    try { audio = (await md.getUserMedia({ audio: true })).getAudioTracks() } catch { /* no mic */ }
    return { stream: new MediaStream([...video, ...audio]), error: video.length ? null : describeMediaError(videoErr) }
  }
}

export default function InterviewerDash() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  useEffect(() => { localStreamRef.current = localStream }, [localStream])
  const [showFaceModal, setShowFaceModal] = useState(false)
  const [activeView, setActiveView] = useState<'forensics' | 'code'>('forensics')

  // Interviewer compiler state
  const [interviewerRunning, setInterviewerRunning] = useState(false)
  const [interviewerOutput, setInterviewerOutput] = useState<{ stdout: string; stderr: string; executionTime?: number; status?: string } | null>(null)

  // Exit interview state
  const [showEndModal, setShowEndModal] = useState(false)
  const [isEnded, setIsEnded] = useState(false)
  const [endingSession, setEndingSession] = useState(false)
  const [downloadingReport, setDownloadingReport] = useState(false)
  const [reportError, setReportError] = useState('')
  // Set when the session was ALREADY completed on load: the live forensic view is
  // never shown (no camera, no call) - only the summary with the report download.
  const [completedSummary, setCompletedSummary] = useState<ReportSummary | null>(null)

  // Download the forensic PDF as a file (see utils/downloadReport).
  const downloadReport = async () => {
    if (!sessionId || downloadingReport) return
    setDownloadingReport(true)
    setReportError('')
    try {
      await fetchAndSaveReport(sessionId)
    } catch (e: any) {
      setReportError(e?.message || 'Could not download the report')
    } finally {
      setDownloadingReport(false)
    }
  }

  const handleEndSession = async () => {
    setEndingSession(true)
    try {
      if (sessionId) {
        await fetch(`/api/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'COMPLETED' }),
        })
      }
    } catch (e) {
      console.warn('Failed to mark session complete', e)
    } finally {
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop())
      }
      rtc.stop()
      setEndingSession(false)
      setShowEndModal(false)
      setIsEnded(true)
    }
  }

  // Initialize WebSockets for dashboard data (including live codeSync & score reversion)
  const { score, breakdown, raw, alerts, status: wsStatus, codeSync: wsCodeSync, acknowledgeAlert } = useTrustScore(sessionId || '', { reconnect: true })

  // Code arriving peer-to-peer over the WebRTC data channel (fastest path).
  // Whichever copy (P2P or WebSocket) has the higher seq wins.
  const [p2pCode, setP2pCode] = useState<{ code: string; language: string; seq: number } | null>(null)
  const handleRtcData = useCallback((msg: any) => {
    if (msg?.type === 'CODE_CHANGE' && typeof msg.code === 'string') {
      setP2pCode((prev) => (prev && (msg.seq ?? 0) <= prev.seq ? prev : { code: msg.code, language: msg.language, seq: msg.seq ?? 0 }))
    }
  }, [])
  const codeSync = p2pCode && p2pCode.seq > (wsCodeSync.seq ?? 0)
    ? { ...wsCodeSync, code: p2pCode.code, language: p2pCode.language || wsCodeSync.language }
    : wsCodeSync

  const handleInterviewerRun = async () => {
    if (!codeSync?.code || interviewerRunning) return
    setInterviewerRunning(true)
    try {
      const res = await fetch('/api/compiler/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          language: codeSync.language || 'python',
          code: codeSync.code,
        }),
      })
      const data = await res.json()
      setInterviewerOutput(data)
    } catch (err: any) {
      setInterviewerOutput({ stdout: '', stderr: err.message || 'Execution error' })
    } finally {
      setInterviewerRunning(false)
    }
  }

  // Initialize WebRTC
  const rtc = useWebRTC(sessionId || '', 'interviewer', localStream, handleRtcData)

  useEffect(() => {
    async function init() {
      let alreadyCompleted = false
      try {
        const res = await fetch(`/api/sessions/${sessionId}`)
        if (!res.ok) throw new Error('Session not found')
        const data = await res.json()
        if (data.status === 'COMPLETED') {
          alreadyCompleted = true
          const summary = await fetchReportSummary(data.session_id || sessionId || '')
          setCompletedSummary(summary || { session_id: data.session_id, status: 'COMPLETED', has_data: false, final_score: null, average_score: null, lowest_score: null, breakdown: { prnu: 0, rppg: 0, jitter: 0, behavioral: 0 }, alert_count: 0 })
          setIsEnded(true)
        }
        setSession(data)
      } catch (err) {
        setError('Session not found.')
      } finally {
        setLoading(false)
      }
      // A finished interview is read-only: do not start the camera or the call.
      if (alreadyCompleted) return

      // Camera + mic. If the camera fails, say why and keep retrying (below);
      // the call still connects with whatever is available.
      const { stream, error } = await getInterviewerMedia()
      if (error) console.warn('[Interviewer] Camera unavailable:', error)
      setLocalStream(stream)
      setCamError(error)
    }
    init()

    return () => {
      localStreamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [sessionId])

  // (Re)start the interviewer's camera and swap it into the live call. A NEW
  // MediaStream object is created so React and the WebRTC hook see the change.
  const retryCamera = useCallback(async (silent = false) => {
    try {
      const v = await navigator.mediaDevices.getUserMedia({ video: true })
      const cur = localStreamRef.current
      const audio = cur ? cur.getAudioTracks() : []
      cur?.getVideoTracks().forEach(t => t.stop())
      setLocalStream(new MediaStream([...v.getVideoTracks(), ...audio]))
      setCamError(null)
      setCamEnabled(true)
      console.log('[Interviewer] Camera started')
    } catch (e) {
      if (!silent) console.warn('[Interviewer] Camera retry failed:', e)
      setCamError(describeMediaError(e))
    }
  }, [])

  // While the camera is unavailable (e.g. in use by another app), retry quietly.
  useEffect(() => {
    if (!camError) return
    const t = setInterval(() => { retryCamera(true) }, 4000)
    return () => clearInterval(t)
  }, [camError, retryCamera])

  const [camEnabled, setCamEnabled] = useState(true)

  const toggleCamera = async () => {
    if (!localStream || localStream.getVideoTracks().length === 0) {
      await retryCamera()
      return
    }

    const next = !camEnabled
    localStream.getVideoTracks().forEach((t) => {
      t.enabled = next
    })
    setCamEnabled(next)
  }

  // Connect once the session + a stream exist. Later stream changes are swapped
  // into the live connection via replaceTrack (no teardown / reconnect).
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


  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="glass-tile !w-16 !h-16 !rounded-[20px]"><Loader2 className="animate-spin text-[#A4123F]" /></div></div>
  }

  if (error || !session) {
    return <div className="min-h-screen flex flex-col items-center justify-center text-center p-6">
      <div className="glass-strong liquid rounded-[32px] px-12 py-12 flex flex-col items-center max-w-md w-full">
      <div className="glass-tile !w-16 !h-16 !rounded-[20px] mb-5"><AlertCircle className="text-[#991B1B] w-8 h-8" /></div>
      <h1 className="text-[22px] font-bold text-[#141114] tracking-[-0.02em] mb-2">Error</h1>
      <p className="text-[15px] text-[#67636C]">{error}</p>
      </div>
    </div>
  }

  // Figures for the summary: live values when the interviewer just ended the call,
  // stored values when a finished session is opened later.
  const endScore: number | null = completedSummary ? completedSummary.final_score : score
  const endAlertCount = completedSummary ? completedSummary.alert_count : alerts.length
  const endBreakdown = completedSummary ? completedSummary.breakdown : breakdown

  if (isEnded) {
    return (
      <div className="min-h-screen font-sans">
        <div className="max-w-[1480px] mx-auto px-6 pt-6">
          <div className="flex items-center justify-between rounded-[26px] glass liquid pl-3.5 pr-4 h-[4.75rem]">
            <div className="flex items-center gap-3 pl-1">
              <div className="glass-tile-maroon !w-11 !h-11 !rounded-[13px]">
                <ShieldCheck size={20} className="text-white" />
              </div>
              <div>
                <div className="text-[17px] font-bold text-[#141114] leading-tight tracking-[-0.015em]">DeepVerify</div>
                <div className="text-[10.5px] font-semibold text-[#85818A] leading-tight mt-0.5 uppercase tracking-[0.12em]">Interview summary</div>
              </div>
            </div>
            <span className="glass-chip !px-3.5 !py-1.5 !text-[12px] text-[#1A6B3C]">
              <CheckCircle2 size={13} /> Completed
            </span>
          </div>
        </div>

        <div className="max-w-[1480px] mx-auto px-6 pt-10 pb-16 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-stretch">
          {/* Left: concluded card */}
          <div className="glass-strong liquid rounded-[32px] p-10 xl:p-12 flex flex-col">
            <div className="glass-tile-maroon !w-16 !h-16 !rounded-[20px] mb-7">
              <ShieldCheck size={30} />
            </div>
            <p className="glass-label !text-[#A4123F] mb-3">Session complete</p>
            <h1 className="text-[clamp(30px,3vw,42px)] font-bold text-[#141114] tracking-[-0.035em] leading-[1.08] mb-4">Interview Session Concluded</h1>
            <p className="text-[15px] text-[#67636C] mb-8 max-w-[560px] leading-relaxed">
              Session <strong className="text-[#141114] font-mono font-semibold">{session.session_id}</strong> with candidate <strong className="text-[#141114] font-semibold">{session.candidate_name}</strong> {completedSummary ? 'was completed. The live forensic dashboard is closed for finished interviews - download the full report below.' : 'has been ended and marked as complete.'}
            </p>

            <div className="w-full rounded-[22px] glass-inset p-2 mb-8 text-left divide-y divide-[rgba(20,17,20,0.06)]">
              <div className="flex justify-between items-center gap-4 px-4 py-3.5 text-[14px]">
                <span className="text-[#67636C]">Candidate:</span>
                <span className="font-semibold text-[#141114] text-right">{session.candidate_name} ({session.role})</span>
              </div>
              <div className="flex justify-between items-center gap-4 px-4 py-3.5 text-[14px]">
                <span className="text-[#67636C]">Overall Trust Score:</span>
                <span className={`font-mono font-bold text-[16px] ${endScore === null ? 'text-[#85818A]' : endScore >= 80 ? 'text-[#1A6B3C]' : endScore >= 60 ? 'text-amber-600' : 'text-[#991B1B]'}`}>
                  {endScore === null ? 'No data' : `${endScore} / 100`}
                </span>
              </div>
              <div className="flex justify-between items-center gap-4 px-4 py-3.5 text-[14px]">
                <span className="text-[#67636C]">AWS Face Verification:</span>
                <span className="inline-flex items-center gap-1 font-semibold text-[#1A6B3C]">
                  {session.face_verification?.verified ? `✓ Match (${session.face_verification.similarity}%)` : 'Processed'}
                </span>
              </div>
              <div className="flex justify-between items-center gap-4 px-4 py-3.5 text-[14px]">
                <span className="text-[#67636C]">Recorded Alerts:</span>
                <span className="font-semibold text-[#141114]">{endAlertCount} Flagged Events</span>
              </div>
            </div>

            {reportError && (
              <div className="mb-3 px-4 py-3 rounded-[16px] bg-[rgba(254,226,226,0.8)] border border-[#FCA5A5] text-[#991B1B] text-[13px] font-medium">{reportError}</div>
            )}
            <div className="mt-auto flex flex-col sm:flex-row gap-3 w-full">
              <button
                type="button"
                onClick={downloadReport}
                disabled={downloadingReport}
                className="flex-1 glass-btn-primary !rounded-full py-3.5 px-6 text-[14.5px] cursor-pointer"
              >
                {downloadingReport ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                {downloadingReport ? 'Preparing report...' : 'Download PDF Report'}
              </button>
              <button
                onClick={() => navigate('/recruiter/dashboard')}
                className="glass-btn !rounded-full py-3.5 px-6 text-[14.5px] cursor-pointer"
              >
                <Home size={16} /> Dashboard
              </button>
            </div>
          </div>

          {/* Right: final forensic snapshot (read-only view of the scores already on this page) */}
          <div className="flex flex-col gap-6">
            <div className="glass liquid rounded-[28px] p-7 flex flex-col items-center">
              <div className="glass-label !text-[11.5px] mb-5 self-start">Final Trust Score</div>
              {endScore === null ? (
                <p className="py-10 text-[14px] text-[#85818A]">No forensic measurements were recorded.</p>
              ) : (
                <TrustGauge score={endScore} />
              )}
            </div>
            <div className="glass liquid rounded-[28px] p-7 flex-1">
              <div className="glass-label !text-[11.5px] mb-5">Forensic Breakdown</div>
              <ModuleBreakdown breakdown={endBreakdown ?? { prnu: 0, rppg: 0, jitter: 0, behavioral: 0 }} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Waiting Room state (BUG 3 & 4 FIX)
  const isCandidateReady = session.status === 'ACTIVE' || wsStatus === 'CONNECTED'

  if (!isCandidateReady) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="max-w-[1480px] w-full mx-auto px-6 pt-6">
          <div className="h-[4.75rem] rounded-[26px] glass liquid flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="glass-tile-maroon !w-11 !h-11 !rounded-[13px]">
              <ShieldCheck size={20} className="text-white" />
            </div>
            <div>
              <span className="block text-[16px] font-bold text-[#141114] tracking-[-0.015em] leading-tight">Interviewer Dashboard</span>
              <span className="block text-[10.5px] font-semibold text-[#85818A] uppercase tracking-[0.12em] mt-0.5">Waiting room</span>
            </div>
          </div>
          <span className="glass-chip !px-3.5 !py-1.5 !text-[12px] text-[#92400E]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-pulse" /> Candidate not joined
          </span>
          </div>
        </div>
        <div className="flex-1 w-full max-w-[1480px] mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-6 items-stretch">
          {/* Left: live waiting status */}
          <div className="glass-strong liquid rounded-[36px] px-8 py-12 sm:px-14 flex flex-col items-center justify-center text-center">
          <div className="relative w-36 h-36 flex items-center justify-center mb-9">
            <span className="absolute inset-0 rounded-full border border-[#A4123F]/25 animate-ring-expand" />
            <span className="absolute inset-0 rounded-full border border-[#A4123F]/20 animate-ring-expand" style={{ animationDelay: '1s' }} />
            <span className="absolute inset-0 rounded-full border border-[#A4123F]/15 animate-ring-expand" style={{ animationDelay: '2s' }} />
            <div className="glass-tile !w-24 !h-24 !rounded-full relative">
              <span className="text-[34px] font-bold text-[#A4123F] tracking-[-0.03em]">{session.candidate_name.charAt(0)}</span>
              <span className="absolute -bottom-1 -right-1 glass-tile !w-9 !h-9 !rounded-full">
                <Loader2 className="animate-spin text-[#A4123F]" size={18} />
              </span>
            </div>
          </div>
          <p className="glass-label !text-[#A4123F] mb-3">Standing by</p>
          <h2 className="text-[clamp(30px,3vw,44px)] font-bold text-[#141114] tracking-[-0.035em] leading-[1.05] mb-4">Waiting for candidate</h2>
          <p className="text-[15.5px] text-[#67636C] mb-10 text-center max-w-[520px] leading-relaxed">
            {session.candidate_name} has not completed the system check yet. This page will automatically update once they join the session.
          </p>

          {/* Progress of the candidate's journey (display only) */}
          <div className="w-full max-w-[620px] grid grid-cols-3 gap-3">
            <div className="glass-soft rounded-[20px] px-4 py-4 flex flex-col items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-[#1A6B3C] text-white flex items-center justify-center shadow-[0_6px_14px_-6px_rgba(26,107,60,0.7)]"><CheckCircle2 size={16} /></span>
              <span className="text-[13px] font-semibold text-[#141114]">Session created</span>
              <span className="text-[11.5px] text-[#85818A]">Link shared</span>
            </div>
            <div className="glass-soft rounded-[20px] px-4 py-4 flex flex-col items-center gap-2 ring-1 ring-[#A4123F]/25 shadow-[0_0_0_4px_rgba(164,18,63,0.06)]">
              <span className="w-8 h-8 rounded-full glass-tile-maroon !w-8 !h-8 !rounded-full"><Loader2 size={15} className="animate-spin" /></span>
              <span className="text-[13px] font-semibold text-[#A4123F]">System check</span>
              <span className="text-[11.5px] text-[#85818A]">Camera &amp; identity</span>
            </div>
            <div className="glass-soft rounded-[20px] px-4 py-4 flex flex-col items-center gap-2 opacity-70">
              <span className="w-8 h-8 rounded-full bg-white/70 border border-[rgba(20,17,20,0.10)] text-[#85818A] flex items-center justify-center"><Activity size={15} /></span>
              <span className="text-[13px] font-semibold text-[#4A464E]">Live interview</span>
              <span className="text-[11.5px] text-[#85818A]">Forensics start</span>
            </div>
          </div>
          </div>

          {/* Right: session details */}
          <div className="flex flex-col gap-6">
            <div className="glass liquid rounded-[30px] p-7">
              <div className="glass-label !text-[11.5px] mb-5">Session details</div>
              <div className="rounded-[20px] glass-inset p-1.5 divide-y divide-[rgba(20,17,20,0.06)] text-[14px]">
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="text-[#67636C]">Candidate</span>
                  <span className="font-semibold text-[#141114] text-right">{session.candidate_name}</span>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="text-[#67636C]">Role</span>
                  <span className="font-semibold text-[#141114] text-right">{session.role}</span>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="text-[#67636C]">Session ID</span>
                  <span className="font-mono font-semibold text-[#141114]">{session.session_id}</span>
                </div>
                {session.interview_type && (
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className="text-[#67636C]">Interview type</span>
                    <span className="font-semibold text-[#141114] text-right">{session.interview_type}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="glass liquid rounded-[30px] p-7 flex-1 flex flex-col">
              <div className="glass-label !text-[11.5px] mb-5">Checks that start when they join</div>
              <div className="grid grid-cols-2 gap-2.5">
                {[['PRNU', 'Camera fingerprint'], ['rPPG', 'Pulse liveness'], ['Jitter', 'Frame timing'], ['Behavioral', 'Gaze & head pose']].map(([k, d]) => (
                  <div key={k} className="glass-soft rounded-[16px] px-4 py-3">
                    <div className="text-[12px] font-mono font-semibold tracking-[0.08em] text-[#A4123F]">{k}</div>
                    <div className="text-[12.5px] text-[#67636C] mt-0.5">{d}</div>
                  </div>
                ))}
              </div>
              <p className="mt-auto pt-6 text-[12.5px] text-[#85818A] leading-relaxed flex items-start gap-2">
                <Clock size={14} className="shrink-0 mt-0.5" /> Keep this tab open. It switches to the live dashboard automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Main Dashboard
  return (
    <div className="min-h-screen flex flex-col font-sans">

      {/* Top Navbar */}
      <nav className="shrink-0 z-30 sticky top-0 px-4 sm:px-6 pt-4">
        <div className="max-w-[1680px] mx-auto min-h-16 rounded-[24px] glass liquid flex flex-wrap items-center justify-between gap-3 pl-3 pr-3 py-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="glass-tile-maroon !w-11 !h-11 !rounded-[13px] shrink-0">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold text-[#141114] leading-tight tracking-[-0.015em]">DeepVerify <span className="font-medium text-[#85818A] ml-1">Live Dashboard</span></h1>
            <div className="flex items-center gap-2 text-[11px] text-[#85818A] mt-0.5">
              <span className="font-mono truncate">{session.session_id}</span>
              <span className="w-1 h-1 rounded-full bg-[#C9C6CC]" />
              <span>{session.interview_type}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Toggle */}
          <div className="glass-track !p-1 text-[13px]">
            <button
              onClick={() => setActiveView('forensics')}
              className={`glass-tab !px-3.5 !py-2 cursor-pointer ${
                activeView === 'forensics'
                  ? 'glass-tab-active'
                  : ''
              }`}
            >
              <Activity size={15} className="text-[#A4123F]" />
              <span>Forensics</span>
              {alerts && alerts.length > 0 && (
                <span className="px-1.5 min-w-[18px] text-center rounded-full bg-[#A4123F] text-white text-[10px] font-bold leading-[18px]">
                  {alerts.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveView('code')}
              className={`glass-tab !px-3.5 !py-2 cursor-pointer ${
                activeView === 'code'
                  ? 'glass-tab-active'
                  : ''
              }`}
            >
              <Code2 size={15} className="text-[#4A464E]" />
              <span>Live Code & Compiler</span>
              {codeSync?.code && <span className="w-1.5 h-1.5 rounded-full bg-[#A4123F] animate-pulse"></span>}
            </button>
          </div>

          <div className="glass-chip !px-3 !py-2 !text-[12px] text-[#1A6B3C]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#1A6B3C] opacity-75 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#1A6B3C]" />
            </span>
            Connection Secure
          </div>
          <button
            onClick={toggleCamera}
            className={`glass-btn !rounded-full px-3.5 py-2 text-[13px] cursor-pointer ${localStream
                ? '!text-[#1A6B3C]'
                : '!text-[#67636C]'
              }`}
            title={localStream ? "Turn off interviewer camera" : "Turn on interviewer camera"}
          >
            <Camera size={15} className={localStream ? 'text-[#1A6B3C]' : 'text-[#9A979E]'} />
            <span>{localStream ? 'Interviewer Cam On' : 'Interviewer Cam Off'}</span>
          </button>
          <button className="nav-ghost !text-[13px] !py-2 !text-[#991B1B] hover:!bg-[rgba(153,27,27,0.07)]">
            <Flag size={14} /> Flag Session
          </button>
          <button
            onClick={() => setShowEndModal(true)}
            className="glass-btn-primary !rounded-full px-4 py-2 text-[13px] cursor-pointer"
          >
            <LogOut size={14} />
            End Session
          </button>
        </div>
        </div>
      </nav>

      {/* Main Grid */}
      <div className="flex-1 p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1680px] mx-auto w-full">

        {/* Left Column: Video & Candidate Info (8 cols in forensics view, 4 next to the code workspace) */}
        <div className={`${activeView === 'forensics' ? 'lg:col-span-8' : 'lg:col-span-4'} flex flex-col gap-6 min-w-0`}>
          {/* Video Card */}
          <div className="glass liquid rounded-[28px] p-2.5 flex flex-col">
            <div className="px-3.5 pt-2.5 pb-3 flex justify-between items-center z-10">
              <h2 className="glass-label !text-[11.5px] !text-[#4A464E]">Live Verification Feed</h2>
              <span className="glass-chip !text-[10.5px] !font-mono text-[#67636C]">720p / 30fps</span>
            </div>
            <div className={`relative ${activeView === 'forensics' ? 'aspect-video' : 'aspect-[4/3]'} bg-[#0E0C10] rounded-[20px] overflow-hidden shadow-[0_18px_40px_-22px_rgba(20,14,18,0.6)]`}>
              {camError && (
                <div className="absolute bottom-3 left-3 right-3 z-20 rounded-[14px] bg-[#1E1508]/90 border border-amber-400/40 px-3.5 py-2.5 text-[12px] text-amber-100 flex items-center gap-2.5 shadow-lg">
                  <span className="flex-1">{camError}</span>
                  <button
                    onClick={() => retryCamera()}
                    className="shrink-0 px-3 py-1.5 rounded-full bg-amber-400 text-[#1E1508] text-[11.5px] font-bold hover:bg-amber-300"
                  >
                    Retry
                  </button>
                </div>
              )}
              <VideoRoom
                state={rtc.state}
                remoteStream={rtc.remoteStream}
                localStream={localStream}
                onLocalStreamChange={setLocalStream}
                status={wsStatus}
              />
            </div>
          </div>

          <div className={`grid gap-6 items-start ${activeView === 'forensics' ? 'xl:grid-cols-2' : ''}`}>
          {/* Candidate Info Card */}
          <div className="glass liquid rounded-[28px] p-6">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 shrink-0 rounded-[18px] glass-tile !w-14 !h-14 !rounded-[18px] text-[20px] font-bold text-[#A4123F] overflow-hidden">
                {session.face_verification?.reference_image_url ? (
                  <img
                    src={session.face_verification.reference_image_url}
                    alt={session.candidate_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  session.candidate_name.charAt(0)
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[17px] font-bold text-[#141114] tracking-[-0.015em] truncate">{session.candidate_name}</h3>
                  {session.face_verification?.verified ? (
                    <span className="glass-chip shrink-0 !text-[10.5px] text-[#1A6B3C]">
                      <CheckCircle2 size={11} /> Rekognition Match
                    </span>
                  ) : session.face_verification?.status === 'FAILED' ? (
                    <span className="glass-chip shrink-0 !text-[10.5px] text-[#991B1B]">
                      <XCircle size={11} /> ID Mismatch
                    </span>
                  ) : (
                    <span className="glass-chip shrink-0 !text-[10.5px] text-[#92400E]">
                      <Clock size={11} /> ID Pending
                    </span>
                  )}
                </div>
                <p className="text-[14px] text-[#67636C] mb-3">{session.role}</p>

                <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                  <div className="glass-inset rounded-[12px] px-3 py-2 flex items-center gap-1.5 text-[#2A262C]">
                    {session.face_verification?.verified ? (
                      <span className="text-[#1A6B3C] font-semibold flex items-center gap-1">
                        <CheckCircle2 size={13} /> {session.face_verification.similarity}% Similarity
                      </span>
                    ) : session.face_verification?.status === 'FAILED' ? (
                      <span className="text-[#991B1B] font-semibold flex items-center gap-1">
                        <XCircle size={13} /> Mismatch
                      </span>
                    ) : (
                      <span className="text-[#67636C] flex items-center gap-1">
                        <Camera size={13} /> Unverified
                      </span>
                    )}
                  </div>
                  <div className="glass-inset rounded-[12px] px-3 py-2 flex items-center gap-1.5 text-[#2A262C]">
                    <Clock size={14} className="text-[#9A979E]" /> Active Call
                  </div>
                </div>

                {/* Inspect ID Photo Button */}
                {(session.face_verification?.reference_image_url || session.face_verification?.live_snapshot_url) && (
                  <button
                    onClick={() => setShowFaceModal(true)}
                    className="mt-3 w-full glass-btn !rounded-full py-2.5 px-4 text-[12.5px]"
                  >
                    <ImageIcon size={14} />
                    <span>View Reference vs Live Face</span>
                  </button>
                )}
              </div>
            </div>
          </div>
          {activeView === 'forensics' && (
            <div className="glass liquid rounded-[28px] p-6">
              <h2 className="glass-label !text-[11.5px] mb-5">Forensic Breakdown</h2>
              <ModuleBreakdown breakdown={breakdown ?? { prnu: 0, rppg: 0, jitter: 0, behavioral: 0 }} />
            </div>
          )}
          </div>
        </div>

        {/* Right Section (8 cols): Either Forensics View or Live Code & Compiler */}
        {activeView === 'forensics' ? (
          <>
            {/* Right Column: Trust Score + Alert Feed (4 cols) */}
            <div className="lg:col-span-4 flex flex-col gap-6 lg:h-[calc(100vh-120px)] lg:sticky top-[100px] min-w-0">
              {/* Main Trust Card */}
              <div className="glass liquid rounded-[28px] p-6 shrink-0">
                <h2 className="glass-label !text-[11.5px] mb-4">Aggregate Trust Score</h2>
                <div className="flex items-center gap-5">
                <div className="shrink-0 scale-[0.86] origin-left -my-3">
                <TrustGauge score={score} />
                </div>

                {/* Raw metrics strip */}
                <div className="flex-1 grid grid-cols-1 gap-2">
                  <div className="glass-inset rounded-[14px] px-3.5 py-2 flex items-center justify-between">
                    <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-[#85818A]">PCE</p>
                    <p className="text-[15px] font-mono font-semibold text-[#141114]">{(raw?.pce ?? 0).toFixed(1)}</p>
                  </div>
                  <div className="glass-inset rounded-[14px] px-3.5 py-2 flex items-center justify-between">
                    <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-[#85818A]">SNR</p>
                    <p className="text-[15px] font-mono font-semibold text-[#141114]">{(raw?.snr_rppg ?? 0).toFixed(1)}</p>
                  </div>
                  <div className="glass-inset rounded-[14px] px-3.5 py-2 flex items-center justify-between">
                    <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-[#85818A]">CV</p>
                    <p className="text-[15px] font-mono font-semibold text-[#141114]">{(raw?.cv_jitter ?? 0).toFixed(3)}</p>
                  </div>
                </div>
                </div>
              </div>

              {/* Alert Feed */}
              <div className="glass liquid rounded-[28px] flex flex-col flex-1 min-h-[420px] lg:min-h-0">
              <div className="px-6 pt-5 pb-4 flex justify-between items-center z-10">
                <div className="flex items-center gap-2.5">
                  <div className="glass-tile !w-9 !h-9 !rounded-[11px]"><Activity size={16} className="text-[#A4123F]" /></div>
                  <h2 className="text-[15px] font-bold text-[#141114] tracking-[-0.01em]">Anomaly Detection</h2>
                </div>
                {alerts && alerts.length > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-[#A4123F] text-white text-[10.5px] font-bold shadow-[0_6px_14px_-6px_rgba(164,18,63,0.7)]">
                    {alerts.length} New
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 mx-2 mb-2 rounded-[20px] glass-inset pt-4">
                <AlertFeed alerts={alerts || []} onAcknowledge={acknowledgeAlert} />
              </div>
              </div>
            </div>
          </>
        ) : (
          /* Live Candidate Code Workspace & Compiler (8 cols) */
          <div className="lg:col-span-8 glass-dark liquid rounded-[28px] flex flex-col overflow-hidden h-[calc(100vh-120px)] sticky top-[100px] animate-fade-in">
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/10 flex flex-wrap gap-3 justify-between items-center text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[12px] bg-white/10 border border-white/10 text-white flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
                  <Code2 size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[15px] font-semibold text-white tracking-[-0.01em]">Candidate Live Coding Workspace</h2>
                    <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-[11px] font-mono font-semibold text-white/75">
                      {codeSync?.language || 'python'}
                    </span>
                  </div>
                  <p className="text-[12px] text-white/50">Synchronized bi-directional compiler mirror</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-300 px-3 py-1.5 bg-emerald-400/10 rounded-full border border-emerald-400/25">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  Live Mirror
                </span>

                <button
                  onClick={handleInterviewerRun}
                  disabled={interviewerRunning || !codeSync?.code}
                  className="glass-btn !bg-white/95 !text-[#141114] !rounded-full px-4 py-2 text-[13px] disabled:opacity-40 cursor-pointer"
                  title="Execute Candidate Code"
                >
                  {interviewerRunning ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Executing...</span>
                    </>
                  ) : (
                    <>
                      <Play size={13} className="fill-current" />
                      <span>Test Run</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Monaco Editor (Candidate Mirrored View) */}
            <div className="flex-1 relative overflow-hidden bg-[#1E1E1E] mx-3 mt-3 rounded-[18px] border border-white/[0.06]">
              {codeSync?.code ? (
                <Editor
                  height="100%"
                  language={codeSync.language || 'python'}
                  value={codeSync.code}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    automaticLayout: true,
                    wordWrap: 'on',
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-white/50 gap-3 p-6 text-center">
                  <div className="w-14 h-14 rounded-[16px] bg-white/[0.06] border border-white/10 flex items-center justify-center mb-1">
                    <Code2 size={26} className="text-white/40 animate-pulse" />
                  </div>
                  <p className="text-[15px] font-semibold text-white/75">Waiting for candidate to start typing...</p>
                  <p className="text-[13px] text-white/45 max-w-sm">
                    Whatever the candidate types in their Monaco editor will stream here in real time.
                  </p>
                </div>
              )}
            </div>

            {/* Compiler Console Output Panel */}
            <div className="h-48 m-3 rounded-[18px] border border-white/[0.07] bg-black/35 flex flex-col font-mono text-xs overflow-hidden">
              <div className="h-9 border-b border-white/[0.07] px-4 flex items-center justify-between bg-white/[0.03] text-[11px] text-white/70">
                <div className="flex items-center gap-2">
                  <Terminal size={13} className="text-emerald-400" />
                  <span className="font-semibold text-white/85 font-sans">Live Compiler Console</span>
                  {(interviewerOutput?.status || codeSync?.status) && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      (interviewerOutput?.status || codeSync?.status) === 'SUCCESS'
                        ? 'bg-emerald-400/10 text-emerald-300 border border-emerald-400/30'
                        : 'bg-red-400/10 text-red-300 border border-red-400/30'
                    }`}>
                      {interviewerOutput?.status || codeSync?.status}
                    </span>
                  )}
                  {(interviewerOutput?.executionTime || codeSync?.executionTime) !== undefined && (
                    <span className="text-[10px] text-white/40">
                      ({interviewerOutput?.executionTime ?? codeSync?.executionTime}s)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setInterviewerOutput(null)}
                    className="text-white/50 hover:text-white text-[10.5px] font-sans font-semibold px-2 py-1 rounded-full hover:bg-white/10 cursor-pointer"
                  >
                    Clear Output
                  </button>
                </div>
              </div>

              <div className="flex-1 p-3.5 overflow-y-auto font-mono text-[12px] leading-relaxed select-text">
                {interviewerRunning || codeSync?.isRunning ? (
                  <div className="flex items-center gap-2 text-white/55 py-1">
                    <Loader2 size={13} className="animate-spin text-emerald-400" />
                    <span>Executing code in compiler sandbox...</span>
                  </div>
                ) : (interviewerOutput || codeSync?.output) ? (
                  <div>
                    {interviewerOutput?.stdout && (
                      <pre className="text-emerald-300 whitespace-pre-wrap font-mono">{interviewerOutput.stdout}</pre>
                    )}
                    {interviewerOutput?.stderr && (
                      <pre className="text-red-300 whitespace-pre-wrap mt-1 font-mono">{interviewerOutput.stderr}</pre>
                    )}
                    {!interviewerOutput && codeSync?.output && (
                      <pre className="text-emerald-300 whitespace-pre-wrap font-mono">{codeSync.output}</pre>
                    )}
                  </div>
                ) : (
                  <span className="text-white/40 italic">No execution output yet. When candidate compiles or you click 'Test Run', stdout/stderr will appear here.</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Face Verification Comparison Modal for Interviewer */}
      {showFaceModal && (
        <div className="fixed inset-0 z-50 bg-[#141114]/25 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-strong liquid !bg-[rgba(255,255,255,0.82)] rounded-[32px] max-w-3xl w-full overflow-hidden animate-fade-in flex flex-col">
            <div className="px-7 pt-6 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="glass-tile-maroon !w-11 !h-11 !rounded-[13px]">
                  <ShieldCheck size={19} />
                </div>
                <div>
                  <h3 className="text-[16px] font-bold text-[#141114] tracking-[-0.015em]">Candidate Face Verification Inspection</h3>
                  <p className="text-[12.5px] text-[#67636C]">AWS Rekognition CompareFaces Analysis</p>
                </div>
              </div>
              <button
                onClick={() => setShowFaceModal(false)}
                className="glass-btn !rounded-full px-3.5 py-2 text-[12.5px]"
              >
                ✕ Close
              </button>
            </div>

            <div className="px-7 pb-7 pt-2 flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4">
                {/* Source Photo */}
                <div>
                  <p className="glass-label !text-[11px] mb-2">Source: Reference Portrait</p>
                  <div className="aspect-[4/3] rounded-[20px] glass-inset overflow-hidden relative flex items-center justify-center">
                    {session.face_verification?.reference_image_url ? (
                      <img
                        src={session.face_verification.reference_image_url}
                        alt="Reference ID"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[13px] text-[#9A979E]">Not uploaded</span>
                    )}
                  </div>
                </div>

                {/* Live Snapshot */}
                <div>
                  <p className="glass-label !text-[11px] mb-2">Target: Live Video Snapshot</p>
                  <div className="aspect-[4/3] rounded-[20px] glass-inset overflow-hidden relative flex items-center justify-center">
                    {session.face_verification?.live_snapshot_url ? (
                      <img
                        src={session.face_verification.live_snapshot_url}
                        alt="Live Snapshot"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[13px] text-[#9A979E]">No snapshot yet</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Status and Similarity Score */}
              <div className="px-5 py-4 rounded-[20px] glass-soft flex items-center justify-between gap-4">
                <div>
                  <span className="glass-label !text-[10.5px] block mb-1">Verification Verdict</span>
                  <div className="flex items-center gap-1.5">
                    {session.face_verification?.verified ? (
                      <span className="text-[15px] font-bold text-[#1A6B3C] flex items-center gap-1.5">
                        <CheckCircle2 size={17} /> Verified Candidate Match
                      </span>
                    ) : (
                      <span className="text-[15px] font-bold text-[#991B1B] flex items-center gap-1.5">
                        <XCircle size={17} /> Identity Verification Not Confirmed
                      </span>
                    )}
                  </div>
                </div>

                {session.face_verification?.similarity !== undefined && session.face_verification?.similarity !== null && (
                  <div className="text-right">
                    <span className="glass-label !text-[10.5px] block mb-1">Rekognition Similarity</span>
                    <span className="text-[22px] font-mono font-bold text-[#141114]">{session.face_verification.similarity}%</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* End Session Confirmation Modal */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 bg-[#141114]/25 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md glass-strong liquid !bg-[rgba(255,255,255,0.82)] rounded-[32px] p-8 animate-fade-in text-[#141114]">
            <div className="flex items-center gap-3.5 mb-5">
              <div className="glass-tile !w-12 !h-12 !rounded-[15px] text-[#991B1B]">
                <LogOut size={20} />
              </div>
              <div>
                <h3 className="text-[18px] font-bold tracking-[-0.02em]">Conclude Interview Session?</h3>
                <p className="text-[12.5px] text-[#67636C] font-mono">Session {sessionId}</p>
              </div>
            </div>

            <p className="text-[14px] text-[#55515A] mb-7 leading-relaxed">
              Are you sure you want to end this interview? The candidate will be disconnected, and the final forensic trust score and biometric logs will be finalized.
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
                onClick={handleEndSession}
                disabled={endingSession}
                className="glass-btn-primary !rounded-full px-5 py-2.5 text-[13.5px] cursor-pointer"
              >
                {endingSession ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Finalizing...</span>
                  </>
                ) : (
                  <>
                    <LogOut size={14} />
                    <span>Yes, End Session</span>
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
