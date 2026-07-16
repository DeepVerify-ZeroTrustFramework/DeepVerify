import { Link, useSearchParams } from 'react-router-dom'
import { ShieldAlert, Home } from 'lucide-react'
import Navbar from '../components/Navbar'

export default function NotFound() {
  const [params] = useSearchParams()
  const message = params.get('message') || 'This session link is invalid or has expired.'

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] px-4">
        <div
          className="text-center max-w-md"
          style={{ animation: 'fadeUp 0.4s ease both' }}
        >
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[#FEE2E2] flex items-center justify-center">
            <ShieldAlert size={28} className="text-[#991B1B]" />
          </div>
          <h1 className="text-2xl font-bold text-[#0F0F0F] mb-3">Page not found</h1>
          <p className="text-[15px] text-[#6B6B6B] leading-relaxed mb-8">
            {message}
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#A4123F] text-white text-sm font-semibold rounded-xl hover:bg-[#7A0D2E] transition-colors"
          >
            <Home size={16} />
            Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}
