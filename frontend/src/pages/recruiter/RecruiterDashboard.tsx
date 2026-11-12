import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Building2, Search, Send, Users, Video,
  Clock, Calendar, CheckCircle2, AlertCircle, Loader2,
  GraduationCap, ExternalLink, X, LayoutDashboard, Settings, ArrowRight,
  Activity, CircleDot, Ban, RefreshCw, Play, Hash, ChevronRight, Download, FileText,
} from 'lucide-react'
import { downloadReport } from '../../utils/downloadReport'
import { getAuthUser, clearAuth, getAuthHeaders, type AuthUser } from '../../utils/auth'
import DashShell from '../../components/dashboard/DashShell'
import Avatar from '../../components/dashboard/Avatar'
import ProfileSettings from '../../components/dashboard/ProfileSettings'

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

  const [activeTab, setActiveTab] = useState<'overview' | 'directory' | 'invitations' | 'settings'>('overview')
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
  // Completed interviews: download the PDF report (the live dashboard is closed for them)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState('')
  const handleDownloadReport = async (sessionId: string) => {
    if (downloadingId) return
    setDownloadingId(sessionId)
    setDownloadError('')
    try {
      await downloadReport(sessionId)
    } catch (e: any) {
      setDownloadError(e?.message || 'Could not download the report')
    } finally {
      setDownloadingId(null)
    }
  }

  // Dashboard UI state (display only)
  const [me, setMe] = useState<AuthUser | null>(user)
  const [invFilter, setInvFilter] = useState<'ALL' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'>('ALL')
  const [invQuery, setInvQuery] = useState('')

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


  // ── Derived view data (display only) ──
  const profile = me || user
  const firstName = (profile.full_name || '').split(' ')[0] || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const isActive = (s: string) => s !== 'COMPLETED' && s !== 'CANCELLED' && s !== 'EXPIRED'
  const counts = {
    ALL: sentInvites.length,
    PENDING: sentInvites.filter(i => i.status === 'PENDING' || i.status === 'ACCEPTED').length,
    IN_PROGRESS: sentInvites.filter(i => i.status === 'IN_PROGRESS').length,
    COMPLETED: sentInvites.filter(i => i.status === 'COMPLETED').length,
    CANCELLED: sentInvites.filter(i => i.status === 'CANCELLED' || i.status === 'EXPIRED').length,
  }
  const activeCount = sentInvites.filter(i => isActive(i.status)).length
  const visibleInvites = sentInvites.filter(i => {
    const f = invFilter === 'ALL' ? true
      : invFilter === 'PENDING' ? (i.status === 'PENDING' || i.status === 'ACCEPTED')
      : invFilter === 'CANCELLED' ? (i.status === 'CANCELLED' || i.status === 'EXPIRED')
      : i.status === invFilter
    const q = invQuery.trim().toLowerCase()
    return f && (!q || [i.candidate_name, i.candidate_email, i.role_title, i.session_id].some(v => (v || '').toLowerCase().includes(q)))
  })
  const statusChip = (s: string) =>
    s === 'COMPLETED' ? 'bg-[rgba(230,244,237,0.85)] text-[#1A6B3C] border-[#1A6B3C]/20' :
    s === 'CANCELLED' || s === 'EXPIRED' ? 'bg-[#141114]/[0.05] text-[#67636C] border-[#141114]/10' :
    s === 'IN_PROGRESS' ? 'bg-[rgba(219,234,254,0.85)] text-[#1D4ED8] border-[#1D4ED8]/20' :
    'bg-[rgba(254,243,199,0.85)] text-[#92400E] border-[#D97706]/25'
  const statusLabel = (s: string) => s === 'IN_PROGRESS' ? 'In progress' : s.charAt(0) + s.slice(1).toLowerCase()
  const fmtDate = (d: string) => { const t = new Date(d); return isNaN(t.getTime()) ? '—' : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }
  const pipeline = [
    { k: 'Pending', n: counts.PENDING, c: '#D97706' },
    { k: 'In progress', n: counts.IN_PROGRESS, c: '#2563EB' },
    { k: 'Completed', n: counts.COMPLETED, c: '#1A6B3C' },
    { k: 'Cancelled', n: counts.CANCELLED, c: '#A8A4AC' },
  ]

  const TITLES: Record<typeof activeTab, [string, string]> = {
    overview: [`${greeting}, ${firstName}`, `Here's what's happening at ${profile.company_name || 'your company'} today.`],
    directory: ['Verified candidates', 'Search face-enrolled candidate profiles and invite them to a zero-trust interview.'],
    invitations: ['Invitations', 'Track every interview you have issued and jump into its live forensic dashboard.'],
    settings: ['Settings', 'Manage your profile, password and account.'],
  }

  const kpi = (Icon: React.ElementType, label: string, value: number | string, sub: string, tone: string) => (
    <div key={label} className="rounded-[24px] glass liquid p-5 glass-hover">
      <div className="flex items-start justify-between mb-5">
        <span className="glass-tile !w-11 !h-11" style={{ color: tone }}><Icon size={19} /></span>
        <span className="glass-label !text-[9.5px]">{label}</span>
      </div>
      <p className="text-[34px] font-bold text-[#141114] tracking-[-0.04em] leading-none tabular-nums">{loading ? '—' : value}</p>
      <p className="mt-2 text-[12.5px] text-[#85818A]">{sub}</p>
    </div>
  )

  const inviteRow = (inv: SentInvitation, compact = false) => (
    <div key={inv.invitation_id} className={`flex flex-col md:flex-row md:items-center gap-4 ${compact ? 'py-3.5' : 'p-5 rounded-[22px] glass liquid glass-hover'}`}>
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        <Avatar name={inv.candidate_name || inv.candidate_email} size={compact ? 38 : 46} rounded={compact ? 12 : 14} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`${compact ? 'text-[14px]' : 'text-[15.5px]'} font-semibold text-[#141114] truncate`}>{inv.candidate_name || inv.candidate_email}</h3>
            <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${statusChip(inv.status)}`}>{statusLabel(inv.status)}</span>
          </div>
          <p className="text-[12.5px] text-[#67636C] truncate">{inv.role_title}{!compact && <> · <span className="font-mono">{inv.candidate_email}</span></>}</p>
        </div>
      </div>
      {!compact && (
        <div className="flex items-center gap-4 text-[12px] text-[#85818A] md:w-[300px] shrink-0">
          <span className="flex items-center gap-1.5"><Clock size={13} /> {inv.duration} mins</span>
          <span className="flex items-center gap-1.5"><Calendar size={13} /> {fmtDate(inv.created_at)}</span>
          <span className="hidden xl:flex items-center gap-1 font-mono text-[11px] text-[#A29FA6] truncate"><Hash size={12} />{inv.session_id}</span>
        </div>
      )}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {!compact && inv.status !== 'COMPLETED' && inv.status !== 'CANCELLED' && (
          <button
            onClick={() => handleCancelInvite(inv.invitation_id)}
            disabled={cancellingId === inv.invitation_id}
            className="glass-btn px-4 py-2 text-[13px] !rounded-full !text-[#B91C1C] disabled:opacity-50"
            title="Revoke and cancel this invitation"
          >
            {cancellingId === inv.invitation_id ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <X size={14} />
            )}
            Cancel Invite
          </button>
        )}
        {inv.status === 'COMPLETED' ? (
          <>
            {!compact && (
              <Link to={`/dashboard/${inv.session_id}`}
                className="glass-btn px-4 py-2 text-[13px] !rounded-full"
                title="View the interview summary">
                <FileText size={14} /> Summary
              </Link>
            )}
            <button
              type="button"
              onClick={() => handleDownloadReport(inv.session_id)}
              disabled={downloadingId === inv.session_id}
              className={compact ? 'glass-icon-btn !w-9 !h-9 !rounded-[11px] !text-[#A4123F] disabled:opacity-60' : 'glass-btn-primary px-4 py-2 text-[13px] !rounded-full disabled:opacity-60'}
              title="Download the forensic PDF report">
              {downloadingId === inv.session_id
                ? <Loader2 size={compact ? 15 : 14} className="animate-spin" />
                : <Download size={compact ? 15 : 14} />}
              {!compact && (downloadingId === inv.session_id ? 'Preparing...' : 'Download PDF Report')}
            </button>
          </>
        ) : (
          <Link to={`/dashboard/${inv.session_id}`}
            className={compact ? 'glass-icon-btn !w-9 !h-9 !rounded-[11px]' : 'btn-graphite px-4 py-2 text-[13px] !rounded-full'}
            title="Enter Forensic Dashboard">
            {compact ? <ChevronRight size={16} /> : <><Video size={14} /> Enter Forensic Dashboard <ExternalLink size={12} /></>}
          </Link>
        )}
      </div>
    </div>
  )

  return (
    <DashShell
      consoleName="Recruiter Console"
      items={[
        { key: 'overview', label: 'Overview', icon: LayoutDashboard },
        { key: 'directory', label: 'Candidates', icon: Users, badge: candidates.length },
        { key: 'invitations', label: 'Invitations', icon: Send, badge: activeCount },
        { key: 'settings', label: 'Settings', icon: Settings },
      ]}
      active={activeTab}
      onSelect={setActiveTab}
      userName={profile.full_name}
      userSub={[profile.designation, profile.company_name].filter(Boolean).join(' · ')}
      userPhoto={profile.profile_photo_url}
      onSignOut={handleLogout}
      title={TITLES[activeTab][0]}
      subtitle={TITLES[activeTab][1]}
      actions={activeTab === 'settings' ? undefined : (
        <>
          <span className="hidden md:inline-flex items-center gap-2 px-4 py-2.5 rounded-full glass text-[13px] font-semibold text-[#141114]">
            <Building2 size={15} className="text-[#A4123F]" /> {profile.company_name}
          </span>
          <button onClick={loadData} title="Refresh" className="glass-icon-btn !w-11 !h-11 !rounded-full"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          {activeTab !== 'directory' && (
            <button onClick={() => setActiveTab('directory')} className="glass-btn-primary px-5 py-2.5 text-[14px] !rounded-full">
              <Send size={15} /> Invite a candidate
            </button>
          )}
        </>
      )}
    >
      {/* ── Error ── */}
      {error && (
        <div className="mb-6 p-4 rounded-[18px] bg-[rgba(254,226,226,0.7)] border border-[#FCA5A5]/60 flex items-center gap-3 text-[13px] text-[#991B1B]">
          <AlertCircle size={16} /><span>{error}</span>
        </div>
      )}
      {downloadError && (
        <div className="mb-6 p-4 rounded-[18px] bg-[rgba(254,226,226,0.7)] border border-[#FCA5A5]/60 flex items-center gap-3 text-[13px] text-[#991B1B]">
          <AlertCircle size={16} /><span className="flex-1">{downloadError}</span>
          <button type="button" onClick={() => setDownloadError('')} className="glass-icon-btn !w-7 !h-7 !rounded-full"><X size={13} /></button>
        </div>
      )}

      {/* ══════════════ OVERVIEW ══════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-6 intro-fade">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {kpi(Users, 'Verified', candidates.length, 'Face-enrolled candidates', '#A4123F')}
            {kpi(Send, 'Issued', sentInvites.length, 'Invitations sent in total', '#141114')}
            {kpi(Activity, 'Active', activeCount, 'Pending or in progress', '#2563EB')}
            {kpi(CheckCircle2, 'Completed', counts.COMPLETED, `${counts.CANCELLED} cancelled or expired`, '#1A6B3C')}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Pipeline */}
            <div className="xl:col-span-2 rounded-[28px] glass-strong liquid p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="glass-label mb-1">Interview pipeline</p>
                  <p className="text-[14px] text-[#67636C]">Where every invitation stands right now</p>
                </div>
                <button onClick={() => setActiveTab('invitations')} className="glass-link">View all <ArrowRight size={14} /></button>
              </div>
              <div className="h-3.5 rounded-full bg-[#141114]/[0.06] overflow-hidden flex shadow-[inset_0_1px_2px_rgba(20,14,18,0.08)]">
                {sentInvites.length > 0 && pipeline.map(p => p.n > 0 && (
                  <div key={p.k} className="h-full transition-all duration-700" style={{ width: `${(p.n / sentInvites.length) * 100}%`, background: p.c }} />
                ))}
              </div>
              <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                {pipeline.map(p => (
                  <div key={p.k} className="p-4 rounded-[18px] glass-soft">
                    <div className="flex items-center gap-2 mb-1.5"><span className="w-2 h-2 rounded-full" style={{ background: p.c }} /><span className="text-[12px] font-semibold text-[#67636C]">{p.k}</span></div>
                    <p className="text-[24px] font-bold text-[#141114] tabular-nums leading-none">{p.n}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-5 border-t border-[#141114]/[0.07] grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  ['Completion rate', (() => { const d = sentInvites.length - counts.CANCELLED; return d > 0 ? `${Math.round((counts.COMPLETED / d) * 100)}%` : '—' })(), 'of non-cancelled invitations'],
                  ['Avg. session length', sentInvites.length ? `${Math.round(sentInvites.reduce((a, i) => a + (Number(i.duration) || 0), 0) / sentInvites.length)} min` : '—', 'scheduled per interview'],
                  ['Most interviewed role', (() => { const m: Record<string, number> = {}; sentInvites.forEach(i => { m[i.role_title] = (m[i.role_title] || 0) + 1 }); const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return top ? top[0] : '—' })(), 'across all invitations'],
                ].map(([k, v, sub]) => (
                  <div key={k} className="min-w-0">
                    <p className="glass-label !text-[9.5px] mb-1.5">{k}</p>
                    <p className="text-[20px] font-bold text-[#141114] tracking-[-0.02em] truncate">{v}</p>
                    <p className="text-[12px] text-[#85818A]">{sub}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick actions */}
            <div className="rounded-[28px] glass-dark liquid p-6 flex flex-col">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/55 mb-4">Quick actions</p>
              <div className="flex flex-col gap-2">
                {[
                  { icon: Search, label: 'Find a verified candidate', go: () => setActiveTab('directory') },
                  { icon: Send, label: 'Review sent invitations', go: () => setActiveTab('invitations') },
                  { icon: Settings, label: 'Edit company profile', go: () => setActiveTab('settings') },
                ].map(a => (
                  <button key={a.label} onClick={a.go} className="flex items-center gap-3 px-3.5 py-3 rounded-[16px] bg-white/[0.06] border border-white/10 hover:bg-white/[0.11] transition-colors text-left">
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded-[11px] bg-white/10 text-white"><a.icon size={16} /></span>
                    <span className="flex-1 text-[13.5px] font-semibold text-white">{a.label}</span>
                    <ChevronRight size={16} className="text-white/50" />
                  </button>
                ))}
                <Link to="/demo" className="flex items-center gap-3 px-3.5 py-3 rounded-[16px] bg-white/[0.06] border border-white/10 hover:bg-white/[0.11] transition-colors">
                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-[11px] bg-[#A4123F] text-white"><Play size={15} /></span>
                  <span className="flex-1 text-[13.5px] font-semibold text-white">Open the live demo</span>
                  <ChevronRight size={16} className="text-white/50" />
                </Link>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            {/* Recent invitations */}
            <div className="xl:col-span-3 rounded-[28px] glass liquid p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="glass-label">Recent invitations</p>
                <button onClick={() => setActiveTab('invitations')} className="glass-link">See all <ArrowRight size={14} /></button>
              </div>
              {sentInvites.length === 0 ? (
                <div className="py-10 text-center">
                  <span className="glass-tile !w-12 !h-12 text-[#85818A] mb-3"><Send size={20} /></span>
                  <p className="text-[14px] font-semibold text-[#141114]">No invitations yet</p>
                  <p className="text-[13px] text-[#85818A]">Invite a verified candidate to start your first session.</p>
                </div>
              ) : (
                <div className="divide-y divide-[#141114]/[0.06]">
                  {sentInvites.slice(0, 5).map(inv => inviteRow(inv, true))}
                </div>
              )}
            </div>

            {/* Newest candidates */}
            <div className="xl:col-span-2 rounded-[28px] glass liquid p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="glass-label">Verified candidates</p>
                <button onClick={() => setActiveTab('directory')} className="glass-link">Browse <ArrowRight size={14} /></button>
              </div>
              {candidates.length === 0 ? (
                <div className="py-10 text-center">
                  <span className="glass-tile !w-12 !h-12 text-[#85818A] mb-3"><GraduationCap size={20} /></span>
                  <p className="text-[14px] font-semibold text-[#141114]">No candidates yet</p>
                  <p className="text-[13px] text-[#85818A]">Verified candidates appear here once they enrol.</p>
                </div>
              ) : (
                <div className="divide-y divide-[#141114]/[0.06]">
                  {candidates.slice(0, 5).map(c => (
                    <div key={c.user_id} className="flex items-center gap-3 py-3.5">
                      <Avatar src={c.profile_photo_url} name={c.full_name} size={38} rounded={12} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-semibold text-[#141114] truncate">{c.full_name}</p>
                        <p className="text-[12.5px] text-[#67636C] truncate">{[c.degree, c.college].filter(Boolean).join(' · ') || c.email}</p>
                      </div>
                      <button onClick={() => setSelectedCandidate(c)} className="glass-btn px-3.5 py-1.5 text-[12.5px] !rounded-full">Invite</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ TAB 1 — Candidate Directory ══════════════ */}
      {activeTab === 'directory' && (
        <div className="space-y-6 intro-fade">

          {/* Glass search bar */}
          <form onSubmit={handleSearch}>
            <div className="flex gap-2.5 p-2 rounded-[22px] glass-strong liquid">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9A979E]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search candidates by name, university, degree, or email..."
                  className="w-full pl-12 pr-4 py-3.5 text-[15px] bg-transparent outline-none text-[#141114] placeholder-[#A29FA6]"
                />
              </div>
              {searchQuery && (
                <button type="button" onClick={() => { setSearchQuery(''); loadData() }}
                  className="glass-btn px-4 text-[13.5px] !rounded-[16px]">
                  Clear
                </button>
              )}
              <button type="submit"
                className="glass-btn-primary px-7 text-[14px] !rounded-[16px]">
                Search
              </button>
            </div>
          </form>

          {/* Candidates grid */}
          {loading ? (
            <div className="rounded-[28px] glass liquid p-20 flex flex-col items-center justify-center text-center">
              <Loader2 size={30} className="animate-spin text-[#A4123F] mb-3" />
              <p className="text-[14px] text-[#67636C]">Loading candidate directory...</p>
            </div>
          ) : candidates.length === 0 ? (
            <div className="rounded-[28px] glass liquid p-20 text-center">
              <span className="glass-tile !w-14 !h-14 text-[#85818A] mb-4"><GraduationCap size={24} /></span>
              <h3 className="text-[16px] font-bold text-[#141114] mb-1">No candidates found</h3>
              <p className="text-[14px] text-[#67636C] max-w-xs mx-auto">
                {searchQuery ? 'No candidates matched your search criteria.' : 'No candidate profiles have registered yet.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {candidates.map((cand, idx) => (
                <div key={cand.user_id}
                  className="rounded-[26px] glass liquid glass-hover p-6 flex flex-col justify-between"
                  style={{ animation: `fadeUp 0.35s ease both`, animationDelay: `${idx * 0.05}s` }}
                >
                  <div>
                    <div className="flex items-start gap-4 mb-5">
                      <Avatar src={cand.profile_photo_url} name={cand.full_name} size={60} rounded={18} ring />
                      <div className="overflow-hidden pt-0.5">
                        <h3 className="text-[16.5px] font-bold text-[#141114] tracking-[-0.015em] truncate">{cand.full_name}</h3>
                        <p className="text-[12.5px] text-[#67636C] truncate">{cand.email}</p>
                        <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[rgba(230,244,237,0.85)] text-[#1A6B3C] text-[11px] font-semibold border border-[#1A6B3C]/20">
                          <CheckCircle2 size={12} /> Face Enrolled
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mb-5">
                      {[['College', cand.college], ['Degree', cand.degree], ['Class of', cand.graduation_year]].map(([k, v]) => (
                        <div key={k} className="px-3 py-2.5 rounded-[14px] glass-soft min-w-0">
                          <p className="glass-label !text-[9px] mb-1">{k}</p>
                          <p className="text-[13px] font-semibold text-[#141114] truncate">{v || '—'}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button onClick={() => setSelectedCandidate(cand)}
                    className="btn-graphite w-full py-3 text-[14px] !rounded-[16px]">
                    <Send size={15} /> Invite to Interview
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════ TAB 2 — Sent Invitations ══════════════ */}
      {activeTab === 'invitations' && (
        <div className="space-y-5 intro-fade">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
            <div className="flex items-center gap-1 p-1.5 rounded-full glass overflow-x-auto">
              {([['ALL', 'All', CircleDot], ['PENDING', 'Pending', Clock], ['IN_PROGRESS', 'In progress', Activity], ['COMPLETED', 'Completed', CheckCircle2], ['CANCELLED', 'Cancelled', Ban]] as const).map(([k, label, Icon]) => (
                <button key={k} onClick={() => setInvFilter(k)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold whitespace-nowrap transition-all ${invFilter === k ? 'bg-white/95 text-[#141114] shadow-[inset_0_1px_0_#fff,0_6px_16px_-8px_rgba(20,14,18,0.35)]' : 'text-[#67636C] hover:text-[#141114]'}`}>
                  <Icon size={14} /> {label}
                  <span className={`min-w-[20px] px-1.5 h-5 inline-flex items-center justify-center rounded-full text-[11px] ${invFilter === k ? 'bg-[#A4123F] text-white' : 'bg-[#141114]/[0.06] text-[#55515A]'}`}>{counts[k]}</span>
                </button>
              ))}
            </div>
            <div className="relative lg:w-[340px]">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9A979E]" />
              <input value={invQuery} onChange={e => setInvQuery(e.target.value)} placeholder="Filter by name, email, role or session…"
                className="auth-input !pl-11 !py-3 !text-[14px] !rounded-full" />
            </div>
          </div>

          {sentInvites.length === 0 ? (
            <div className="rounded-[28px] glass liquid p-20 text-center">
              <span className="glass-tile !w-14 !h-14 text-[#85818A] mb-4"><Send size={22} /></span>
              <h3 className="text-[16px] font-bold text-[#141114] mb-1">No invitations sent yet</h3>
              <p className="text-[14px] text-[#67636C] max-w-sm mx-auto">
                Browse verified candidates in the directory to schedule your first interview session.
              </p>
            </div>
          ) : visibleInvites.length === 0 ? (
            <div className="rounded-[28px] glass liquid p-14 text-center">
              <p className="text-[15px] font-semibold text-[#141114] mb-1">No invitations match this filter</p>
              <button onClick={() => { setInvFilter('ALL'); setInvQuery('') }} className="glass-link mt-1">Clear filters</button>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleInvites.map((inv, idx) => (
                <div key={inv.invitation_id} style={{ animation: `fadeUp 0.3s ease both`, animationDelay: `${idx * 0.04}s` }}>
                  {inviteRow(inv)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════ SETTINGS ══════════════ */}
      {activeTab === 'settings' && (
        <div className="intro-fade">
          <ProfileSettings user={profile} onUpdated={setMe} onSignOut={handleLogout} />
        </div>
      )}

      {/* ══════════════ Invite Modal ══════════════ */}
      {selectedCandidate && (
        <div className="fixed inset-0 z-50 bg-[#141114]/25 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-xl rounded-[32px] glass-strong liquid p-8 relative" style={{ animation: 'fadeUp 0.3s ease both' }}>
            <button onClick={() => { setSelectedCandidate(null); setInviteError(''); setInviteSuccess('') }}
              className="absolute top-6 right-6 glass-icon-btn !w-9 !h-9 !rounded-[11px]">
              <X size={16} />
            </button>

            <div className="flex items-center gap-4 mb-7 pb-6 border-b border-[#141114]/[0.07]">
              <Avatar src={selectedCandidate.profile_photo_url} name={selectedCandidate.full_name} size={56} rounded={16} ring />
              <div>
                <h3 className="text-[20px] font-bold text-[#141114] tracking-[-0.02em]">Invite Candidate</h3>
                <p className="text-[13.5px] text-[#67636C]">
                  Sending interview invitation to <strong className="text-[#141114]">{selectedCandidate.full_name}</strong>
                </p>
              </div>
            </div>

            {inviteSuccess && (
              <div className="mb-5 p-3.5 rounded-[14px] bg-[rgba(230,244,237,0.8)] border border-[#1A6B3C]/20 text-[13px] text-[#1A6B3C] flex items-center gap-2">
                <CheckCircle2 size={16} /><span>{inviteSuccess}</span>
              </div>
            )}

            {error && (
              <div className="mb-5 p-3.5 rounded-[14px] bg-[rgba(254,226,226,0.7)] border border-[#FCA5A5]/60 text-[13px] text-[#991B1B] flex items-center gap-2">
                <AlertCircle size={16} /><span>{error}</span>
              </div>
            )}

            {inviteError && (
              <div className="mb-5 p-4 rounded-[14px] bg-[rgba(254,226,226,0.7)] border border-[#FCA5A5]/60 text-[13px] text-[#991B1B] flex items-start gap-2.5">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Cannot Send Invitation</p>
                  <p className="mt-0.5 leading-relaxed">{inviteError}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSendInvite} className="space-y-5">
              <div>
                <label className="auth-label">Candidate Email</label>
                <input type="email" disabled value={selectedCandidate.email}
                  className="auth-input !bg-white/35 !text-[#67636C] cursor-not-allowed" />
              </div>
              <div>
                <label className="auth-label">Position / Role Title <span className="text-[#A4123F]">*</span></label>
                <input type="text" required value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                  placeholder="e.g. Senior Frontend Engineer"
                  className="auth-input focus:!border-[#A4123F]/50 focus:shadow-[0_0_0_4px_rgba(164,18,63,0.10)]" />
              </div>
              <div>
                <label className="auth-label">Session Duration <span className="text-[#A4123F]">*</span></label>
                <select value={inviteDuration} onChange={e => setInviteDuration(Number(e.target.value))}
                  className="auth-input focus:!border-[#A4123F]/50">
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                  <option value={90}>90 minutes</option>
                </select>
              </div>
              <div>
                <label className="auth-label">Message for Candidate (Optional)</label>
                <textarea rows={3} value={inviteMessage} onChange={e => setInviteMessage(e.target.value)}
                  placeholder="Please be prepared for a live coding assessment in Python or TypeScript."
                  className="auth-input resize-none focus:!border-[#A4123F]/50 focus:shadow-[0_0_0_4px_rgba(164,18,63,0.10)]" />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setSelectedCandidate(null)}
                  className="glass-btn px-5 py-2.5 text-[14px] !rounded-full">
                  Cancel
                </button>
                <button type="submit" disabled={inviteLoading}
                  className="glass-btn-primary px-6 py-2.5 text-[14px] !rounded-full disabled:opacity-50">
                  {inviteLoading
                    ? <><Loader2 size={15} className="animate-spin" />Generating Session & Sending...</>
                    : <><Send size={15} />Send Interview Invitation</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashShell>
  )
}
