import { useState, useRef, useCallback } from 'react'

export type WebRTCState = 'idle' | 'waiting' | 'connected' | 'error'

export function useWebRTC(sessionId: string, role: 'candidate' | 'interviewer', localStream: MediaStream | null) {
  const [state, setState] = useState<WebRTCState>('idle')
  const [error, setError] = useState('')
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  
  // Create PeerConnection and set up signaling
  const initialize = useCallback(async () => {
    if (pcRef.current) return

    setState('waiting')
    
    // ICE servers could be injected via env in production
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })
    pcRef.current = pc
    remoteStreamRef.current = new MediaStream()

    // Add local tracks
    if (localStream && role === 'candidate') {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream)
      })
    } else if (role === 'interviewer') {
      // Interviewer doesn't send video in this setup, just receives
      // But we need to add a transceiver to receive
      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received ${event.track.kind} track from ${role === 'candidate' ? 'interviewer' : 'candidate'}`)
      event.streams[0].getTracks().forEach(track => {
        remoteStreamRef.current?.addTrack(track)
      })
      setRemoteStream(remoteStreamRef.current)
      setState('connected')
    }

    // Handle ICE candidates
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        try {
          await fetch(`/api/webrtc/ice/${sessionId}/${role}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex
            })
          })
        } catch (e) {
          console.error('[WebRTC] Error sending ICE candidate', e)
        }
      }
    }

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state: ${pc.connectionState}`)
      if (pc.connectionState === 'connected') {
        setState('connected')
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setState('error')
        setError('Connection failed. Please refresh.')
      }
    }

    // Negotiate (offer/answer)
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const res = await fetch(`/api/webrtc/offer/${sessionId}/${role}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: offer.sdp,
          type: offer.type
        })
      })

      if (!res.ok) throw new Error('Failed to negotiate with signaling server')
      const answer = await res.json()
      
      await pc.setRemoteDescription(new RTCSessionDescription(answer))
    } catch (e: any) {
      console.error('[WebRTC] Negotiation failed', e)
      setState('error')
      setError('Failed to connect to signaling server')
    }
  }, [sessionId, role, localStream])

  // Stop connection
  const stop = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
      setState('idle')
      setRemoteStream(null)
      remoteStreamRef.current = null
      
      fetch(`/api/webrtc/close/${sessionId}/${role}`, { method: 'POST' }).catch(() => {})
    }
  }, [sessionId, role])

  return {
    state,
    error,
    remoteStream,
    initialize,
    stop
  }
}
