import React, { useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2, AlertCircle, UploadCloud, GraduationCap, CheckCircle2, ShieldCheck, Sparkles, Lock, Eye, EyeOff } from 'lucide-react'
import { setAuth } from '../../utils/auth'
import AuthShell from '../../components/AuthShell'


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
    borderColor: focusedField === field ? '#A4123F' : 'rgba(20,17,20,0.10)',
    boxShadow: focusedField === field ? '0 0 0 3px rgba(164,18,63,0.1)' : 'none',
  })
  const iClass = 'auth-input'

  return (
    <AuthShell
      formWidth={680}
      eyebrowIcon={<GraduationCap size={22} className="text-white" />}
      eyebrow="Student Enrollment"
      titleLead="Create your"
      titleAccent="candidate profile."
      description="Enroll your academic identity and verified reference photograph to get started."
      steps={[
        { step: '01', label: 'Fill in your academic details' },
        { step: '02', label: 'Upload passport-size photo' },
        { step: '03', label: 'AWS Rekognition verifies identity' },
        { step: '04', label: 'Accept interview invites' },
      ]}
      points={[
        { icon: <ShieldCheck size={16} />, text: 'Zero-trust verified sessions' },
        { icon: <Sparkles size={16} />, text: 'IEEE ICOSAAS 2026 accepted' },
        { icon: <Lock size={16} />, text: 'End-to-end encrypted' },
      ]}
      footnote={<>
        Already registered?{' '}
        <Link to="/auth/candidate/login" className="font-semibold text-[#A4123F] hover:underline">Sign In →</Link>
      </>}
    >
      <span className="glass-chip !text-[11.5px] !px-3.5 !py-1.5 text-[#A4123F]">
        <GraduationCap size={13} /> Student Enrollment
      </span>
      <h1 className="text-[32px] font-bold text-[#141114] tracking-[-0.035em] mt-6 mb-1.5">Create Candidate Profile</h1>
      <p className="text-[15px] text-[#67636C] mb-7">Fill in your details to enroll.</p>

      {error && (
        <div className="mb-6 p-4 rounded-[16px] bg-[rgba(254,226,226,0.7)] border border-[#FCA5A5]/60 flex items-start gap-2.5 text-[13px] text-[#991B1B]">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="auth-label">Full Name <span className="text-[#A4123F]">*</span></label>
            <input type="text" name="fullName" required value={formData.fullName} onChange={handleInputChange}
              onFocus={() => setFocusedField('fullName')} onBlur={() => setFocusedField(null)}
              placeholder="Jane Doe" className={iClass} style={iStyle('fullName')} />
          </div>
          <div>
            <label className="auth-label">Email Address <span className="text-[#A4123F]">*</span></label>
            <input type="email" name="email" required value={formData.email} onChange={handleInputChange}
              onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)}
              placeholder="jane@university.edu" className={iClass} style={iStyle('email')} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="auth-label">Password <span className="text-[#A4123F]">*</span></label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} name="password" required value={formData.password} onChange={handleInputChange}
                onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)}
                placeholder="Min. 6 characters" className={iClass} style={iStyle('password')} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9A979E] hover:text-[#141114] transition-colors">
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>
          <div>
            <label className="auth-label">Phone (Optional)</label>
            <input type="tel" name="phone" value={formData.phone} onChange={handleInputChange}
              onFocus={() => setFocusedField('phone')} onBlur={() => setFocusedField(null)}
              placeholder="+1 (555) 000-0000" className={iClass} style={iStyle('phone')} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="auth-label">College / University <span className="text-[#A4123F]">*</span></label>
            <input type="text" name="college" required value={formData.college} onChange={handleInputChange}
              onFocus={() => setFocusedField('college')} onBlur={() => setFocusedField(null)}
              placeholder="Stanford University" className={iClass} style={iStyle('college')} />
          </div>
          <div>
            <label className="auth-label">Degree & Major <span className="text-[#A4123F]">*</span></label>
            <input type="text" name="degree" required value={formData.degree} onChange={handleInputChange}
              onFocus={() => setFocusedField('degree')} onBlur={() => setFocusedField(null)}
              placeholder="B.S. Computer Science" className={iClass} style={iStyle('degree')} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="auth-label">Graduation Year <span className="text-[#A4123F]">*</span></label>
            <select name="graduationYear" value={formData.graduationYear} onChange={handleInputChange}
              className={iClass} style={iStyle('graduationYear')}
              onFocus={() => setFocusedField('graduationYear')} onBlur={() => setFocusedField(null)}>
              {[2024, 2025, 2026, 2027, 2028, 2029].map(yr => <option key={yr} value={yr}>{yr}</option>)}
            </select>
          </div>
          {/* Photo upload — compact */}
          <div>
            <label className="auth-label">
              Identity Photo <span className="text-[#A4123F]">*</span>
            </label>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" onChange={handlePhotoSelect} className="hidden" />
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`h-[50px] border-2 border-dashed rounded-[14px] flex items-center justify-center gap-2 cursor-pointer transition-colors text-[13px] ${
                photoPreview ? 'border-[#1A6B3C]/60 bg-[rgba(230,244,237,0.75)] text-[#1A6B3C]' : 'border-[#141114]/15 hover:border-[#A4123F]/60 bg-white/55 text-[#67636C]'
              }`}
            >
              {photoPreview
                ? <><CheckCircle2 size={14} /><span className="font-semibold">Photo ready</span></>
                : <><UploadCloud size={14} /><span>Upload passport photo</span></>
              }
            </div>
            {photoPreview && (
              <p className="text-[11.5px] text-[#67636C] mt-1.5 truncate">{photoFile?.name}</p>
            )}
          </div>
        </div>

        <p className="text-[12px] text-[#85818A] leading-relaxed">
          Photo: clear passport-size portrait, front-facing, neutral lighting (JPG/PNG). AWS Rekognition will verify your identity during interviews.
        </p>

        <button type="submit" disabled={loading}
        className="glass-btn-primary w-full mt-3 py-3.5 text-[15px] disabled:opacity-50">
          {loading ? <><Loader2 size={15} className="animate-spin" />Creating Account...</> : <>Complete Registration <ArrowRight size={15} /></>}
        </button>
      </form>

      <div className="mt-7 pt-6 border-t border-[#141114]/[0.08] text-center">
        <p className="text-[13.5px] text-[#85818A]">
          Already have an account?{' '}
          <Link to="/auth/candidate/login" className="text-[#A4123F] font-semibold hover:underline">Sign In</Link>
        </p>
      </div>
    </AuthShell>
  )
}
