import React from 'react'
import { Link, useLocation } from 'react-router-dom'

export const DemoNav: React.FC = () => {
  const location = useLocation()
  
  const tabs = [
    { label: 'Landing', path: '/' },
    { label: 'System check', path: '/session/demo-token' },
    { label: 'Live session', path: '/interview/demo-session' },
    { label: 'Dashboard', path: '/dashboard/demo-session' },
  ]

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path.split('/')[1])
  }

  return (
    <div className="bg-[#1c1c1c] border-b border-[#333333] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#be123c] flex items-center justify-center">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          </div>
          <div>
            <h1 className="text-[15px] font-medium text-[#f43f5e] leading-tight">DeepVerify</h1>
            <p className="text-[11px] text-[#60a5fa] font-medium leading-tight mt-0.5">Zero-Trust Interview Integrity</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {tabs.map((tab) => (
            <Link
              key={tab.path}
              to={tab.path}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                isActive(tab.path)
                  ? 'bg-[#333333] text-white border-[#555555]'
                  : 'text-gray-300 border-[#333333] hover:text-white hover:border-[#444444]'
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        
        <div className="w-10"></div>
      </div>
    </div>
  )
}
