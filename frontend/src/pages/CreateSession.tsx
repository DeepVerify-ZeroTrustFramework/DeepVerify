import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, Info, Loader2, Copy, CheckCircle2, Video, ArrowLeft, ArrowRight } from 'lucide-react'
import Navbar from '../components/Navbar'

export default function CreateSession() {
  const [form, setForm] = useState({
    candidateName: '',
    candidateEmail: '',
    interviewerName: '',
    role: '',
    duration: '60',
    interviewType: 'Technical',
    modules: {
      prnu: true,
      rppg: true,
      jitter: true,
    }
  })

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [copiedLink, setCopiedLink] = useState<'candidate' | 'dashboard' | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      // Create session via backend API
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_name: form.candidateName,
          candidate_email: form.candidateEmail,
          interviewer_name: form.interviewerName,
          role: form.role,
          duration: parseInt(form.duration),
          interview_type: form.interviewType,
          modules: form.modules
        })
      })

      if (!res.ok) throw new Error('Failed to create session')
      
      // Simulate slight delay for "generating..." effect
      await new Promise(resolve => setTimeout(resolve, 1100))
      
      const data = await res.json()
      setResult(data)
    } catch (err) {
      console.error(err)
      alert('Failed to create session. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text: string, type: 'candidate' | 'dashboard') => {
    navigator.clipboard.writeText(text)
    setCopiedLink(type)
    setTimeout(() => setCopiedLink(null), 2000)
  }

  // Handle module toggle
  const toggleModule = (key: keyof typeof form.modules) => {
    setForm(prev => ({
      ...prev,
      modules: { ...prev.modules, [key]: !prev.modules[key] }
    }))
  }

  return (
    <div className="min-h-screen bg-[#F7F7F8]">
      <Navbar />
      
      <div className="max-w-[960px] mx-auto px-6 py-12">
        {/* Back Link */}
        <Link to="/" className="inline-flex items-center gap-2 text-[13px] font-medium text-[#6B6B6B] hover:text-[#0F0F0F] transition-colors mb-6">
          <ArrowLeft size={16} /> Back to home
        </Link>

        {/* Header */}
        <div className="mb-8" style={{ animation: 'fadeUp 0.4s ease both' }}>
          <p className="text-[11px] uppercase tracking-widest text-[#A4123F] font-medium mb-2">Recruiter portal</p>
          <h1 className="text-[32px] font-bold text-[#0F0F0F] mb-3 leading-tight">Create an interview session</h1>
          <p className="text-[15px] text-[#6B6B6B] max-w-2xl leading-relaxed">
            Fill in the details below. A cryptographically scoped link will be generated and sent to the candidate. The link expires in 24 hours.
          </p>
        </div>

        {/* Security Info Box */}
        {!result && (
          <div className="mb-8 p-4 bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl flex items-start gap-3" style={{ animation: 'fadeUp 0.4s 0.1s ease both' }}>
            <Info size={20} className="text-[#1E3A8A] shrink-0 mt-0.5" />
            <p className="text-[13px] text-[#1E3A8A] leading-relaxed">
              The candidate portal only unlocks after this session is created. Each link is scoped to a single device enrollment — it cannot be shared or replayed.
            </p>
          </div>
        )}

        {/* Form or Success State */}
        <div className="bg-white border border-[#E4E4E6] rounded-[16px] shadow-sm overflow-hidden" style={{ animation: 'fadeUp 0.4s 0.2s ease both' }}>
          
          {result ? (
            /* SUCCESS STATE */
            <div className="p-8 animate-fade-in">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 rounded-full bg-[#E6F4ED] flex items-center justify-center shrink-0">
                  <CheckCircle2 size={24} className="text-[#1A6B3C]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[#0F0F0F] mb-1">Session created</h2>
                  <p className="text-[13px] text-[#6B6B6B]">Invite sent to {result.candidate_email} · expires 24 hours</p>
                </div>
              </div>

              {/* Links */}
              <div className="space-y-4 mb-8">
                {/* Candidate Link */}
                <div>
                  <label className="block text-[12px] font-semibold text-[#3A3A3A] mb-1.5">Candidate session link</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-4 py-2.5 bg-[#F7F7F8] border border-[#E4E4E6] rounded-xl font-mono text-[13px] text-[#0F0F0F] overflow-x-auto whitespace-nowrap">
                      {window.location.origin}{result.candidate_url}
                    </div>
                    <button 
                      onClick={() => copyToClipboard(`${window.location.origin}${result.candidate_url}`, 'candidate')}
                      className="shrink-0 px-4 py-2.5 border border-[#E4E4E6] rounded-xl text-[#3A3A3A] hover:bg-[#F7F7F8] transition-colors flex items-center gap-2 text-sm font-medium"
                    >
                      {copiedLink === 'candidate' ? <CheckCircle2 size={16} className="text-[#1A6B3C]" /> : <Copy size={16} />}
                      {copiedLink === 'candidate' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* Dashboard Link */}
                <div>
                  <label className="block text-[12px] font-semibold text-[#3A3A3A] mb-1.5">Your interviewer dashboard</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-4 py-2.5 bg-[#F7F7F8] border border-[#E4E4E6] rounded-xl font-mono text-[13px] text-[#0F0F0F] overflow-x-auto whitespace-nowrap">
                      {window.location.origin}{result.dashboard_url}
                    </div>
                    <button 
                      onClick={() => copyToClipboard(`${window.location.origin}${result.dashboard_url}`, 'dashboard')}
                      className="shrink-0 px-4 py-2.5 border border-[#E4E4E6] rounded-xl text-[#3A3A3A] hover:bg-[#F7F7F8] transition-colors flex items-center gap-2 text-sm font-medium"
                    >
                      {copiedLink === 'dashboard' ? <CheckCircle2 size={16} className="text-[#1A6B3C]" /> : <Copy size={16} />}
                      {copiedLink === 'dashboard' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Summary Card */}
              <div className="grid grid-cols-3 gap-6 p-5 bg-[#F7F7F8] border border-[#E4E4E6] rounded-xl mb-8">
                <div>
                  <p className="text-[11px] text-[#6B6B6B] mb-1">Candidate</p>
                  <p className="text-[14px] font-semibold text-[#0F0F0F]">{result.candidate_name}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#6B6B6B] mb-1">Role</p>
                  <p className="text-[14px] font-semibold text-[#0F0F0F]">{result.role}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#6B6B6B] mb-1">Duration</p>
                  <p className="text-[14px] font-semibold text-[#0F0F0F]">{result.duration} mins</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 border-t border-[#E4E4E6] pt-6">
                <button 
                  onClick={() => { setResult(null); setForm({...form, candidateName: '', candidateEmail: ''}) }}
                  className="px-5 py-2.5 text-sm font-medium text-[#3A3A3A] border border-[#E4E4E6] rounded-xl hover:bg-[#F7F7F8] transition-colors"
                >
                  New session
                </button>
                <Link
                  to={result.candidate_url}
                  className="px-5 py-2.5 text-sm font-medium text-[#3A3A3A] border border-[#E4E4E6] rounded-xl hover:bg-[#F7F7F8] transition-colors flex items-center gap-2"
                >
                  <Video size={16} /> Preview candidate flow
                </Link>
                <Link
                  to={result.dashboard_url}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-[#A4123F] rounded-xl hover:bg-[#7A0D2E] transition-colors ml-auto flex items-center gap-2"
                >
                  Open dashboard <ArrowRight size={16} />
                </Link>
              </div>
            </div>

          ) : (
            /* FORM STATE */
            <form onSubmit={handleSubmit} className="p-8">
              {/* Section 1 */}
              <div className="mb-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[12px] font-semibold text-[#3A3A3A] mb-1.5">Candidate name</label>
                    <input 
                      required
                      type="text"
                      value={form.candidateName}
                      onChange={e => setForm({...form, candidateName: e.target.value})}
                      className="w-full px-4 py-2.5 bg-white border border-[#E4E4E6] rounded-xl text-[14px] text-[#0F0F0F] focus:outline-none focus:border-[#A4123F] focus:ring-1 focus:ring-[#A4123F] transition-shadow placeholder-[#9B9B9B]"
                      placeholder="e.g. Naren Moorthy"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-[#3A3A3A] mb-1.5">Candidate email</label>
                    <input 
                      required
                      type="email"
                      value={form.candidateEmail}
                      onChange={e => setForm({...form, candidateEmail: e.target.value})}
                      className="w-full px-4 py-2.5 bg-white border border-[#E4E4E6] rounded-xl text-[14px] text-[#0F0F0F] focus:outline-none focus:border-[#A4123F] focus:ring-1 focus:ring-[#A4123F] transition-shadow placeholder-[#9B9B9B]"
                      placeholder="naren@example.com"
                    />
                    <p className="text-[11px] text-[#6B6B6B] mt-1.5 pl-1">Session link will be sent here</p>
                  </div>
                </div>
              </div>

              {/* Section 2 */}
              <div className="mb-8 pt-6 border-t border-[#E4E4E6]">
                <h3 className="text-[13px] font-semibold text-[#0F0F0F] mb-5">Session configuration</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-[12px] font-semibold text-[#3A3A3A] mb-1.5">Interviewer name</label>
                    <input 
                      required
                      type="text"
                      value={form.interviewerName}
                      onChange={e => setForm({...form, interviewerName: e.target.value})}
                      className="w-full px-4 py-2.5 bg-white border border-[#E4E4E6] rounded-xl text-[14px] text-[#0F0F0F] focus:outline-none focus:border-[#A4123F] transition-shadow placeholder-[#9B9B9B]"
                      placeholder="Dr. Senthilkumar"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-[#3A3A3A] mb-1.5">Role being interviewed for</label>
                    <input 
                      required
                      type="text"
                      value={form.role}
                      onChange={e => setForm({...form, role: e.target.value})}
                      className="w-full px-4 py-2.5 bg-white border border-[#E4E4E6] rounded-xl text-[14px] text-[#0F0F0F] focus:outline-none focus:border-[#A4123F] transition-shadow placeholder-[#9B9B9B]"
                      placeholder="Full Stack Engineer"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[12px] font-semibold text-[#3A3A3A] mb-1.5">Duration</label>
                    <div className="relative">
                      <select 
                        value={form.duration}
                        onChange={e => setForm({...form, duration: e.target.value})}
                        className="w-full px-4 py-2.5 bg-white border border-[#E4E4E6] rounded-xl text-[14px] text-[#0F0F0F] focus:outline-none focus:border-[#A4123F] appearance-none"
                      >
                        <option value="30">30 minutes</option>
                        <option value="60">60 minutes</option>
                        <option value="90">90 minutes</option>
                        <option value="120">120 minutes</option>
                      </select>
                      <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="#6B6B6B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-[#3A3A3A] mb-1.5">Interview type</label>
                    <div className="relative">
                      <select 
                        value={form.interviewType}
                        onChange={e => setForm({...form, interviewType: e.target.value})}
                        className="w-full px-4 py-2.5 bg-white border border-[#E4E4E6] rounded-xl text-[14px] text-[#0F0F0F] focus:outline-none focus:border-[#A4123F] appearance-none"
                      >
                        <option value="Technical">Technical</option>
                        <option value="Design">Design</option>
                        <option value="Behavioural">Behavioural</option>
                        <option value="Mixed">Mixed</option>
                      </select>
                      <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="#6B6B6B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3 */}
              <div className="mb-10 pt-6 border-t border-[#E4E4E6]">
                <h3 className="text-[13px] font-semibold text-[#0F0F0F] mb-5">Forensic modules</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  {/* PRNU Toggle */}
                  <label className={`relative flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${form.modules.prnu ? 'bg-[#FDF2F5] border-[#A4123F]' : 'bg-white border-[#E4E4E6] hover:border-[#D0D0D3]'}`}>
                    <div className="flex h-5 items-center">
                      <input type="checkbox" checked={form.modules.prnu} onChange={() => toggleModule('prnu')} className="h-4 w-4 rounded border-gray-300 text-[#A4123F] focus:ring-[#A4123F]" />
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-[13px] font-semibold ${form.modules.prnu ? 'text-[#7A0D2E]' : 'text-[#3A3A3A]'}`}>PRNU module</span>
                      <span className="text-[11px] text-[#6B6B6B]">Hardware fingerprint</span>
                    </div>
                  </label>

                  {/* rPPG Toggle */}
                  <label className={`relative flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${form.modules.rppg ? 'bg-[#FDF2F5] border-[#A4123F]' : 'bg-white border-[#E4E4E6] hover:border-[#D0D0D3]'}`}>
                    <div className="flex h-5 items-center">
                      <input type="checkbox" checked={form.modules.rppg} onChange={() => toggleModule('rppg')} className="h-4 w-4 rounded border-gray-300 text-[#A4123F] focus:ring-[#A4123F]" />
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-[13px] font-semibold ${form.modules.rppg ? 'text-[#7A0D2E]' : 'text-[#3A3A3A]'}`}>rPPG module</span>
                      <span className="text-[11px] text-[#6B6B6B]">Biological liveness</span>
                    </div>
                  </label>

                  {/* Jitter Toggle */}
                  <label className={`relative flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${form.modules.jitter ? 'bg-[#FDF2F5] border-[#A4123F]' : 'bg-white border-[#E4E4E6] hover:border-[#D0D0D3]'}`}>
                    <div className="flex h-5 items-center">
                      <input type="checkbox" checked={form.modules.jitter} onChange={() => toggleModule('jitter')} className="h-4 w-4 rounded border-gray-300 text-[#A4123F] focus:ring-[#A4123F]" />
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-[13px] font-semibold ${form.modules.jitter ? 'text-[#7A0D2E]' : 'text-[#3A3A3A]'}`}>Jitter module</span>
                      <span className="text-[11px] text-[#6B6B6B]">Network rendering</span>
                    </div>
                  </label>
                </div>
                <p className="text-[11px] text-[#6B6B6B] italic pl-1">Note: Behavioral telemetry is always active and cannot be disabled.</p>
              </div>

              {/* Submit */}
              <button 
                type="submit" 
                disabled={loading}
                className="w-full h-14 bg-[#A4123F] text-white text-[15px] font-semibold rounded-xl hover:bg-[#7A0D2E] transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <ShieldCheck size={18} />
                    Generate session link
                  </>
                )}
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  )
}
