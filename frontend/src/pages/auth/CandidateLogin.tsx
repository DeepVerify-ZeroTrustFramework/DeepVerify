import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2, AlertCircle, GraduationCap, Eye, EyeOff, ShieldCheck, Sparkles, Lock } from 'lucide-react'
import { setAuth } from '../../utils/auth'
import AuthShell, { ProofCard } from '../../components/AuthShell'


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
    borderColor: focusedField === field ? '#A4123F' : 'rgba(20,17,20,0.10)',
    boxShadow: focusedField === field ? '0 0 0 3px rgba(164,18,63,0.1)' : 'none',
  })
  const iClass = 'auth-input'

  return (
    <AuthShell
      eyebrowIcon={<GraduationCap size={22} className="text-white" />}
      eyebrow="Candidate Portal"
      titleLead="Your verified"
      titleAccent="interview identity."
      description="Access your interview invites, track your verified integrity score, and manage your academic profile."
      points={[
        { icon: <ShieldCheck size={16} />, text: 'Zero-trust verified identity' },
        { icon: <Sparkles size={16} />, text: 'Live AI integrity telemetry' },
        { icon: <Lock size={16} />, text: 'End-to-end encrypted sessions' },
      ]}
      proof={<ProofCard title="Integrity check · sample" rows={[{ k: 'PRNU', v: 'MATCH' }, { k: 'rPPG', v: '74 BPM' }, { k: 'TRUST', v: '87/100' }]} />}
      footnote={<>
        Don't have an account?{' '}
        <Link to="/auth/candidate/signup" className="font-semibold text-[#A4123F] hover:underline">Create Profile →</Link>
      </>}
    >
      <span className="glass-chip !text-[11.5px] !px-3.5 !py-1.5 text-[#A4123F]">
        <GraduationCap size={13} /> Candidate Sign In
      </span>

      <h1 className="text-[34px] font-bold text-[#141114] tracking-[-0.035em] mt-6 mb-1.5">Welcome back</h1>
      <p className="text-[15px] text-[#67636C] mb-8">Enter your credentials to continue.</p>

      {error && (
        <div className="mb-6 p-4 rounded-[16px] bg-[rgba(254,226,226,0.7)] border border-[#FCA5A5]/60 flex items-start gap-2.5 text-[13px] text-[#991B1B]">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="c-email" className="auth-label">Email Address</label>
          <input id="c-email" type="email" required value={email}
            onChange={e => setEmail(e.target.value)}
            onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)}
            placeholder="student@university.edu" className={iClass} style={iStyle('email')} />
        </div>

        <div>
          <label htmlFor="c-password" className="auth-label">Password</label>
          <div className="relative">
            <input id="c-password" type={showPassword ? 'text' : 'password'} required value={password}
              onChange={e => setPassword(e.target.value)}
              onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)}
              placeholder="••••••••" className={iClass} style={iStyle('password')} />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9A979E] hover:text-[#141114] transition-colors">
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>

        <button type="submit" disabled={loading}
          className="glass-btn-primary w-full mt-2 py-3.5 text-[15px] disabled:opacity-50">
          {loading ? <><Loader2 size={16} className="animate-spin" />Signing In...</> : <>Sign In <ArrowRight size={16} /></>}
        </button>
      </form>

      <div className="mt-8 pt-6 border-t border-[#141114]/[0.08] text-center">
        <p className="text-[13.5px] text-[#85818A]">
          Are you a recruiter?{' '}
          <Link to="/auth/recruiter/login" className="text-[#141114] font-semibold hover:text-[#A4123F] transition-colors">Company Login →</Link>
        </p>
      </div>
    </AuthShell>
  )
}
