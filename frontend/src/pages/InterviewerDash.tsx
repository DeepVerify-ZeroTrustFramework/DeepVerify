import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { 
  ShieldCheck, Activity, Clock, Loader2, AlertCircle, LogOut, 
  CheckCircle2, XCircle, Camera, Image as ImageIcon, FileText, Home,
  Code2, Play, Terminal
} from 'lucide-react'
import Editor from '@monaco-editor/react'
import TrustGauge from '../components/TrustGauge'
import ModuleBreakdown from '../components/ModuleBreakdown'
import AlertFeed from '../components/AlertFeed'
import VideoRoom from '../components/VideoRoom'
import { useTrustScore } from '../hooks/useTrustScore'
import { useWebRTC } from '../hooks/useWebRTC'

export default function InterviewerDash() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [showFaceModal, setShowFaceModal] = useState(false)
  const [activeView, setActiveView] = useState<'forensics' | 'code'>('forensics')

  // Interviewer compiler state
  const [interviewerRunning, setInterviewerRunning] = useState(false)
  const [interviewerOutput, setInterviewerOutput] = useState<{ stdout: string; stderr: string; executionTime?: number; status?: string } | null>(null)

  // Exit interview state
  const [showEndModal, setShowEndModal] = useState(false)
  const [isEnded, setIsEnded] = useState(false)
  const [endingSession, setEndingSession] = useState(false)

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
  const { score, breakdown, raw, alerts, status: wsStatus, codeSync, acknowledgeAlert } = useTrustScore(sessionId || '')

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
  const rtc = useWebRTC(sessionId || '', 'interviewer', localStream)

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`)
        if (!res.ok) throw new Error('Session not found')
        const data = await res.json()
        setSession(data)
      } catch (err) {
        setError('Session not found.')
      } finally {
        setLoading(false)
      }

      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
          setLocalStream(stream)
        }
      } catch (e) {
        console.warn('Interviewer camera access not available on mount (may be locked by candidate):', e)
        try {
          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            setLocalStream(audioStream)
          }
        } catch (audioErr) {
          console.warn('Interviewer audio access also unavailable:', audioErr)
          setLocalStream(new MediaStream())
        }
      }
    }
    init()

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop())
      }
    }
  }, [sessionId])

  const [camEnabled, setCamEnabled] = useState(true)

  const toggleCamera = async () => {
    if (!localStream) {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
          setLocalStream(stream)
          setCamEnabled(true)
        }
      } catch (e) {
        console.warn('Could not start interviewer camera:', e)
      }
      return
    }

    const next = !camEnabled
    localStream.getVideoTracks().forEach((t) => {
      t.enabled = next
    })
    setCamEnabled(next)
  }

  useEffect(() => {
    // Connect to signaling WebSocket and set up P2P connection once stream is ready
    if (session && localStream) {
      rtc.initialize()
    }
    return () => {
      rtc.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, localStream])


  if (loading) {
    return <div className="min-h-screen bg-[#F7F7F8] flex items-center justify-center"><Loader2 className="animate-spin text-[#A4123F]" /></div>
  }

  if (error || !session) {
    return <div className="min-h-screen bg-[#F7F7F8] flex flex-col items-center justify-center text-center p-6">
      <AlertCircle className="text-[#991B1B] w-12 h-12 mb-4" />
      <h1 className="text-xl font-bold text-[#0F0F0F] mb-2">Error</h1>
      <p className="text-[#6B6B6B]">{error}</p>
    </div>
  }

  if (isEnded) {
    return (
      <div className="min-h-screen bg-[#F7F7F8] flex flex-col items-center justify-center p-6 text-center font-sans">
        <div className="w-full max-w-xl bg-white border border-[#E4E4E6] rounded-3xl p-10 shadow-lg flex flex-col items-center">
          <div className="w-20 h-20 rounded-full bg-[#FDF2F4] border-2 border-[#A4123F] flex items-center justify-center text-[#A4123F] mb-6 shadow-md shadow-[#A4123F]/10">
            <ShieldCheck size={42} />
          </div>
          <h1 className="text-2xl font-bold text-[#0F0F0F] mb-2">Interview Session Concluded</h1>
          <p className="text-sm text-[#555] mb-6 max-w-md leading-relaxed">
            Session <strong className="text-[#0F0F0F] font-mono">{session.session_id}</strong> with candidate <strong className="text-[#0F0F0F]">{session.candidate_name}</strong> has been ended and marked as complete.
          </p>

          <div className="w-full bg-[#FAFAFB] border border-[#E5E5E8] rounded-2xl p-5 mb-8 text-left space-y-3.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#6B6B6B]">Candidate:</span>
              <span className="font-bold text-[#0F0F0F]">{session.candidate_name} ({session.role})</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#6B6B6B]">Overall Trust Score:</span>
              <span className={`font-mono font-bold text-sm ${score >= 80 ? 'text-[#1A6B3C]' : score >= 60 ? 'text-amber-600' : 'text-[#991B1B]'}`}>
                {score} / 100
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#6B6B6B]">AWS Face Verification:</span>
              <span className="inline-flex items-center gap-1 font-bold text-[#1A6B3C]">
                {session.face_verification?.verified ? `✓ Match (${session.face_verification.similarity}%)` : 'Processed'}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#6B6B6B]">Recorded Alerts:</span>
              <span className="font-semibold text-[#0F0F0F]">{alerts.length} Flagged Events</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <a
              href={`/api/reports/${session.session_id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 py-3 px-5 rounded-xl bg-[#A4123F] hover:bg-[#850E32] text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2"
            >
              <FileText size={15} /> Download PDF Report
            </a>
            <button
              onClick={() => navigate('/recruiter/dashboard')}
              className="py-3 px-5 rounded-xl border border-[#D5D5D7] hover:bg-gray-50 text-xs font-semibold text-[#3A3A3A] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Home size={15} /> Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Waiting Room state (BUG 3 & 4 FIX)
  const isCandidateReady = session.status === 'ACTIVE' || wsStatus === 'CONNECTED'

  if (!isCandidateReady) {
    return (
      <div className="min-h-screen bg-[#F7F7F8] flex flex-col">
        <div className="h-16 bg-white border-b border-[#E4E4E6] flex items-center px-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#A4123F] flex items-center justify-center">
              <ShieldCheck size={18} className="text-white" />
            </div>
            <span className="text-sm font-bold text-[#0F0F0F]">Interviewer Dashboard</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-16 h-16 rounded-2xl bg-white border border-[#E4E4E6] flex items-center justify-center mb-6 shadow-sm">
            <Loader2 className="animate-spin text-[#A4123F]" size={28} />
          </div>
          <h2 className="text-xl font-bold text-[#0F0F0F] mb-2">Waiting for candidate</h2>
          <p className="text-[14px] text-[#6B6B6B] mb-8 text-center max-w-md">
            {session.candidate_name} has not completed the system check yet. This page will automatically update once they join the session.
          </p>
          <div className="bg-white border border-[#E4E4E6] rounded-xl p-4 flex items-center gap-4 text-[13px]">
            <div className="flex items-center gap-2">
              <span className="text-[#6B6B6B]">Session ID:</span>
              <span className="font-mono font-semibold text-[#0F0F0F]">{session.session_id}</span>
            </div>
            <div className="w-px h-4 bg-[#E4E4E6]" />
            <div className="flex items-center gap-2">
              <span className="text-[#6B6B6B]">Role:</span>
              <span className="font-semibold text-[#0F0F0F]">{session.role}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Main Dashboard
  return (
    <div className="min-h-screen bg-[#F7F7F8] flex flex-col font-sans">

      {/* Top Navbar */}
      <nav className="h-16 bg-white border-b border-[#E4E4E6] flex items-center justify-between px-6 shrink-0 z-10 sticky top-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#A4123F] flex items-center justify-center">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-[#0F0F0F] leading-tight">DeepVerify <span className="font-normal text-[#6B6B6B] ml-1">Live Dashboard</span></h1>
            <div className="flex items-center gap-2 text-[10px] text-[#6B6B6B] mt-0.5">
              <span className="font-mono">{session.session_id}</span>
              <span className="w-1 h-1 rounded-full bg-[#D0D0D3]" />
              <span>{session.interview_type}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-gray-100 p-1 rounded-xl border border-gray-200 text-xs font-semibold">
            <button
              onClick={() => setActiveView('forensics')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeView === 'forensics'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Activity size={14} className="text-[#A4123F]" />
              <span>Forensics</span>
              {alerts && alerts.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
                  {alerts.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveView('code')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeView === 'code'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Code2 size={14} className="text-blue-500" />
              <span>Live Code & Compiler</span>
              {codeSync?.code && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>}
            </button>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E6F4ED] rounded-full text-[#1A6B3C] text-[11px] font-semibold border border-[#1A6B3C]/20">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#1A6B3C] opacity-75 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#1A6B3C]" />
            </span>
            Connection Secure
          </div>
          <button
            onClick={toggleCamera}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${localStream
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            title={localStream ? "Turn off interviewer camera" : "Turn on interviewer camera"}
          >
            <Camera size={14} className={localStream ? 'text-emerald-600' : 'text-gray-400'} />
            <span>{localStream ? 'Interviewer Cam On' : 'Interviewer Cam Off'}</span>
          </button>
          <button className="px-4 py-2 text-[13px] font-semibold text-[#991B1B] hover:bg-[#FEE2E2] rounded-xl transition-colors border border-transparent hover:border-[#FCA5A5]">
            Flag Session
          </button>
          <button
            onClick={() => setShowEndModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold text-white bg-[#991B1B] hover:bg-[#7F1D1D] rounded-xl transition-colors cursor-pointer"
          >
            <LogOut size={14} />
            End Session
          </button>
        </div>
      </nav>

      {/* Main Grid */}
      <div className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1600px] mx-auto w-full">

        {/* Left Column: Video & Candidate Info (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Video Card */}
          <div className="bg-white rounded-[16px] border border-[#E4E4E6] overflow-hidden shadow-sm flex flex-col">
            <div className="p-4 border-b border-[#E4E4E6] flex justify-between items-center bg-white z-10">
              <h2 className="text-[13px] font-bold text-[#0F0F0F]">Live Verification Feed</h2>
              <span className="text-[11px] font-mono text-[#6B6B6B]">720p / 30fps</span>
            </div>
            <div className="relative aspect-[4/3] bg-[#0A0A0A]">
              <VideoRoom
                state={rtc.state}
                remoteStream={rtc.remoteStream}
                localStream={localStream}
                onLocalStreamChange={setLocalStream}
                status={wsStatus}
              />
            </div>
          </div>

          {/* Candidate Info Card */}
          <div className="bg-white rounded-[16px] border border-[#E4E4E6] p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-[#F9ECF0] flex items-center justify-center text-lg font-bold text-[#A4123F] overflow-hidden">
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
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-[16px] font-bold text-[#0F0F0F]">{session.candidate_name}</h3>
                  {session.face_verification?.verified ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E6F4ED] text-[#1A6B3C] border border-[#1A6B3C]/20">
                      <CheckCircle2 size={10} /> Rekognition Match
                    </span>
                  ) : session.face_verification?.status === 'FAILED' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                      <XCircle size={10} /> ID Mismatch
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      <Clock size={10} /> ID Pending
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-[#6B6B6B] mb-3">{session.role}</p>

                <div className="grid grid-cols-2 gap-y-2 text-[12px] pt-1 border-t border-[#F0F0F2]">
                  <div className="flex items-center gap-1.5 text-[#3A3A3A]">
                    {session.face_verification?.verified ? (
                      <span className="text-[#1A6B3C] font-semibold flex items-center gap-1">
                        <CheckCircle2 size={13} /> {session.face_verification.similarity}% Similarity
                      </span>
                    ) : session.face_verification?.status === 'FAILED' ? (
                      <span className="text-red-600 font-semibold flex items-center gap-1">
                        <XCircle size={13} /> Mismatch
                      </span>
                    ) : (
                      <span className="text-[#6B6B6B] flex items-center gap-1">
                        <Camera size={13} /> Unverified
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[#3A3A3A]">
                    <Clock size={14} className="text-[#9B9B9B]" /> Active Call
                  </div>
                </div>

                {/* Inspect ID Photo Button */}
                {(session.face_verification?.reference_image_url || session.face_verification?.live_snapshot_url) && (
                  <button
                    onClick={() => setShowFaceModal(true)}
                    className="mt-3 w-full py-1.5 px-3 rounded-lg border border-[#E4E4E6] hover:bg-[#F7F7F8] text-[11px] font-semibold text-[#0F0F0F] transition-colors flex items-center justify-center gap-1.5"
                  >
                    <ImageIcon size={12} />
                    <span>View Reference vs Live Face</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Section (8 cols): Either Forensics View or Live Code & Compiler */}
        {activeView === 'forensics' ? (
          <>
            {/* Center Column: Trust Score & Modules (4 cols) */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              {/* Main Trust Card */}
              <div className="bg-white rounded-[16px] border border-[#E4E4E6] p-6 shadow-sm flex flex-col items-center justify-center flex-1">
                <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#6B6B6B] mb-6">Aggregate Trust Score</h2>
                <TrustGauge score={score} />

                {/* Raw metrics strip */}
                <div className="w-full mt-8 grid grid-cols-3 gap-2 border-t border-[#E4E4E6] pt-6">
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-wider text-[#9B9B9B] mb-1">PCE</p>
                    <p className="text-[14px] font-mono font-medium text-[#0F0F0F]">{(raw?.pce ?? 0).toFixed(1)}</p>
                  </div>
                  <div className="text-center border-l border-r border-[#E4E4E6]">
                    <p className="text-[10px] uppercase tracking-wider text-[#9B9B9B] mb-1">SNR</p>
                    <p className="text-[14px] font-mono font-medium text-[#0F0F0F]">{(raw?.snr_rppg ?? 0).toFixed(1)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-wider text-[#9B9B9B] mb-1">CV</p>
                    <p className="text-[14px] font-mono font-medium text-[#0F0F0F]">{(raw?.cv_jitter ?? 0).toFixed(3)}</p>
                  </div>
                </div>
              </div>

              {/* Module Breakdown Card */}
              <div className="bg-white rounded-[16px] border border-[#E4E4E6] p-6 shadow-sm">
                <h2 className="text-[13px] font-bold text-[#0F0F0F] mb-5">Forensic Breakdown</h2>
                <ModuleBreakdown breakdown={breakdown ?? { prnu: 0, rppg: 0, jitter: 0, behavioral: 0 }} />
              </div>
            </div>

            {/* Right Column: Alert Feed (4 cols) */}
            <div className="lg:col-span-4 bg-white rounded-[16px] border border-[#E4E4E6] shadow-sm flex flex-col h-[calc(100vh-112px)] sticky top-[88px]">
              <div className="p-4 border-b border-[#E4E4E6] flex justify-between items-center bg-white z-10 rounded-t-[16px]">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="text-[#A4123F]" />
                  <h2 className="text-[13px] font-bold text-[#0F0F0F]">Anomaly Detection</h2>
                </div>
                {alerts && alerts.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-[#FEE2E2] text-[#991B1B] text-[10px] font-bold">
                    {alerts.length} New
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4 bg-[#F7F7F8]">
                <AlertFeed alerts={alerts || []} onAcknowledge={acknowledgeAlert} />
              </div>
            </div>
          </>
        ) : (
          /* Live Candidate Code Workspace & Compiler (8 cols) */
          <div className="lg:col-span-8 bg-[#11131A] rounded-[16px] border border-[#232736] shadow-sm flex flex-col overflow-hidden h-[calc(100vh-112px)] sticky top-[88px] animate-fade-in">
            {/* Header */}
            <div className="p-3.5 border-b border-[#232736] flex justify-between items-center bg-[#171A24] text-white">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
                  <Code2 size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[13px] font-bold text-white">Candidate Live Coding Workspace</h2>
                    <span className="px-2 py-0.5 rounded-md bg-[#232736] text-[11px] font-mono font-semibold text-gray-300">
                      {codeSync?.language || 'python'}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400">Synchronized bi-directional compiler mirror</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 px-2.5 py-1 bg-emerald-950/40 rounded-lg border border-emerald-800/50">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  Live Mirror
                </span>

                <button
                  onClick={handleInterviewerRun}
                  disabled={interviewerRunning || !codeSync?.code}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#1A6B3C] hover:bg-[#145530] text-white text-xs font-semibold rounded-lg transition-all disabled:opacity-50 cursor-pointer shadow"
                  title="Execute Candidate Code"
                >
                  {interviewerRunning ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Executing...</span>
                    </>
                  ) : (
                    <>
                      <Play size={13} className="fill-white" />
                      <span>Test Run</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Monaco Editor (Candidate Mirrored View) */}
            <div className="flex-1 relative overflow-hidden bg-[#0D0F16]">
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
                <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3 p-6 text-center">
                  <Code2 size={36} className="text-gray-600 animate-pulse" />
                  <p className="text-sm font-semibold text-gray-400">Waiting for candidate to start typing...</p>
                  <p className="text-xs text-gray-500 max-w-sm">
                    Whatever the candidate types in their Monaco editor will stream here in real time.
                  </p>
                </div>
              )}
            </div>

            {/* Compiler Console Output Panel */}
            <div className="h-44 border-t border-[#232736] bg-[#0A0C10] flex flex-col font-mono text-xs">
              <div className="h-8 border-b border-[#1E232E] px-4 flex items-center justify-between bg-[#12151E] text-[11px] text-gray-300">
                <div className="flex items-center gap-2">
                  <Terminal size={13} className="text-emerald-400" />
                  <span className="font-semibold text-gray-200">Live Compiler Console</span>
                  {(interviewerOutput?.status || codeSync?.status) && (
                    <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      (interviewerOutput?.status || codeSync?.status) === 'SUCCESS'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : 'bg-red-950 text-red-400 border border-red-800'
                    }`}>
                      {interviewerOutput?.status || codeSync?.status}
                    </span>
                  )}
                  {(interviewerOutput?.executionTime || codeSync?.executionTime) !== undefined && (
                    <span className="text-[10px] text-gray-500">
                      ({interviewerOutput?.executionTime ?? codeSync?.executionTime}s)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setInterviewerOutput(null)}
                    className="text-gray-400 hover:text-white text-[10px] cursor-pointer"
                  >
                    Clear Output
                  </button>
                </div>
              </div>

              <div className="flex-1 p-3 overflow-y-auto font-mono text-[12px] leading-relaxed select-text bg-[#08090E]">
                {interviewerRunning || codeSync?.isRunning ? (
                  <div className="flex items-center gap-2 text-gray-400 py-1">
                    <Loader2 size={13} className="animate-spin text-emerald-400" />
                    <span>Executing code in compiler sandbox...</span>
                  </div>
                ) : (interviewerOutput || codeSync?.output) ? (
                  <div>
                    {interviewerOutput?.stdout && (
                      <pre className="text-emerald-300 whitespace-pre-wrap font-mono">{interviewerOutput.stdout}</pre>
                    )}
                    {interviewerOutput?.stderr && (
                      <pre className="text-red-400 whitespace-pre-wrap mt-1 font-mono">{interviewerOutput.stderr}</pre>
                    )}
                    {!interviewerOutput && codeSync?.output && (
                      <pre className="text-emerald-300 whitespace-pre-wrap font-mono">{codeSync.output}</pre>
                    )}
                  </div>
                ) : (
                  <span className="text-gray-500 italic">No execution output yet. When candidate compiles or you click 'Test Run', stdout/stderr will appear here.</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Face Verification Comparison Modal for Interviewer */}
      {showFaceModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E4E4E6] max-w-xl w-full shadow-2xl overflow-hidden animate-fade-in flex flex-col">
            <div className="p-4 border-b border-[#E4E4E6] flex items-center justify-between bg-[#F7F7F8]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#A4123F] flex items-center justify-center text-white">
                  <ShieldCheck size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#0F0F0F]">Candidate Face Verification Inspection</h3>
                  <p className="text-[11px] text-[#6B6B6B]">AWS Rekognition CompareFaces Analysis</p>
                </div>
              </div>
              <button
                onClick={() => setShowFaceModal(false)}
                className="text-gray-400 hover:text-black text-xs font-semibold px-2 py-1 rounded hover:bg-gray-100"
              >
                ✕ Close
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Source Photo */}
                <div>
                  <p className="text-[12px] font-bold text-[#0F0F0F] mb-1.5">Source: Reference Portrait</p>
                  <div className="aspect-[4/3] rounded-xl bg-gray-100 border border-[#E4E4E6] overflow-hidden relative flex items-center justify-center">
                    {session.face_verification?.reference_image_url ? (
                      <img
                        src={session.face_verification.reference_image_url}
                        alt="Reference ID"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-gray-400">Not uploaded</span>
                    )}
                  </div>
                </div>

                {/* Live Snapshot */}
                <div>
                  <p className="text-[12px] font-bold text-[#0F0F0F] mb-1.5">Target: Live Video Snapshot</p>
                  <div className="aspect-[4/3] rounded-xl bg-gray-100 border border-[#E4E4E6] overflow-hidden relative flex items-center justify-center">
                    {session.face_verification?.live_snapshot_url ? (
                      <img
                        src={session.face_verification.live_snapshot_url}
                        alt="Live Snapshot"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-gray-400">No snapshot yet</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Status and Similarity Score */}
              <div className="p-4 rounded-xl border border-[#E4E4E6] bg-[#F7F7F8] flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-[#6B6B6B] block uppercase font-bold tracking-wider mb-0.5">Verification Verdict</span>
                  <div className="flex items-center gap-1.5">
                    {session.face_verification?.verified ? (
                      <span className="text-sm font-bold text-[#1A6B3C] flex items-center gap-1">
                        <CheckCircle2 size={16} /> Verified Candidate Match
                      </span>
                    ) : (
                      <span className="text-sm font-bold text-red-600 flex items-center gap-1">
                        <XCircle size={16} /> Identity Verification Not Confirmed
                      </span>
                    )}
                  </div>
                </div>

                {session.face_verification?.similarity !== undefined && session.face_verification?.similarity !== null && (
                  <div className="text-right">
                    <span className="text-[11px] text-[#6B6B6B] block uppercase font-bold tracking-wider mb-0.5">Rekognition Similarity</span>
                    <span className="text-lg font-mono font-bold text-[#0F0F0F]">{session.face_verification.similarity}%</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* End Session Confirmation Modal */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-[#E4E4E6] rounded-2xl p-6 shadow-2xl animate-fade-in text-[#0F0F0F]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 text-[#991B1B] flex items-center justify-center">
                <LogOut size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold">Conclude Interview Session?</h3>
                <p className="text-xs text-[#6B6B6B]">Session {sessionId}</p>
              </div>
            </div>

            <p className="text-xs text-[#555] mb-6 leading-relaxed">
              Are you sure you want to end this interview? The candidate will be disconnected, and the final forensic trust score and biometric logs will be finalized.
            </p>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowEndModal(false)}
                disabled={endingSession}
                className="px-4 py-2 rounded-xl border border-[#D5D5D7] hover:bg-gray-50 text-xs font-semibold text-[#3A3A3A] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEndSession}
                disabled={endingSession}
                className="px-5 py-2 rounded-xl bg-[#991B1B] hover:bg-[#7F1D1D] text-xs font-bold text-white transition-colors flex items-center gap-2 cursor-pointer shadow-md"
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
