import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ShieldCheck, Building2, Calendar, Clock,
  ArrowRight, LogOut, CheckCircle2, AlertCircle, Loader2,
  Mail, Video, User, Sparkles, GraduationCap, Phone, Lock
} from 'lucide-react'
import { getAuthUser, clearAuth, getAuthHeaders } from '../../utils/auth'

interface Invitation {
  invitation_id: string
  recruiter_id: string
  recruiter_name: string
  recruiter_company: string
  candidate_email: string
  candidate_name?: string
  session_id: string
  session_token: string
  role_title: string
  duration: number
  message?: string
  status: string
  created_at: string
}



export default function StudentInbox() {
  const navigate = useNavigate()
  const user = getAuthUser()

  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user || user.role !== 'candidate') {
      navigate('/auth/candidate/login', { replace: true })
      return
    }
    async function fetchInvitations() {
      try {
        const res = await fetch('/api/invitations/my', { headers: getAuthHeaders() })
        if (res.status === 401) { clearAuth(); navigate('/auth/candidate/login'); return }
        if (!res.ok) throw new Error('Failed to load invitations.')
        const data = await res.json()
        setInvitations(data)
      } catch (err: any) {
        setError(err.message || 'Could not load invitations.')
      } finally {
        setLoading(false)
      }
    }
    fetchInvitations()
  }, [navigate])

  const handleLogout = () => { clearAuth(); navigate('/') }
  if (!user) return null

  return (
    <div className="min-h-screen bg-[#FAFAFB] relative">

      {/* ── Floating glass island Navbar ── */}
      <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
        <nav className="w-full max-w-[1100px] pointer-events-auto rounded-[1.25rem] bg-white/75 backdrop-blur-xl border border-white/80 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
          <div className="px-6 h-[4.5rem] flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#A4123F] flex items-center justify-center shadow-sm">
                <ShieldCheck size={20} className="text-white" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-[#0F0F0F] leading-tight">DeepVerify</p>
                <p className="text-[11px] font-medium text-[#888] leading-tight mt-0.5">Candidate Portal</p>
              </div>
            </Link>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#F7F7F8] border border-[#E4E4E6] text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="font-medium text-[#3A3A3A]">{user.email}</span>
              </div>
              <button onClick={handleLogout}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-[#F7F7F8] border border-transparent hover:border-[#E4E4E6] transition-all">
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        </nav>
      </div>

      {/* ── Main Content ── */}
      <main className="relative z-10 max-w-[1100px] mx-auto px-4 pt-36 pb-16">

        {/* Page header badge */}
        <div className="mb-8" style={{ animation: 'fadeUp 0.4s ease both' }}>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#E4E4E6] bg-white/70 backdrop-blur-sm text-[11px] font-semibold text-[#A4123F] mb-3">
            <Sparkles size={11} />
            Candidate Dashboard · Zero-Trust
          </div>
          <h1 className="text-[28px] font-bold text-[#0F0F0F] tracking-[-0.03em]">Student Inbox</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">Your verified interview invitations and academic profile</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ═══════════ LEFT: Profile Panel ═══════════ */}
          <div className="space-y-5" style={{ animation: 'fadeUp 0.4s ease both', animationDelay: '0.05s' }}>

            {/* Profile card */}
            <div className="rounded-2xl bg-white/50 backdrop-blur-xl border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.05)] p-6 relative overflow-hidden">
              {/* subtle orb inside card */}
              <div className="absolute top-[-20px] right-[-20px] w-28 h-28 rounded-full bg-rose-300/10 blur-2xl animate-drift1 pointer-events-none" />

              <div className="flex flex-col items-center text-center pb-5 border-b border-white/80 relative z-10">
                {user.profile_photo_url ? (
                  <div className="relative mb-3">
                    <img src={user.profile_photo_url} alt={user.full_name}
                      className="w-24 object-cover rounded-2xl border-2 border-emerald-400 shadow-md"
                      style={{ height: '112px' }} />
                    <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-white p-1.5 rounded-full shadow-md">
                      <CheckCircle2 size={12} />
                    </div>
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-[#F7F7F8] flex items-center justify-center text-[#CCCCCC] mb-3 border border-white/80">
                    <User size={34} />
                  </div>
                )}
                <h2 className="text-[17px] font-bold text-[#0F0F0F] leading-snug">{user.full_name}</h2>
                <p className="text-[11px] text-[#6B6B6B] mt-0.5">{user.email}</p>
                <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold border border-emerald-100">
                  <CheckCircle2 size={11} /> Ground Truth Enrolled
                </div>
              </div>

              <div className="pt-4 space-y-3 text-xs relative z-10">
                {[
                  { icon: <GraduationCap size={13} className="text-[#A4123F]" />, label: 'College / University', value: user.college || 'Not specified' },
                  { icon: <GraduationCap size={13} className="text-[#A4123F]" />, label: 'Degree & Major', value: user.degree || 'Not specified' },
                  { icon: <Calendar size={13} className="text-[#A4123F]" />, label: 'Expected Graduation', value: user.graduation_year || 'Not specified' },
                  ...(user.phone ? [{ icon: <Phone size={13} className="text-[#A4123F]" />, label: 'Phone', value: user.phone }] : []),
                ].map((row, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/70 border border-white/80">
                    <span className="mt-0.5 shrink-0">{row.icon}</span>
                    <div>
                      <span className="text-[10px] text-[#9B9B9B] block">{row.label}</span>
                      <span className="font-semibold text-[#111]">{row.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Zero-Trust verification card */}
            <div className="rounded-2xl relative overflow-hidden p-5 shadow-sm"
              style={{ background: 'linear-gradient(155deg, #1A1A1A 0%, #0A0A0A 100%)' }}>
              {/* Maroon inner glow */}
              <div className="absolute top-[-20px] right-[-20px] w-32 h-32 rounded-full opacity-20 blur-3xl"
                style={{ background: '#A4123F' }} />
              <div className="absolute bottom-[-10px] left-[-10px] w-24 h-24 rounded-full opacity-10 blur-2xl"
                style={{ background: '#A4123F' }} />

              {/* Subtle spinning ring inside card */}
              <div className="absolute animate-spin-slow opacity-[0.08] pointer-events-none"
                style={{ width: 220, height: 220, borderRadius: '50%', border: '1px dashed #A4123F', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />

              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2 text-[#E68A9E]">
                  <Sparkles size={15} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Zero-Trust Verification</span>
                </div>
                <h3 className="text-sm font-bold text-white mb-1.5">Passive Forensics Enabled</h3>
                <p className="text-[11px] text-white/50 mb-4 leading-relaxed">
                  Your interviews are verified through camera PRNU sensor noise and rPPG biological pulse detection.
                </p>
                <div className="space-y-2">
                  {[
                    { icon: <CheckCircle2 size={11} />, text: 'AWS Rekognition FaceCompare ready' },
                    { icon: <CheckCircle2 size={11} />, text: 'Anti-Deepfake GPU jitter profiling' },
                    { icon: <CheckCircle2 size={11} />, text: 'MediaPipe gaze & iris tracker' },
                  ].map((f, i) => (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-white/8 border border-white/10 text-[11px] text-white/60"
                      style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <span className="text-emerald-400">{f.icon}</span>
                      {f.text}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-[10px] text-white/30">
                  <Lock size={10} /> End-to-end session integrity
                </div>
              </div>
            </div>
          </div>

          {/* ═══════════ RIGHT: Invitations Feed ═══════════ */}
          <div className="lg:col-span-2 space-y-5" style={{ animation: 'fadeUp 0.4s ease both', animationDelay: '0.1s' }}>

            {/* Header row */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[20px] font-bold text-[#0F0F0F] tracking-[-0.02em]">Interview Invitations</h2>
                <p className="text-[12px] text-[#6B6B6B] mt-0.5">Direct session links received from verified recruiters</p>
              </div>
              <span className="text-xs font-semibold px-3 py-1.5 rounded-full border border-[#E4E4E6] bg-white/70 backdrop-blur-sm text-[#3A3A3A] shadow-sm">
                {invitations.length} Active
              </span>
            </div>

            {/* States */}
            {loading ? (
              <div className="rounded-2xl bg-white/50 backdrop-blur-xl border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04)] p-16 flex flex-col items-center justify-center text-center">
                <Loader2 size={26} className="animate-spin text-[#A4123F] mb-3" />
                <p className="text-xs text-[#6B6B6B]">Loading your invitations...</p>
              </div>
            ) : error ? (
              <div className="rounded-2xl bg-red-50 border border-red-200 p-6 text-xs text-[#991B1B] flex items-center gap-3">
                <AlertCircle size={16} /><span>{error}</span>
              </div>
            ) : invitations.length === 0 ? (
              <div className="rounded-2xl bg-white/50 backdrop-blur-xl border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04)] p-16 text-center relative overflow-hidden">
                {/* Empty state inner animation */}
                <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-rose-300/5 blur-3xl animate-drift1 pointer-events-none" />
                <div className="relative z-10">
                  <div className="w-14 h-14 rounded-2xl bg-[#F7F7F8] flex items-center justify-center mx-auto mb-4 text-[#D0D0D3]">
                    <Mail size={24} />
                  </div>
                  <h3 className="text-sm font-bold text-[#0F0F0F] mb-1.5">Your inbox is clear</h3>
                  <p className="text-xs text-[#6B6B6B] max-w-xs mx-auto leading-relaxed">
                    When a recruiter schedules an interview with you, your direct zero-trust session link will appear right here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {invitations.map((inv, idx) => (
                  <div key={inv.invitation_id}
                    className="rounded-2xl bg-white/50 backdrop-blur-xl border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 hover:border-[#A4123F]/20 transition-all duration-300 p-5 relative overflow-hidden"
                    style={{ animation: `fadeUp 0.3s ease both`, animationDelay: `${idx * 0.06}s` }}
                  >
                    {/* Card inner glow on hover */}
                    <div className="absolute top-[-20px] right-[-20px] w-24 h-24 rounded-full bg-rose-300/5 blur-2xl pointer-events-none" />

                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4 relative z-10">
                      <div>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#FDF2F4] text-[#A4123F] border border-[#F9C4D0]">
                            {inv.role_title}
                          </span>
                          <span className="text-[11px] text-[#9B9B9B] flex items-center gap-1">
                            <Clock size={11} /> {inv.duration} mins
                          </span>
                        </div>
                        <h3 className="text-[15px] font-bold text-[#0F0F0F] flex items-center gap-2">
                          <Building2 size={15} className="text-[#9B9B9B]" />
                          {inv.recruiter_company}
                        </h3>
                        <p className="text-xs text-[#6B6B6B] mt-0.5">
                          Invited by <span className="font-semibold text-[#3A3A3A]">{inv.recruiter_name}</span>
                        </p>
                      </div>

                      <Link to={`/check/${inv.session_token}`}
                        className="px-5 py-2.5 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 shrink-0 transition-all hover:gap-3"
                        style={{ background: 'linear-gradient(135deg,#A4123F,#7A0D2E)', boxShadow: '0 4px 14px rgba(164,18,63,0.30)' }}>
                        <Video size={13} /> Start System Check & Join <ArrowRight size={13} />
                      </Link>
                    </div>

                    {inv.message && (
                      <div className="mb-4 px-3.5 py-3 rounded-xl text-xs text-[#555] italic bg-white/70 border border-white/80 relative z-10">
                        "{inv.message}"
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-[#BBBBBB] pt-3 border-t border-white/60 relative z-10">
                      <span className="flex items-center gap-1">
                        <Calendar size={11} /> Received: {new Date(inv.created_at).toLocaleDateString()}
                      </span>
                      <span className="font-mono text-[10px]">Session: {inv.session_id}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 py-6 text-center text-[11px] text-[#C0C0C0]">
        DeepVerify © 2026 · Standalone Zero-Trust Technical Interview Platform
      </footer>
    </div>
  )
}
