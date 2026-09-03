import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck, User, Building2, LogOut } from 'lucide-react'
import { getAuthUser, clearAuth } from '../utils/auth'

export default function Navbar() {
  const navigate = useNavigate()
  const user = getAuthUser()

  const handleLogout = () => {
    clearAuth()
    navigate('/')
  }

  return (
    <nav className="sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-[#E4E4E6]">
      <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#A4123F] flex items-center justify-center">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#0F0F0F] leading-tight">DeepVerify</p>
            <p className="text-[10px] text-[#6B6B6B] leading-tight">Zero-Trust Interview Integrity</p>
          </div>
        </Link>

        {/* Right side navigation */}
        <div className="flex items-center gap-3">
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
            <div className="flex items-center gap-2">
              <Link
                to="/auth/candidate/login"
                className="px-3.5 py-1.5 text-xs font-semibold text-[#3A3A3A] hover:text-[#0F0F0F] rounded-lg hover:bg-gray-100 transition-colors"
              >
                Candidate Portal
              </Link>

              <Link
                to="/auth/recruiter/login"
                className="px-4 py-1.5 bg-[#0F0F0F] text-white text-xs font-semibold rounded-xl hover:bg-[#2A2A2A] transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <Building2 size={13} />
                Company Portal
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
