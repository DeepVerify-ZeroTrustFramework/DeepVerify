import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck, ArrowRight, Loader2, AlertCircle, Building2 } from 'lucide-react'
import { setAuth } from '../../utils/auth'

export default function RecruiterLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
      try {
        data = await res.json()
      } catch {
        throw new Error(`Server returned status ${res.status} with non-JSON response. Please check server logs.`)
      }

      if (!res.ok) {
        throw new Error(data.detail || 'Failed to sign in.')
      }

      setAuth(data.token, data.user)
      navigate('/recruiter/dashboard')
    } catch (err: any) {
      setError(err.message || 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col justify-between">
      {/* Top Bar */}
      <header className="px-6 py-4 border-b border-[#EAEAEA] bg-white flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#A4123F] flex items-center justify-center">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#0F0F0F] leading-tight">DeepVerify</p>
            <p className="text-[10px] text-[#6B6B6B] leading-tight">Company & Recruiter Portal</p>
          </div>
        </Link>
        <Link to="/auth/candidate/login" className="text-xs text-[#6B6B6B] hover:text-[#0F0F0F]">
          Are you a candidate? <span className="text-[#A4123F] font-semibold">Candidate Login →</span>
        </Link>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white border border-[#EAEAEA] rounded-2xl p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[#F0F4FF] text-[#1E40AF] flex items-center justify-center">
              <Building2 size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#0F0F0F]">Recruiter Sign In</h1>
              <p className="text-xs text-[#6B6B6B]">Manage interviews and view live integrity telemetry</p>
            </div>
          </div>

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-[#991B1B]">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                Work Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="recruiter@company.com"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F] transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F] transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 bg-[#0F0F0F] hover:bg-[#2A2A2A] text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Signing In...
                </>
              ) : (
                <>
                  Sign In to Dashboard <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-[#F0F0F0] text-center">
            <p className="text-xs text-[#6B6B6B]">
              New company or interviewer?{' '}
              <Link to="/auth/recruiter/signup" className="text-[#A4123F] font-semibold hover:underline">
                Create Recruiter Account
              </Link>
            </p>
          </div>
        </div>
      </main>

      <footer className="py-4 text-center text-xs text-[#999]">
        DeepVerify © 2026 · Standalone Zero-Trust Technical Interview Portal
      </footer>
    </div>
  )
}
