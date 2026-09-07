import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2, AlertCircle, Building2, BarChart3, Users, Eye, EyeOff } from 'lucide-react'
import { setAuth } from '../../utils/auth'
import Navbar from '../../components/Navbar'

function FormBg({ accent }: { accent: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute animate-drift1 rounded-full opacity-[0.08]"
        style={{ width: 320, height: 320, background: `radial-gradient(circle, ${accent}, transparent)`, top: '-10%', right: '-10%', filter: 'blur(40px)', animationDuration: '11s' }} />
      <div className="absolute animate-drift2 rounded-full opacity-[0.06]"
        style={{ width: 280, height: 280, background: `radial-gradient(circle, ${accent}, transparent)`, bottom: '-5%', left: '-5%', filter: 'blur(50px)', animationDuration: '14s' }} />
      <div className="absolute animate-drift3 rounded-full opacity-[0.05]"
        style={{ width: 200, height: 200, background: `radial-gradient(circle, ${accent}, transparent)`, top: '40%', left: '20%', filter: 'blur(30px)', animationDuration: '18s' }} />

      <div className="absolute animate-spin-slow opacity-[0.07]"
        style={{ width: 420, height: 420, borderRadius: '50%', border: `1.5px dashed ${accent}`, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
      <div className="absolute animate-spin-slow-r opacity-[0.05]"
        style={{ width: 280, height: 280, borderRadius: '50%', border: `1px solid ${accent}`, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />

      {[...Array(7)].map((_, i) => (
        <div key={i} className="absolute animate-particle rounded-full"
          style={{
            width: 4 + (i % 3) * 2,
            height: 4 + (i % 3) * 2,
            background: accent,
            opacity: 0.12 + (i % 3) * 0.04,
            left: `${12 + i * 12}%`,
            top: `${20 + (i % 4) * 18}%`,
            animationDelay: `${i * 0.7}s`,
            animationDuration: `${3.5 + i * 0.5}s`,
            filter: 'blur(1px)',
          }} />
      ))}

      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="dots-rs" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.5" fill={accent} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots-rs)" />
      </svg>

      <svg className="absolute bottom-0 right-0 opacity-[0.06]" width="180" height="180" viewBox="0 0 180 180">
        <path d="M 180 0 Q 0 0 0 180" fill="none" stroke={accent} strokeWidth="2" />
        <path d="M 180 30 Q 30 30 30 180" fill="none" stroke={accent} strokeWidth="1" />
        <path d="M 180 60 Q 60 60 60 180" fill="none" stroke={accent} strokeWidth="1" />
      </svg>
    </div>
  )
}

const REC_ACCENT = '#3A3A3A'
const REC_FOCUS = '#2A2A2A'

export default function RecruiterSignup() {
  const navigate = useNavigate()
  const [formData, setFormData] = useState({ fullName: '', email: '', password: '', companyName: '', designation: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [focusedField, setFocusedField] = useState<string | null>(null)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormData({ ...formData, [e.target.name]: e.target.value })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!formData.fullName || !formData.email || !formData.password || !formData.companyName || !formData.designation) {
      setError('Please fill in all fields.'); return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register/recruiter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: formData.fullName, email: formData.email, password: formData.password, company_name: formData.companyName, designation: formData.designation }),
      })
      let data: any = {}
      try { data = await res.json() } catch { throw new Error(`Server returned status ${res.status} with non-JSON response.`) }
      if (!res.ok) throw new Error(data.detail || 'Registration failed.')
      setAuth(data.token, data.user)
      navigate('/recruiter/dashboard')
    } catch (err: any) {
      setError(err.message || 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  const iStyle = (field: string) => ({
    borderColor: focusedField === field ? REC_FOCUS : '#D5D5D7',
    boxShadow: focusedField === field ? `0 0 0 3px ${REC_FOCUS}22` : 'none',
  })
  const iClass = 'w-full px-3.5 py-2.5 text-sm bg-white/90 border rounded-xl outline-none transition-all text-[#0F0F0F] placeholder-[#AAAAAA]'

  return (
    <div className="min-h-screen bg-[#FAFAFB] relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-rose-300/20 blur-[100px] animate-blob" />
        <div className="absolute top-[20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-slate-300/10 blur-[120px] animate-blob-slow" />
        <div className="absolute bottom-[-10%] left-[20%] w-[800px] h-[800px] rounded-full bg-pink-200/15 blur-[140px] animate-blob" style={{ animationDelay: '2s' }} />
      </div>

      <Navbar />

      <main className="relative z-10 flex items-center justify-center min-h-screen px-4 pt-28 pb-12">
        <div
          className="w-full max-w-[900px] rounded-3xl overflow-hidden flex shadow-[0_32px_80px_rgba(0,0,0,0.1)]"
          style={{ animation: 'fadeUp 0.45s ease both' }}
        >
          {/* ── LEFT — Minimal white branded panel ── */}
          <div
            className="hidden lg:flex flex-col justify-between w-[40%] p-10 relative overflow-hidden"
            style={{ background: '#FFFFFF' }}
          >
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48 rounded-full bg-black/5 blur-2xl" />
            <div className="absolute bottom-[-30px] left-[-30px] w-56 h-56 rounded-full bg-black/5 blur-2xl" />

            <div className="relative z-10">
              <div className="w-11 h-11 rounded-2xl bg-black/5 border border-black/10 flex items-center justify-center mb-8">
                <Building2 size={22} className="text-[#0F0F0F]" />
              </div>
              <h2 className="text-[26px] font-bold text-[#0F0F0F] leading-tight mb-3">Create your<br />Recruiter Account</h2>
              <p className="text-[#6B6B6B] text-[13px] leading-relaxed">
                Start inviting candidates and monitoring interview integrity across your organization.
              </p>
            </div>

            <div className="relative z-10">
              <p className="text-[10px] font-bold text-[#9B9B9B] tracking-widest uppercase mb-4">What you get</p>
              <div className="space-y-4 mb-6">
                {[
                  { id: '01', text: 'Invite candidates via secure links' },
                  { id: '02', text: 'Live AI integrity telemetry dashboard' },
                  { id: '03', text: 'Post-interview deep-fake analytics' },
                  { id: '04', text: 'Verified candidate profile access' },
                ].map((f) => (
                  <div key={f.id} className="flex items-start gap-3">
                    <span className="text-[10px] font-mono font-semibold text-[#A4123F] mt-0.5">{f.id}</span>
                    <span className="text-xs font-medium text-[#3A3A3A] leading-tight">{f.text}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                {[
                  { icon: <Users size={13} />, text: 'Search verified profiles' },
                  { icon: <BarChart3 size={13} />, text: 'Live integrity reports' },
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-black/5 border border-black/5">
                    <span className="text-[#3A3A3A]">{f.icon}</span>
                    <span className="text-xs font-medium text-[#3A3A3A]">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT — Animated form panel ── */}
          <div className="flex-1 relative flex flex-col justify-center px-10 py-10 border-l border-white/80 overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(24px)' }}>

            <FormBg accent={REC_ACCENT} />

            <div className="relative z-10">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#E4E4E6] bg-[#F5F5F5] text-[#2A2A2A] text-[11px] font-semibold w-fit mb-6">
                <Building2 size={12} /> Company Enrollment
              </span>

              <h1 className="text-[22px] font-bold text-[#0F0F0F] tracking-tight mb-1">Create Recruiter Account</h1>
              <p className="text-[13px] text-[#6B6B6B] mb-6">Fill in your details to get started.</p>

              {error && (
                <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-[#991B1B]">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" /><span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Full Name <span className="text-red-500">*</span></label>
                  <input type="text" name="fullName" required value={formData.fullName} onChange={handleInputChange}
                    onFocus={() => setFocusedField('fullName')} onBlur={() => setFocusedField(null)}
                    placeholder="Alex Mercer" className={iClass} style={iStyle('fullName')} />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Work Email Address <span className="text-red-500">*</span></label>
                  <input type="email" name="email" required value={formData.email} onChange={handleInputChange}
                    onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)}
                    placeholder="alex@techcorp.com" className={iClass} style={iStyle('email')} />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Password <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} name="password" required value={formData.password} onChange={handleInputChange}
                      onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)}
                      placeholder="Min. 6 characters" className={iClass} style={iStyle('password')} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] hover:text-[#6B6B6B] transition-colors">
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Company Name <span className="text-red-500">*</span></label>
                    <input type="text" name="companyName" required value={formData.companyName} onChange={handleInputChange}
                      onFocus={() => setFocusedField('companyName')} onBlur={() => setFocusedField(null)}
                      placeholder="TechCorp Global" className={iClass} style={iStyle('companyName')} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Designation / Role <span className="text-red-500">*</span></label>
                    <input type="text" name="designation" required value={formData.designation} onChange={handleInputChange}
                      onFocus={() => setFocusedField('designation')} onBlur={() => setFocusedField(null)}
                      placeholder="Senior Technical Recruiter" className={iClass} style={iStyle('designation')} />
                  </div>
                </div>

                <button type="submit" disabled={loading}
                  className="w-full mt-2 py-3 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #2A2A2A, #111111)', boxShadow: '0 4px 18px rgba(15,15,15,0.22)' }}>
                  {loading ? <><Loader2 size={15} className="animate-spin" />Creating Account...</> : <>Register Company Account <ArrowRight size={15} /></>}
                </button>
              </form>

              <div className="mt-5 pt-4 border-t border-[#EAEAEA] text-center">
                <p className="text-xs text-[#9B9B9B]">
                  Already have an account?{' '}
                  <Link to="/auth/recruiter/login" className="text-[#2A2A2A] font-semibold hover:underline">Sign In</Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
