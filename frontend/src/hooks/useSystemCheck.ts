import { useState } from 'react'

export interface CheckStep {
  id: number
  title: string
  desc: string
  status: 'pending' | 'active' | 'completed' | 'error'
  error?: string
}

const VIRTUAL_SIGNATURES = [
  'obs', 'virtual', 'manycam', 'xsplit', 'ndi', 'snap', 'chromacam',
  'epoccam', 'ivcam', 'droidcam', 'camo'
]

export function useSystemCheck(sessionId: string) {
  const [currentStep, setCurrentStep] = useState(1)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [deviceName, setDeviceName] = useState('')
  const [virtualError, setVirtualError] = useState('')
  const [isDone, setIsDone] = useState(false)
  
  // State for specific steps
  const [rtt, setRtt] = useState<number | null>(null)
  const [connType, setConnType] = useState('')
  const [prnuFrames, setPrnuFrames] = useState(0)
  const [rppgBpm, setRppgBpm] = useState(0)
  const [gazeLambda, setGazeLambda] = useState<number | null>(null)
  const [consentTimestamp, setConsentTimestamp] = useState<string | null>(null)
  const [referencePhotoUrl, setReferencePhotoUrl] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [isPhotoValidated, setIsPhotoValidated] = useState(false)

  // Step 1: Permissions
  const requestPermissions = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      setStream(s)
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevice = devices.find(d => d.kind === 'videoinput')
      const name = videoDevice?.label || 'Camera'
      setDeviceName(name)
      
      const isVirtual = VIRTUAL_SIGNATURES.some(sig => name.toLowerCase().includes(sig))
      if (isVirtual) {
        setVirtualError(`Virtual camera detected: ${name}. You must use your physical webcam to proceed.`)
        return false
      }
      return true
    } catch (e) {
      console.error(e)
      setVirtualError('Failed to access camera/microphone. Please allow permissions.')
      return false
    }
  }

  // Step 2: Network
  const measureNetwork = async () => {
    try {
      // Dummy STUN check delay
      await new Promise(r => setTimeout(r, 600))
      
      // Ping
      const start = performance.now()
      await fetch('/api/ping')
      const pingRtt = performance.now() - start
      
      let type = 'fiber'
      if (pingRtt > 80) type = 'cellular'
      else if (pingRtt > 20) type = 'wifi'
      
      setRtt(Math.round(pingRtt))
      setConnType(type)
      
      await fetch(`/api/sessions/${sessionId}/network`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_type: type, baseline_rtt_ms: pingRtt })
      })
      
      return true
    } catch (e) {
      console.error(e)
      return false
    }
  }

  // Step 3: PRNU (Simulated via delay for now, real WebCodecs is complex)
  const enrollPrnu = async () => {
    return new Promise<boolean>(resolve => {
      let f = 0
      const interval = setInterval(() => {
        f += 3
        setPrnuFrames(f)
        if (f >= 90) {
          clearInterval(interval)
          // Mock post to backend
          fetch(`/api/sessions/${sessionId}/enroll/prnu`, { method: 'POST' }).catch(() => {})
          resolve(true)
        }
      }, 100)
    })
  }

  // Step 4: rPPG
  const enrollRppg = async () => {
    return new Promise<boolean>(resolve => {
      let t = 0
      const interval = setInterval(() => {
        t += 1
        setRppgBpm(Math.round(68 + Math.sin(t / 5) * 4))
        if (t >= 60) {
          clearInterval(interval)
          fetch(`/api/sessions/${sessionId}/enroll/rppg`, { method: 'POST' }).catch(() => {})
          resolve(true)
        }
      }, 100) // fast forwarded for demo
    })
  }

  // Step 5: Gaze
  const enrollGaze = async () => {
    // In real app, mediapipe worker does this. We mock success.
    await new Promise(r => setTimeout(r, 2000))
    setGazeLambda(0.24)
    await fetch(`/api/sessions/${sessionId}/enroll/gaze`, { method: 'POST' }).catch(() => {})
    return true
  }

  // Step 6: Upload Reference Identity Photograph
  const uploadReferencePhoto = async (file: File): Promise<boolean> => {
    setPhotoUploading(true)
    setPhotoError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`/api/face-verification/reference-photo/${sessionId}`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        const errorMsg = data?.detail?.message || (typeof data?.detail === 'string' ? data.detail : 'Face validation failed.')
        setPhotoError(errorMsg)
        setIsPhotoValidated(false)
        return false
      }

      setReferencePhotoUrl(data.reference_image_url)
      setIsPhotoValidated(true)
      setPhotoError(null)
      return true
    } catch (err: any) {
      setPhotoError('Network error uploading photograph. Please check your connection.')
      setIsPhotoValidated(false)
      return false
    } finally {
      setPhotoUploading(false)
    }
  }

  // Step 7: Consent
  const submitConsent = async (text: string) => {
    if (text !== 'I CONSENT') return false
    try {
      await fetch(`/api/sessions/${sessionId}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent_text: text, timestamp: new Date().toISOString() })
      })
      setConsentTimestamp(new Date().toLocaleTimeString())
      return true
    } catch {
      return false
    }
  }

  // Step 8: Finish
  const finishCheck = async () => {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ check_completed: true, status: 'ACTIVE' })
      })
      setIsDone(true)
      return true
    } catch {
      return false
    }
  }

  const nextStep = () => setCurrentStep(prev => prev + 1)

  return {
    currentStep,
    nextStep,
    stream,
    deviceName,
    virtualError,
    rtt,
    connType,
    prnuFrames,
    rppgBpm,
    gazeLambda,
    consentTimestamp,
    referencePhotoUrl,
    photoUploading,
    photoError,
    isPhotoValidated,
    isDone,
    actions: {
      requestPermissions,
      measureNetwork,
      enrollPrnu,
      enrollRppg,
      enrollGaze,
      uploadReferencePhoto,
      submitConsent,
      finishCheck,
    }
  }
}
