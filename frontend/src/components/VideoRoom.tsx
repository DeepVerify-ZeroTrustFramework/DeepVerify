import { Loader2, Mic, MicOff, Video as VideoIcon, VideoOff, UserX } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import type { WebRTCState } from '../hooks/useWebRTC'

export default function VideoRoom({
  state,
  remoteStream,
  localStream,
  onLocalStreamChange,
  status: _status
}: {
  state: WebRTCState
  remoteStream: MediaStream | null
  localStream: MediaStream | null
  onLocalStreamChange?: (stream: MediaStream | null) => void
  status: string
}) {
  // Interviewer's own controls
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)

  // Candidate remote controls (mute/disable candidate's stream on interviewer's end)
  const [candidateMicOn, setCandidateMicOn] = useState(true)
  const [candidateCamOn, setCandidateCamOn] = useState(true)

  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)

  // Bind remote stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      if (remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream
      }
    }
  }, [remoteStream])

  // Bind local stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream
      }
    }
  }, [localStream])

  const toggleMic = async () => {
    if (!localStream || localStream.getAudioTracks().length === 0) {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const newStream = await navigator.mediaDevices.getUserMedia({ audio: true })
          if (localStream) {
            newStream.getAudioTracks().forEach(t => localStream.addTrack(t))
            onLocalStreamChange?.(localStream)
          } else {
            onLocalStreamChange?.(newStream)
          }
          setMicOn(true)
          return
        }
      } catch (err) {
        console.warn('Could not acquire microphone:', err)
      }
    }

    const next = !micOn
    if (localStream) {
      localStream.getAudioTracks().forEach(t => {
        t.enabled = next
      })
    }
    setMicOn(next)
  }

  const toggleCam = async () => {
    if (!localStream || localStream.getVideoTracks().length === 0) {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const newStream = await navigator.mediaDevices.getUserMedia({ video: true })
          if (localStream) {
            newStream.getVideoTracks().forEach(t => localStream.addTrack(t))
            onLocalStreamChange?.(localStream)
          } else {
            onLocalStreamChange?.(newStream)
          }
          setCamOn(true)
          return
        }
      } catch (err) {
        console.warn('Could not acquire camera (may be in use by candidate on localhost):', err)
      }
    }

    const next = !camOn
    if (localStream) {
      localStream.getVideoTracks().forEach(t => {
        t.enabled = next
      })
    }
    setCamOn(next)
  }

  const toggleCandidateMic = () => {
    const next = !candidateMicOn
    if (remoteStream) {
      remoteStream.getAudioTracks().forEach(t => {
        t.enabled = next
      })
    }
    setCandidateMicOn(next)
  }

  const toggleCandidateCam = () => {
    const next = !candidateCamOn
    if (remoteStream) {
      remoteStream.getVideoTracks().forEach(t => {
        t.enabled = next
      })
    }
    setCandidateCamOn(next)
  }

  return (
    <div className="w-full h-full relative bg-[#0A0A0A] overflow-hidden group">

      {/* Remote Video (Candidate) */}
      {remoteStream ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          muted={!candidateMicOn}
          className={`w-full h-full object-cover transition-opacity duration-200 ${candidateCamOn ? 'opacity-100' : 'opacity-0'}`}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#11131A] text-white">
          <Loader2 size={32} className="animate-spin text-[#6B6B6B] mb-4" />
          <p className="text-[14px] font-medium">
            {state === 'error' ? 'Connection error — please refresh' : 'Waiting for candidate to connect...'}
          </p>
        </div>
      )}

      {/* Local Video PiP (Interviewer) */}
      <div className="absolute top-4 right-4 w-40 aspect-video bg-black rounded-lg border border-white/10 shadow-2xl overflow-hidden transition-transform group-hover:scale-105 z-10">
        {localStream && localStream.getVideoTracks().length > 0 ? (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-200 ${camOn ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-[#1A1A1A] text-gray-400 text-[10px] p-2 text-center">
            <VideoOff size={18} className="text-[#6B6B6B] mb-1" />
            <span>{camOn ? 'Interviewer Camera Off' : 'Camera Disabled'}</span>
          </div>
        )}
      </div>

      {/* Controls Toolbar — Interviewer self controls + Candidate controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/75 backdrop-blur-md px-5 py-2.5 rounded-2xl border border-white/15 shadow-xl transition-opacity duration-200 z-20">

        {/* Interviewer's own controls */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mr-1">You</span>
          <button
            onClick={toggleMic}
            title={micOn ? 'Mute your microphone' : 'Unmute your microphone'}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${micOn ? 'bg-white/15 hover:bg-white/25 text-white' : 'bg-red-500/30 text-red-400 border border-red-500/50'}`}
          >
            {micOn ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          <button
            onClick={toggleCam}
            title={camOn ? 'Turn off your camera' : 'Turn on your camera'}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${camOn ? 'bg-white/15 hover:bg-white/25 text-white' : 'bg-red-500/30 text-red-400 border border-red-500/50'}`}
          >
            {camOn ? <VideoIcon size={16} /> : <VideoOff size={16} />}
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/20 mx-1" />

        {/* Candidate controls */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mr-1">
            <UserX size={12} className="inline -mt-0.5" /> Cand.
          </span>
          <button
            onClick={toggleCandidateMic}
            title={candidateMicOn ? "Mute candidate's audio" : "Unmute candidate's audio"}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${candidateMicOn ? 'bg-white/10 hover:bg-white/20 text-gray-300' : 'bg-orange-500/30 text-orange-300 border border-orange-500/50'}`}
          >
            {candidateMicOn ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          <button
            onClick={toggleCandidateCam}
            title={candidateCamOn ? "Hide candidate's video" : "Show candidate's video"}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${candidateCamOn ? 'bg-white/10 hover:bg-white/20 text-gray-300' : 'bg-orange-500/30 text-orange-300 border border-orange-500/50'}`}
          >
            {candidateCamOn ? <VideoIcon size={16} /> : <VideoOff size={16} />}
          </button>
        </div>
      </div>

    </div>
  )
}
