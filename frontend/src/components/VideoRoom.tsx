import { Loader2, Mic, MicOff, Video as VideoIcon, VideoOff } from 'lucide-react'
import { useState } from 'react'
import type { WebRTCState } from '../hooks/useWebRTC'

export default function VideoRoom({ 
  state, 
  remoteStream, 
  localStream,
  status
}: { 
  state: WebRTCState
  remoteStream: MediaStream | null
  localStream: MediaStream | null
  status: string
}) {
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)

  const toggleMic = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.enabled = !micOn)
      setMicOn(!micOn)
    }
  }

  const toggleCam = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => t.enabled = !camOn)
      setCamOn(!camOn)
    }
  }

  return (
    <div className="w-full h-full relative bg-[#0A0A0A] overflow-hidden group">
      
      {/* Remote Video (Candidate) */}
      {state === 'connected' && remoteStream ? (
        <video 
          autoPlay playsInline
          ref={v => { if (v) v.srcObject = remoteStream }}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#11131A] text-white">
          <Loader2 size={32} className="animate-spin text-[#6B6B6B] mb-4" />
          <p className="text-[14px] font-medium">
            {status === 'WAITING' ? 'Waiting for candidate to connect...' : 'Establishing secure connection...'}
          </p>
        </div>
      )}

      {/* Local Video PiP (Interviewer) */}
      <div className="absolute top-4 right-4 w-40 aspect-video bg-black rounded-lg border border-white/10 shadow-2xl overflow-hidden transition-transform group-hover:scale-105">
        {localStream ? (
          <video 
            autoPlay playsInline muted 
            ref={v => { if (v) v.srcObject = localStream }}
            className={`w-full h-full object-cover scale-x-[-1] ${!camOn && 'opacity-0'}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#1A1A1A]">
            <VideoOff size={20} className="text-[#6B6B6B]" />
          </div>
        )}
      </div>

      {/* Controls Toolbar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 backdrop-blur-md px-6 py-3 rounded-2xl border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          onClick={toggleMic}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${micOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500/20 text-red-500 border border-red-500/30'}`}
        >
          {micOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <button 
          onClick={toggleCam}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${camOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500/20 text-red-500 border border-red-500/30'}`}
        >
          {camOn ? <VideoIcon size={18} /> : <VideoOff size={18} />}
        </button>
      </div>

    </div>
  )
}
