import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2, AlertCircle, Building2, BarChart3, Users, Zap, Eye, EyeOff } from 'lucide-react'
import { setAuth } from '../../utils/auth'
import AuthShell, { ProofCard } from '../../components/AuthShell'

/* Recruiter brand: minimal white/light grey */
const REC_BADGE_BG = '#F5F5F5'
const REC_BADGE_TEXT = '#2A2A2A'
const REC_FOCUS = '#2A2A2A'



export default function RecruiterLogin() {
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
        body: JSON.stringify({ email, password, role: 'recruiter' })
      })
      let data: any = {}
      try { data = await res.json() } catch {
        throw new Error(`Server returned status ${res.status} with non-JSON response.`)
      }
      if (!res.ok) throw new Error(data.detail || 'Failed to sign in.')
      setAuth(data.token, data.user)
      navigate('/recruiter/dashboard')
    } catch (err: any) {
      setError(err.message || 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  const iStyle = (field: string) => ({
    borderColor: focusedField === field ? REC_FOCUS : 'rgba(20,17,20,0.10)',
    boxShadow: focusedField === field ? `0 0 0 3px ${REC_FOCUS}1A` : 'none',
  })
  const iClass = 'auth-input'

  return (
    <AuthShell
      tone="graphite"
      eyebrowIcon={<Building2 size={22} />}
      eyebrow="Company Portal"
      titleLead="Hire with evidence,"
      titleAccent="not hunches."
      description="Search verified candidates, issue interview invites, and watch live forensic telemetry for every session."
      points={[
        { icon: <Users size={16} />, text: 'Search verified candidate profiles' },
        { icon: <BarChart3 size={16} />, text: 'Live session integrity dashboard' },
        { icon: <Zap size={16} />, text: 'Issue direct interview invites' },
      ]}
      proof={<ProofCard tone="graphite" title="Recruiter dashboard · sample" rows={[{ k: 'SESSIONS', v: '12 LIVE' }, { k: 'VERIFIED', v: '11' }, { k: 'FLAGGED', v: '1', ok: false }]} />}
      footnote={<>
        New to DeepVerify?{' '}
        <Link to="/auth/recruiter/signup" className="font-semibold text-[#141114] hover:underline">Create Account →</Link>
      </>}
    >
      <span className="glass-chip !text-[11.5px] !px-3.5 !py-1.5"
        style={{ color: REC_BADGE_TEXT, background: REC_BADGE_BG }}>
        <Building2 size={13} /> Company Sign In
      </span>

      <h1 className="text-[34px] font-bold text-[#141114] tracking-[-0.035em] mt-6 mb-1.5">Welcome back</h1>
      <p className="text-[15px] text-[#67636C] mb-8">Sign in to your recruiter dashboard.</p>

      {error && (
        <div className="mb-6 p-4 rounded-[16px] bg-[rgba(254,226,226,0.7)] border border-[#FCA5A5]/60 flex items-start gap-2.5 text-[13px] text-[#991B1B]">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="r-email" className="auth-label">Work Email Address</label>
          <input id="r-email" type="email" required value={email}
            onChange={e => setEmail(e.target.value)}
            onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)}
            placeholder="recruiter@company.com" className={iClass} style={iStyle('email')} />
        </div>

        <div>
          <label htmlFor="r-password" className="auth-label">Password</label>
          <div className="relative">
            <input id="r-password" type={showPassword ? 'text' : 'password'} required value={password}
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
        className="btn-graphite w-full mt-2 py-3.5 text-[15px] disabled:opacity-50">
          {loading ? <><Loader2 size={15} className="animate-spin" />Signing In...</> : <>Sign In to Dashboard <ArrowRight size={15} /></>}
        </button>
      </form>

      <div className="mt-8 pt-6 border-t border-[#141114]/[0.08] text-center">
        <p className="text-[13.5px] text-[#85818A]">
          Are you a candidate?{' '}
          <Link to="/auth/candidate/login" className="text-[#141114] font-semibold hover:text-[#A4123F] transition-colors">Candidate Login →</Link>
        </p>
      </div>
    </AuthShell>
  )
}
