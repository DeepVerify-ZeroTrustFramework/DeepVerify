import React, { useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck, ArrowRight, Loader2, AlertCircle, UploadCloud, GraduationCap, CheckCircle2 } from 'lucide-react'
import { setAuth } from '../../utils/auth'

export default function CandidateSignup() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    phone: '',
    college: '',
    degree: '',
    graduationYear: new Date().getFullYear().toString(),
  })

  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('Please select a valid image file (JPEG or PNG).')
        return
      }
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
      setError('Please complete all required fields.')
      return
    }

    if (!photoFile) {
      setError('Please upload a passport-size photograph for identity ground-truth verification.')
      return
    }

    setLoading(true)

    try {
      const data = new FormData()
      data.append('full_name', formData.fullName)
      data.append('email', formData.email)
      data.append('password', formData.password)
      data.append('college', formData.college)
      data.append('degree', formData.degree)
      data.append('graduation_year', formData.graduationYear)
      if (formData.phone) data.append('phone', formData.phone)
      data.append('photo', photoFile)

      const res = await fetch('/api/auth/register/candidate', {
        method: 'POST',
        body: data,
      })

      let json: any = {}
      try {
        json = await res.json()
      } catch {
        throw new Error(`Server returned status ${res.status} with non-JSON response. Please check server logs.`)
      }

      if (!res.ok) {
        throw new Error(
          typeof json.detail === 'string'
            ? json.detail
            : json.detail?.message || 'Registration failed.'
        )
      }

      setAuth(json.token, json.user)
      navigate('/student/inbox')
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
            <p className="text-[10px] text-[#6B6B6B] leading-tight">Student Identity Enrollment</p>
          </div>
        </Link>
        <Link to="/auth/candidate/login" className="text-xs text-[#6B6B6B] hover:text-[#0F0F0F]">
          Already registered? <span className="text-[#A4123F] font-semibold">Sign In →</span>
        </Link>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-xl bg-white border border-[#EAEAEA] rounded-2xl p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[#FDF2F4] text-[#A4123F] flex items-center justify-center">
              <GraduationCap size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#0F0F0F]">Create Candidate Profile</h1>
              <p className="text-xs text-[#6B6B6B]">Enroll your academic identity and verified reference photograph</p>
            </div>
          </div>

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-[#991B1B]">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  placeholder="Jane Doe"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="jane.doe@university.edu"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                  Phone Number (Optional)
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="+1 (555) 000-0000"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                  College / University <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="college"
                  required
                  value={formData.college}
                  onChange={handleInputChange}
                  placeholder="Stanford University"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                  Degree & Major <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="degree"
                  required
                  value={formData.degree}
                  onChange={handleInputChange}
                  placeholder="B.S. Computer Science"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#3A3A3A] mb-1.5">
                Expected Graduation Year <span className="text-red-500">*</span>
              </label>
              <select
                name="graduationYear"
                value={formData.graduationYear}
                onChange={handleInputChange}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D5D5D7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A4123F]/20 focus:border-[#A4123F]"
              >
                {[2024, 2025, 2026, 2027, 2028, 2029].map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>

            {/* Passport Photograph Upload */}
            <div className="pt-2">
              <label className="block text-xs font-semibold text-[#3A3A3A] mb-1">
                Ground Truth Identity Photo <span className="text-red-500">*</span>
              </label>
              <p className="text-[11px] text-[#6B6B6B] mb-2">
                Upload a clear passport-size portrait. During technical interviews, AWS Rekognition CompareFaces will verify your live webcam feed against this image.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={handlePhotoSelect}
                className="hidden"
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                  photoPreview
                    ? 'border-[#1A6B3C] bg-[#F3FAF6]'
                    : 'border-[#D5D5D7] hover:border-[#A4123F] bg-[#FCFCFC]'
                }`}
              >
                {photoPreview ? (
                  <div className="flex items-center gap-4">
                    <img
                      src={photoPreview}
                      alt="Preview"
                      className="w-16 h-20 object-cover rounded-lg border border-[#1A6B3C] shadow-sm"
                    />
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#1A6B3C]">
                        <CheckCircle2 size={16} /> Photo Selected
                      </div>
                      <p className="text-[11px] text-[#6B6B6B] mt-0.5">{photoFile?.name}</p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          fileInputRef.current?.click()
                        }}
                        className="text-[11px] text-[#A4123F] font-semibold mt-1 hover:underline"
                      >
                        Change photo
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 mb-2">
                      <UploadCloud size={20} />
                    </div>
                    <p className="text-xs font-semibold text-[#0F0F0F]">
                      Click to upload passport photo
                    </p>
                    <p className="text-[10px] text-[#888] mt-0.5">JPG or PNG (Min 100KB, front-facing, neutral lighting)</p>
                  </>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-4 py-3 bg-[#A4123F] hover:bg-[#850E32] text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating Verified Account...
                </>
              ) : (
                <>
                  Complete Registration <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-[#F0F0F0] text-center">
            <p className="text-xs text-[#6B6B6B]">
              Already have an account?{' '}
              <Link to="/auth/candidate/login" className="text-[#A4123F] font-semibold hover:underline">
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </main>

      <footer className="py-4 text-center text-xs text-[#999]">
        DeepVerify © 2026 · Protected with PRNU Hardware & rPPG Biological Verification
      </footer>
    </div>
  )
}
