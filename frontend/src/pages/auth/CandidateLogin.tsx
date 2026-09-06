import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2, AlertCircle, GraduationCap, Eye, EyeOff, ShieldCheck, Sparkles, Lock } from 'lucide-react'
import { setAuth } from '../../utils/auth'
import Navbar from '../../components/Navbar'

/* ── Animated background for the form panel ── */
function FormBg({ accent }: { accent: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Large soft drifting orbs */}
      <div className="absolute animate-drift1 rounded-full opacity-[0.08]"
        style={{ width: 320, height: 320, background: `radial-gradient(circle, ${accent}, transparent)`, top: '-10%', right: '-10%', filter: 'blur(40px)', animationDuration: '11s' }} />
      <div className="absolute animate-drift2 rounded-full opacity-[0.06]"
        style={{ width: 280, height: 280, background: `radial-gradient(circle, ${accent}, transparent)`, bottom: '-5%', left: '-5%', filter: 'blur(50px)', animationDuration: '14s' }} />
      <div className="absolute animate-drift3 rounded-full opacity-[0.05]"
        style={{ width: 200, height: 200, background: `radial-gradient(circle, ${accent}, transparent)`, top: '40%', left: '20%', filter: 'blur(30px)', animationDuration: '18s' }} />

      {/* Spinning outer ring */}
      <div className="absolute animate-spin-slow opacity-[0.07]"
        style={{ width: 420, height: 420, borderRadius: '50%', border: `1.5px dashed ${accent}`, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
      <div className="absolute animate-spin-slow-r opacity-[0.05]"
        style={{ width: 280, height: 280, borderRadius: '50%', border: `1px solid ${accent}`, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />

      {/* Floating particles */}
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

      {/* Grid dots */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id={`dots-${accent.replace('#','')}`} x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.5" fill={accent} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#dots-${accent.replace('#','')})`} />
      </svg>

      {/* Corner accent arc */}
      <svg className="absolute bottom-0 right-0 opacity-[0.06]" width="180" height="180" viewBox="0 0 180 180">
        <path d="M 180 0 Q 0 0 0 180" fill="none" stroke={accent} strokeWidth="2" />
        <path d="M 180 30 Q 30 30 30 180" fill="none" stroke={accent} strokeWidth="1" />
        <path d="M 180 60 Q 60 60 60 180" fill="none" stroke={accent} strokeWidth="1" />
      </svg>
    </div>
  )
}

export default function CandidateLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [focusedField, setFocusedField] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role: 'candidate' })
      })
      let data: any = {}
      try { data = await res.json() } catch {
        throw new Error(`Server returned status ${res.status} with non-JSON response.`)
      }
      if (!res.ok) throw new Error(data.detail || 'Failed to sign in.')
      setAuth(data.token, data.user)
      navigate('/student/inbox')
    } catch (err: any) {
      setError(err.message || 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  const iStyle = (field: string) => ({
    borderColor: focusedField === field ? '#A4123F' : '#D5D5D7',
    boxShadow: focusedField === field ? '0 0 0 3px rgba(164,18,63,0.1)' : 'none',
  })
  const iClass = 'w-full px-3.5 py-2.5 text-sm bg-white/90 border rounded-xl outline-none transition-all text-[#0F0F0F] placeholder-[#AAAAAA]'

  return (
    <div className="min-h-screen bg-[#FAFAFB] relative overflow-hidden">
      {/* Page-level ambient orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-rose-300/20 blur-[100px] animate-blob" />
        <div className="absolute top-[20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-300/10 blur-[120px] animate-blob-slow" />
        <div className="absolute bottom-[-10%] left-[20%] w-[800px] h-[800px] rounded-full bg-pink-200/20 blur-[140px] animate-blob" style={{ animationDelay: '2s' }} />
      </div>

      <Navbar />

      <main className="relative z-10 flex items-center justify-center min-h-screen px-4 pt-28 pb-12">
        <div
          className="w-full max-w-[900px] rounded-3xl overflow-hidden flex shadow-[0_32px_80px_rgba(0,0,0,0.1)]"
          style={{ animation: 'fadeUp 0.45s ease both', minHeight: '520px' }}
        >
          {/* ── LEFT — Branded maroon panel ── */}
          <div
            className="hidden lg:flex flex-col justify-between w-[42%] p-10 relative overflow-hidden"
            style={{ background: 'linear-gradient(155deg, #A4123F 0%, #6B0D29 100%)' }}
          >
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48 rounded-full bg-white/5 blur-2xl" />
            <div className="absolute bottom-[-30px] left-[-30px] w-56 h-56 rounded-full bg-white/5 blur-2xl" />

            <div className="relative z-10">
              <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center mb-8">
                <GraduationCap size={22} className="text-white" />
              </div>
              <h2 className="text-[26px] font-bold text-white leading-tight mb-3">Candidate<br />Portal</h2>
              <p className="text-white/65 text-[13px] leading-relaxed">
                Access your interview invites, track your verified integrity score, and manage your academic profile.
              </p>
            </div>

            <div className="relative z-10 space-y-2.5">
              {[
                { icon: <ShieldCheck size={14} />, text: 'Zero-trust verified identity' },
                { icon: <Sparkles size={14} />, text: 'Live AI integrity telemetry' },
                { icon: <Lock size={14} />, text: 'End-to-end encrypted sessions' },
              ].map((f, i) => (
                <div key={i} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-white/10 backdrop-blur-sm">
                  <span className="text-white/80">{f.icon}</span>
                  <span className="text-white/80 text-xs font-medium">{f.text}</span>
                </div>
              ))}
              <p className="pt-2 text-white/40 text-[11px]">
                Don't have an account?{' '}
                <Link to="/auth/candidate/signup" className="text-white/80 font-semibold hover:underline">Create Profile →</Link>
              </p>
            </div>
          </div>

          {/* ── RIGHT — Animated form panel ── */}
          <div className="flex-1 relative flex flex-col justify-center px-10 py-10 border-l border-white/80 overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(24px)' }}>

            {/* 🎨 Dynamic animated background */}
            <FormBg accent="#A4123F" />

            {/* Form content sits above animations */}
            <div className="relative z-10">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#E4E4E6] bg-[#FDF2F5] text-[#A4123F] text-[11px] font-semibold w-fit mb-7">
                <GraduationCap size={12} /> Candidate Sign In
              </span>

              <h1 className="text-[24px] font-bold text-[#0F0F0F] tracking-tight mb-1">Welcome back</h1>
              <p className="text-[13px] text-[#6B6B6B] mb-7">Enter your credentials to continue.</p>

              {error && (
                <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-[#991B1B]">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" /><span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="c-email" className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Email Address</label>
                  <input id="c-email" type="email" required value={email}
                    onChange={e => setEmail(e.target.value)}
                    onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)}
                    placeholder="student@university.edu" className={iClass} style={iStyle('email')} />
                </div>

                <div>
                  <label htmlFor="c-password" className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Password</label>
                  <div className="relative">
                    <input id="c-password" type={showPassword ? 'text' : 'password'} required value={password}
                      onChange={e => setPassword(e.target.value)}
                      onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)}
                      placeholder="••••••••" className={iClass} style={iStyle('password')} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] hover:text-[#6B6B6B] transition-colors">
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <button type="submit" disabled={loading}
                  className="w-full mt-1 py-2.5 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#A4123F,#7A0D2E)', boxShadow: '0 4px 18px rgba(164,18,63,0.28)' }}>
                  {loading ? <><Loader2 size={15} className="animate-spin" />Signing In...</> : <>Sign In <ArrowRight size={15} /></>}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-[#EAEAEA] text-center">
                <p className="text-xs text-[#9B9B9B]">
                  Are you a recruiter?{' '}
                  <Link to="/auth/recruiter/login" className="text-[#3A3A3A] font-semibold hover:text-[#0F0F0F] transition-colors">Company Login →</Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
