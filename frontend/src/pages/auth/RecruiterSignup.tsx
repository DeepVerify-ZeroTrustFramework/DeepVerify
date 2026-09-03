import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck, ArrowRight, Loader2, AlertCircle, Building2 } from 'lucide-react'
import { setAuth } from '../../utils/auth'

export default function RecruiterSignup() {
  const navigate = useNavigate()

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    companyName: '',
    designation: '',
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!formData.fullName || !formData.email || !formData.password || !formData.companyName || !formData.designation) {
      setError('Please fill in all fields.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/register/recruiter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: formData.fullName,
          email: formData.email,
          password: formData.password,
          company_name: formData.companyName,
          designation: formData.designation,
        }),
      })

      let data: any = {}
      try {
        data = await res.json()
      } catch {
        throw new Error(`Server returned status ${res.status} with non-JSON response. Please check server logs.`)
      }

      if (!res.ok) {
        throw new Error(data.detail || 'Registration failed.')
      }

      setAuth(data.token, data.user)
      navigate('/recruiter/dashboard')
    } catch (err: any) {
      setError(err.message || 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col justify-between">
      {/* Header */}
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
        <Link to="/auth/recruiter/login" className="text-xs text-[#6B6B6B] hover:text-[#0F0F0F]">
          Already have an account? <span className="text-[#A4123F] font-semibold">Sign In →</span>
        </Link>
      </header>

      {/* Main Form */}
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg bg-white border border-[#EAEAEA] rounded-2xl p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[#F0F4FF] text-[#1E40AF] flex items-center justify-center">
              <Building2 size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#0F0F0F]">Create Recruiter Account</h1>
              <p className="text-xs text-[#6B6B6B]">Start inviting candidates and monitoring interview integrity</p>
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
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="fullName"
                required
                value={formData.fullName}
                onChange={handleInputChange}
                placeholder="Alex Mercer"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                Work Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                name="email"
                required
                value={formData.email}
                onChange={handleInputChange}
                placeholder="alex@techcorp.com"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                name="password"
                required
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Min. 6 characters"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                  Company Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="companyName"
                  required
                  value={formData.companyName}
                  onChange={handleInputChange}
                  placeholder="TechCorp Global"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                  Designation / Role <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="designation"
                  required
                  value={formData.designation}
                  onChange={handleInputChange}
                  placeholder="Senior Technical Recruiter"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-4 py-3 bg-[#0F0F0F] hover:bg-[#2A2A2A] text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating Company Account...
                </>
              ) : (
                <>
                  Register Company Account <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-[#F0F0F0] text-center">
            <p className="text-xs text-[#6B6B6B]">
              Already have an account?{' '}
              <Link to="/auth/recruiter/login" className="text-[#A4123F] font-semibold hover:underline">
                Sign In
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
