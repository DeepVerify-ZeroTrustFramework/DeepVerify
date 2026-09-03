import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { 
  ShieldCheck, Building2, Search, Send, Users, Video, 
  LogOut, Clock, Calendar, CheckCircle2, AlertCircle, Loader2, 
  GraduationCap, ExternalLink, X
} from 'lucide-react'
import { getAuthUser, clearAuth, getAuthHeaders } from '../../utils/auth'

interface Candidate {
  user_id: string
  full_name: string
  email: string
  college?: string
  degree?: string
  graduation_year?: string
  profile_photo_url?: string
}

interface SentInvitation {
  invitation_id: string
  candidate_email: string
  candidate_name?: string
  session_id: string
  session_token: string
  interviewer_token?: string
  role_title: string
  duration: number
  message?: string
  status: string
  created_at: string
}

export default function RecruiterDashboard() {
  const navigate = useNavigate()
  const user = getAuthUser()

  const [activeTab, setActiveTab] = useState<'directory' | 'invitations'>('directory')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [sentInvites, setSentInvites] = useState<SentInvitation[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Invite Modal State
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null)
  const [inviteRole, setInviteRole] = useState('Senior Software Engineer')
  const [inviteDuration, setInviteDuration] = useState(60)
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState('')

  useEffect(() => {
    if (!user || user.role !== 'recruiter') {
      navigate('/auth/recruiter/login', { replace: true })
      return
    }

    loadData()
  }, [navigate])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [candRes, invRes] = await Promise.all([
        fetch('/api/candidates', { headers: getAuthHeaders() }),
        fetch('/api/invitations/sent', { headers: getAuthHeaders() }),
      ])

      if (candRes.status === 401 || invRes.status === 401) {
        clearAuth()
        navigate('/auth/recruiter/login')
        return
      }

      if (candRes.ok) {
        const candData = await candRes.json()
        setCandidates(candData)
      }

      if (invRes.ok) {
        const invData = await invRes.json()
        setSentInvites(invData)
      }
    } catch (err: any) {
      setError(err.message || 'Error loading dashboard data.')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) {
      loadData()
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/candidates/search?q=${encodeURIComponent(searchQuery.trim())}`, {
        headers: getAuthHeaders(),
      })
      if (res.ok) {
        const data = await res.json()
        setCandidates(data)
      }
    } catch (err: any) {
      setError(err.message || 'Search failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCandidate) return

    setInviteLoading(true)
    setInviteSuccess('')
    setError('')

    try {
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          candidate_email: selectedCandidate.email,
          role_title: inviteRole,
          duration: Number(inviteDuration),
          message: inviteMessage || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to send invitation.')
      }

      setInviteSuccess(`Invitation sent successfully to ${selectedCandidate.full_name}!`)
      setSentInvites([data, ...sentInvites])
      setTimeout(() => {
        setSelectedCandidate(null)
        setInviteSuccess('')
        setActiveTab('invitations')
      }, 1500)
    } catch (err: any) {
      setError(err.message || 'Failed to send invite.')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleLogout = () => {
    clearAuth()
    navigate('/')
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col">
      {/* Navigation */}
      <nav className="bg-white border-b border-[#EAEAEA] sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#A4123F] flex items-center justify-center">
              <ShieldCheck size={18} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#0F0F0F] leading-tight">DeepVerify</p>
              <p className="text-[10px] text-[#6B6B6B] leading-tight">Company Portal</p>
            </div>
          </Link>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-[#F5F5F5] rounded-full text-xs text-[#555]">
              <Building2 size={12} className="text-[#A4123F]" />
              <span className="font-semibold text-[#111]">{user.company_name}</span>
              <span className="text-gray-400">·</span>
              <span>{user.full_name}</span>
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        
        {/* Top Header & Tab Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#0F0F0F]">Recruiter Console</h1>
            <p className="text-xs text-[#6B6B6B]">Search verified candidate profiles and issue zero-trust interview sessions</p>
          </div>

          <div className="flex items-center gap-2 bg-white border border-[#E0E0E0] p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('directory')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'directory'
                  ? 'bg-[#0F0F0F] text-white shadow-sm'
                  : 'text-[#666] hover:text-[#0F0F0F]'
              }`}
            >
              <Users size={14} />
              Verified Candidates ({candidates.length})
            </button>
            <button
              onClick={() => setActiveTab('invitations')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'invitations'
                  ? 'bg-[#0F0F0F] text-white shadow-sm'
                  : 'text-[#666] hover:text-[#0F0F0F]'
              }`}
            >
              <Send size={14} />
              Sent Invitations ({sentInvites.length})
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3 text-xs text-[#991B1B]">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Tab 1: Candidates Directory */}
        {activeTab === 'directory' && (
          <div className="space-y-6">
            {/* Search Bar */}
            <form onSubmit={handleSearch} className="flex gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search candidates by name, university, degree, or email..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#D5D5D7] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
                />
              </div>
              <button
                type="submit"
                className="px-5 py-2.5 bg-[#A4123F] hover:bg-[#850E32] text-white text-xs font-semibold rounded-xl transition-colors"
              >
                Search
              </button>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    loadData()
                  }}
                  className="px-4 py-2.5 bg-white border border-[#D5D5D7] text-xs font-semibold text-[#666] hover:text-[#111] rounded-xl"
                >
                  Clear
                </button>
              )}
            </form>

            {/* Candidates Grid */}
            {loading ? (
              <div className="bg-white border border-[#EAEAEA] rounded-2xl p-16 flex flex-col items-center justify-center text-center">
                <Loader2 size={28} className="animate-spin text-[#A4123F] mb-3" />
                <p className="text-xs text-[#666]">Loading candidate directory...</p>
              </div>
            ) : candidates.length === 0 ? (
              <div className="bg-white border border-[#EAEAEA] rounded-2xl p-16 text-center">
                <GraduationCap size={32} className="text-gray-400 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-[#0F0F0F] mb-1">No candidates found</h3>
                <p className="text-xs text-[#6B6B6B] max-w-sm mx-auto">
                  {searchQuery ? 'No candidates matched your search criteria.' : 'No candidate profiles have registered yet.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {candidates.map((cand) => (
                  <div
                    key={cand.user_id}
                    className="bg-white border border-[#EAEAEA] rounded-2xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start gap-4 mb-4">
                        {cand.profile_photo_url ? (
                          <img
                            src={cand.profile_photo_url}
                            alt={cand.full_name}
                            className="w-16 h-20 object-cover rounded-xl border border-emerald-500 shadow-sm shrink-0"
                          />
                        ) : (
                          <div className="w-16 h-20 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">
                            <GraduationCap size={28} />
                          </div>
                        )}
                        <div className="overflow-hidden">
                          <h3 className="text-base font-bold text-[#0F0F0F] truncate">{cand.full_name}</h3>
                          <p className="text-xs text-[#6B6B6B] truncate">{cand.email}</p>
                          <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold">
                            <CheckCircle2 size={10} /> Face Enrolled
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs text-[#444] bg-[#FAFAFA] p-3 rounded-xl mb-4 border border-[#F0F0F0]">
                        <p className="truncate">
                          <span className="text-[#888]">College:</span> <strong className="font-semibold">{cand.college || '—'}</strong>
                        </p>
                        <p className="truncate">
                          <span className="text-[#888]">Degree:</span> <strong className="font-semibold">{cand.degree || '—'}</strong>
                        </p>
                        <p>
                          <span className="text-[#888]">Class of:</span> <strong className="font-semibold">{cand.graduation_year || '—'}</strong>
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => setSelectedCandidate(cand)}
                      className="w-full py-2.5 bg-[#0F0F0F] hover:bg-[#2A2A2A] text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
                    >
                      <Send size={14} />
                      Invite to Interview
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Sent Invitations */}
        {activeTab === 'invitations' && (
          <div className="space-y-4">
            {sentInvites.length === 0 ? (
              <div className="bg-white border border-[#EAEAEA] rounded-2xl p-16 text-center">
                <Send size={32} className="text-gray-400 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-[#0F0F0F] mb-1">No invitations sent yet</h3>
                <p className="text-xs text-[#6B6B6B] max-w-sm mx-auto">
                  Browse verified candidates in the directory to schedule your first interview session.
                </p>
              </div>
            ) : (
              sentInvites.map((inv) => (
                <div
                  key={inv.invitation_id}
                  className="bg-white border border-[#EAEAEA] rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#FDF2F4] text-[#A4123F]">
                        {inv.role_title}
                      </span>
                      <span className="text-[11px] text-[#888] flex items-center gap-1">
                        <Clock size={12} /> {inv.duration} mins
                      </span>
                      <span className="text-[11px] text-[#888] flex items-center gap-1">
                        <Calendar size={12} /> {new Date(inv.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-[#0F0F0F]">
                      {inv.candidate_name || inv.candidate_email}
                    </h3>
                    <p className="text-xs text-[#6B6B6B]">
                      Candidate email: <span className="font-mono text-gray-700">{inv.candidate_email}</span>
                    </p>
                    <p className="text-[11px] font-mono text-gray-400 mt-1">
                      Session ID: {inv.session_id}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <Link
                      to={`/dashboard/${inv.session_id}`}
                      className="px-5 py-2.5 bg-[#0F0F0F] hover:bg-[#2A2A2A] text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm transition-colors"
                    >
                      <Video size={14} />
                      Enter Forensic Dashboard
                      <ExternalLink size={12} />
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

      </main>

      {/* Invite Modal */}
      {selectedCandidate && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white border border-[#EAEAEA] rounded-2xl p-6 shadow-2xl relative">
            <button
              onClick={() => setSelectedCandidate(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 p-1"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[#F0F0F0]">
              {selectedCandidate.profile_photo_url && (
                <img
                  src={selectedCandidate.profile_photo_url}
                  alt={selectedCandidate.full_name}
                  className="w-12 h-14 object-cover rounded-lg border border-emerald-500"
                />
              )}
              <div>
                <h3 className="text-base font-bold text-[#0F0F0F]">Invite Candidate</h3>
                <p className="text-xs text-[#6B6B6B]">
                  Sending interview invitation to <strong className="text-[#111]">{selectedCandidate.full_name}</strong>
                </p>
              </div>
            </div>

            {inviteSuccess && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 size={16} />
                <span>{inviteSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSendInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1">
                  Candidate Email
                </label>
                <input
                  type="email"
                  disabled
                  value={selectedCandidate.email}
                  className="w-full px-3.5 py-2 text-xs bg-gray-100 border border-[#D5D5D7] rounded-xl text-gray-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1">
                  Position / Role Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  placeholder="e.g. Senior Frontend Engineer"
                  className="w-full px-3.5 py-2.5 text-xs bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1">
                  Session Duration <span className="text-red-500">*</span>
                </label>
                <select
                  value={inviteDuration}
                  onChange={(e) => setInviteDuration(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 text-xs bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
                >
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                  <option value={90}>90 minutes</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1">
                  Custom Message for Candidate (Optional)
                </label>
                <textarea
                  rows={3}
                  value={inviteMessage}
                  onChange={(e) => setInviteMessage(e.target.value)}
                  placeholder="Please be prepared for a 45-minute live coding assessment in Python or TypeScript."
                  className="w-full px-3.5 py-2 text-xs bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedCandidate(null)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviteLoading}
                  className="px-5 py-2.5 bg-[#A4123F] hover:bg-[#850E32] text-white text-xs font-semibold rounded-xl flex items-center gap-2 disabled:opacity-50"
                >
                  {inviteLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Generating Session & Sending...
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      Send Interview Invitation
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <footer className="py-6 border-t border-[#EAEAEA] bg-white text-center text-xs text-[#888]">
        DeepVerify © 2026 · Standalone Zero-Trust Technical Interview Platform
      </footer>
    </div>
  )
}
