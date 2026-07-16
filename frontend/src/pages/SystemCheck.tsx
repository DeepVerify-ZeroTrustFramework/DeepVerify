import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ShieldCheck, Loader2, Camera, AlertCircle, Wifi, Cpu, HeartPulse, Eye, FileText, CheckCircle2 } from 'lucide-react'
import { useSystemCheck } from '../hooks/useSystemCheck'

export default function SystemCheck() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(`/api/sessions/by-token/${token}`)
        if (!res.ok) throw new Error('Invalid or expired link')
        const data = await res.json()
        
        // Gate check (BUG 1 FIX)
        if (data.check_completed) {
          navigate(`/session/${token}`, { replace: true })
          return
        }
        
        setSession(data)
      } catch (err) {
        setError('Invalid or expired session link.')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [token, navigate])

  if (loading) {
    return <div className="min-h-screen bg-white flex items-center justify-center"><Loader2 className="animate-spin text-[#A4123F]" /></div>
  }
  
  if (error || !session) {
    return <div className="min-h-screen bg-white flex flex-col items-center justify-center text-center p-6">
      <AlertCircle className="text-[#991B1B] w-12 h-12 mb-4" />
      <h1 className="text-xl font-bold text-[#0F0F0F] mb-2">Access Denied</h1>
      <p className="text-[#6B6B6B]">{error}</p>
    </div>
  }

  return <SystemCheckWizard session={session} />
}

function SystemCheckWizard({ session }: { session: any }) {
  const { 
    currentStep, nextStep, stream, deviceName, virtualError,
    rtt, connType, prnuFrames, rppgBpm, gazeLambda,
    actions
  } = useSystemCheck(session.session_id)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stepLoading, setStepLoading] = useState(false)
  const [consentInput, setConsentInput] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const steps = [
    { n: 1, label: 'Permissions' },
    { n: 2, label: 'Network' },
    { n: 3, label: 'PRNU' },
    { n: 4, label: 'rPPG' },
    { n: 5, label: 'Gaze' },
    { n: 6, label: 'Consent' },
    { n: 7, label: 'Ready' }
  ]

  const handleStep = async () => {
    setStepLoading(true)
    let ok = false
    if (currentStep === 1) ok = await actions.requestPermissions()
    if (currentStep === 2) ok = await actions.measureNetwork()
    if (currentStep === 3) ok = await actions.enrollPrnu()
    if (currentStep === 4) ok = await actions.enrollRppg()
    if (currentStep === 5) ok = await actions.enrollGaze()
    if (currentStep === 6) ok = await actions.submitConsent(consentInput)
    if (currentStep === 7) {
      ok = await actions.finishCheck()
      if (ok) {
        navigate(`/session/${session.token}`, { replace: true })
        return
      }
    }

    if (ok) nextStep()
    setStepLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#F7F7F8] flex flex-col">
      {/* Top bar */}
      <div className="h-16 bg-white border-b border-[#E4E4E6] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#A4123F] flex items-center justify-center">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <span className="text-sm font-bold text-[#0F0F0F]">System Check</span>
        </div>
        <div className="text-[13px] font-medium text-[#6B6B6B]">
          Candidate: {session.candidate_name}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-[600px] bg-white rounded-2xl shadow-sm border border-[#E4E4E6] overflow-hidden">
          
          {/* Progress header */}
          <div className="px-8 py-6 border-b border-[#E4E4E6] bg-[#FDF2F5]">
            <div className="flex justify-between items-center mb-4">
              {steps.map(s => (
                <div key={s.n} className="flex flex-col items-center gap-2">
                  <div className={`w-3 h-3 rounded-full transition-colors ${currentStep >= s.n ? 'bg-[#A4123F]' : 'bg-[#EDD0D8]'}`} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[11px] font-semibold text-[#A4123F] uppercase tracking-wider">
              <span>Step {currentStep} of 7</span>
              <span>{steps[currentStep - 1].label}</span>
            </div>
          </div>

          <div className="p-8 min-h-[340px] flex flex-col">
            
            {/* Step 1: Permissions */}
            {currentStep === 1 && (
              <div className="flex-1 animate-fade-in">
                <div className="w-12 h-12 rounded-xl bg-[#F9ECF0] flex items-center justify-center mb-6">
                  <Camera className="text-[#A4123F]" />
                </div>
                <h2 className="text-xl font-bold text-[#0F0F0F] mb-3">Camera & Hardware Access</h2>
                <p className="text-[14px] text-[#6B6B6B] mb-6 leading-relaxed">
                  DeepVerify requires raw access to your physical camera to generate cryptographic hardware fingerprints. Virtual cameras (OBS, Snap Camera, etc.) are strictly prohibited.
                </p>
                {virtualError && (
                  <div className="p-3 mb-6 rounded-lg bg-[#FEE2E2] border border-[#FCA5A5] text-[#991B1B] text-[13px] flex gap-2">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" /> {virtualError}
                  </div>
                )}
                <div className="mt-auto">
                  <button onClick={handleStep} disabled={stepLoading} className="w-full h-12 bg-[#A4123F] text-white font-semibold rounded-xl hover:bg-[#7A0D2E] transition-colors flex justify-center items-center gap-2">
                    {stepLoading ? <Loader2 size={16} className="animate-spin" /> : 'Grant Permissions'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Network */}
            {currentStep === 2 && (
              <div className="flex-1 animate-fade-in">
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mb-6">
                  <Wifi className="text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-[#0F0F0F] mb-3">Network Profiling</h2>
                <p className="text-[14px] text-[#6B6B6B] mb-6 leading-relaxed">
                  Measuring your STUN/TURN latencies and establishing a connection baseline. This detects routing anomalies used by rendering proxies.
                </p>
                
                {/* Result box (appears as measuring) */}
                <div className="bg-[#F7F7F8] rounded-xl p-4 mb-6">
                  <div className="flex justify-between items-center text-[13px] mb-2">
                    <span className="text-[#6B6B6B]">Round Trip Time (RTT)</span>
                    <span className="font-semibold text-[#0F0F0F]">{rtt !== null ? `${rtt} ms` : 'Measuring...'}</span>
                  </div>
                  <div className="flex justify-between items-center text-[13px]">
                    <span className="text-[#6B6B6B]">Classification</span>
                    <span className="font-semibold text-[#0F0F0F] capitalize">{connType || 'Measuring...'}</span>
                  </div>
                </div>

                <div className="mt-auto">
                  <button onClick={handleStep} disabled={stepLoading} className="w-full h-12 bg-[#A4123F] text-white font-semibold rounded-xl hover:bg-[#7A0D2E] transition-colors flex justify-center items-center gap-2">
                    {stepLoading ? <Loader2 size={16} className="animate-spin" /> : 'Run Diagnostics'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: PRNU */}
            {currentStep === 3 && (
              <div className="flex-1 animate-fade-in">
                <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mb-6">
                  <Cpu className="text-amber-600" />
                </div>
                <h2 className="text-xl font-bold text-[#0F0F0F] mb-3">PRNU Hardware Calibration</h2>
                <p className="text-[14px] text-[#6B6B6B] mb-6 leading-relaxed">
                  Extracting the unique sensor noise pattern (K̂) from your camera. Please keep the camera completely still for 3 seconds.
                </p>
                
                <div className="mb-6">
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-[#6B6B6B]">I-frames captured</span>
                    <span className="font-medium text-[#0F0F0F]">{prnuFrames} / 90</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#EFEFF0] overflow-hidden">
                    <div className="h-full bg-amber-500 transition-all duration-100" style={{ width: `${(prnuFrames/90)*100}%` }} />
                  </div>
                </div>

                <div className="mt-auto">
                  <button onClick={handleStep} disabled={stepLoading} className="w-full h-12 bg-[#A4123F] text-white font-semibold rounded-xl hover:bg-[#7A0D2E] transition-colors flex justify-center items-center gap-2">
                    {stepLoading ? 'Calibrating...' : 'Start Calibration'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: rPPG */}
            {currentStep === 4 && (
              <div className="flex-1 animate-fade-in">
                <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mb-6">
                  <HeartPulse className="text-red-500" />
                </div>
                <h2 className="text-xl font-bold text-[#0F0F0F] mb-3">rPPG Liveness Baseline</h2>
                <p className="text-[14px] text-[#6B6B6B] mb-6 leading-relaxed">
                  Extracting micro-color variations from your face to establish a biological pulse baseline. Look directly at the camera.
                </p>
                
                <div className="flex justify-center mb-6">
                  <div className="text-center p-4 rounded-xl border border-red-100 bg-red-50/50 min-w-[120px]">
                    <span className="block text-[11px] text-red-600/70 font-semibold uppercase tracking-wider mb-1">Heart Rate</span>
                    <span className={`text-3xl font-bold text-red-600 font-mono ${stepLoading ? 'animate-heartbeat' : ''}`}>
                      {rppgBpm || '--'} <span className="text-sm">BPM</span>
                    </span>
                  </div>
                </div>

                <div className="mt-auto">
                  <button onClick={handleStep} disabled={stepLoading} className="w-full h-12 bg-[#A4123F] text-white font-semibold rounded-xl hover:bg-[#7A0D2E] transition-colors flex justify-center items-center gap-2">
                    {stepLoading ? 'Capturing baseline...' : 'Start Capture'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 5: Gaze */}
            {currentStep === 5 && (
              <div className="flex-1 animate-fade-in">
                <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center mb-6">
                  <Eye className="text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-[#0F0F0F] mb-3">Behavioral & Gaze Setup</h2>
                <p className="text-[14px] text-[#6B6B6B] mb-6 leading-relaxed">
                  Mapping your screen bounding box and natural head pose. Look at the corners of your screen.
                </p>
                
                {gazeLambda && (
                  <div className="p-3 mb-6 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2 text-[13px] text-green-800">
                    <CheckCircle2 size={16} /> Gaze lambda threshold set to {gazeLambda}
                  </div>
                )}

                <div className="mt-auto">
                  <button onClick={handleStep} disabled={stepLoading} className="w-full h-12 bg-[#A4123F] text-white font-semibold rounded-xl hover:bg-[#7A0D2E] transition-colors flex justify-center items-center gap-2">
                    {stepLoading ? <Loader2 size={16} className="animate-spin" /> : 'Calibrate Screen'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 6: Consent */}
            {currentStep === 6 && (
              <div className="flex-1 animate-fade-in">
                <div className="w-12 h-12 rounded-xl bg-[#F7F7F8] flex items-center justify-center mb-6">
                  <FileText className="text-[#6B6B6B]" />
                </div>
                <h2 className="text-xl font-bold text-[#0F0F0F] mb-3">Forensic Consent</h2>
                <p className="text-[14px] text-[#6B6B6B] mb-6 leading-relaxed">
                  By proceeding, you consent to continuous forensic analysis of your video stream, network activity, and browser behavior during this session.
                </p>
                
                <div className="mb-6">
                  <label className="block text-[12px] font-semibold text-[#3A3A3A] mb-1.5">Type "I CONSENT" to proceed</label>
                  <input 
                    type="text" 
                    value={consentInput}
                    onChange={e => setConsentInput(e.target.value)}
                    placeholder="I CONSENT"
                    className="w-full px-4 py-3 bg-white border border-[#E4E4E6] rounded-xl text-[14px] font-bold focus:border-[#A4123F] focus:ring-1 focus:ring-[#A4123F] outline-none"
                  />
                </div>

                <div className="mt-auto">
                  <button 
                    onClick={handleStep} 
                    disabled={stepLoading || consentInput !== 'I CONSENT'} 
                    className="w-full h-12 bg-[#A4123F] text-white font-semibold rounded-xl hover:bg-[#7A0D2E] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Accept & Continue
                  </button>
                </div>
              </div>
            )}

            {/* Step 7: Ready */}
            {currentStep === 7 && (
              <div className="flex-1 animate-fade-in flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-full bg-[#E6F4ED] flex items-center justify-center mb-6 animate-check-pop">
                  <CheckCircle2 size={32} className="text-[#1A6B3C]" />
                </div>
                <h2 className="text-2xl font-bold text-[#0F0F0F] mb-2">You're all set.</h2>
                <p className="text-[15px] text-[#6B6B6B] mb-8">
                  Your device has been verified and enrolled. Good luck with your interview.
                </p>
                
                <button onClick={handleStep} disabled={stepLoading} className="w-full h-14 bg-[#A4123F] text-white text-[15px] font-bold rounded-xl hover:bg-[#7A0D2E] transition-colors flex justify-center items-center gap-2">
                  {stepLoading ? <Loader2 size={18} className="animate-spin" /> : 'Begin interview'}
                </button>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Persistent mini preview strip after step 1 */}
      <div className={`fixed bottom-6 left-6 transition-all duration-500 ${currentStep > 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="w-48 bg-white p-2 rounded-xl border border-[#E4E4E6] shadow-lg">
          <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-[#0A0A0A]">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
            <div className="absolute top-2 right-2 flex gap-1">
              {currentStep > 3 && <div className="w-2 h-2 rounded-full bg-amber-500" />}
              {currentStep > 4 && <div className="w-2 h-2 rounded-full bg-red-500" />}
              {currentStep > 5 && <div className="w-2 h-2 rounded-full bg-green-500" />}
            </div>
          </div>
          <div className="mt-2 text-center text-[10px] font-medium text-[#6B6B6B] truncate px-1">
            {deviceName}
          </div>
        </div>
      </div>
    </div>
  )
}
