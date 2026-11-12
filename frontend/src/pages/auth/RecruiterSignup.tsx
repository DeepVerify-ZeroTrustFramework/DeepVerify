import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2, AlertCircle, Building2, BarChart3, Users, Eye, EyeOff } from 'lucide-react'
import { setAuth } from '../../utils/auth'
import AuthShell from '../../components/AuthShell'


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
    borderColor: focusedField === field ? REC_FOCUS : 'rgba(20,17,20,0.10)',
    boxShadow: focusedField === field ? `0 0 0 3px ${REC_FOCUS}22` : 'none',
  })
  const iClass = 'auth-input'

  return (
    <AuthShell
      tone="graphite"
      formWidth={600}
      eyebrowIcon={<Building2 size={22} />}
      eyebrow="Company Enrollment"
      titleLead="Create your"
      titleAccent="recruiter account."
      description="Start inviting candidates and monitoring interview integrity across your organization."
      steps={[
        { step: '01', label: 'Invite candidates via secure links' },
        { step: '02', label: 'Live AI integrity telemetry dashboard' },
        { step: '03', label: 'Post-interview deep-fake analytics' },
        { step: '04', label: 'Verified candidate profile access' },
      ]}
      pointsLabel="What you get"
      points={[
        { icon: <Users size={16} />, text: 'Search verified profiles' },
        { icon: <BarChart3 size={16} />, text: 'Live integrity reports' },
      ]}
    >
      <span className="glass-chip !text-[11.5px] !px-3.5 !py-1.5 text-[#141114]">
        <Building2 size={13} /> Company Enrollment
      </span>

      <h1 className="text-[32px] font-bold text-[#141114] tracking-[-0.035em] mt-6 mb-1.5">Create Recruiter Account</h1>
      <p className="text-[15px] text-[#67636C] mb-7">Fill in your details to get started.</p>

      {error && (
        <div className="mb-6 p-4 rounded-[16px] bg-[rgba(254,226,226,0.7)] border border-[#FCA5A5]/60 flex items-start gap-2.5 text-[13px] text-[#991B1B]">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="auth-label">Full Name <span className="text-[#A4123F]">*</span></label>
          <input type="text" name="fullName" required value={formData.fullName} onChange={handleInputChange}
            onFocus={() => setFocusedField('fullName')} onBlur={() => setFocusedField(null)}
            placeholder="Alex Mercer" className={iClass} style={iStyle('fullName')} />
        </div>

        <div>
          <label className="auth-label">Work Email Address <span className="text-[#A4123F]">*</span></label>
          <input type="email" name="email" required value={formData.email} onChange={handleInputChange}
            onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)}
            placeholder="alex@techcorp.com" className={iClass} style={iStyle('email')} />
        </div>

        <div>
          <label className="auth-label">Password <span className="text-[#A4123F]">*</span></label>
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} name="password" required value={formData.password} onChange={handleInputChange}
              onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)}
              placeholder="Min. 6 characters" className={iClass} style={iStyle('password')} />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9A979E] hover:text-[#141114] transition-colors">
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="auth-label">Company Name <span className="text-[#A4123F]">*</span></label>
            <input type="text" name="companyName" required value={formData.companyName} onChange={handleInputChange}
              onFocus={() => setFocusedField('companyName')} onBlur={() => setFocusedField(null)}
              placeholder="TechCorp Global" className={iClass} style={iStyle('companyName')} />
          </div>
          <div>
            <label className="auth-label">Designation / Role <span className="text-[#A4123F]">*</span></label>
            <input type="text" name="designation" required value={formData.designation} onChange={handleInputChange}
              onFocus={() => setFocusedField('designation')} onBlur={() => setFocusedField(null)}
              placeholder="Senior Technical Recruiter" className={iClass} style={iStyle('designation')} />
          </div>
        </div>

        <button type="submit" disabled={loading}
        className="btn-graphite w-full mt-3 py-3.5 text-[15px] disabled:opacity-50">
          {loading ? <><Loader2 size={15} className="animate-spin" />Creating Account...</> : <>Register Company Account <ArrowRight size={15} /></>}
        </button>
      </form>

      <div className="mt-7 pt-6 border-t border-[#141114]/[0.08] text-center">
        <p className="text-[13.5px] text-[#85818A]">
          Already have an account?{' '}
          <Link to="/auth/recruiter/login" className="text-[#141114] font-semibold hover:text-[#A4123F] transition-colors">Sign In</Link>
        </p>
      </div>
    </AuthShell>
  )
}
