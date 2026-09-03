import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { 
  ShieldCheck, Building2, Calendar, Clock, 
  ArrowRight, LogOut, CheckCircle2, AlertCircle, Loader2, 
  Mail, Video, User, Sparkles
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
        const res = await fetch('/api/invitations/my', {
          headers: getAuthHeaders(),
        })
        if (res.status === 401) {
          clearAuth()
          navigate('/auth/candidate/login')
          return
        }
        if (!res.ok) {
          throw new Error('Failed to load invitations.')
        }
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

  const handleLogout = () => {
    clearAuth()
    navigate('/')
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col">
      {/* Navigation */}
      <nav className="bg-white border-b border-[#EAEAEA] sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#A4123F] flex items-center justify-center">
              <ShieldCheck size={18} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#0F0F0F] leading-tight">DeepVerify</p>
              <p className="text-[10px] text-[#6B6B6B] leading-tight">Candidate Portal</p>
            </div>
          </Link>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-[#F5F5F5] rounded-full text-xs text-[#555]">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              {user.email}
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#666] hover:text-[#0F0F0F] hover:bg-gray-100 rounded-lg transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Student Profile Summary */}
          <div className="space-y-6">
            <div className="bg-white border border-[#EAEAEA] rounded-2xl p-6 shadow-sm">
              <div className="flex flex-col items-center text-center pb-5 border-b border-[#F0F0F0]">
                {user.profile_photo_url ? (
                  <div className="relative mb-3">
                    <img
                      src={user.profile_photo_url}
                      alt={user.full_name}
                      className="w-24 h-28 object-cover rounded-xl border-2 border-[#1A6B3C] shadow-sm"
                    />
                    <div className="absolute -bottom-2 -right-2 bg-[#1A6B3C] text-white p-1 rounded-full shadow">
                      <CheckCircle2 size={14} />
                    </div>
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
                    <User size={36} />
                  </div>
                )}
                <h2 className="text-lg font-bold text-[#0F0F0F]">{user.full_name}</h2>
                <p className="text-xs text-[#6B6B6B]">{user.email}</p>
                
                <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#E6F4ED] text-[#1A6B3C] text-[11px] font-semibold">
                  <CheckCircle2 size={12} /> Ground Truth Enrolled
                </div>
              </div>

              <div className="pt-4 space-y-3 text-xs">
                <div>
                  <span className="text-[#888] block text-[11px]">College / University</span>
                  <span className="font-semibold text-[#111]">{user.college || 'Not specified'}</span>
                </div>
                <div>
                  <span className="text-[#888] block text-[11px]">Degree & Major</span>
                  <span className="font-semibold text-[#111]">{user.degree || 'Not specified'}</span>
                </div>
                <div>
                  <span className="text-[#888] block text-[11px]">Expected Graduation</span>
                  <span className="font-semibold text-[#111]">{user.graduation_year || 'Not specified'}</span>
                </div>
                {user.phone && (
                  <div>
                    <span className="text-[#888] block text-[11px]">Phone</span>
                    <span className="font-semibold text-[#111]">{user.phone}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Hardware & Sandbox Card */}
            <div className="bg-gradient-to-br from-[#111] to-[#222] text-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2 text-[#E68A9E]">
                <Sparkles size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Zero-Trust Verification</span>
              </div>
              <h3 className="text-sm font-bold mb-1">Passive Forensics Enabled</h3>
              <p className="text-xs text-gray-300 mb-4 leading-relaxed">
                Your interviews are verified through camera PRNU sensor noise and rPPG biological pulse detection.
              </p>
              <div className="text-[11px] text-gray-400 bg-white/10 rounded-xl p-3">
                ✓ AWS Rekognition FaceCompare ready<br />
                ✓ Anti-Deepfake GPU jitter profiling<br />
                ✓ MediaPipe gaze & iris tracker
              </div>
            </div>
          </div>

          {/* Right Column: Invitations Feed */}
          <div className="lg:col-span-2 space-y-6">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h1 className="text-xl font-bold text-[#0F0F0F]">Interview Invitations</h1>
                  <p className="text-xs text-[#6B6B6B]">Direct session links received from verified recruiters</p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 bg-white border border-[#E0E0E0] rounded-full text-[#333]">
                  {invitations.length} Active
                </span>
              </div>

              {loading ? (
                <div className="bg-white border border-[#EAEAEA] rounded-2xl p-12 flex flex-col items-center justify-center text-center">
                  <Loader2 size={24} className="animate-spin text-[#A4123F] mb-3" />
                  <p className="text-xs text-[#666]">Loading your invitations...</p>
                </div>
              ) : error ? (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-xs text-[#991B1B] flex items-center gap-3">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              ) : invitations.length === 0 ? (
                <div className="bg-white border border-[#EAEAEA] rounded-2xl p-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3 text-gray-400">
                    <Mail size={22} />
                  </div>
                  <h3 className="text-sm font-bold text-[#0F0F0F] mb-1">Your inbox is clear</h3>
                  <p className="text-xs text-[#6B6B6B] max-w-sm mx-auto">
                    When a recruiter schedules an interview with you, your direct zero-trust session link will appear right here.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {invitations.map((inv) => (
                    <div
                      key={inv.invitation_id}
                      className="bg-white border border-[#EAEAEA] rounded-2xl p-6 shadow-sm hover:border-[#A4123F]/40 transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#FDF2F4] text-[#A4123F]">
                              {inv.role_title}
                            </span>
                            <span className="text-[11px] text-[#888] flex items-center gap-1">
                              <Clock size={12} /> {inv.duration} mins
                            </span>
                          </div>
                          <h3 className="text-base font-bold text-[#0F0F0F] flex items-center gap-2">
                            <Building2 size={16} className="text-[#6B6B6B]" />
                            {inv.recruiter_company}
                          </h3>
                          <p className="text-xs text-[#6B6B6B] mt-0.5">
                            Invited by <span className="font-semibold text-[#333]">{inv.recruiter_name}</span>
                          </p>
                        </div>

                        {/* Direct Join Action */}
                        <Link
                          to={`/check/${inv.session_token}`}
                          className="px-5 py-2.5 bg-[#A4123F] hover:bg-[#850E32] text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 shadow-sm hover:shadow transition-all shrink-0"
                        >
                          <Video size={14} />
                          Start System Check & Join
                          <ArrowRight size={14} />
                        </Link>
                      </div>

                      {inv.message && (
                        <div className="p-3 bg-[#F9F9F9] rounded-xl text-xs text-[#555] mb-3 italic border border-[#F0F0F0]">
                          "{inv.message}"
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[11px] text-[#888] pt-3 border-t border-[#F5F5F5]">
                        <span className="flex items-center gap-1">
                          <Calendar size={12} /> Received: {new Date(inv.created_at).toLocaleDateString()}
                        </span>
                        <span className="font-mono text-[10px] text-gray-400">
                          Session: {inv.session_id}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </main>

      <footer className="py-6 border-t border-[#EAEAEA] bg-white text-center text-xs text-[#888]">
        DeepVerify © 2026 · Standalone Zero-Trust Technical Interview Platform
      </footer>
    </div>
  )
}
