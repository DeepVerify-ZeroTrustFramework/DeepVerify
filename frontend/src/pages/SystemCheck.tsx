import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { 
  ShieldCheck, Loader2, Camera, AlertCircle, AlertTriangle, RefreshCw, Wifi, Cpu, 
  HeartPulse, Eye, FileText, CheckCircle2, Volume2, VolumeX, Monitor,
  UploadCloud, UserCheck
} from 'lucide-react'
import { useSystemCheck } from '../hooks/useSystemCheck'
import { useTTS } from '../hooks/useTTS'

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
    return <div className="min-h-screen flex items-center justify-center"><div className="glass-tile !w-16 !h-16 !rounded-[20px]"><Loader2 className="animate-spin text-[#A4123F]" /></div></div>
  }
  
  if (error || !session) {
    return <div className="min-h-screen flex flex-col items-center justify-center text-center p-6">
      <div className="glass-strong liquid rounded-[32px] px-12 py-12 flex flex-col items-center max-w-md w-full">
      <div className="glass-tile !w-16 !h-16 !rounded-[20px] mb-5"><AlertCircle className="text-[#991B1B] w-8 h-8" /></div>
      <h1 className="text-[22px] font-bold text-[#141114] tracking-[-0.02em] mb-2">Access Denied</h1>
      <p className="text-[15px] text-[#67636C]">{error}</p>
      </div>
    </div>
  }

  return <SystemCheckWizard session={session} />
}

function SystemCheckWizard({ session }: { session: any }) {
  const { 
    currentStep, nextStep, stream, deviceName, virtualError, hardwareError,
    availableCameras, selectedCameraId, hasAudio,
    rtt, connType, prnuFrames, rppgBpm, gazeLambda,
    referencePhotoUrl, photoUploading, photoError, isPhotoValidated,
    actions
  } = useSystemCheck(session.session_id)

  const { isMuted, isSpeaking, toggleMute, speak, cancel } = useTTS(session.session_id)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [localPhotoPreview, setLocalPhotoPreview] = useState<string | null>(null)
  const [stepLoading, setStepLoading] = useState(false)
  const [consentInput, setConsentInput] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  // Narrate instructions when entering each step
  useEffect(() => {
    const stepNarrations: Record<number, string> = {
      1: "Camera and Hardware Access. DeepVerify requires raw access to your physical camera to generate cryptographic hardware fingerprints.",
      2: "Network Profiling. Measuring your STUN and TURN latencies and establishing a connection baseline.",
      3: "PRNU Hardware Calibration. Extracting the unique sensor noise pattern from your camera. Please keep the camera completely still for 3 seconds.",
      4: "rPPG Liveness Baseline. Extracting micro-color variations from your face to establish a biological pulse baseline. Look directly at the camera.",
      5: "Behavioral and Gaze Setup. Mapping your screen bounding box and natural head pose. Look at the corners of your screen.",
      6: "Identity Photograph Upload. Please upload a clear passport-size photo. This image will be verified against your live video stream using AWS Rekognition.",
      7: "Forensic Consent. By proceeding, you consent to continuous forensic analysis of your video stream, network activity, and browser behavior during this session. Type I CONSENT to proceed.",
      8: "You're all set. Your device has been verified and enrolled. Good luck with your interview."
    }

    const text = stepNarrations[currentStep]
    if (text) {
      speak(text)
    }

    return () => {
      cancel()
    }
  }, [currentStep, speak, cancel])

  // Read out any error that appears during device checks
  useEffect(() => {
    if (virtualError) {
      speak(virtualError)
    } else if (hardwareError) {
      speak(hardwareError.message)
    }
  }, [virtualError, hardwareError, speak])

  // Read out network measurement results when ready in Step 2
  useEffect(() => {
    if (connType && rtt !== null && currentStep === 2) {
      speak(`Network classified as ${connType} with round trip time of ${rtt} milliseconds.`)
    }
  }, [connType, rtt, currentStep, speak])

  const steps = [
    { n: 1, label: 'Permissions' },
    { n: 2, label: 'Network' },
    { n: 3, label: 'PRNU' },
    { n: 4, label: 'rPPG' },
    { n: 5, label: 'Gaze' },
    { n: 6, label: 'ID Photo' },
    { n: 7, label: 'Consent' },
    { n: 8, label: 'Ready' }
  ]

  const handleStep = async () => {
    setStepLoading(true)
    let ok = false

    if (currentStep === 1) {
      if (!stream) {
        ok = await actions.requestPermissions()
        if (ok) {
          speak("Physical camera verified.")
        }
      } else {
        ok = true
      }
    }

    if (currentStep === 2) {
      ok = await actions.measureNetwork()
      if (!ok) {
        speak("Network measurement failed. Please check your internet connection.")
      }
    }

    if (currentStep === 3) {
      ok = await actions.enrollPrnu()
      if (ok) {
        speak("Camera sensor noise calibrated.")
      } else {
        speak("PRNU calibration failed. Please ensure the camera remains still.")
      }
    }

    if (currentStep === 4) {
      ok = await actions.enrollRppg()
      if (ok) {
        speak("Biological pulse baseline established.")
      } else {
        speak("Biological liveness baseline capture failed. Please look directly at the camera and ensure proper lighting.")
      }
    }

    if (currentStep === 5) {
      ok = await actions.enrollGaze()
      if (ok) {
        speak("Screen and gaze calibration complete.")
      } else {
        speak("Gaze calibration failed. Please look at the screen.")
      }
    }

    if (currentStep === 6) {
      if (!isPhotoValidated) {
        speak("Please upload a clear identity photograph to proceed.")
        ok = false
      } else {
        speak("Reference photo verified.")
        ok = true
      }
    }

    if (currentStep === 7) {
      if (consentInput !== 'I CONSENT') {
        speak("Please type I CONSENT exactly to proceed.")
        ok = false
      } else {
        ok = await actions.submitConsent(consentInput)
        if (ok) {
          speak("Consent confirmed.")
        } else {
          speak("Consent submission failed. Please try again.")
        }
      }
    }

    if (currentStep === 8) {
      ok = await actions.finishCheck()
      if (ok) {
        cancel()
        navigate(`/session/${session.token}`, { replace: true })
        return
      } else {
        speak("Failed to complete system check. Please try again.")
      }
    }

    if (ok) nextStep()
    setStepLoading(false)
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <div className="shrink-0 max-w-[1320px] w-full mx-auto px-4 sm:px-6 pt-5">
        <div className="min-h-[4.25rem] rounded-[24px] glass liquid flex flex-wrap items-center justify-between gap-3 pl-3 pr-3 py-2">
        <div className="flex items-center gap-3">
          <div className="glass-tile-maroon !w-11 !h-11 !rounded-[13px]">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div>
            <span className="block text-[16px] font-bold text-[#141114] tracking-[-0.015em] leading-tight">System Check</span>
            <span className="block text-[10.5px] font-semibold text-[#85818A] uppercase tracking-[0.12em] mt-0.5">Device enrolment before your interview</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Speaking indicator */}
          {isSpeaking && (
            <div className="glass-chip !px-3 !py-1.5 !text-[12px] text-[#A4123F] animate-fade-in">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#A4123F] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#A4123F]"></span>
              </span>
              <span>Speaking...</span>
            </div>
          )}

          {/* Mute / Unmute Toggle */}
          <button
            onClick={toggleMute}
            title={isMuted ? "Unmute voice narration" : "Mute voice narration"}
            className={`glass-btn !rounded-full px-3.5 py-2 text-[13px] ${
              isMuted
                ? '!text-[#85818A]'
                : '!text-[#A4123F]'
            }`}
          >
            {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            <span>{isMuted ? 'Muted' : 'Voice on'}</span>
          </button>


          <div className="text-[13px] font-medium text-[#55515A] pl-3 pr-2 py-2 rounded-full bg-white/40 border border-white/80">
            Candidate: {session.candidate_name}
          </div>
        </div>
        </div>
      </div>

      <div className="flex-1 w-full max-w-[1320px] mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6 items-start">

        {/* Steps rail (display only) */}
        <aside className="hidden lg:flex flex-col gap-5 sticky top-6">
          <div className="glass liquid rounded-[28px] p-5">
            <div className="glass-label !text-[11px] px-2 mb-3">Setup progress</div>
            <ol className="flex flex-col gap-1">
              {steps.map(s => (
                <li key={s.n} className={`flex items-center gap-3 px-2.5 py-2 rounded-[14px] transition-colors ${currentStep === s.n ? 'bg-white/80 shadow-[inset_0_1px_0_#fff,0_6px_16px_-10px_rgba(20,14,18,0.35)]' : ''}`}>
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0 transition-colors ${currentStep > s.n ? 'bg-[#1A6B3C] text-white' : currentStep === s.n ? 'bg-gradient-to-b from-[#B01848] to-[#7A0D2E] text-white shadow-[0_6px_14px_-6px_rgba(164,18,63,0.8)]' : 'bg-white/60 border border-[rgba(20,17,20,0.10)] text-[#85818A]'}`}>
                    {currentStep > s.n ? <CheckCircle2 size={14} /> : s.n}
                  </span>
                  <span className={`text-[13.5px] font-semibold ${currentStep === s.n ? 'text-[#141114]' : currentStep > s.n ? 'text-[#4A464E]' : 'text-[#9A979E]'}`}>{s.label}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="glass-soft rounded-[22px] px-5 py-4 text-[12.5px] text-[#67636C] leading-relaxed">
            Stay in good light and keep your camera still. Each step takes a few seconds.
          </div>
        </aside>

        <div className="w-full glass-strong liquid rounded-[32px] overflow-hidden">

          {/* Progress header */}
          <div className="px-8 sm:px-10 pt-8 pb-6 border-b border-[rgba(20,17,20,0.06)]">
            <div className="flex justify-between items-center gap-1.5 mb-4">
              {steps.map(s => (
                <div key={s.n} className="flex-1 flex flex-col items-center gap-2">
                  <div className={`w-full h-1.5 rounded-full transition-colors duration-500 ${currentStep >= s.n ? 'bg-gradient-to-r from-[#B01848] to-[#7A0D2E]' : 'bg-[rgba(20,17,20,0.08)]'}`} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[11px] font-semibold text-[#A4123F] uppercase tracking-[0.14em]">
              <span>Step {currentStep} of {steps.length}</span>
              <span className="text-[#55515A]">{steps[currentStep - 1]?.label || ''}</span>
            </div>
          </div>

          <div className="p-8 sm:p-10 min-h-[460px] flex flex-col">

            {/* Step 1: Permissions */}
            {currentStep === 1 && (
              <div className="flex-1 animate-fade-in flex flex-col">
                <div className="flex items-center justify-between mb-5">
                  <div className="glass-tile !w-14 !h-14 !rounded-[18px]">
                    <Camera className="text-[#A4123F]" />
                  </div>
                  {stream && !virtualError && !hardwareError && (
                    <span className="glass-chip !px-3 !py-1.5 !text-[12px] text-[#137333]">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      Hardware Ready
                    </span>
                  )}
                </div>

                <h2 className="text-[clamp(24px,2.2vw,30px)] font-bold text-[#141114] tracking-[-0.03em] mb-2">Camera & Hardware Access</h2>
                <p className="text-[15px] text-[#67636C] mb-6 leading-relaxed max-w-[640px]">
                  DeepVerify requires raw access to your physical camera to generate cryptographic hardware fingerprints. Virtual cameras (OBS, Snap Camera, etc.) are strictly prohibited.
                </p>

                {/* 1. Hardware Access & Permissions Troubleshooting Card */}
                {hardwareError && (
                  <div className="p-5 mb-6 rounded-[20px] bg-[rgba(255,245,245,0.8)] border border-[#FED7D7] text-[#9B2C2C] text-[13.5px] flex flex-col gap-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                    <div className="flex gap-3 items-start">
                      <AlertTriangle size={18} className="shrink-0 text-amber-600 mt-0.5" />
                      <div className="flex-1">
                        <strong className="text-[#9B2C2C] block font-bold text-[14.5px] mb-1">
                          {hardwareError.title}
                        </strong>
                        <p className="text-[#742A2A] leading-relaxed mb-3">
                          {hardwareError.message}
                        </p>
                        <div className="p-3.5 bg-white/85 rounded-[14px] border border-[#FEB2B2]/70 text-[12.5px] text-[#4A5568]">
                          <strong className="block text-[#2D3748] mb-1 font-semibold">Troubleshooting Steps:</strong>
                          <div className="whitespace-pre-line leading-relaxed font-sans">
                            {hardwareError.suggestion}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-[#FEB2B2]/60 flex items-center justify-between gap-3">
                      <span className="text-[11.5px] text-[#742A2A] font-medium">
                        Status: Hardware release / permission required
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          setStepLoading(true)
                          await actions.requestPermissions()
                          setStepLoading(false)
                        }}
                        className="px-4 py-2 bg-[#9B2C2C] text-white hover:bg-[#742A2A] rounded-full text-[12px] font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw size={12} className={stepLoading ? 'animate-spin' : ''} />
                        Retry Access
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. Genuine Virtual Camera Security Block */}
                {virtualError && (
                  <div className="p-5 mb-6 rounded-[20px] bg-[rgba(254,226,226,0.8)] border border-[#FCA5A5] text-[#991B1B] text-[13.5px] flex flex-col gap-3">
                    <div className="flex gap-2.5 items-start">
                      <AlertCircle size={16} className="shrink-0 mt-0.5" />
                      <div>
                        <strong>Security Block:</strong> {virtualError}
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Live Stream Hardware Preview & Verification */}
                {stream && !virtualError && !hardwareError && (
                  <div className="mb-6 animate-fade-in">
                    <div className="w-full aspect-video rounded-[22px] overflow-hidden bg-[#0E0C10] relative mb-3 shadow-[0_0_0_6px_rgba(255,255,255,0.6),0_0_0_7px_rgba(255,255,255,0.95),0_24px_50px_-24px_rgba(20,14,18,0.55)]">
                      <video
                        autoPlay
                        playsInline
                        muted
                        ref={(el) => {
                          if (el && stream) el.srcObject = stream
                        }}
                        className="w-full h-full object-cover scale-x-[-1]"
                      />
                      <div className="absolute top-3 left-3 bg-black/55 text-white text-[11.5px] px-3 py-1.5 rounded-full flex items-center gap-1.5 font-medium border border-white/15">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Live Physical Camera Feed</span>
                      </div>
                      {hasAudio && (
                        <div className="absolute top-3 right-3 bg-black/55 text-white text-[11.5px] px-3 py-1.5 rounded-full flex items-center gap-1.5 font-medium border border-white/15">
                          <Volume2 size={12} className="text-emerald-400" />
                          <span>Mic Active</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 px-4 py-3 rounded-[16px] bg-[rgba(230,244,237,0.75)] border border-[#B7E1CD] text-[#137333] text-[12.5px] flex items-center justify-between">
                      <div className="flex items-center gap-2 truncate">
                        <CheckCircle2 size={16} className="shrink-0 text-[#137333]" />
                        <span className="font-semibold shrink-0">Authentic Hardware Verified:</span>
                        <span className="font-mono text-[11.5px] truncate">{deviceName}</span>
                      </div>
                    </div>

                    {availableCameras.length > 1 && (
                      <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-[#67636C] px-1">
                        <span>Select Camera Device:</span>
                        <select
                          value={selectedCameraId}
                          onChange={(e) => actions.switchCamera(e.target.value)}
                          className="glass-input !w-auto !py-2 !px-3.5 !text-[13px] !rounded-full font-medium"
                        >
                          {availableCameras.map(cam => (
                            <option key={cam.deviceId} value={cam.deviceId}>
                              {cam.label || `Camera ${cam.deviceId.slice(0, 6)}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {typeof window !== 'undefined' && Boolean((window.screen as any)?.isExtended) && (
                  <div className="px-4 py-3 mb-6 rounded-[16px] bg-[rgba(254,243,199,0.8)] border border-[#FDE68A] text-[#92400E] text-[13px] flex gap-2">
                    <Monitor size={16} className="shrink-0 mt-0.5" />
                    <span><strong>Advisory:</strong> Multiple monitors detected. Please disconnect secondary displays for an optimal integrity score.</span>
                  </div>
                )}

                <div className="mt-auto pt-2">
                  <button
                    onClick={handleStep}
                    disabled={stepLoading}
                    className="w-full py-3.5 glass-btn-primary !rounded-full text-[15px] cursor-pointer"
                  >
                    {stepLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : stream ? (
                      'Continue to Network Check →'
                    ) : hardwareError ? (
                      'Retry Permissions'
                    ) : (
                      'Grant Permissions'
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Network */}
            {currentStep === 2 && (
              <div className="flex-1 animate-fade-in flex flex-col">
                <div className="glass-tile !w-14 !h-14 !rounded-[18px] mb-6">
                  <Wifi className="text-[#A4123F]" />
                </div>
                <h2 className="text-[clamp(24px,2.2vw,30px)] font-bold text-[#141114] tracking-[-0.03em] mb-3">Network Profiling</h2>
                <p className="text-[15px] text-[#67636C] mb-7 leading-relaxed max-w-[640px]">
                  Measuring your STUN/TURN latencies and establishing a connection baseline. This detects routing anomalies used by rendering proxies.
                </p>

                {/* Result box (appears as measuring) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
                  <div className="glass-soft rounded-[20px] px-5 py-4">
                    <span className="block glass-label !text-[10.5px] mb-1.5">Round Trip Time (RTT)</span>
                    <span className="block text-[22px] font-mono font-semibold text-[#141114]">{rtt !== null ? `${rtt} ms` : 'Measuring...'}</span>
                  </div>
                  <div className="glass-soft rounded-[20px] px-5 py-4">
                    <span className="block glass-label !text-[10.5px] mb-1.5">Classification</span>
                    <span className="block text-[22px] font-semibold text-[#141114] capitalize">{connType || 'Measuring...'}</span>
                  </div>
                </div>

                <div className="mt-auto">
                  <button onClick={handleStep} disabled={stepLoading} className="w-full py-3.5 glass-btn-primary !rounded-full text-[15px]">
                    {stepLoading ? <Loader2 size={16} className="animate-spin" /> : 'Run Diagnostics'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: PRNU */}
            {currentStep === 3 && (
              <div className="flex-1 animate-fade-in flex flex-col">
                <div className="glass-tile !w-14 !h-14 !rounded-[18px] mb-6">
                  <Cpu className="text-[#A4123F]" />
                </div>
                <h2 className="text-[clamp(24px,2.2vw,30px)] font-bold text-[#141114] tracking-[-0.03em] mb-3">PRNU Hardware Calibration</h2>
                <p className="text-[15px] text-[#67636C] mb-7 leading-relaxed max-w-[640px]">
                  Extracting the unique sensor noise pattern (K̂) from your camera. Please keep the camera completely still for 3 seconds.
                </p>

                <div className="mb-7 glass-soft rounded-[20px] px-5 py-5">
                  <div className="flex justify-between text-[12px] mb-2.5">
                    <span className="glass-label !text-[10.5px]">I-frames captured</span>
                    <span className="font-mono font-semibold text-[#141114]">{prnuFrames} / 90</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-[rgba(20,17,20,0.08)] overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#B01848] to-[#7A0D2E] rounded-full transition-all duration-100" style={{ width: `${(prnuFrames/90)*100}%` }} />
                  </div>
                </div>

                <div className="mt-auto">
                  <button onClick={handleStep} disabled={stepLoading} className="w-full py-3.5 glass-btn-primary !rounded-full text-[15px]">
                    {stepLoading ? 'Calibrating...' : 'Start Calibration'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: rPPG */}
            {currentStep === 4 && (
              <div className="flex-1 animate-fade-in flex flex-col">
                <div className="glass-tile !w-14 !h-14 !rounded-[18px] mb-6">
                  <HeartPulse className="text-[#A4123F]" />
                </div>
                <h2 className="text-[clamp(24px,2.2vw,30px)] font-bold text-[#141114] tracking-[-0.03em] mb-3">rPPG Liveness Baseline</h2>
                <p className="text-[15px] text-[#67636C] mb-7 leading-relaxed max-w-[640px]">
                  Extracting micro-color variations from your face to establish a biological pulse baseline. Look directly at the camera.
                </p>

                <div className="flex justify-center mb-7">
                  <div className="text-center px-10 py-6 rounded-[24px] glass-soft min-w-[200px]">
                    <span className="block glass-label !text-[10.5px] !text-[#A4123F] mb-2">Heart Rate</span>
                    <span className={`inline-block text-[44px] leading-none font-bold text-[#A4123F] font-mono ${stepLoading ? 'animate-heartbeat' : ''}`}>
                      {rppgBpm || '--'} <span className="text-[15px] text-[#85818A]">BPM</span>
                    </span>
                  </div>
                </div>

                <div className="mt-auto">
                  <button onClick={handleStep} disabled={stepLoading} className="w-full py-3.5 glass-btn-primary !rounded-full text-[15px]">
                    {stepLoading ? 'Capturing baseline...' : 'Start Capture'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 5: Gaze */}
            {currentStep === 5 && (
              <div className="flex-1 animate-fade-in flex flex-col">
                <div className="glass-tile !w-14 !h-14 !rounded-[18px] mb-6">
                  <Eye className="text-[#A4123F]" />
                </div>
                <h2 className="text-[clamp(24px,2.2vw,30px)] font-bold text-[#141114] tracking-[-0.03em] mb-3">Behavioral & Gaze Setup</h2>
                <p className="text-[15px] text-[#67636C] mb-7 leading-relaxed max-w-[640px]">
                  Mapping your screen bounding box and natural head pose. Look at the corners of your screen.
                </p>

                {gazeLambda && (
                  <div className="px-4 py-3 mb-7 bg-[rgba(230,244,237,0.75)] border border-[#B7E1CD] rounded-[16px] flex items-center gap-2 text-[13.5px] text-[#137333]">
                    <CheckCircle2 size={16} /> Gaze lambda threshold set to {gazeLambda}
                  </div>
                )}

                <div className="mt-auto">
                  <button onClick={handleStep} disabled={stepLoading} className="w-full py-3.5 glass-btn-primary !rounded-full text-[15px]">
                    {stepLoading ? <Loader2 size={16} className="animate-spin" /> : 'Calibrate Screen'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 6: Identity Photograph Upload */}
            {currentStep === 6 && (
              <div className="flex-1 animate-fade-in flex flex-col">
                <div className="glass-tile !w-14 !h-14 !rounded-[18px] mb-6">
                  <UserCheck className="text-[#A4123F]" />
                </div>
                <h2 className="text-[clamp(24px,2.2vw,30px)] font-bold text-[#141114] tracking-[-0.03em] mb-2">Identity Photograph Upload</h2>
                <p className="text-[14.5px] text-[#67636C] mb-6 leading-relaxed max-w-[640px]">
                  Upload a clear passport-size or identity-style photograph. This will be securely stored and used as the reference image to verify your identity during the live interview via AWS Rekognition.
                </p>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      setLocalPhotoPreview(URL.createObjectURL(file))
                      const success = await actions.uploadReferencePhoto(file)
                      if (success) {
                        speak("Identity photograph verified.")
                      } else {
                        speak("Photograph validation failed. Please ensure a single clear face is visible.")
                      }
                    }
                  }}
                />

                {/* Upload or Preview Box */}
                {!localPhotoPreview && !referencePhotoUrl ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-[rgba(164,18,63,0.25)] hover:border-[#A4123F]/60 rounded-[24px] px-6 py-9 flex flex-col items-center justify-center cursor-pointer transition-colors bg-white/40 hover:bg-white/65 mb-6 group"
                  >
                    <div className="glass-tile !w-14 !h-14 !rounded-full mb-3 group-hover:scale-105 transition-transform">
                      <UploadCloud className="text-[#A4123F]" size={22} />
                    </div>
                    <p className="text-[15px] font-bold text-[#141114] mb-1">Click to upload reference photo</p>
                    <p className="text-[12px] text-[#85818A]">JPG, PNG or WEBP · Max 5MB · Single person portrait</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-5 p-5 rounded-[24px] glass-soft mb-6">
                    <img
                      src={localPhotoPreview || referencePhotoUrl || ''}
                      alt="Candidate Reference"
                      className="w-24 h-28 object-cover rounded-[16px] border-2 border-white shadow-[0_10px_24px_-12px_rgba(20,14,18,0.5)]"
                    />
                    <div className="flex-1">
                      <p className="text-[14px] font-bold text-[#141114] mb-1.5">
                        {referencePhotoUrl && !localPhotoPreview
                          ? '✓ Verified Candidate Profile Photo'
                          : 'Uploaded Reference Portrait'}
                      </p>
                      {photoUploading && (
                        <div className="flex items-center gap-1.5 text-[12.5px] text-[#A4123F] font-medium">
                          <Loader2 size={13} className="animate-spin" /> Validating face with AWS Rekognition...
                        </div>
                      )}
                      {isPhotoValidated && (
                        <div className="flex items-center gap-1.5 text-[12.5px] text-[#1A6B3C] font-semibold">
                          <CheckCircle2 size={14} /> Face Validated via Rekognition
                        </div>
                      )}
                      {photoError && (
                        <div className="flex items-start gap-1.5 text-[12px] text-[#991B1B] font-medium mt-1">
                          <AlertCircle size={13} className="shrink-0 mt-0.5" />
                          <span>{photoError}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setLocalPhotoPreview(null)
                          fileInputRef.current?.click()
                        }}
                        className="mt-3 glass-btn !rounded-full px-3.5 py-1.5 text-[12px] !text-[#A4123F]"
                      >
                        Change photo
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-auto">
                  <button
                    onClick={handleStep}
                    disabled={stepLoading || photoUploading || !isPhotoValidated}
                    className="w-full py-3.5 glass-btn-primary !rounded-full text-[15px]"
                  >
                    {photoUploading ? <Loader2 size={16} className="animate-spin" /> : 'Confirm Photo & Continue'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 7: Consent */}
            {currentStep === 7 && (
              <div className="flex-1 animate-fade-in flex flex-col">
                <div className="glass-tile !w-14 !h-14 !rounded-[18px] mb-6">
                  <FileText className="text-[#A4123F]" />
                </div>
                <h2 className="text-[clamp(24px,2.2vw,30px)] font-bold text-[#141114] tracking-[-0.03em] mb-3">Forensic Consent</h2>
                <p className="text-[15px] text-[#67636C] mb-7 leading-relaxed max-w-[640px]">
                  By proceeding, you consent to continuous forensic analysis of your video stream, network activity, and browser behavior during this session.
                </p>

                <div className="mb-7">
                  <label className="auth-label">Type "I CONSENT" to proceed</label>
                  <input
                    type="text"
                    value={consentInput}
                    onChange={e => setConsentInput(e.target.value)}
                    placeholder="I CONSENT"
                    className="auth-input !font-bold tracking-[0.06em] focus:!border-[#A4123F]/45 focus:shadow-[0_0_0_4px_rgba(164,18,63,0.10)]"
                  />
                </div>

                <div className="mt-auto">
                  <button
                    onClick={handleStep}
                    disabled={stepLoading || consentInput !== 'I CONSENT'}
                    className="w-full py-3.5 glass-btn-primary !rounded-full text-[15px]"
                  >
                    Accept & Continue
                  </button>
                </div>
              </div>
            )}

            {/* Step 8: Ready */}
            {currentStep === 8 && (
              <div className="flex-1 animate-fade-in flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 rounded-full bg-gradient-to-b from-[#22874D] to-[#145530] flex items-center justify-center mb-7 animate-check-pop shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_14px_30px_-12px_rgba(26,107,60,0.7)]">
                  <CheckCircle2 size={38} className="text-white" />
                </div>
                <h2 className="text-[clamp(28px,2.6vw,36px)] font-bold text-[#141114] tracking-[-0.035em] mb-2">You're all set.</h2>
                <p className="text-[15.5px] text-[#67636C] mb-9 max-w-[460px]">
                  Your device has been verified and enrolled. Good luck with your interview.
                </p>

                <button onClick={handleStep} disabled={stepLoading} className="w-full max-w-[520px] py-4 glass-btn-primary !rounded-full text-[16px] !font-bold">
                  {stepLoading ? <Loader2 size={18} className="animate-spin" /> : 'Begin interview'}
                </button>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Persistent mini preview strip after step 1 */}
      <div className={`fixed bottom-6 left-6 z-20 transition-all duration-500 ${currentStep > 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="w-56 glass liquid p-2 rounded-[20px]">
          <div className="relative w-full aspect-video rounded-[14px] overflow-hidden bg-[#0E0C10]">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
            <div className="absolute top-2 right-2 flex gap-1">
              {currentStep > 3 && <div className="w-2 h-2 rounded-full bg-amber-500" />}
              {currentStep > 4 && <div className="w-2 h-2 rounded-full bg-red-500" />}
              {currentStep > 5 && <div className="w-2 h-2 rounded-full bg-green-500" />}
            </div>
          </div>
          <div className="mt-2 mb-0.5 text-center text-[11px] font-medium text-[#67636C] truncate px-1">
            {deviceName}
          </div>
        </div>
      </div>
    </div>
  )
}
