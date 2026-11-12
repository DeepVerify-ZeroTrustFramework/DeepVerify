import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Building2, Calendar, Clock,
  ArrowRight, CheckCircle2, AlertCircle, Loader2,
  Mail, Video, Sparkles, GraduationCap, Phone, Lock,
  Home, Settings, Camera, MonitorCheck, UserCheck, ImageIcon, Sun, Wifi, AppWindow, MonitorOff,
  History, Inbox, Hash, ChevronRight, Circle,
} from 'lucide-react'
import { getAuthUser, clearAuth, getAuthHeaders, type AuthUser } from '../../utils/auth'
import DashShell from '../../components/dashboard/DashShell'
import Avatar from '../../components/dashboard/Avatar'
import ProfileSettings from '../../components/dashboard/ProfileSettings'
import { usePhotoStatus } from '../../components/dashboard/usePhotoStatus'

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

  // Portal UI state (display only)
  const [tab, setTab] = useState<'home' | 'interviews' | 'settings'>('home')
  const [me, setMe] = useState<AuthUser | null>(user)
  const [view, setView] = useState<'upcoming' | 'history'>('upcoming')
  const [history, setHistory] = useState<Invitation[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [hasCamera, setHasCamera] = useState<boolean | null>(null)
  const photo = usePhotoStatus((me || user)?.profile_photo_url)

  // Readiness: is any camera present? (enumerateDevices needs no permission prompt)
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.()
      .then(d => setHasCamera(d.some(x => x.kind === 'videoinput')))
      .catch(() => setHasCamera(null))
  }, [])

  // Past interviews: read-only fetch of the same endpoint including finished sessions
  const loadHistory = async () => {
    setHistoryLoading(true); setHistoryError('')
    try {
      const res = await fetch('/api/invitations/my?include_completed=true', { headers: getAuthHeaders() })
      if (res.status === 401) { clearAuth(); navigate('/auth/candidate/login'); return }
      if (!res.ok) throw new Error('Failed to load interview history.')
      const data: Invitation[] = await res.json()
      setHistory(data.filter(i => ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(i.status)))
    } catch (err: any) {
      setHistoryError(err.message || 'Could not load interview history.')
    } finally {
      setHistoryLoading(false)
    }
  }

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


  // ── Derived view data (display only) ──
  const profile = me || user
  const firstName = (profile.full_name || '').split(' ')[0] || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const next = invitations[0]
  const fmtDate = (d: string) => { const t = new Date(d); return isNaN(t.getTime()) ? '—' : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }
  const browserOk = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype
  const profileComplete = !!(profile.college && profile.degree && profile.graduation_year)
  const checks = [
    { ok: photo === 'ok', warn: photo === 'loading', icon: ImageIcon,
      title: photo === 'broken' ? 'Identity photo unavailable' : photo === 'none' ? 'Identity photo missing' : 'Identity photo enrolled',
      desc: photo === 'ok' ? 'Your reference photo is on file and loads correctly.'
        : photo === 'loading' ? 'Checking your reference photo…'
        : photo === 'broken' ? "Your saved photo can't be loaded. Re-upload it so interviews can verify you."
        : 'Upload a clear portrait in Settings.',
      fix: photo === 'broken' || photo === 'none' },
    { ok: profileComplete, icon: UserCheck, title: 'Academic profile complete', desc: profileComplete ? 'College, degree and year are filled in.' : 'Add your college, degree and year in Settings.', fix: !profileComplete },
    { ok: hasCamera === true, warn: hasCamera === null, icon: Camera, title: 'Camera detected', desc: hasCamera === true ? 'A camera is connected to this device.' : hasCamera === false ? 'No camera found. Connect a webcam before joining.' : 'Camera will be checked when you join.' },
    { ok: browserOk, icon: MonitorCheck, title: 'Browser supported', desc: browserOk ? 'Frame-timing verification is available.' : 'Use the latest Chrome or Edge for full verification.' },
  ]
  const readyCount = checks.filter(c => c.ok).length
  const statusChip = (s: string) =>
    s === 'COMPLETED' ? 'bg-[rgba(230,244,237,0.85)] text-[#1A6B3C] border-[#1A6B3C]/20' :
    s === 'CANCELLED' || s === 'EXPIRED' ? 'bg-[#141114]/[0.05] text-[#67636C] border-[#141114]/10' :
    s === 'IN_PROGRESS' ? 'bg-[rgba(219,234,254,0.85)] text-[#1D4ED8] border-[#1D4ED8]/20' :
    'bg-[rgba(254,243,199,0.85)] text-[#92400E] border-[#D97706]/25'
  const statusLabel = (s: string) => s === 'IN_PROGRESS' ? 'In progress' : s.charAt(0) + s.slice(1).toLowerCase()

  const TITLES: Record<typeof tab, [string, string]> = {
    home: [`${greeting}, ${firstName}`, invitations.length ? `You have ${invitations.length} interview${invitations.length > 1 ? 's' : ''} waiting.` : 'Your verified interview home.'],
    interviews: ['Interviews', 'Your zero-trust interview invitations from verified recruiters.'],
    settings: ['Settings', 'Manage your profile, identity photo, password and account.'],
  }

  const inviteCard = (inv: Invitation, idx: number, past = false) => (
    <div key={inv.invitation_id}
      className="rounded-[26px] glass liquid glass-hover p-6"
      style={{ animation: `fadeUp 0.3s ease both`, animationDelay: `${idx * 0.06}s` }}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar name={inv.recruiter_company} size={52} rounded={16} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="glass-chip !text-[11px] text-[#A4123F]">
                {inv.role_title}
              </span>
              <span className="text-[12px] text-[#85818A] flex items-center gap-1">
                <Clock size={12} /> {inv.duration} mins
              </span>
              {past && <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${statusChip(inv.status)}`}>{statusLabel(inv.status)}</span>}
            </div>
            <h3 className="text-[18px] font-bold text-[#141114] tracking-[-0.015em] flex items-center gap-2">
              <Building2 size={16} className="text-[#85818A]" />
              {inv.recruiter_company}
            </h3>
            <p className="text-[13.5px] text-[#67636C] mt-0.5">
              Invited by <span className="font-semibold text-[#2A262C]">{inv.recruiter_name}</span>
            </p>
          </div>
        </div>

        {!past && (
          <Link to={`/check/${inv.session_token}`}
            className="glass-btn-primary px-6 py-3 text-[14px] !rounded-full shrink-0">
            <Video size={15} /> Start System Check & Join <ArrowRight size={15} />
          </Link>
        )}
      </div>

      {inv.message && (
        <div className="mt-5 px-4 py-3.5 rounded-[16px] glass-soft text-[13.5px] text-[#4A464E] italic">
          "{inv.message}"
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-[#141114]/[0.07] flex items-center justify-between text-[12px] text-[#85818A]">
        <span className="flex items-center gap-1.5">
          <Calendar size={13} /> Received: {fmtDate(inv.created_at)}
        </span>
        <span className="font-mono text-[11px] flex items-center gap-1"><Hash size={12} />Session: {inv.session_id}</span>
      </div>
    </div>
  )

  return (
    <DashShell
      consoleName="Candidate Portal"
      items={[
        { key: 'home', label: 'Home', icon: Home },
        { key: 'interviews', label: 'Interviews', icon: Inbox, badge: invitations.length },
        { key: 'settings', label: 'Settings', icon: Settings },
      ]}
      active={tab}
      onSelect={setTab}
      userName={profile.full_name}
      userSub={profile.email}
      userPhoto={profile.profile_photo_url}
      onSignOut={handleLogout}
      title={TITLES[tab][0]}
      subtitle={TITLES[tab][1]}
      actions={tab === 'settings' ? undefined : (
        <span className="hidden md:inline-flex items-center gap-2 px-4 py-2.5 rounded-full glass text-[13px] font-semibold text-[#2A262C]">
          <span className="w-2 h-2 rounded-full bg-[#1A6B3C] live-dot" />
          {profile.email}
        </span>
      )}
    >
      {/* ══════════════ HOME ══════════════ */}
      {tab === 'home' && (
        <div className="space-y-5 intro-fade">
          {/* ── Row 1: identity strip ── */}
          <div className="rounded-[28px] glass-strong liquid p-5 sm:p-6 flex flex-wrap 2xl:flex-nowrap items-center gap-5 2xl:gap-6">
            <div className="flex items-center gap-4 min-w-0 flex-1 2xl:flex-none 2xl:w-[340px]">
              <div className="relative shrink-0">
                <Avatar src={profile.profile_photo_url} name={profile.full_name} size={72} rounded={22} ring={photo === 'ok'} />
                {photo === 'ok' && (
                  <span className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-[#1A6B3C] text-white inline-flex items-center justify-center shadow-[0_6px_14px_-6px_rgba(26,107,60,0.8)] border-2 border-white"><CheckCircle2 size={14} /></span>
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-[19px] font-bold text-[#141114] tracking-[-0.02em] truncate">{profile.full_name}</h2>
                <p className="text-[13px] text-[#67636C] truncate">{profile.email}</p>
                {photo === 'ok' ? (
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-[rgba(230,244,237,0.85)] text-[#1A6B3C] border-[#1A6B3C]/20">
                    <CheckCircle2 size={12} /> Ground Truth Enrolled
                  </div>
                ) : photo === 'loading' ? (
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-white/60 text-[#67636C] border-[#141114]/10">
                    <Loader2 size={12} className="animate-spin" /> Checking photo…
                  </div>
                ) : (
                  <button onClick={() => setTab('settings')} className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-[rgba(254,243,199,0.85)] text-[#92400E] border-[#D97706]/25 hover:bg-[rgba(254,243,199,1)]">
                    <AlertCircle size={12} /> {photo === 'broken' ? 'Photo unavailable — re-upload' : 'Identity photo needed'} <ArrowRight size={11} />
                  </button>
                )}
              </div>
            </div>

            <div className="hidden 2xl:block w-px self-stretch bg-[#141114]/[0.07]" />

            <div className="order-last 2xl:order-none basis-full 2xl:basis-auto grid grid-cols-2 lg:grid-cols-4 gap-3 flex-1 min-w-0">
              {[
                { icon: GraduationCap, label: 'College', value: profile.college || 'Not specified' },
                { icon: GraduationCap, label: 'Degree', value: profile.degree || 'Not specified' },
                { icon: Calendar, label: 'Graduating', value: profile.graduation_year || 'Not specified' },
                { icon: Phone, label: 'Phone', value: profile.phone || 'Not added' },
              ].map((row, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-[16px] glass-soft min-w-0">
                  <span className="glass-tile !w-9 !h-9 !rounded-[11px] text-[#A4123F] shrink-0"><row.icon size={15} /></span>
                  <div className="min-w-0">
                    <span className="glass-label !text-[9px] block truncate">{row.label}</span>
                    <span className="text-[13.5px] font-semibold text-[#141114] truncate block">{row.value}</span>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => setTab('settings')} className="glass-btn px-5 py-2.5 text-[13.5px] !rounded-full shrink-0">Edit profile <ArrowRight size={14} /></button>
          </div>

          {/* ── Row 2: next interview + readiness ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch">
            <div className="xl:col-span-2 flex">
              {loading ? (
                <div className="w-full rounded-[28px] glass-strong liquid p-14 flex flex-col items-center justify-center text-center">
                  <Loader2 size={28} className="animate-spin text-[#A4123F] mb-3" />
                  <p className="text-[14px] text-[#67636C]">Loading your invitations...</p>
                </div>
              ) : error ? (
                <div className="w-full rounded-[22px] bg-[rgba(254,226,226,0.7)] border border-[#FCA5A5]/60 p-6 text-[14px] text-[#991B1B] flex items-center gap-3">
                  <AlertCircle size={17} /><span>{error}</span>
                </div>
              ) : next ? (
                <div className="w-full rounded-[30px] glass-dark liquid p-7 sm:p-8 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-5">
                      <span className="w-2 h-2 rounded-full bg-[#4ADE80] live-dot" />
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/60">Next interview</span>
                    </div>
                    <h2 className="text-[clamp(26px,2.6vw,36px)] font-bold text-white tracking-[-0.03em] leading-tight">{next.role_title}</h2>
                    <p className="mt-2 text-[15px] text-white/70 flex items-center gap-2 flex-wrap"><Building2 size={16} /> {next.recruiter_company} <span className="text-white/30">·</span> {next.recruiter_name}</p>
                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-[12.5px] text-white/85"><Clock size={13} /> {next.duration} minutes</span>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-[12.5px] text-white/85"><Calendar size={13} /> Received {fmtDate(next.created_at)}</span>
                    </div>
                    {next.message && <p className="mt-5 px-4 py-3.5 rounded-[16px] bg-white/[0.06] border border-white/10 text-[13.5px] text-white/75 italic">"{next.message}"</p>}
                  </div>
                  <div className="mt-7 flex items-center justify-between gap-4 flex-wrap">
                    <Link to={`/check/${next.session_token}`} className="glass-btn !bg-white/95 !text-[#141114] px-6 py-3.5 text-[14.5px] !rounded-full">
                      <Video size={16} /> Start System Check & Join <ArrowRight size={16} />
                    </Link>
                    {invitations.length > 1 && (
                      <button onClick={() => setTab('interviews')} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/70 hover:text-white">
                        +{invitations.length - 1} more invitation{invitations.length > 2 ? 's' : ''} <ChevronRight size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-full rounded-[28px] glass-strong liquid p-7 sm:p-8 flex flex-col justify-between gap-7">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-6">
                  <span className="glass-tile !w-16 !h-16 !rounded-[20px] text-[#A4123F] shrink-0"><Mail size={26} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="glass-label mb-1.5">Next interview</p>
                    <h3 className="text-[20px] font-bold text-[#141114] tracking-[-0.02em] mb-1">Your inbox is clear</h3>
                    <p className="text-[14px] text-[#67636C] leading-relaxed max-w-[520px]">
                      When a recruiter schedules an interview with you, your direct zero-trust session link will appear right here.
                    </p>
                    <div className="mt-5 flex items-center gap-2.5 flex-wrap">
                      <button onClick={() => { setTab('interviews'); setView('history'); if (history === null && !historyLoading) loadHistory() }} className="glass-btn px-4 py-2 text-[13px] !rounded-full"><History size={14} /> View past interviews</button>
                      <button onClick={() => setTab('settings')} className="glass-btn px-4 py-2 text-[13px] !rounded-full"><UserCheck size={14} /> Complete your profile</button>
                    </div>
                  </div>
                  </div>
                  <div>
                    <p className="glass-label !text-[10px] mb-3">What happens next</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { n: '01', icon: Mail, t: 'A recruiter invites you', d: 'The invitation appears here with the role and duration.' },
                        { n: '02', icon: MonitorCheck, t: 'Run the system check', d: 'Enrol your camera and confirm your identity photo.' },
                        { n: '03', icon: Video, t: 'Join a verified interview', d: 'Your session is checked live for deepfakes and proxies.' },
                      ].map(st => (
                        <div key={st.n} className="relative p-4 rounded-[18px] glass-soft">
                          <div className="flex items-center justify-between mb-3">
                            <span className="glass-tile !w-9 !h-9 !rounded-[11px] text-[#A4123F]"><st.icon size={16} /></span>
                            <span className="font-mono text-[11px] font-semibold text-[#A29FA6]">{st.n}</span>
                          </div>
                          <p className="text-[13.5px] font-semibold text-[#141114]">{st.t}</p>
                          <p className="text-[12px] text-[#67636C] mt-0.5 leading-snug">{st.d}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Readiness */}
            <div className="rounded-[28px] glass liquid p-6 flex flex-col">
              <div className="flex items-center gap-4 mb-5">
                <div className="relative w-14 h-14 shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(20,17,20,0.08)" strokeWidth="3.5" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#1A6B3C" strokeWidth="3.5" strokeLinecap="round"
                      strokeDasharray={97.4} strokeDashoffset={97.4 - 97.4 * (readyCount / checks.length)} style={{ transition: 'stroke-dashoffset .8s ease' }} />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-[#141114] tabular-nums">{readyCount}/{checks.length}</span>
                </div>
                <div className="min-w-0">
                  <p className="glass-label mb-1">Interview readiness</p>
                  <p className="text-[13.5px] text-[#67636C] leading-snug">{readyCount === checks.length ? "You're all set for your next interview." : 'A few things to check before you join.'}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 flex-1">
                {checks.map(c => (
                  <div key={c.title} className="flex items-center gap-3 px-3.5 py-3 rounded-[16px] glass-soft">
                    <span className={`glass-tile !w-9 !h-9 !rounded-[11px] shrink-0 ${c.ok ? 'text-[#1A6B3C]' : c.warn ? 'text-[#85818A]' : 'text-[#B45309]'}`}><c.icon size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold text-[#141114] truncate">{c.title}</p>
                      <p className="text-[12px] text-[#67636C] leading-snug">{c.desc}</p>
                    </div>
                    {c.ok ? <CheckCircle2 size={17} className="text-[#1A6B3C] shrink-0" />
                      : c.fix ? <button onClick={() => setTab('settings')} className="glass-link !text-[12px] !font-semibold !text-[#A4123F] shrink-0">Fix <ArrowRight size={12} /></button>
                      : c.warn ? <Circle size={15} className="text-[#A29FA6] shrink-0" />
                      : <AlertCircle size={17} className="text-[#B45309] shrink-0" />}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Row 3: tips + verification ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch">
            <div className="xl:col-span-2 rounded-[28px] glass liquid p-6 flex flex-col">
              <p className="glass-label mb-4">Before you join</p>
              <div className="grid grid-cols-1 md:grid-cols-2 md:auto-rows-fr gap-3 flex-1">
                {[
                  { icon: Sun, t: 'Face a light source', d: 'Even lighting on your face keeps the pulse signal clean.' },
                  { icon: Wifi, t: 'Stable connection', d: 'A steady network keeps video and timing checks smooth.' },
                  { icon: AppWindow, t: 'Close camera apps', d: 'Zoom, Teams or OBS can lock or replace your camera.' },
                  { icon: MonitorOff, t: 'No virtual cameras', d: 'Use your real webcam — virtual cameras are flagged.' },
                ].map(x => (
                  <div key={x.t} className="flex items-center gap-4 p-5 rounded-[18px] glass-soft">
                    <span className="glass-tile !w-10 !h-10 !rounded-[12px] text-[#A4123F] shrink-0"><x.icon size={17} /></span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-[#141114]">{x.t}</p>
                      <p className="text-[12.5px] text-[#67636C] mt-0.5 leading-snug">{x.d}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Zero-trust verification */}
            <div className="rounded-[28px] glass-dark liquid p-6 flex flex-col">
              <div className="flex items-center gap-2 mb-3 text-[#F4AABE]">
                <Sparkles size={15} />
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em]">Zero-Trust Verification</span>
              </div>
              <h3 className="text-[17px] font-bold text-white mb-1.5">Passive Forensics Enabled</h3>
              <p className="text-[13px] text-white/55 mb-4 leading-relaxed">
                Your interviews are verified through camera PRNU sensor noise and rPPG biological pulse detection.
              </p>
              <div className="space-y-2">
                {[
                  'AWS Rekognition FaceCompare ready',
                  'Anti-Deepfake GPU jitter profiling',
                  'MediaPipe gaze & iris tracker',
                ].map(t => (
                  <div key={t} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[14px] bg-white/[0.06] border border-white/10 text-[12.5px] text-white/75">
                    <CheckCircle2 size={14} className="text-[#4ADE80]" /> {t}
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-4 flex items-center gap-1.5 text-[11.5px] text-white/40">
                <Lock size={12} /> End-to-end session integrity
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ INTERVIEWS ══════════════ */}
      {tab === 'interviews' && (
        <div className="space-y-5 intro-fade">
          <div className="flex items-center gap-1 p-1.5 rounded-full glass w-fit">
            {([['upcoming', 'Upcoming', Inbox, invitations.length], ['history', 'History', History, history?.length]] as const).map(([k, label, Icon, n]) => (
              <button key={k} onClick={() => { setView(k); if (k === 'history' && history === null && !historyLoading) loadHistory() }}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-[13.5px] font-semibold transition-all ${view === k ? 'bg-white/95 text-[#141114] shadow-[inset_0_1px_0_#fff,0_6px_16px_-8px_rgba(20,14,18,0.35)]' : 'text-[#67636C] hover:text-[#141114]'}`}>
                <Icon size={15} /> {label}
                {n !== undefined && <span className={`min-w-[20px] px-1.5 h-5 inline-flex items-center justify-center rounded-full text-[11px] ${view === k ? 'bg-[#A4123F] text-white' : 'bg-[#141114]/[0.06] text-[#55515A]'}`}>{n}</span>}
              </button>
            ))}
          </div>

          {view === 'upcoming' && (
            loading ? (
              <div className="rounded-[28px] glass liquid p-16 flex flex-col items-center justify-center text-center">
                <Loader2 size={28} className="animate-spin text-[#A4123F] mb-3" />
                <p className="text-[14px] text-[#67636C]">Loading your invitations...</p>
              </div>
            ) : error ? (
              <div className="rounded-[22px] bg-[rgba(254,226,226,0.7)] border border-[#FCA5A5]/60 p-6 text-[14px] text-[#991B1B] flex items-center gap-3">
                <AlertCircle size={17} /><span>{error}</span>
              </div>
            ) : invitations.length === 0 ? (
              <div className="rounded-[28px] glass liquid p-16 text-center">
                <span className="glass-tile !w-14 !h-14 text-[#85818A] mb-4"><Mail size={24} /></span>
                <h3 className="text-[16px] font-bold text-[#141114] mb-1.5">Your inbox is clear</h3>
                <p className="text-[14px] text-[#67636C] max-w-xs mx-auto leading-relaxed">
                  When a recruiter schedules an interview with you, your direct zero-trust session link will appear right here.
                </p>
              </div>
            ) : (
              <div className="space-y-4">{invitations.map((inv, idx) => inviteCard(inv, idx))}</div>
            )
          )}

          {view === 'history' && (
            historyLoading ? (
              <div className="rounded-[28px] glass liquid p-16 flex flex-col items-center justify-center text-center">
                <Loader2 size={28} className="animate-spin text-[#A4123F] mb-3" />
                <p className="text-[14px] text-[#67636C]">Loading your interview history...</p>
              </div>
            ) : historyError ? (
              <div className="rounded-[22px] bg-[rgba(254,226,226,0.7)] border border-[#FCA5A5]/60 p-6 text-[14px] text-[#991B1B] flex items-center gap-3">
                <AlertCircle size={17} /><span>{historyError}</span>
                <button onClick={loadHistory} className="ml-auto glass-btn px-4 py-1.5 text-[13px] !rounded-full">Retry</button>
              </div>
            ) : !history || history.length === 0 ? (
              <div className="rounded-[28px] glass liquid p-16 text-center">
                <span className="glass-tile !w-14 !h-14 text-[#85818A] mb-4"><History size={24} /></span>
                <h3 className="text-[16px] font-bold text-[#141114] mb-1.5">No past interviews yet</h3>
                <p className="text-[14px] text-[#67636C] max-w-xs mx-auto leading-relaxed">Completed, cancelled and expired interviews will be listed here.</p>
              </div>
            ) : (
              <div className="space-y-4">{history.map((inv, idx) => inviteCard(inv, idx, true))}</div>
            )
          )}
        </div>
      )}

      {/* ══════════════ SETTINGS ══════════════ */}
      {tab === 'settings' && (
        <div className="intro-fade">
          <ProfileSettings user={profile} onUpdated={setMe} onSignOut={handleLogout} />
        </div>
      )}
    </DashShell>
  )
}
