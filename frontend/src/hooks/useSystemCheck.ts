import { useState, useEffect } from 'react'

export interface CheckStep {
  id: number
  title: string
  desc: string
  status: 'pending' | 'active' | 'completed' | 'error'
  error?: string
}


export interface HardwareError {
  type: 'IN_USE' | 'DENIED' | 'NOT_FOUND' | 'INSECURE' | 'UNKNOWN'
  title: string
  message: string
  suggestion: string
}

export function useSystemCheck(sessionId: string) {
  const [currentStep, setCurrentStep] = useState(1)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [deviceName, setDeviceName] = useState('')
  const [virtualError, setVirtualError] = useState('')
  const [hardwareError, setHardwareError] = useState<HardwareError | null>(null)
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string>('')
  const [hasAudio, setHasAudio] = useState(false)
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



  // Auto-detect pre-enrolled profile photo from candidate's account
  useEffect(() => {
    async function checkExistingProfilePhoto() {
      try {
        const res = await fetch(`/api/face-verification/status/${sessionId}`)
        if (res.ok) {
          const data = await res.json()
          if (data.reference_image_url) {
            setReferencePhotoUrl(data.reference_image_url)
            setIsPhotoValidated(true)
          }
        }
      } catch (err) {
        // Silently continue
      }
    }
    if (sessionId) {
      checkExistingProfilePhoto()
    }
  }, [sessionId])

  // Step 1: Permissions
  const requestPermissions = async (targetCameraId?: string) => {
    setHardwareError(null)
    setVirtualError('')

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setHardwareError({
        type: 'INSECURE',
        title: 'Insecure Origin Detected',
        message: 'Browser camera and microphone access strictly requires a secure context (HTTPS or localhost).',
        suggestion: 'Please open this application using http://localhost:5173 rather than an external IP address.'
      })
      return false
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setHardwareError({
        type: 'NOT_FOUND',
        title: 'Media Devices Not Supported',
        message: 'Your browser environment does not support media device capture.',
        suggestion: 'Please use a modern browser such as Google Chrome, Microsoft Edge, or Firefox.'
      })
      return false
    }

    const cameraIdToUse = targetCameraId || selectedCameraId
    const videoConstraints: MediaTrackConstraints | boolean = cameraIdToUse
      ? { deviceId: { exact: cameraIdToUse } }
      : true

    let activeStream: MediaStream | null = null
    let audioAcquired = false

    // Attempt 1: Combined video + audio
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: true
      })
      audioAcquired = true
    } catch (combinedErr: any) {
      console.warn('Combined getUserMedia failed, diagnosing video and audio separately...', combinedErr)

      // Attempt 2: Test video separately
      let videoStream: MediaStream | null = null
      let videoError: any = null
      try {
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints
        })
      } catch (err: any) {
        videoError = err
      }

      // Attempt 3: Test audio separately
      let audioStream: MediaStream | null = null
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err: any) {
        console.warn('Audio capture failed:', err)
      }

      if (videoStream && audioStream) {
        activeStream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...audioStream.getAudioTracks()
        ])
        audioAcquired = true
      } else if (videoStream) {
        activeStream = videoStream
        audioAcquired = false
      } else {
        // Both combined and video alone failed
        if (audioStream) audioStream.getTracks().forEach(t => t.stop())

        const err = videoError || combinedErr
        const errName = err?.name || ''
        const errMsg = err?.message || ''

        if (
          errName === 'NotReadableError' ||
          errName === 'TrackStartError' ||
          errMsg.toLowerCase().includes('could not start') ||
          errMsg.toLowerCase().includes('in use')
        ) {
          setHardwareError({
            type: 'IN_USE',
            title: 'Camera In Use by Another Application',
            message: 'Your physical webcam is currently locked by another application or browser tab.',
            suggestion: 'Please close other browser tabs (such as the Interviewer Dashboard in Microsoft Edge or Chrome) and background meeting apps (Zoom, Teams, Skype, Windows Camera), then click "Retry Access".'
          })
        } else if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          setHardwareError({
            type: 'DENIED',
            title: 'Camera / Microphone Permission Denied',
            message: 'Access to your camera or microphone was blocked by browser or OS permissions.',
            suggestion: '1. Click the lock or tune icon at the left of your browser address bar and set Camera and Microphone to "Allow".\n2. In Windows Settings > Privacy & security > Camera, ensure "Let desktop apps access your camera" is ON.\n3. Click "Retry Access".'
          })
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          setHardwareError({
            type: 'NOT_FOUND',
            title: 'Camera Device Not Found',
            message: 'No compatible physical video camera was detected on this computer.',
            suggestion: 'Please verify that your webcam is connected, enabled, and functioning in Windows Device Manager.'
          })
        } else {
          setHardwareError({
            type: 'UNKNOWN',
            title: 'Hardware Access Error',
            message: errMsg || 'Unable to access your physical camera.',
            suggestion: 'Please refresh the page and verify your browser and camera settings.'
          })
        }
        return false
      }
    }

    setStream(activeStream)
    setHasAudio(audioAcquired)

    // Inspect active camera directly from the active video track
    const activeVideoTrack = activeStream.getVideoTracks()[0]
    const activeName = activeVideoTrack?.label || 'Physical Camera'
    setDeviceName(activeName)

    // Enumerate devices to populate available cameras
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const videoInputs = allDevices.filter(d => d.kind === 'videoinput')
      setAvailableCameras(videoInputs)
      const currentDeviceId = activeVideoTrack?.getSettings()?.deviceId
      if (currentDeviceId) {
        setSelectedCameraId(currentDeviceId)
      }
    } catch (e) {
      console.warn('Failed to enumerate devices', e)
    }

    setVirtualError('')
    setHardwareError(null)
    return true
  }

  const switchCamera = async (deviceId: string) => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
      setStream(null)
    }
    setSelectedCameraId(deviceId)
    return await requestPermissions(deviceId)
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

  // Step 3: Real PRNU Hardware Calibration
  const enrollPrnu = async (): Promise<boolean> => {
    try {
      let activeStream = stream
      if (!activeStream || activeStream.getVideoTracks().length === 0) {
        activeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        setStream(activeStream)
      }

      // Create video element to render stream frames
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = activeStream
      await video.play()

      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      const ctx = canvas.getContext('2d')
      if (!ctx) return false

      const blobs: Blob[] = []
      const targetFrames = 30

      for (let i = 0; i < targetFrames; i++) {
        ctx.drawImage(video, 0, 0, 320, 240)
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', 0.85)
        })
        if (blob) {
          blobs.push(blob)
        }
        setPrnuFrames(Math.round(((i + 1) / targetFrames) * 90))
        await new Promise((r) => setTimeout(r, 70))
      }

      video.pause()
      video.srcObject = null

      if (blobs.length < 5) {
        console.error('Failed to capture enough valid frames for PRNU')
        return false
      }

      const formData = new FormData()
      blobs.forEach((b, idx) => {
        formData.append('frames', b, `frame_${idx}.jpg`)
      })

      const res = await fetch(`/api/enroll/${sessionId}`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const res2 = await fetch(`/api/sessions/${sessionId}/enroll/prnu`, {
          method: 'POST',
          body: formData,
        })
        return res2.ok
      }

      return true
    } catch (err) {
      console.error('PRNU enrollment failed:', err)
      return false
    }
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
          fetch(`/api/sessions/${sessionId}/enroll/rppg`, { method: 'POST' }).catch(() => { })
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
    await fetch(`/api/sessions/${sessionId}/enroll/gaze`, { method: 'POST' }).catch(() => { })
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
    hardwareError,
    availableCameras,
    selectedCameraId,
    hasAudio,
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
      switchCamera,
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
