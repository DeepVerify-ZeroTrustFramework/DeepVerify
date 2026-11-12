import { useMemo, useRef, useState } from 'react'
import { User, KeyRound, BadgeCheck, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, LogOut, Mail, Copy, Check, Camera, Upload, X, ShieldAlert } from 'lucide-react'
import { getAuthHeaders, getAuthToken, setAuth, type AuthUser } from '../../utils/auth'
import Avatar from './Avatar'

type Field = { key: keyof AuthUser; label: string; placeholder?: string; type?: string; full?: boolean }

const FIELDS: Record<'recruiter' | 'candidate', Field[]> = {
  recruiter: [
    { key: 'full_name', label: 'Full name', placeholder: 'Alex Mercer' },
    { key: 'phone', label: 'Phone', placeholder: '+91 90000 00000', type: 'tel' },
    { key: 'company_name', label: 'Company', placeholder: 'TechCorp Global' },
    { key: 'designation', label: 'Designation / role', placeholder: 'Senior Technical Recruiter' },
  ],
  candidate: [
    { key: 'full_name', label: 'Full name', placeholder: 'Jane Doe' },
    { key: 'phone', label: 'Phone', placeholder: '+91 90000 00000', type: 'tel' },
    { key: 'college', label: 'College / university', placeholder: 'Amrita Vishwa Vidyapeetham' },
    { key: 'degree', label: 'Degree & major', placeholder: 'B.Tech Computer Science' },
    { key: 'graduation_year', label: 'Graduation year', placeholder: '2027' },
  ],
}

type Section = 'profile' | 'security' | 'account'

/** Settings panel shared by recruiter and candidate dashboards. */
export default function ProfileSettings({ user, onUpdated, onSignOut }: {
  user: AuthUser; onUpdated: (u: AuthUser) => void; onSignOut: () => void
}) {
  const [section, setSection] = useState<Section>('profile')
  const fields = FIELDS[user.role] || FIELDS.recruiter
  const initial = useMemo(() => Object.fromEntries(fields.map(f => [f.key, (user[f.key] as string) || ''])), [user, fields])
  const [form, setForm] = useState<Record<string, string>>(initial)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const dirty = fields.some(f => (form[f.key] ?? '') !== (initial[f.key] ?? ''))

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // Profile photo
  const fileRef = useRef<HTMLInputElement>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoMsg, setPhotoMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [currentPhotoBroken, setCurrentPhotoBroken] = useState(false)

  const pickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setPhotoMsg(null)
    if (!/^image\/(jpeg|png)$/.test(f.type)) { setPhotoMsg({ ok: false, text: 'Please choose a JPG or PNG image.' }); return }
    if (f.size > 10 * 1024 * 1024) { setPhotoMsg({ ok: false, text: 'That image is larger than 10 MB. Please choose a smaller one.' }); return }
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(f)
    setPhotoPreview(URL.createObjectURL(f))
  }
  const cancelPhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoFile(null); setPhotoPreview(null)
  }
  const uploadPhoto = async () => {
    if (!photoFile) return
    setPhotoUploading(true); setPhotoMsg(null)
    try {
      const fd = new FormData()
      fd.append('photo', photoFile)
      const res = await fetch('/api/auth/photo', { method: 'POST', headers: getAuthHeaders(), body: fd })
      let data: any = {}
      try { data = await res.json() } catch { throw new Error(`Server returned status ${res.status}.`) }
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.detail?.message || 'Could not update your photo.')
      const updated: AuthUser = { ...user, ...data }
      const token = getAuthToken()
      if (token) setAuth(token, updated)
      onUpdated(updated)
      cancelPhoto()
      setCurrentPhotoBroken(false)
      setPhotoMsg({ ok: true, text: 'Profile photo updated.' })
    } catch (err: any) {
      setPhotoMsg({ ok: false, text: err.message || 'Could not update your photo.' })
    } finally { setPhotoUploading(false) }
  }

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setMsg(null)
    try {
      const body: Record<string, string> = {}
      fields.forEach(f => { if ((form[f.key] ?? '') !== (initial[f.key] ?? '') && (form[f.key] ?? '').trim()) body[f.key] = form[f.key] })
      const res = await fetch('/api/auth/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(body) })
      let data: any = {}
      try { data = await res.json() } catch { throw new Error(`Server returned status ${res.status}.`) }
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.detail?.[0]?.msg || 'Could not save your changes.')
      const updated: AuthUser = { ...user, ...data }
      const token = getAuthToken()
      if (token) setAuth(token, updated)
      onUpdated(updated)
      setMsg({ ok: true, text: 'Profile updated.' })
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || 'Could not save your changes.' })
    } finally { setSaving(false) }
  }

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwMsg(null)
    if (pw.next.length < 6) { setPwMsg({ ok: false, text: 'New password must be at least 6 characters.' }); return }
    if (pw.next !== pw.confirm) { setPwMsg({ ok: false, text: 'New passwords do not match.' }); return }
    setPwSaving(true)
    try {
      const res = await fetch('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ current_password: pw.current, new_password: pw.next }) })
      let data: any = {}
      try { data = await res.json() } catch { throw new Error(`Server returned status ${res.status}.`) }
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.detail?.[0]?.msg || 'Could not change your password.')
      setPw({ current: '', next: '', confirm: '' })
      setPwMsg({ ok: true, text: 'Password changed. Use it next time you sign in.' })
    } catch (err: any) {
      setPwMsg({ ok: false, text: err.message || 'Could not change your password.' })
    } finally { setPwSaving(false) }
  }

  const strength = (() => {
    const p = pw.next; let s = 0
    if (p.length >= 6) s++; if (p.length >= 10) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++
    return s
  })()
  const memberSince = user.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—'

  const NAV: { key: Section; label: string; icon: React.ElementType; desc: string }[] = [
    { key: 'profile', label: 'Profile', icon: User, desc: 'Name and contact details' },
    { key: 'security', label: 'Security', icon: KeyRound, desc: 'Password' },
    { key: 'account', label: 'Account', icon: BadgeCheck, desc: 'Account information' },
  ]

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-6 items-start">
      {/* Section nav */}
      <div className="rounded-[24px] glass liquid p-2.5 flex xl:flex-col gap-1 overflow-x-auto">
        {NAV.map(n => (
          <button key={n.key} onClick={() => setSection(n.key)}
            className={`flex items-center gap-3 px-3 py-3 rounded-[16px] text-left transition-all min-w-[180px] xl:min-w-0 ${section === n.key ? 'bg-white/90 shadow-[inset_0_1px_0_#fff,0_8px_20px_-10px_rgba(20,14,18,0.3)]' : 'hover:bg-white/40'}`}>
            <span className={`glass-tile !w-9 !h-9 !rounded-[11px] ${section === n.key ? 'text-[#A4123F]' : 'text-[#67636C]'}`}><n.icon size={16} /></span>
            <span>
              <span className={`block text-[14px] font-semibold ${section === n.key ? 'text-[#141114]' : 'text-[#4A464E]'}`}>{n.label}</span>
              <span className="block text-[11.5px] text-[#85818A]">{n.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {/* ── Profile ── */}
      {section === 'profile' && (
        <form onSubmit={saveProfile} className="rounded-[28px] glass-strong liquid p-7 sm:p-8">
          <div className="pb-6 mb-6 border-b border-[#141114]/[0.07]">
            <div className="flex flex-wrap items-center gap-5">
              <div className="relative group">
                {photoPreview
                  ? <img src={photoPreview} alt="New profile photo preview" className="w-[88px] h-[88px] rounded-[24px] object-cover ring-2 ring-[#A4123F]/40 ring-offset-2 ring-offset-white/60" />
                  : <Avatar src={currentPhotoBroken ? null : user.profile_photo_url} name={form.full_name || user.full_name} size={88} rounded={24} />}
                {/* probe: detect a current photo that fails to load */}
                {user.profile_photo_url && !photoPreview && !currentPhotoBroken && (
                  <img src={user.profile_photo_url} alt="" className="hidden" onError={() => setCurrentPhotoBroken(true)} />
                )}
                <button type="button" onClick={() => fileRef.current?.click()} disabled={photoUploading}
                  title="Change photo"
                  className="absolute -bottom-2 -right-2 glass-icon-btn !w-9 !h-9 !rounded-full !text-[#A4123F] shadow-[0_6px_16px_-6px_rgba(20,14,18,0.45)]">
                  <Camera size={16} />
                </button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={pickPhoto} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[20px] font-bold text-[#141114] tracking-[-0.02em] truncate">{form.full_name || user.full_name}</p>
                <p className="text-[13.5px] text-[#67636C] truncate">
                  {user.role === 'recruiter' ? [form.designation, form.company_name].filter(Boolean).join(' · ') : [form.degree, form.college].filter(Boolean).join(' · ')}
                </p>
                {!photoFile && (
                  <button type="button" onClick={() => fileRef.current?.click()} className="glass-link mt-2 !text-[13px] !font-semibold !text-[#A4123F]">
                    <Upload size={14} /> {user.profile_photo_url && !currentPhotoBroken ? 'Change profile photo' : 'Upload a profile photo'}
                  </button>
                )}
              </div>
              {photoFile && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={cancelPhoto} disabled={photoUploading} className="glass-btn px-4 py-2 text-[13.5px] !rounded-full"><X size={14} /> Cancel</button>
                  <button type="button" onClick={uploadPhoto} disabled={photoUploading} className="glass-btn-primary px-5 py-2 text-[13.5px] !rounded-full">
                    {photoUploading ? <><Loader2 size={14} className="animate-spin" /> Uploading…</> : <><Upload size={14} /> Upload photo</>}
                  </button>
                </div>
              )}
            </div>
            <p className="mt-4 text-[12.5px] text-[#85818A] leading-relaxed flex items-start gap-2">
              {user.role === 'candidate'
                ? <><ShieldAlert size={15} className="text-[#A4123F] shrink-0 mt-0.5" /><span>This photo is your <strong className="text-[#2A262C]">identity reference</strong>: during interviews your live face is compared against it. Use a clear, front-facing portrait with only your face in frame (JPG or PNG).</span></>
                : <span>Use a clear, front-facing portrait with only your face in frame (JPG or PNG, up to 10 MB).</span>}
            </p>
            {currentPhotoBroken && !photoFile && (
              <p className="mt-2 text-[12.5px] text-[#92400E]">Your current photo couldn't be loaded. Uploading a new one will replace it.</p>
            )}
            {photoMsg && (
              <div className={`mt-4 p-3.5 rounded-[14px] flex items-center gap-2.5 text-[13px] border ${photoMsg.ok ? 'bg-[rgba(230,244,237,0.75)] border-[#1A6B3C]/20 text-[#1A6B3C]' : 'bg-[rgba(254,226,226,0.7)] border-[#FCA5A5]/60 text-[#991B1B]'}`}>
                {photoMsg.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {photoMsg.text}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {fields.map(f => (
              <div key={f.key} className={f.full ? 'md:col-span-2' : ''}>
                <label className="auth-label" htmlFor={`pf-${f.key}`}>{f.label}</label>
                <input id={`pf-${f.key}`} type={f.type || 'text'} value={form[f.key] ?? ''} placeholder={f.placeholder}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  className="auth-input focus:!border-[#A4123F]/50 focus:shadow-[0_0_0_4px_rgba(164,18,63,0.10)]" />
              </div>
            ))}
            <div className="md:col-span-2">
              <label className="auth-label" htmlFor="pf-email">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9A979E]" />
                <input id="pf-email" type="email" value={user.email} disabled className="auth-input !pl-11 !bg-white/35 !text-[#67636C] cursor-not-allowed" />
              </div>
              <p className="mt-1.5 text-[12px] text-[#85818A]">Your email is your sign-in ID and can't be changed here.</p>
            </div>
          </div>

          {msg && (
            <div className={`mt-6 p-3.5 rounded-[14px] flex items-center gap-2.5 text-[13px] border ${msg.ok ? 'bg-[rgba(230,244,237,0.75)] border-[#1A6B3C]/20 text-[#1A6B3C]' : 'bg-[rgba(254,226,226,0.7)] border-[#FCA5A5]/60 text-[#991B1B]'}`}>
              {msg.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {msg.text}
            </div>
          )}

          <div className="mt-7 pt-6 border-t border-[#141114]/[0.07] flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[13px] text-[#85818A]">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</p>
            <div className="flex items-center gap-2.5">
              <button type="button" disabled={!dirty || saving} onClick={() => { setForm(initial); setMsg(null) }} className="glass-btn px-5 py-2.5 text-[14px] !rounded-full">Discard</button>
              <button type="submit" disabled={!dirty || saving} className="glass-btn-primary px-6 py-2.5 text-[14px] !rounded-full">
                {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ── Security ── */}
      {section === 'security' && (
        <form onSubmit={changePassword} className="rounded-[28px] glass-strong liquid p-7 sm:p-8">
          <h3 className="text-[19px] font-bold text-[#141114] tracking-[-0.02em]">Change password</h3>
          <p className="text-[14px] text-[#67636C] mt-1 mb-6">Use at least 6 characters. A longer password with mixed characters is stronger.</p>
          <div className="grid grid-cols-1 gap-5 max-w-[520px]">
            {([['current', 'Current password', 'current-password'], ['next', 'New password', 'new-password'], ['confirm', 'Confirm new password', 'new-password']] as const).map(([k, label, ac]) => (
              <div key={k}>
                <label className="auth-label" htmlFor={`pw-${k}`}>{label}</label>
                <div className="relative">
                  <input id={`pw-${k}`} type={showPw ? 'text' : 'password'} autoComplete={ac} required value={pw[k]}
                    onChange={e => setPw({ ...pw, [k]: e.target.value })} className="auth-input focus:!border-[#A4123F]/50 focus:shadow-[0_0_0_4px_rgba(164,18,63,0.10)]" />
                  {k === 'current' && (
                    <button type="button" onClick={() => setShowPw(!showPw)} title={showPw ? 'Hide passwords' : 'Show passwords'}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9A979E] hover:text-[#141114]">{showPw ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  )}
                </div>
                {k === 'next' && pw.next && (
                  <div className="mt-2 flex items-center gap-2">
                    {[0, 1, 2, 3].map(i => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < strength ? (strength >= 3 ? 'bg-[#1A6B3C]' : strength === 2 ? 'bg-[#D97706]' : 'bg-[#DC2626]') : 'bg-[#141114]/[0.08]'}`} />)}
                    <span className="text-[11.5px] font-semibold text-[#67636C] w-14 text-right">{['Weak', 'Weak', 'Fair', 'Good', 'Strong'][strength]}</span>
                  </div>
                )}
                {k === 'confirm' && pw.confirm && pw.confirm !== pw.next && <p className="mt-1.5 text-[12px] text-[#991B1B]">Passwords don't match yet.</p>}
              </div>
            ))}
          </div>
          {pwMsg && (
            <div className={`mt-6 max-w-[520px] p-3.5 rounded-[14px] flex items-center gap-2.5 text-[13px] border ${pwMsg.ok ? 'bg-[rgba(230,244,237,0.75)] border-[#1A6B3C]/20 text-[#1A6B3C]' : 'bg-[rgba(254,226,226,0.7)] border-[#FCA5A5]/60 text-[#991B1B]'}`}>
              {pwMsg.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {pwMsg.text}
            </div>
          )}
          <div className="mt-7 pt-6 border-t border-[#141114]/[0.07]">
            <button type="submit" disabled={pwSaving} className="glass-btn-primary px-6 py-2.5 text-[14px] !rounded-full">
              {pwSaving ? <><Loader2 size={15} className="animate-spin" /> Updating…</> : <><KeyRound size={15} /> Update password</>}
            </button>
          </div>
        </form>
      )}

      {/* ── Account ── */}
      {section === 'account' && (
        <div className="rounded-[28px] glass-strong liquid p-7 sm:p-8">
          <h3 className="text-[19px] font-bold text-[#141114] tracking-[-0.02em] mb-6">Account</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              ['Account type', user.role === 'recruiter' ? 'Company / recruiter' : 'Candidate'],
              ['Member since', memberSince],
              ['Email', user.email],
            ].map(([k, v]) => (
              <div key={k} className="p-4 rounded-[18px] glass-soft">
                <p className="glass-label !text-[10px] mb-1.5">{k}</p>
                <p className="text-[14.5px] font-semibold text-[#141114] truncate">{v}</p>
              </div>
            ))}
            <div className="p-4 rounded-[18px] glass-soft">
              <p className="glass-label !text-[10px] mb-1.5">Account ID</p>
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-mono font-semibold text-[#141114] truncate">{user.user_id}</p>
                <button type="button" title="Copy account ID" className="glass-icon-btn !w-7 !h-7 !rounded-[9px] shrink-0"
                  onClick={() => { navigator.clipboard?.writeText(user.user_id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          </div>
          <div className="mt-7 pt-6 border-t border-[#141114]/[0.07] flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[14.5px] font-semibold text-[#141114]">Sign out of DeepVerify</p>
              <p className="text-[13px] text-[#85818A]">You'll need your email and password to sign back in.</p>
            </div>
            <button type="button" onClick={onSignOut} className="glass-btn px-5 py-2.5 text-[14px] !rounded-full !text-[#991B1B]"><LogOut size={15} /> Sign out</button>
          </div>
        </div>
      )}
    </div>
  )
}
