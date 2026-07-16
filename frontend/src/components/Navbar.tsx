import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#E4E4E6]">
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

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Platform online indicator */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E6F4ED] text-[#1A6B3C] text-[11px] font-medium">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#1A6B3C] opacity-75 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#1A6B3C]" />
            </span>
            Platform online
          </div>

          {/* Sign in */}
          <button className="px-4 py-2 text-sm font-medium text-[#3A3A3A] hover:text-[#0F0F0F] transition-colors">
            Sign in
          </button>

          {/* Create session CTA */}
          <Link
            to="/create"
            className="px-5 py-2 bg-[#A4123F] text-white text-sm font-semibold rounded-xl hover:bg-[#7A0D2E] transition-colors"
          >
            Create session
          </Link>
        </div>
      </div>
    </nav>
  )
}
