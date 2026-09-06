import React, { useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2, AlertCircle, UploadCloud, GraduationCap, CheckCircle2, ShieldCheck, Sparkles, Lock, Eye, EyeOff } from 'lucide-react'
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
        style={{ width: 520, height: 520, borderRadius: '50%', border: `1.5px dashed ${accent}`, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
      <div className="absolute animate-spin-slow-r opacity-[0.05]"
        style={{ width: 340, height: 340, borderRadius: '50%', border: `1px solid ${accent}`, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />

      {[...Array(8)].map((_, i) => (
        <div key={i} className="absolute animate-particle rounded-full"
          style={{
            width: 4 + (i % 3) * 2,
            height: 4 + (i % 3) * 2,
            background: accent,
            opacity: 0.12 + (i % 3) * 0.04,
            left: `${8 + i * 11}%`,
            top: `${15 + (i % 5) * 16}%`,
            animationDelay: `${i * 0.6}s`,
            animationDuration: `${3.5 + i * 0.4}s`,
            filter: 'blur(1px)',
          }} />
      ))}

      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="dots-cs" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.5" fill={accent} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots-cs)" />
      </svg>

      <svg className="absolute bottom-0 right-0 opacity-[0.06]" width="180" height="180" viewBox="0 0 180 180">
        <path d="M 180 0 Q 0 0 0 180" fill="none" stroke={accent} strokeWidth="2" />
        <path d="M 180 30 Q 30 30 30 180" fill="none" stroke={accent} strokeWidth="1" />
        <path d="M 180 60 Q 60 60 60 180" fill="none" stroke={accent} strokeWidth="1" />
      </svg>
    </div>
  )
}

export default function CandidateSignup() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState({
    fullName: '', email: '', password: '', phone: '',
    college: '', degree: '', graduationYear: new Date().getFullYear().toString(),
  })
  const [showPassword, setShowPassword] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [focusedField, setFocusedField] = useState<string | null>(null)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFormData({ ...formData, [e.target.name]: e.target.value })

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) { setError('Please select a valid image file (JPEG or PNG).'); return }
      setPhotoFile(file)
      const reader = new FileReader()
      reader.onload = () => setPhotoPreview(reader.result as string)
      reader.readAsDataURL(file)
      setError('')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!formData.fullName || !formData.email || !formData.password || !formData.college || !formData.degree) {
      setError('Please complete all required fields.'); return
    }
    if (!photoFile) { setError('Please upload a passport-size photograph for identity verification.'); return }
    setLoading(true)
    try {
      const data = new FormData()
      data.append('full_name', formData.fullName); data.append('email', formData.email)
      data.append('password', formData.password); data.append('college', formData.college)
      data.append('degree', formData.degree); data.append('graduation_year', formData.graduationYear)
      if (formData.phone) data.append('phone', formData.phone)
      data.append('photo', photoFile)
      const res = await fetch('/api/auth/register/candidate', { method: 'POST', body: data })
      let json: any = {}
      try { json = await res.json() } catch { throw new Error(`Server returned status ${res.status} with non-JSON response.`) }
      if (!res.ok) throw new Error(typeof json.detail === 'string' ? json.detail : json.detail?.message || 'Registration failed.')
      setAuth(json.token, json.user)
      navigate('/student/inbox')
    } catch (err: any) {
      setError(err.message || 'Registration failed.')
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
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-rose-300/20 blur-[100px] animate-blob" />
        <div className="absolute top-[20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-300/10 blur-[120px] animate-blob-slow" />
        <div className="absolute bottom-[-10%] left-[20%] w-[800px] h-[800px] rounded-full bg-pink-200/20 blur-[140px] animate-blob" style={{ animationDelay: '2s' }} />
      </div>

      <Navbar />

      <main className="relative z-10 flex items-center justify-center min-h-screen px-4 pt-28 pb-12">
        <div
          className="w-full max-w-[960px] rounded-3xl overflow-hidden flex shadow-[0_32px_80px_rgba(0,0,0,0.1)]"
          style={{ animation: 'fadeUp 0.45s ease both' }}
        >
          {/* ── LEFT — Branded maroon panel ── */}
          <div
            className="hidden lg:flex flex-col justify-between w-[36%] p-10 relative overflow-hidden"
            style={{ background: 'linear-gradient(155deg, #A4123F 0%, #6B0D29 100%)' }}
          >
            <div className="absolute top-[-40px] right-[-40px] w-48 h-48 rounded-full bg-white/5 blur-2xl" />
            <div className="absolute bottom-[-30px] left-[-30px] w-56 h-56 rounded-full bg-white/5 blur-2xl" />
            <div className="relative z-10">
              <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center mb-8">
                <GraduationCap size={22} className="text-white" />
              </div>
              <h2 className="text-[22px] font-bold text-white leading-tight mb-3">Create your<br />Candidate Profile</h2>
              <p className="text-white/65 text-[12px] leading-relaxed">
                Enroll your academic identity and verified reference photograph to get started.
              </p>
            </div>
            <div className="relative z-10 space-y-3">
              <p className="text-white/50 text-[10px] uppercase tracking-widest font-semibold mb-1">How it works</p>
              {[
                { step: '01', label: 'Fill in your academic details' },
                { step: '02', label: 'Upload passport-size photo' },
                { step: '03', label: 'AWS Rekognition verifies identity' },
                { step: '04', label: 'Accept interview invites' },
              ].map((s, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-[10px] font-bold text-white/40 mt-0.5 w-5 flex-shrink-0">{s.step}</span>
                  <span className="text-white/75 text-[12px] leading-snug">{s.label}</span>
                </div>
              ))}
              <div className="flex flex-col gap-2 pt-2">
                {[
                  { icon: <ShieldCheck size={12} />, text: 'Zero-trust verified sessions' },
                  { icon: <Sparkles size={12} />, text: 'IEEE ICOSAAS 2026 accepted' },
                  { icon: <Lock size={12} />, text: 'End-to-end encrypted' },
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10">
                    <span className="text-white/70">{f.icon}</span>
                    <span className="text-white/70 text-[11px] font-medium">{f.text}</span>
                  </div>
                ))}
              </div>
              <p className="pt-2 text-white/40 text-[11px]">
                Already registered?{' '}
                <Link to="/auth/candidate/login" className="text-white/80 font-semibold hover:underline">Sign In →</Link>
              </p>
            </div>
          </div>

          {/* ── RIGHT — Animated form panel ── */}
          <div className="flex-1 relative flex flex-col justify-center px-10 py-8 border-l border-white/80 overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(24px)' }}>

            <FormBg accent="#A4123F" />

            <div className="relative z-10">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#E4E4E6] bg-[#FDF2F5] text-[#A4123F] text-[11px] font-semibold w-fit mb-5">
                <GraduationCap size={12} /> Student Enrollment
              </span>
              <h1 className="text-[20px] font-bold text-[#0F0F0F] tracking-tight mb-1">Create Candidate Profile</h1>
              <p className="text-[12px] text-[#6B6B6B] mb-5">Fill in your details to enroll.</p>

              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-[#991B1B]">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" /><span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Full Name <span className="text-red-500">*</span></label>
                    <input type="text" name="fullName" required value={formData.fullName} onChange={handleInputChange}
                      onFocus={() => setFocusedField('fullName')} onBlur={() => setFocusedField(null)}
                      placeholder="Jane Doe" className={iClass} style={iStyle('fullName')} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Email Address <span className="text-red-500">*</span></label>
                    <input type="email" name="email" required value={formData.email} onChange={handleInputChange}
                      onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)}
                      placeholder="jane@university.edu" className={iClass} style={iStyle('email')} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Password <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <input type={showPassword ? 'text' : 'password'} name="password" required value={formData.password} onChange={handleInputChange}
                        onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)}
                        placeholder="Min. 6 characters" className={iClass} style={iStyle('password')} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] hover:text-[#6B6B6B] transition-colors">
                        {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Phone (Optional)</label>
                    <input type="tel" name="phone" value={formData.phone} onChange={handleInputChange}
                      onFocus={() => setFocusedField('phone')} onBlur={() => setFocusedField(null)}
                      placeholder="+1 (555) 000-0000" className={iClass} style={iStyle('phone')} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">College / University <span className="text-red-500">*</span></label>
                    <input type="text" name="college" required value={formData.college} onChange={handleInputChange}
                      onFocus={() => setFocusedField('college')} onBlur={() => setFocusedField(null)}
                      placeholder="Stanford University" className={iClass} style={iStyle('college')} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Degree & Major <span className="text-red-500">*</span></label>
                    <input type="text" name="degree" required value={formData.degree} onChange={handleInputChange}
                      onFocus={() => setFocusedField('degree')} onBlur={() => setFocusedField(null)}
                      placeholder="B.S. Computer Science" className={iClass} style={iStyle('degree')} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">Graduation Year <span className="text-red-500">*</span></label>
                    <select name="graduationYear" value={formData.graduationYear} onChange={handleInputChange}
                      className={iClass} style={iStyle('graduationYear')}
                      onFocus={() => setFocusedField('graduationYear')} onBlur={() => setFocusedField(null)}>
                      {[2024, 2025, 2026, 2027, 2028, 2029].map(yr => <option key={yr} value={yr}>{yr}</option>)}
                    </select>
                  </div>
                  {/* Photo upload — compact */}
                  <div>
                    <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                      Identity Photo <span className="text-red-500">*</span>
                    </label>
                    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" onChange={handlePhotoSelect} className="hidden" />
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className={`h-[42px] border-2 border-dashed rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors text-xs ${
                        photoPreview ? 'border-[#1A6B3C] bg-[#F3FAF6]/80 text-[#1A6B3C]' : 'border-[#D5D5D7] hover:border-[#A4123F] bg-white/60 text-[#6B6B6B]'
                      }`}
                    >
                      {photoPreview
                        ? <><CheckCircle2 size={14} /><span className="font-semibold">Photo ready</span></>
                        : <><UploadCloud size={14} /><span>Upload passport photo</span></>
                      }
                    </div>
                    {photoPreview && (
                      <p className="text-[10px] text-[#6B6B6B] mt-1 truncate">{photoFile?.name}</p>
                    )}
                  </div>
                </div>

                <p className="text-[10px] text-[#9B9B9B] -mt-1">
                  Photo: clear passport-size portrait, front-facing, neutral lighting (JPG/PNG). AWS Rekognition will verify your identity during interviews.
                </p>

                <button type="submit" disabled={loading}
                  className="w-full py-2.5 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#A4123F,#7A0D2E)', boxShadow: '0 4px 18px rgba(164,18,63,0.28)' }}>
                  {loading ? <><Loader2 size={15} className="animate-spin" />Creating Account...</> : <>Complete Registration <ArrowRight size={15} /></>}
                </button>
              </form>

              <div className="mt-4 pt-4 border-t border-[#EAEAEA] text-center">
                <p className="text-xs text-[#9B9B9B]">
                  Already have an account?{' '}
                  <Link to="/auth/candidate/login" className="text-[#A4123F] font-semibold hover:underline">Sign In</Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
