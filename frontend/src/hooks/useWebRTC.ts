/**
 * useWebRTC — Peer-to-peer WebRTC hook via signaling WebSocket.
 *
 * Architecture:
 *   Browser A  ←→  Signaling WS (/ws/signaling/{id})  ←→  Browser B
 *   Browser A  ←————————— WebRTC media (direct) ——————————→  Browser B
 *
 * The candidate is always the "caller" (creates SDP offer).
 * The interviewer is always the "callee" (creates SDP answer).
 *
 * ICE candidates that arrive before setRemoteDescription are queued
 * and flushed once the remote description is set.
 */
import { useState, useRef, useCallback, useEffect } from 'react'

export type WebRTCState = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error'

// Build the signaling WS URL relative to current page
function buildSignalingUrl(sessionId: string, role: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/signaling/${sessionId}?role=${role}`
}

// ICE servers — Google STUN is free and widely available
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

export function useWebRTC(
  sessionId: string,
  role: 'candidate' | 'interviewer',
  localStream: MediaStream | null
) {
  const [state, setState] = useState<WebRTCState>('idle')
  const [error, setError] = useState('')
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)

  // Refs for mutable objects that must survive re-renders
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([])
  const hasRemoteDescription = useRef(false)
  const isCreatingOffer = useRef(false)
  const isInitialized = useRef(false)
  const remoteStreamRef = useRef<MediaStream>(new MediaStream())

  const localStreamRef = useRef<MediaStream | null>(localStream)

  const attachTracksToPC = useCallback(async (pc: RTCPeerConnection, stream: MediaStream | null) => {
    if (!pc || !stream) return
    const tracks = stream.getTracks()
    for (const track of tracks) {
      const transceivers = pc.getTransceivers()
      const tc = transceivers.find((t) => t.receiver?.track?.kind === track.kind)
      if (tc) {
        tc.direction = 'sendrecv'
        if (tc.sender.track !== track) {
          try {
            await tc.sender.replaceTrack(track)
            console.log(`[WebRTC] Replaced ${track.kind} track on transceiver`)
          } catch (err) {
            console.warn(`[WebRTC] replaceTrack failed for ${track.kind}:`, err)
          }
        }
      } else {
        try {
          pc.addTrack(track, stream)
          console.log(`[WebRTC] Attached track ${track.kind} via addTrack`)
        } catch (e) {
          console.warn(`[WebRTC] addTrack fallback failed:`, e)
        }
      }
    }
  }, [])

  // Dynamically attach local tracks or replace existing sender tracks
  useEffect(() => {
    localStreamRef.current = localStream
    if (pcRef.current && localStream) {
      attachTracksToPC(pcRef.current, localStream)
    }
  }, [localStream, attachTracksToPC])

  /**
   * Flush any ICE candidates that were queued before the remote
   * description was set.
   */
  const flushIceCandidates = useCallback(async () => {
    const pc = pcRef.current
    if (!pc) return

    const queue = iceCandidateQueue.current
    iceCandidateQueue.current = []

    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
      } catch (e) {
        console.warn('[WebRTC] Failed to add queued ICE candidate:', e)
      }
    }

    if (queue.length > 0) {
      console.log(`[WebRTC] Flushed ${queue.length} queued ICE candidates`)
    }
  }, [])

  /**
   * Create the SDP offer (candidate only) and send it via signaling WS.
   */
  const createAndSendOffer = useCallback(async () => {
    const pc = pcRef.current
    const ws = wsRef.current
    if (!pc || !ws || ws.readyState !== WebSocket.OPEN) return

    // If we already have a local offer that wasn't answered yet, re-send it
    if (pc.signalingState === 'have-local-offer' && pc.localDescription) {
      console.log('[WebRTC] Re-sending pending local offer to peer...')
      ws.send(JSON.stringify({
        type: 'offer',
        sdp: pc.localDescription.sdp,
      }))
      return
    }

    if (pc.signalingState !== 'stable') {
      console.warn(`[WebRTC] Postponing offer: signalingState is ${pc.signalingState}`)
      return
    }
    if (isCreatingOffer.current) {
      console.log('[WebRTC] Offer already in flight, skipping redundant trigger')
      return
    }

    try {
      isCreatingOffer.current = true
      if (localStreamRef.current) {
        await attachTracksToPC(pc, localStreamRef.current)
      }

      console.log('[WebRTC] Creating SDP offer...')
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      ws.send(JSON.stringify({
        type: 'offer',
        sdp: offer.sdp,
      }))
      console.log('[WebRTC] Offer sent to signaling server')
    } catch (e) {
      console.error('[WebRTC] Failed to create/send offer:', e)
      setState('error')
      setError('Failed to create video offer')
    } finally {
      isCreatingOffer.current = false
    }
  }, [attachTracksToPC])

  /**
   * Handle an incoming SDP offer (interviewer only).
   * Sets remote description then creates and sends the answer.
   */
  const handleOffer = useCallback(async (sdp: string) => {
    const pc = pcRef.current
    const ws = wsRef.current
    if (!pc || !ws || ws.readyState !== WebSocket.OPEN) return

    try {
      console.log('[WebRTC] Received offer — setting remote description...')
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }))
      hasRemoteDescription.current = true

      // Flush any ICE candidates that arrived before the offer
      await flushIceCandidates()

      // Attach latest local tracks to transceivers before creating answer
      if (localStreamRef.current) {
        await attachTracksToPC(pc, localStreamRef.current)
      }

      console.log('[WebRTC] Creating SDP answer...')
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      ws.send(JSON.stringify({
        type: 'answer',
        sdp: answer.sdp,
      }))
      console.log('[WebRTC] Answer sent to signaling server')
    } catch (e) {
      console.error('[WebRTC] Failed to handle offer:', e)
      setState('error')
      setError('Failed to respond to video offer')
    }
  }, [flushIceCandidates, attachTracksToPC])

  /**
   * Handle an incoming SDP answer (candidate only).
   */
  const handleAnswer = useCallback(async (sdp: string) => {
    const pc = pcRef.current
    if (!pc) return

    try {
      console.log('[WebRTC] Received answer — setting remote description...')
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }))
      hasRemoteDescription.current = true

      // Flush any ICE candidates that arrived before the answer
      await flushIceCandidates()
    } catch (e) {
      console.error('[WebRTC] Failed to handle answer:', e)
    }
  }, [flushIceCandidates])

  /**
   * Handle an incoming ICE candidate from the remote peer.
   */
  const handleIceCandidate = useCallback(async (candidateInit: RTCIceCandidateInit) => {
    const pc = pcRef.current
    if (!pc) return

    if (hasRemoteDescription.current) {
      // Remote description already set — add immediately
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidateInit))
      } catch (e) {
        console.warn('[WebRTC] Failed to add ICE candidate:', e)
      }
    } else {
      // Queue for later
      iceCandidateQueue.current.push(candidateInit)
    }
  }, [])

  /**
   * Main initialization: create PeerConnection + Signaling WebSocket.
   */
  const initialize = useCallback(() => {
    if (isInitialized.current) return
    if (!sessionId) return
    isInitialized.current = true

    setState('waiting')
    setError('')
    hasRemoteDescription.current = false
    iceCandidateQueue.current = []
    remoteStreamRef.current = new MediaStream()

    // ─── 1. Create RTCPeerConnection ───
    console.log(`[WebRTC] Initializing as ${role} for session ${sessionId}`)
    const pc = new RTCPeerConnection(ICE_CONFIG)
    pcRef.current = pc

    // Add existing tracks directly so sender and stream IDs are immediately bound
    if (localStreamRef.current && localStreamRef.current.getTracks().length > 0) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, localStreamRef.current!)
          console.log(`[WebRTC] Initialized track ${track.kind} (${track.id}) with stream`)
        } catch (e) {
          console.warn('[WebRTC] Error adding initial track:', e)
        }
      })
    }

    // Ensure transceivers exist for both audio and video so we can receive
    const existingKinds = pc.getTransceivers().map((t) => t.receiver?.track?.kind)
    if (!existingKinds.includes('audio')) {
      try { pc.addTransceiver('audio', { direction: 'sendrecv' }) } catch {}
    }
    if (!existingKinds.includes('video')) {
      try { pc.addTransceiver('video', { direction: 'sendrecv' }) } catch {}
    }

    // Handle incoming remote tracks
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received remote ${event.track.kind} track (${event.track.id})`)

      if (event.streams && event.streams[0]) {
        remoteStreamRef.current = event.streams[0]
      } else {
        const exists = remoteStreamRef.current.getTracks().some((t) => t.id === event.track.id)
        if (!exists) {
          remoteStreamRef.current.addTrack(event.track)
        }
      }

      event.track.onunmute = () => {
        console.log(`[WebRTC] Remote track ${event.track.kind} unmuted`)
        setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()))
      }

      // Create a fresh MediaStream reference so React detects the change
      setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()))
      setState('connected')
    }

    // Connection state monitoring
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      console.log(`[WebRTC] PeerConnection state: ${s}`)
      if (s === 'connected') {
        setState('connected')
      } else if (s === 'failed') {
        setState('error')
        setError('WebRTC connection failed. Please refresh.')
      } else if (s === 'disconnected') {
        // May recover — don't immediately error
        console.warn('[WebRTC] Connection disconnected — may recover...')
      }
    }

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE connection state: ${pc.iceConnectionState}`)
    }

    // ─── 2. Connect Signaling WebSocket ───
    const wsUrl = buildSignalingUrl(sessionId, role)
    console.log(`[WebRTC] Connecting to signaling: ${wsUrl}`)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    // Send local ICE candidates to remote peer via signaling
    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        }))
      }
    }

    ws.onopen = () => {
      console.log(`[WebRTC] Signaling WebSocket connected as ${role}`)
      // Tell the server we're ready
      ws.send(JSON.stringify({ type: 'ready' }))
    }

    ws.onmessage = (event) => {
      let msg: any
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }

      switch (msg.type) {
        case 'room-ready':
          // Both peers present — candidate creates the offer
          console.log('[WebRTC] Room ready — both peers connected')
          if (role === 'candidate') {
            createAndSendOffer()
          }
          break

        case 'ready':
          console.log(`[WebRTC] Remote peer sent ready (${msg.from || 'peer'})`)
          if (role === 'candidate') {
            createAndSendOffer()
          }
          break

        case 'peer-joined':
          console.log(`[WebRTC] Peer joined: ${msg.role}`)
          if (role === 'candidate') {
            createAndSendOffer()
          }
          break

        case 'offer':
          // Only the interviewer should receive offers
          if (role === 'interviewer') {
            handleOffer(msg.sdp)
          }
          break

        case 'answer':
          // Only the candidate should receive answers
          if (role === 'candidate') {
            handleAnswer(msg.sdp)
          }
          break

        case 'ice-candidate':
          if (msg.candidate) {
            handleIceCandidate(msg.candidate)
          }
          break

        case 'peer-left':
          console.log(`[WebRTC] Peer left: ${msg.role}`)
          setState('waiting')
          setRemoteStream(null)
          remoteStreamRef.current = new MediaStream()
          hasRemoteDescription.current = false
          if (pc && pc.signalingState === 'have-local-offer') {
            try {
              pc.setLocalDescription({ type: 'rollback' }).catch(() => {})
            } catch {}
          }
          break

        case 'pong':
          // Heartbeat response — ignore
          break

        default:
          console.log(`[WebRTC] Unknown signaling message: ${msg.type}`)
      }
    }

    ws.onerror = (e) => {
      console.error('[WebRTC] Signaling WebSocket error:', e)
    }

    ws.onclose = (e) => {
      console.log(`[WebRTC] Signaling WebSocket closed (code=${e.code})`)
    }

    // Heartbeat to keep the WebSocket alive through proxies
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 25000)

      // Store cleanup ref for the ping interval
      ; (pc as any).__pingInterval = pingInterval

  }, [sessionId, role, localStream, createAndSendOffer, handleOffer, handleAnswer, handleIceCandidate])

  /**
   * Clean teardown of everything.
   */
  const stop = useCallback(() => {
    // Clear ping interval
    const pc = pcRef.current
    if (pc && (pc as any).__pingInterval) {
      clearInterval((pc as any).__pingInterval)
    }

    // Close WebSocket
    const ws = wsRef.current
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'bye' }))
        } catch { /* ignore */ }
      }
      ws.close()
      wsRef.current = null
    }

    // Close PeerConnection
    if (pc) {
      pc.close()
      pcRef.current = null
    }

    // Reset state
    setState('idle')
    setError('')
    setRemoteStream(null)
    remoteStreamRef.current = new MediaStream()
    hasRemoteDescription.current = false
    iceCandidateQueue.current = []
    isInitialized.current = false
  }, [])

  return {
    state,
    error,
    remoteStream,
    initialize,
    stop,
  }
}
