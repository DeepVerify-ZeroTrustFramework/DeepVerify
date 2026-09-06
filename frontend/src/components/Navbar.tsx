import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck, User, Building2, LogOut, Film } from 'lucide-react'
import { getAuthUser, clearAuth } from '../utils/auth'

export default function Navbar() {
  const navigate = useNavigate()
  const user = getAuthUser()

  const handleLogout = () => {
    clearAuth()
    navigate('/')
  }

  return (
    <nav className="fixed top-6 left-1/2 -translate-x-1/2 w-[90%] max-w-[1100px] z-50 rounded-[1.25rem] bg-white/70 backdrop-blur-xl border border-white/80 shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
      <div className="px-6 h-[4.5rem] flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#A4123F] flex items-center justify-center shadow-sm">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div className="flex flex-col justify-center">
            <p className="text-[15px] font-bold text-[#0F0F0F] leading-tight">DeepVerify</p>
            <p className="text-[11px] font-medium text-[#888888] leading-tight mt-0.5">Zero-Trust Interview Integrity</p>
          </div>
        </Link>

        {/* Right side navigation */}
        <div className="flex items-center gap-3">
          <Link
            to="/demo"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#FDF2F5] text-[#A4123F] text-xs font-semibold hover:bg-[#FBE8EC] transition-colors"
          >
            <Film size={13} /> Demo Mode
          </Link>
          {user ? (
            <div className="flex items-center gap-3">
              {user.role === 'candidate' ? (
                <Link
                  to="/student/inbox"
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#FDF2F4] text-[#A4123F] text-xs font-semibold hover:bg-[#FBE8EC] transition-colors"
                >
                  <User size={14} />
                  Candidate Inbox
                </Link>
              ) : (
                <Link
                  to="/recruiter/dashboard"
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#F0F4FF] text-[#1E40AF] text-xs font-semibold hover:bg-[#E0EAFF] transition-colors"
                >
                  <Building2 size={14} />
                  Company Dashboard
                </Link>
              )}

              <button
                onClick={handleLogout}
                className="p-1.5 text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
                title="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <Link
                to="/auth/candidate/login"
                className="text-[13px] font-semibold text-[#555555] hover:text-[#0F0F0F] transition-colors"
              >
                Candidate Portal
              </Link>

              <Link
                to="/auth/recruiter/login"
                className="flex items-center gap-2 px-5 py-2.5 bg-[#0F0F0F] text-white text-[13px] font-semibold rounded-full hover:bg-black transition-colors shadow-md"
              >
                <Building2 size={16} className="text-white/80" />
                Company Portal
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
