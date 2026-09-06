import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ShieldCheck, Building2, Search, Send, Users, Video,
  LogOut, Clock, Calendar, CheckCircle2, AlertCircle, Loader2,
  GraduationCap, ExternalLink, X, Sparkles
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

  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null)
  const [inviteRole, setInviteRole] = useState('Senior Software Engineer')
  const [inviteDuration, setInviteDuration] = useState(60)
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)

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
        clearAuth(); navigate('/auth/recruiter/login'); return
      }
      if (candRes.ok) setCandidates(await candRes.json())
      if (invRes.ok) setSentInvites(await invRes.json())
    } catch (err: any) {
      setError(err.message || 'Error loading dashboard data.')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) { loadData(); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/candidates/search?q=${encodeURIComponent(searchQuery.trim())}`, { headers: getAuthHeaders() })
      if (res.ok) setCandidates(await res.json())
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
    setInviteError('')
    try {
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ candidate_email: selectedCandidate.email, role_title: inviteRole, duration: Number(inviteDuration), message: inviteMessage || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed to send invitation.')
      setInviteSuccess(`Invitation sent successfully to ${selectedCandidate.full_name}!`)
      setSentInvites([data, ...sentInvites])
      setTimeout(() => { setSelectedCandidate(null); setInviteSuccess(''); setActiveTab('invitations') }, 1500)
    } catch (err: any) {
      setInviteError(err.message || 'Failed to send invite.')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleCancelInvite = async (invitationId: string) => {
    if (!window.confirm('Are you sure you want to cancel this invitation? The candidate will no longer be able to join with this link.')) {
      return
    }
    setCancellingId(invitationId)
    setError('')
    try {
      const res = await fetch(`/api/invitations/${invitationId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })
      if (res.ok) {
        setSentInvites((prev) =>
          prev.map((inv) =>
            inv.invitation_id === invitationId ? { ...inv, status: 'CANCELLED' } : inv
          )
        )
      } else {
        const data = await res.json()
        setError(data.detail || 'Failed to cancel invitation.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to cancel invitation.')
    } finally {
      setCancellingId(null)
    }
  }

  const handleLogout = () => { clearAuth(); navigate('/') }
  if (!user) return null

  return (
    <div className="min-h-screen bg-[#FAFAFB] relative overflow-x-hidden">

      {/* ── Page-level ambient orbs (same palette as landing) ── */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full bg-rose-300/15 blur-[110px] animate-blob" />
        <div className="absolute top-[30%] right-[-8%] w-[550px] h-[550px] rounded-full bg-indigo-200/10 blur-[120px] animate-blob-slow" />
        <div className="absolute bottom-[-10%] left-[25%] w-[700px] h-[700px] rounded-full bg-pink-200/15 blur-[140px] animate-blob" style={{ animationDelay: '2s' }} />
      </div>

      {/* ── Floating glass island Navbar ── */}
      <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
        <nav className="w-full max-w-[1100px] pointer-events-auto rounded-[1.25rem] bg-white/75 backdrop-blur-xl border border-white/80 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
          <div className="px-6 h-[4.5rem] flex items-center justify-between">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#A4123F] flex items-center justify-center shadow-sm">
                <ShieldCheck size={20} className="text-white" />
              </div>
              <div className="flex flex-col justify-center">
                <p className="text-[15px] font-bold text-[#0F0F0F] leading-tight">DeepVerify</p>
                <p className="text-[11px] font-medium text-[#888] leading-tight mt-0.5">Recruiter Console</p>
              </div>
            </Link>

            {/* Right: user info + logout */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#F7F7F8] border border-[#E4E4E6] text-xs">
                <Building2 size={13} className="text-[#A4123F]" />
                <span className="font-bold text-[#0F0F0F]">{user.company_name}</span>
                <span className="text-[#D0D0D3]">·</span>
                <span className="text-[#6B6B6B]">{user.full_name}</span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-[#F7F7F8] border border-transparent hover:border-[#E4E4E6] transition-all"
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        </nav>
      </div>

      {/* ── Main content ── */}
      <main className="relative z-10 max-w-[1100px] mx-auto px-4 pt-36 pb-16">

        {/* ── Page header ── */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8" style={{ animation: 'fadeUp 0.4s ease both' }}>
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#E4E4E6] bg-white/70 backdrop-blur-sm text-[11px] font-semibold text-[#A4123F] mb-3">
              <Sparkles size={11} />
              Company Portal · Zero-Trust
            </div>
            <h1 className="text-[30px] font-bold text-[#0F0F0F] tracking-[-0.03em] leading-tight">Recruiter Console</h1>
            <p className="text-sm text-[#6B6B6B] mt-1">Search verified candidate profiles and issue zero-trust interview sessions</p>
          </div>

          {/* Tab switcher — glass pill */}
          <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
            <button
              onClick={() => setActiveTab('directory')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'directory'
                  ? 'bg-[#0F0F0F] text-white shadow-sm'
                  : 'text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-white/80'
              }`}
            >
              <Users size={13} /> Verified Candidates ({candidates.length})
            </button>
            <button
              onClick={() => setActiveTab('invitations')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'invitations'
                  ? 'bg-[#0F0F0F] text-white shadow-sm'
                  : 'text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-white/80'
              }`}
            >
              <Send size={13} /> Sent Invitations ({sentInvites.length})
            </button>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 flex items-center gap-3 text-xs text-[#991B1B]">
            <AlertCircle size={15} /><span>{error}</span>
          </div>
        )}

        {/* ══════════════ TAB 1 — Candidate Directory ══════════════ */}
        {activeTab === 'directory' && (
          <div className="space-y-6" style={{ animation: 'fadeUp 0.35s ease both' }}>

            {/* Floating glass search bar */}
            <form onSubmit={handleSearch}>
              <div className="flex gap-3 p-2 rounded-2xl bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#AAAAAA]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search candidates by name, university, degree, or email..."
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-transparent outline-none text-[#0F0F0F] placeholder-[#AAAAAA]"
                  />
                </div>
                {searchQuery && (
                  <button type="button" onClick={() => { setSearchQuery(''); loadData() }}
                    className="px-3 py-2 rounded-xl text-xs font-semibold text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-white/80 transition-all">
                    Clear
                  </button>
                )}
                <button type="submit"
                  className="px-5 py-2.5 text-white text-xs font-semibold rounded-xl transition-all"
                  style={{ background: 'linear-gradient(135deg,#A4123F,#7A0D2E)', boxShadow: '0 4px 14px rgba(164,18,63,0.3)' }}>
                  Search
                </button>
              </div>
            </form>

            {/* Candidates grid */}
            {loading ? (
              <div className="rounded-2xl bg-white/50 backdrop-blur-xl border border-white/80 p-20 flex flex-col items-center justify-center text-center shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
                <Loader2 size={28} className="animate-spin text-[#A4123F] mb-3" />
                <p className="text-xs text-[#6B6B6B]">Loading candidate directory...</p>
              </div>
            ) : candidates.length === 0 ? (
              <div className="rounded-2xl bg-white/50 backdrop-blur-xl border border-white/80 p-20 text-center shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
                <GraduationCap size={32} className="text-[#D0D0D3] mx-auto mb-3" />
                <h3 className="text-sm font-bold text-[#0F0F0F] mb-1">No candidates found</h3>
                <p className="text-xs text-[#6B6B6B] max-w-xs mx-auto">
                  {searchQuery ? 'No candidates matched your search criteria.' : 'No candidate profiles have registered yet.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {candidates.map((cand, idx) => (
                  <div key={cand.user_id}
                    className="rounded-2xl bg-white/50 backdrop-blur-xl border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-300 p-5 flex flex-col justify-between"
                    style={{ animation: `fadeUp 0.3s ease both`, animationDelay: `${idx * 0.05}s` }}
                  >
                    <div>
                      <div className="flex items-start gap-3.5 mb-4">
                        {cand.profile_photo_url ? (
                          <img src={cand.profile_photo_url} alt={cand.full_name}
                            className="w-14 h-18 object-cover rounded-xl border-2 border-emerald-400 shadow-sm shrink-0" style={{ height: '72px' }} />
                        ) : (
                          <div className="w-14 rounded-xl bg-[#F7F7F8] flex items-center justify-center text-[#D0D0D3] shrink-0" style={{ height: '72px' }}>
                            <GraduationCap size={26} />
                          </div>
                        )}
                        <div className="overflow-hidden">
                          <h3 className="text-[15px] font-bold text-[#0F0F0F] truncate">{cand.full_name}</h3>
                          <p className="text-[11px] text-[#6B6B6B] truncate">{cand.email}</p>
                          <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-100">
                            <CheckCircle2 size={10} /> Face Enrolled
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1 text-xs text-[#444] bg-white/70 p-3 rounded-xl mb-4 border border-white/80">
                        <p className="truncate"><span className="text-[#9B9B9B]">College: </span><strong className="font-semibold">{cand.college || '—'}</strong></p>
                        <p className="truncate"><span className="text-[#9B9B9B]">Degree: </span><strong className="font-semibold">{cand.degree || '—'}</strong></p>
                        <p><span className="text-[#9B9B9B]">Class of: </span><strong className="font-semibold">{cand.graduation_year || '—'}</strong></p>
                      </div>
                    </div>

                    <button onClick={() => setSelectedCandidate(cand)}
                      className="w-full py-2.5 bg-[#0F0F0F] hover:bg-[#2A2A2A] text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm hover:shadow-md">
                      <Send size={13} /> Invite to Interview
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ TAB 2 — Sent Invitations ══════════════ */}
        {activeTab === 'invitations' && (
          <div className="space-y-4" style={{ animation: 'fadeUp 0.35s ease both' }}>
            {sentInvites.length === 0 ? (
              <div className="rounded-2xl bg-white/50 backdrop-blur-xl border border-white/80 p-20 text-center shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
                <Send size={32} className="text-[#D0D0D3] mx-auto mb-3" />
                <h3 className="text-sm font-bold text-[#0F0F0F] mb-1">No invitations sent yet</h3>
                <p className="text-xs text-[#6B6B6B] max-w-sm mx-auto">
                  Browse verified candidates in the directory to schedule your first interview session.
                </p>
              </div>
            ) : (
              sentInvites.map((inv, idx) => (
                <div key={inv.invitation_id}
                  className="rounded-2xl bg-white/50 backdrop-blur-xl border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.08)] transition-all p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  style={{ animation: `fadeUp 0.3s ease both`, animationDelay: `${idx * 0.04}s` }}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#FDF2F4] text-[#A4123F] border border-[#F9C4D0]">{inv.role_title}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        inv.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        inv.status === 'CANCELLED' ? 'bg-gray-100 text-gray-500 border border-gray-200' :
                        inv.status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                        'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        {inv.status}
                      </span>
                      <span className="text-[11px] text-[#9B9B9B] flex items-center gap-1"><Clock size={11} /> {inv.duration} mins</span>
                      <span className="text-[11px] text-[#9B9B9B] flex items-center gap-1"><Calendar size={11} /> {new Date(inv.created_at).toLocaleDateString()}</span>
                    </div>
                    <h3 className="text-[15px] font-bold text-[#0F0F0F]">{inv.candidate_name || inv.candidate_email}</h3>
                    <p className="text-xs text-[#6B6B6B]">Candidate: <span className="font-mono text-[#3A3A3A]">{inv.candidate_email}</span></p>
                    <p className="text-[10px] font-mono text-[#C0C0C0] mt-0.5">Session: {inv.session_id}</p>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                    {inv.status !== 'COMPLETED' && inv.status !== 'CANCELLED' && (
                      <button
                        onClick={() => handleCancelInvite(inv.invitation_id)}
                        disabled={cancellingId === inv.invitation_id}
                        className="px-3 py-2 bg-white/70 hover:bg-red-50 text-red-600 border border-red-200 hover:border-red-300 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all disabled:opacity-50"
                        title="Revoke and cancel this invitation"
                      >
                        {cancellingId === inv.invitation_id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <X size={13} />
                        )}
                        Cancel Invite
                      </button>
                    )}
                    <Link to={`/dashboard/${inv.session_id}`}
                      className="px-5 py-2.5 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shrink-0 transition-all"
                      style={{ background: 'linear-gradient(135deg,#0F0F0F,#2A2A2A)', boxShadow: '0 4px 14px rgba(15,15,15,0.2)' }}>
                      <Video size={13} /> Enter Forensic Dashboard <ExternalLink size={11} />
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 py-6 text-center text-[11px] text-[#C0C0C0]">
        DeepVerify © 2026 · Standalone Zero-Trust Technical Interview Platform
      </footer>

      {/* ══════════════ Invite Modal ══════════════ */}
      {selectedCandidate && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-md flex items-center justify-center p-4">
          <div
            className="w-full max-w-lg rounded-3xl p-7 relative"
            style={{
              background: 'rgba(255,255,255,0.75)',
              backdropFilter: 'blur(40px)',
              border: '1px solid rgba(255,255,255,0.9)',
              boxShadow: '0 32px 64px rgba(0,0,0,0.15)',
              animation: 'fadeUp 0.3s ease both',
            }}
          >
            <button onClick={() => { setSelectedCandidate(null); setInviteError(''); setInviteSuccess('') }}
              className="absolute top-5 right-5 w-8 h-8 rounded-xl bg-[#F7F7F8] hover:bg-[#EAEAEA] flex items-center justify-center text-[#6B6B6B] hover:text-[#0F0F0F] transition-all">
              <X size={16} />
            </button>

            <div className="flex items-center gap-3.5 mb-6 pb-5 border-b border-[#F0F0F0]">
              {selectedCandidate.profile_photo_url && (
                <img src={selectedCandidate.profile_photo_url} alt={selectedCandidate.full_name}
                  className="w-12 h-16 object-cover rounded-xl border-2 border-emerald-400 shadow-sm" style={{ height: '60px' }} />
              )}
              <div>
                <h3 className="text-[16px] font-bold text-[#0F0F0F]">Invite Candidate</h3>
                <p className="text-xs text-[#6B6B6B]">
                  Sending interview invitation to <strong className="text-[#111]">{selectedCandidate.full_name}</strong>
                </p>
              </div>
            </div>

            {inviteSuccess && (
              <div className="mb-4 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 size={15} /><span>{inviteSuccess}</span>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-[#991B1B] flex items-center gap-2">
                <AlertCircle size={15} /><span>{error}</span>
              </div>
            )}

            {inviteError && (
              <div className="mb-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2.5">
                <AlertCircle size={16} className="shrink-0 text-red-600 mt-0.5" />
                <div>
                  <p className="font-bold text-red-900">Cannot Send Invitation</p>
                  <p className="mt-0.5 text-red-700 leading-relaxed">{inviteError}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSendInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Candidate Email</label>
                <input type="email" disabled value={selectedCandidate.email}
                  className="w-full px-3.5 py-2.5 text-xs bg-[#F7F7F8] border border-[#E4E4E6] rounded-xl text-[#6B6B6B]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Position / Role Title <span className="text-red-500">*</span></label>
                <input type="text" required value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                  placeholder="e.g. Senior Frontend Engineer"
                  className="w-full px-3.5 py-2.5 text-xs bg-white/80 border border-[#D5D5D7] rounded-xl outline-none focus:border-[#A4123F] transition-all"
                  style={{ boxShadow: 'none' }} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Session Duration <span className="text-red-500">*</span></label>
                <select value={inviteDuration} onChange={e => setInviteDuration(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 text-xs bg-white/80 border border-[#D5D5D7] rounded-xl outline-none focus:border-[#A4123F] transition-all">
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                  <option value={90}>90 minutes</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Message for Candidate (Optional)</label>
                <textarea rows={3} value={inviteMessage} onChange={e => setInviteMessage(e.target.value)}
                  placeholder="Please be prepared for a live coding assessment in Python or TypeScript."
                  className="w-full px-3.5 py-2.5 text-xs bg-white/80 border border-[#D5D5D7] rounded-xl outline-none focus:border-[#A4123F] transition-all resize-none" />
              </div>

              <div className="pt-1 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setSelectedCandidate(null)}
                  className="px-4 py-2.5 text-xs font-semibold text-[#6B6B6B] hover:text-[#0F0F0F] rounded-xl hover:bg-[#F7F7F8] transition-all">
                  Cancel
                </button>
                <button type="submit" disabled={inviteLoading}
                  className="px-5 py-2.5 text-white text-xs font-semibold rounded-xl flex items-center gap-2 disabled:opacity-50 transition-all"
                  style={{ background: 'linear-gradient(135deg,#A4123F,#7A0D2E)', boxShadow: '0 4px 14px rgba(164,18,63,0.3)' }}>
                  {inviteLoading
                    ? <><Loader2 size={13} className="animate-spin" />Generating Session & Sending...</>
                    : <><Send size={13} />Send Interview Invitation</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
