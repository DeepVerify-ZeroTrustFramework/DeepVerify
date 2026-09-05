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
    <div className="min-h-screen bg-[#F7F7F8] flex flex-col">
      {/* Top bar */}
      <div className="h-16 bg-white border-b border-[#E4E4E6] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#A4123F] flex items-center justify-center">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <span className="text-sm font-bold text-[#0F0F0F]">System Check</span>
        </div>

        <div className="flex items-center gap-4">
          {/* Speaking indicator */}
          {isSpeaking && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FDF2F5] border border-[#F5C2CD] text-[12px] font-semibold text-[#A4123F] animate-fade-in">
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
            className={`px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 text-xs font-medium ${
              isMuted 
                ? 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200' 
                : 'bg-white text-[#A4123F] border-[#E4E4E6] hover:bg-[#FDF2F5]'
            }`}
          >
            {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            <span>{isMuted ? 'Muted' : 'Voice on'}</span>
          </button>


          <div className="text-[13px] font-medium text-[#6B6B6B] border-l border-[#E4E4E6] pl-4">
            Candidate: {session.candidate_name}
          </div>
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
              <span>Step {currentStep} of {steps.length}</span>
              <span>{steps[currentStep - 1]?.label || ''}</span>
            </div>
          </div>

          <div className="p-8 min-h-[340px] flex flex-col">
            
            {/* Step 1: Permissions */}
            {currentStep === 1 && (
              <div className="flex-1 animate-fade-in flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-[#F9ECF0] flex items-center justify-center">
                    <Camera className="text-[#A4123F]" />
                  </div>
                  {stream && !virtualError && !hardwareError && (
                    <span className="px-3 py-1 rounded-full bg-emerald-50 text-[#137333] text-xs font-semibold flex items-center gap-1.5 border border-[#B7E1CD]">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      Hardware Ready
                    </span>
                  )}
                </div>

                <h2 className="text-xl font-bold text-[#0F0F0F] mb-2">Camera & Hardware Access</h2>
                <p className="text-[14px] text-[#6B6B6B] mb-5 leading-relaxed">
                  DeepVerify requires raw access to your physical camera to generate cryptographic hardware fingerprints. Virtual cameras (OBS, Snap Camera, etc.) are strictly prohibited.
                </p>

                {/* 1. Hardware Access & Permissions Troubleshooting Card */}
                {hardwareError && (
                  <div className="p-4 mb-5 rounded-xl bg-[#FFF5F5] border border-[#FED7D7] text-[#9B2C2C] text-[13px] flex flex-col gap-3 shadow-sm">
                    <div className="flex gap-2.5 items-start">
                      <AlertTriangle size={18} className="shrink-0 text-amber-600 mt-0.5" />
                      <div className="flex-1">
                        <strong className="text-[#9B2C2C] block font-bold text-[14px] mb-1">
                          {hardwareError.title}
                        </strong>
                        <p className="text-[#742A2A] leading-relaxed mb-3">
                          {hardwareError.message}
                        </p>
                        <div className="p-3 bg-white/90 rounded-lg border border-[#FEB2B2] text-[12px] text-[#4A5568]">
                          <strong className="block text-[#2D3748] mb-1 font-semibold">Troubleshooting Steps:</strong>
                          <div className="whitespace-pre-line leading-relaxed font-sans">
                            {hardwareError.suggestion}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[#FEB2B2]/60 flex items-center justify-between">
                      <span className="text-[11px] text-[#742A2A] font-medium">
                        Status: Hardware release / permission required
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          setStepLoading(true)
                          await actions.requestPermissions()
                          setStepLoading(false)
                        }}
                        className="px-3 py-1.5 bg-[#9B2C2C] text-white hover:bg-[#742A2A] rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw size={12} className={stepLoading ? 'animate-spin' : ''} />
                        Retry Access
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. Genuine Virtual Camera Security Block */}
                {virtualError && (
                  <div className="p-4 mb-5 rounded-xl bg-[#FEE2E2] border border-[#FCA5A5] text-[#991B1B] text-[13px] flex flex-col gap-3">
                    <div className="flex gap-2 items-start">
                      <AlertCircle size={16} className="shrink-0 mt-0.5" /> 
                      <div>
                        <strong>Security Block:</strong> {virtualError}
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Live Stream Hardware Preview & Verification */}
                {stream && !virtualError && !hardwareError && (
                  <div className="mb-5 animate-fade-in">
                    <div className="w-full aspect-video rounded-xl overflow-hidden bg-[#0A0A0A] relative shadow-inner border border-[#E4E4E6] mb-3">
                      <video
                        autoPlay
                        playsInline
                        muted
                        ref={(el) => {
                          if (el && stream) el.srcObject = stream
                        }}
                        className="w-full h-full object-cover scale-x-[-1]"
                      />
                      <div className="absolute top-2.5 left-2.5 bg-black/70 backdrop-blur-sm text-white text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Live Physical Camera Feed</span>
                      </div>
                      {hasAudio && (
                        <div className="absolute top-2.5 right-2.5 bg-black/70 backdrop-blur-sm text-white text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium">
                          <Volume2 size={12} className="text-emerald-400" />
                          <span>Mic Active</span>
                        </div>
                      )}
                    </div>

                    <div className="p-3 rounded-xl bg-[#E6F4ED] border border-[#B7E1CD] text-[#137333] text-[12px] flex items-center justify-between">
                      <div className="flex items-center gap-2 truncate">
                        <CheckCircle2 size={16} className="shrink-0 text-[#137333]" />
                        <span className="font-semibold shrink-0">Authentic Hardware Verified:</span>
                        <span className="font-mono text-[11px] truncate">{deviceName}</span>
                      </div>
                    </div>

                    {availableCameras.length > 1 && (
                      <div className="mt-2.5 flex items-center justify-between text-xs text-[#6B6B6B] px-1">
                        <span>Select Camera Device:</span>
                        <select
                          value={selectedCameraId}
                          onChange={(e) => actions.switchCamera(e.target.value)}
                          className="px-2.5 py-1 bg-white border border-[#E4E4E6] rounded-lg text-xs font-medium text-[#0F0F0F] outline-none hover:border-[#A4123F] transition-colors"
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
                  <div className="p-3 mb-5 rounded-lg bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] text-[13px] flex gap-2">
                    <Monitor size={16} className="shrink-0 mt-0.5" />
                    <span><strong>Advisory:</strong> Multiple monitors detected. Please disconnect secondary displays for an optimal integrity score.</span>
                  </div>
                )}

                <div className="mt-auto pt-2">
                  <button
                    onClick={handleStep}
                    disabled={stepLoading}
                    className="w-full h-12 bg-[#A4123F] text-white font-semibold rounded-xl hover:bg-[#7A0D2E] transition-colors flex justify-center items-center gap-2 cursor-pointer shadow-sm"
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

            {/* Step 6: Identity Photograph Upload */}
            {currentStep === 6 && (
              <div className="flex-1 animate-fade-in flex flex-col">
                <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center mb-6">
                  <UserCheck className="text-purple-600" />
                </div>
                <h2 className="text-xl font-bold text-[#0F0F0F] mb-2">Identity Photograph Upload</h2>
                <p className="text-[13px] text-[#6B6B6B] mb-5 leading-relaxed">
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
                    className="border-2 border-dashed border-[#D0D0D5] hover:border-[#A4123F] rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors bg-[#FAFAFB] hover:bg-[#FDF2F5] mb-5 group"
                  >
                    <div className="w-12 h-12 rounded-full bg-white border border-[#E4E4E6] flex items-center justify-center mb-3 shadow-sm group-hover:scale-105 transition-transform">
                      <UploadCloud className="text-[#A4123F]" size={22} />
                    </div>
                    <p className="text-[14px] font-bold text-[#0F0F0F] mb-1">Click to upload reference photo</p>
                    <p className="text-[11px] text-[#6B6B6B]">JPG, PNG or WEBP · Max 5MB · Single person portrait</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-4 p-4 rounded-2xl border border-[#E4E4E6] bg-[#FAFAFB] mb-5">
                    <img 
                      src={localPhotoPreview || referencePhotoUrl || ''} 
                      alt="Candidate Reference" 
                      className="w-20 h-24 object-cover rounded-xl border border-white shadow-sm"
                    />
                    <div className="flex-1">
                      <p className="text-[13px] font-bold text-[#0F0F0F] mb-1">
                        {referencePhotoUrl && !localPhotoPreview
                          ? '✓ Verified Candidate Profile Photo'
                          : 'Uploaded Reference Portrait'}
                      </p>
                      {photoUploading && (
                        <div className="flex items-center gap-1.5 text-xs text-purple-600 font-medium">
                          <Loader2 size={13} className="animate-spin" /> Validating face with AWS Rekognition...
                        </div>
                      )}
                      {isPhotoValidated && (
                        <div className="flex items-center gap-1.5 text-xs text-[#1A6B3C] font-semibold">
                          <CheckCircle2 size={14} /> Face Validated via Rekognition
                        </div>
                      )}
                      {photoError && (
                        <div className="flex items-start gap-1.5 text-[11px] text-red-600 font-medium mt-1">
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
                        className="mt-2 text-[11px] font-medium text-[#A4123F] hover:underline"
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
                    className="w-full h-12 bg-[#A4123F] text-white font-semibold rounded-xl hover:bg-[#7A0D2E] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {photoUploading ? <Loader2 size={16} className="animate-spin" /> : 'Confirm Photo & Continue'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 7: Consent */}
            {currentStep === 7 && (
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

            {/* Step 8: Ready */}
            {currentStep === 8 && (
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
