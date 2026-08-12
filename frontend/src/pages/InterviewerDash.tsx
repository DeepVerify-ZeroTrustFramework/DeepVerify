import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ShieldCheck, Activity, Users, Clock, Loader2, AlertCircle, LogOut } from 'lucide-react'
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

  // Initialize WebSockets for dashboard data
  const { score, breakdown, raw, alerts, status: wsStatus, acknowledgeAlert } = useTrustScore(sessionId || '')
  
  // Initialize WebRTC
  const rtc = useWebRTC(sessionId || '', 'interviewer', localStream)

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`)
        if (!res.ok) throw new Error('Session not found')
        const data = await res.json()
        setSession(data)
        
        // Get camera for interviewer PiP
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
          setLocalStream(stream)
        } catch (e) {
          console.warn('Interviewer camera access denied or missing')
        }
      } catch (err) {
        setError('Session not found.')
      } finally {
        setLoading(false)
      }
    }
    init()
    
    return () => {
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop())
      }
    }
  }, [sessionId])

  useEffect(() => {
    // Connect to signaling WebSocket and set up P2P connection
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
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E6F4ED] rounded-full text-[#1A6B3C] text-[11px] font-semibold border border-[#1A6B3C]/20">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#1A6B3C] opacity-75 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#1A6B3C]" />
            </span>
            Connection Secure
          </div>
          <button className="px-4 py-2 text-[13px] font-semibold text-[#991B1B] hover:bg-[#FEE2E2] rounded-xl transition-colors border border-transparent hover:border-[#FCA5A5]">
            Flag Session
          </button>
          <button
            onClick={() => {
              if (confirm('Are you sure you want to end this session?')) {
                // Stop WebRTC and navigate away
                rtc.stop()
                navigate('/')
              }
            }}
            className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold text-white bg-[#991B1B] hover:bg-[#7F1D1D] rounded-xl transition-colors"
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
              <VideoRoom state={rtc.state} remoteStream={rtc.remoteStream} localStream={localStream} status={wsStatus} />
            </div>
          </div>

          {/* Candidate Info Card */}
          <div className="bg-white rounded-[16px] border border-[#E4E4E6] p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-[#F9ECF0] flex items-center justify-center text-lg font-bold text-[#A4123F]">
                {session.candidate_name.charAt(0)}
              </div>
              <div className="flex-1">
                <h3 className="text-[16px] font-bold text-[#0F0F0F]">{session.candidate_name}</h3>
                <p className="text-[13px] text-[#6B6B6B] mb-3">{session.role}</p>
                <div className="grid grid-cols-2 gap-y-2 text-[12px]">
                  <div className="flex items-center gap-1.5 text-[#3A3A3A]">
                    <Users size={14} className="text-[#9B9B9B]" /> ID Verified
                  </div>
                  <div className="flex items-center gap-1.5 text-[#3A3A3A]">
                    <Clock size={14} className="text-[#9B9B9B]" /> 14m 23s elapsed
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

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
                <p className="text-[14px] font-mono font-medium text-[#0F0F0F]">{raw.pce.toFixed(1)}</p>
              </div>
              <div className="text-center border-l border-r border-[#E4E4E6]">
                <p className="text-[10px] uppercase tracking-wider text-[#9B9B9B] mb-1">SNR</p>
                <p className="text-[14px] font-mono font-medium text-[#0F0F0F]">{raw.snr_rppg.toFixed(1)}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wider text-[#9B9B9B] mb-1">CV</p>
                <p className="text-[14px] font-mono font-medium text-[#0F0F0F]">{raw.cv_jitter.toFixed(3)}</p>
              </div>
            </div>
          </div>

          {/* Module Breakdown Card */}
          <div className="bg-white rounded-[16px] border border-[#E4E4E6] p-6 shadow-sm">
            <h2 className="text-[13px] font-bold text-[#0F0F0F] mb-5">Forensic Breakdown</h2>
            <ModuleBreakdown breakdown={breakdown} />
          </div>
        </div>

        {/* Right Column: Alert Feed (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-[16px] border border-[#E4E4E6] shadow-sm flex flex-col h-[calc(100vh-112px)] sticky top-[88px]">
          <div className="p-4 border-b border-[#E4E4E6] flex justify-between items-center bg-white z-10 rounded-t-[16px]">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-[#A4123F]" />
              <h2 className="text-[13px] font-bold text-[#0F0F0F]">Anomaly Detection</h2>
            </div>
            {alerts.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-[#FEE2E2] text-[#991B1B] text-[10px] font-bold">
                {alerts.length} New
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 bg-[#F7F7F8]">
            <AlertFeed alerts={alerts} onAcknowledge={acknowledgeAlert} />
          </div>
        </div>
      </div>
    </div>
  )
}
