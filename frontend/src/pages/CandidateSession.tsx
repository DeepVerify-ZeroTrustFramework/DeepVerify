import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ShieldCheck, Loader2, Code2, AlertCircle, Clock } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { useWebRTC } from '../hooks/useWebRTC'
import { useBehavioralSocket } from '../hooks/useBehavioralSocket'

// ── Language templates ──
const LANGUAGE_TEMPLATES: Record<string, { lang: string; template: string }> = {
  'Python': {
    lang: 'python',
    template: `# Write your solution here...\n\ndef solution():\n    pass\n`,
  },
  'JavaScript': {
    lang: 'javascript',
    template: `// Write your solution here...\n\nfunction solution() {\n  \n}\n`,
  },
  'TypeScript': {
    lang: 'typescript',
    template: `// Write your solution here...\n\nfunction solution(): void {\n  \n}\n`,
  },
  'Java': {
    lang: 'java',
    template: `// Write your solution here...\n\npublic class Solution {\n    public static void main(String[] args) {\n        \n    }\n}\n`,
  },
  'C': {
    lang: 'c',
    template: `// Write your solution here...\n\n#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}\n`,
  },
  'C++': {
    lang: 'cpp',
    template: `// Write your solution here...\n\n#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n`,
  },
  'Go': {
    lang: 'go',
    template: `// Write your solution here...\n\npackage main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello")\n}\n`,
  },
  'Rust': {
    lang: 'rust',
    template: `// Write your solution here...\n\nfn main() {\n    \n}\n`,
  },
}

export default function CandidateSession() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  
  // Editor state
  const [selectedLang, setSelectedLang] = useState('Python')
  const [editorCode, setEditorCode] = useState(LANGUAGE_TEMPLATES['Python'].template)

  // Timer
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  
  // Telemetry mocks for UI
  const [gazeDelta, setGazeDelta] = useState(0)
  const [hr, setHr] = useState(72)

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(`/api/sessions/by-token/${token}`)
        if (!res.ok) throw new Error('Invalid or expired link')
        const data = await res.json()
        
        // Gate check (BUG 1 FIX)
        if (!data.check_completed) {
          navigate(`/check/${token}`, { replace: true })
          return
        }
        
        setSession(data)
        
        // Get camera for WebRTC
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
          setLocalStream(stream)
        } catch (e) {
          setError('Camera access is required. Please check permissions.')
        }
        
      } catch (err) {
        setError('Invalid or expired session link.')
      } finally {
        setLoading(false)
      }
    }
    init()
    
    // Cleanup stream on unmount
    return () => {
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop())
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, navigate])

  // Session timer
  useEffect(() => {
    if (!session) return
    timerRef.current = setInterval(() => {
      setElapsed(prev => prev + 1)
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [session])

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  // Initialize WebRTC
  const rtc = useWebRTC(session?.session_id || '', 'candidate', localStream)
  
  // Initialize Behavioral Socket
  const telemetry = useBehavioralSocket(session?.session_id || '', !!session)

  useEffect(() => {
    if (session && localStream) {
      rtc.initialize()
    }
    return () => {
      rtc.stop()
    }
  }, [session, localStream])

  // Mock telemetry generation (simulate MediaPipe/Frame metrics running locally)
  useEffect(() => {
    if (!session) return
    const interval = setInterval(() => {
      // Simulate normal gaze
      const delta = Math.random() * 0.15
      setGazeDelta(delta)
      telemetry.sendGaze(delta, (Math.random()-0.5)*10, (Math.random()-0.5)*10)
      
      // Simulate HR and frame metrics
      const newHr = Math.round(72 + Math.sin(Date.now()/1000) * 5)
      setHr(newHr)
      telemetry.sendFrameMetrics({
        pce: 85 + Math.random()*5,
        snr_rppg: 8 + Math.random()*2,
        cv_jitter: 0.04 + Math.random()*0.02,
        hr_bpm: newHr
      })
    }, 500)
    return () => clearInterval(interval)
  }, [session])

  // Language change handler
  const handleLanguageChange = (lang: string) => {
    setSelectedLang(lang)
    setEditorCode(LANGUAGE_TEMPLATES[lang].template)
  }

  if (loading) {
    return <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center"><Loader2 className="animate-spin text-white" /></div>
  }
  
  if (error || !session) {
    return <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center text-center p-6">
      <AlertCircle className="text-red-500 w-12 h-12 mb-4" />
      <h1 className="text-xl font-bold text-white mb-2">Error</h1>
      <p className="text-gray-400">{error}</p>
    </div>
  }

  return (
    <div className="h-screen bg-[#0A0A0A] flex flex-col overflow-hidden text-white font-sans">
      {/* Top bar — NO End Session button for candidate */}
      <div className="h-14 bg-[#0F0F0F] border-b border-[#1A1A1A] flex items-center justify-between px-6 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#1A6B3C]/10 border border-[#1A6B3C]/30 text-[#4CAF50] text-[11px] font-medium">
            <ShieldCheck size={14} /> Integrity Verified
          </div>
          <span className="text-sm font-medium text-gray-300 ml-2">{session.interview_type} Interview</span>
        </div>
        
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-1.5 text-gray-400">
            <Clock size={14} />
            <span className="font-mono">{formatTime(elapsed)}</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left: Video Area — NO media controls for candidate */}
        <div className="flex-1 relative flex flex-col p-4">
          <div className="flex-1 bg-[#11131A] rounded-xl border border-[#1A1A1A] relative overflow-hidden flex items-center justify-center">
            
            {/* Interviewer Video */}
            {rtc.remoteStream ? (
              <video 
                autoPlay playsInline
                ref={v => { if (v && v.srcObject !== rtc.remoteStream) v.srcObject = rtc.remoteStream }}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center flex flex-col items-center">
                <Loader2 size={32} className="animate-spin text-gray-500 mb-4" />
                <p className="text-gray-400 text-sm">
                  {rtc.state === 'error' ? rtc.error : 'Waiting for interviewer to join...'}
                </p>
              </div>
            )}

            {/* Self view PiP */}
            <div className="absolute bottom-6 right-6 w-48 aspect-video bg-black rounded-lg border border-gray-700 overflow-hidden shadow-2xl">
              {localStream && (
                <video 
                  autoPlay playsInline muted 
                  ref={v => { if (v) v.srcObject = localStream }}
                  className="w-full h-full object-cover scale-x-[-1]"
                />
              )}
            </div>

            {/* Candidate Name overlay */}
            <div className="absolute bottom-6 left-6 px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded-md text-[13px] font-medium border border-white/10">
              {session.candidate_name}
            </div>
          </div>
        </div>

        {/* Right: Code Editor with Monaco */}
        <div className="w-[450px] border-l border-[#1A1A1A] bg-[#11131A] flex flex-col">
          {/* Editor Header */}
          <div className="h-12 border-b border-[#1A1A1A] flex items-center justify-between px-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
              <Code2 size={16} className="text-blue-400" />
              Shared Editor
            </div>
            <select 
              value={selectedLang}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="bg-[#0A0A0A] border border-[#333] rounded px-2 py-1 text-xs text-gray-300 outline-none cursor-pointer"
            >
              {Object.keys(LANGUAGE_TEMPLATES).map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
          
          {/* Monaco Editor */}
          <div className="flex-1 overflow-hidden">
            <Editor
              height="100%"
              language={LANGUAGE_TEMPLATES[selectedLang].lang}
              value={editorCode}
              onChange={(value) => setEditorCode(value || '')}
              theme="vs-dark"
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                renderLineHighlight: 'line',
                tabSize: 4,
                insertSpaces: true,
                automaticLayout: true,
                wordWrap: 'on',
                padding: { top: 16, bottom: 16 },
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                bracketPairColorization: { enabled: true },
              }}
            />
          </div>

          {/* Telemetry Strip (Read-only for candidate) */}
          <div className="h-10 border-t border-[#1A1A1A] bg-[#0A0A0A] flex items-center px-4 gap-6 text-[10px] font-mono text-gray-500 tracking-wider">
            <div>GAZE Δ {gazeDelta.toFixed(3)}</div>
            <div>HR {hr} BPM</div>
            <div className="ml-auto text-green-700">● SECURE</div>
          </div>
        </div>
      </div>
    </div>
  )
}
