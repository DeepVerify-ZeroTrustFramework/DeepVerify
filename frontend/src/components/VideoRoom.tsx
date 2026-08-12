import { Loader2, Mic, MicOff, Video as VideoIcon, VideoOff, UserX } from 'lucide-react'
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
  // Interviewer's own controls
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)

  // Candidate remote controls (mute/disable candidate's stream on interviewer's end)
  const [candidateMicOn, setCandidateMicOn] = useState(true)
  const [candidateCamOn, setCandidateCamOn] = useState(true)

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

  const toggleCandidateMic = () => {
    if (remoteStream) {
      remoteStream.getAudioTracks().forEach(t => t.enabled = !candidateMicOn)
      setCandidateMicOn(!candidateMicOn)
    }
  }

  const toggleCandidateCam = () => {
    if (remoteStream) {
      remoteStream.getVideoTracks().forEach(t => t.enabled = !candidateCamOn)
      setCandidateCamOn(!candidateCamOn)
    }
  }

  return (
    <div className="w-full h-full relative bg-[#0A0A0A] overflow-hidden group">
      
      {/* Remote Video (Candidate) */}
      {remoteStream ? (
        <video 
          autoPlay playsInline
          ref={v => { if (v && v.srcObject !== remoteStream) v.srcObject = remoteStream }}
          className={`w-full h-full object-cover ${!candidateCamOn && 'opacity-0'}`}
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

      {/* Controls Toolbar — Interviewer self controls + Candidate controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 backdrop-blur-md px-5 py-2.5 rounded-2xl border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
        
        {/* Interviewer's own controls */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-wider text-gray-500 mr-1">You</span>
          <button 
            onClick={toggleMic}
            title={micOn ? 'Mute yourself' : 'Unmute yourself'}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${micOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500/20 text-red-500 border border-red-500/30'}`}
          >
            {micOn ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          <button 
            onClick={toggleCam}
            title={camOn ? 'Turn off camera' : 'Turn on camera'}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${camOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500/20 text-red-500 border border-red-500/30'}`}
          >
            {camOn ? <VideoIcon size={16} /> : <VideoOff size={16} />}
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/10 mx-1" />

        {/* Candidate controls */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-wider text-gray-500 mr-1">
            <UserX size={12} className="inline -mt-0.5" /> Cand.
          </span>
          <button 
            onClick={toggleCandidateMic}
            title={candidateMicOn ? "Mute candidate's mic" : "Unmute candidate's mic"}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${candidateMicOn ? 'bg-white/5 hover:bg-white/15 text-gray-400' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'}`}
          >
            {candidateMicOn ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          <button 
            onClick={toggleCandidateCam}
            title={candidateCamOn ? "Turn off candidate's camera" : "Turn on candidate's camera"}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${candidateCamOn ? 'bg-white/5 hover:bg-white/15 text-gray-400' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'}`}
          >
            {candidateCamOn ? <VideoIcon size={16} /> : <VideoOff size={16} />}
          </button>
        </div>
      </div>

    </div>
  )
}
