/**
 * useWebRTC — Peer-to-peer WebRTC hook via signaling WebSocket.
 *
 *   Browser A  ←→  Signaling WS (/ws/signaling/{id})  ←→  Browser B
 *   Browser A  ←——— WebRTC media + "sync" data channel (direct or via TURN) ———→  Browser B
 *
 * The candidate is always the offerer, the interviewer always the answerer.
 *
 * Cross-network reliability:
 *  - ICE servers (incl. TURN with short-lived credentials) are fetched from the
 *    backend (/api/webrtc/ice-servers) so they can be rotated without a rebuild.
 *    Two laptops on different networks / campus Wi-Fi with client isolation
 *    CANNOT connect without a working TURN relay — only same-machine tests can.
 *  - Every RTCPeerConnection gets a random `pcId`. Signaling messages carry it,
 *    so a peer that refreshed/rejoined gets a brand-new connection instead of a
 *    stale one, and late ICE candidates from an old connection are dropped.
 *  - ICE restart on failure, signaling WS auto-reconnect.
 *
 * Latency:
 *  - Receiver jitter buffer target set to 0 (playoutDelayHint / jitterBufferTarget).
 *  - Senders prefer framerate over resolution; bitrate capped to avoid queueing.
 *  - A negotiated data channel ("sync") lets the candidate stream editor contents
 *    peer-to-peer, bypassing the backend entirely (see sendData / onData).
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { getWsUrl } from '../utils/apiConfig'

export type WebRTCState = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error'

function buildSignalingUrl(sessionId: string, role: string): string {
  return getWsUrl(`/ws/signaling/${sessionId}?role=${role}`)
}

// ── Fallback ICE config — used ONLY if the backend /api/webrtc/ice-servers call fails.
// The real relays (ExpressTURN + Metered) are configured on the BACKEND. These
// optional VITE_TURN_* build-time vars can point at any single TURN server. ──
const TURN_URL = import.meta.env.VITE_TURN_URL || ''
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME || ''
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL || ''

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ...(TURN_URL && TURN_USERNAME
    ? [{
        urls: [
          `turn:${TURN_URL}:80`,
          `turn:${TURN_URL}:80?transport=tcp`,
          `turn:${TURN_URL}:443`,
          `turns:${TURN_URL}:443?transport=tcp`,
        ],
        username: TURN_USERNAME,
        credential: TURN_CREDENTIAL,
      }]
    : []),
]

let cachedIce: { servers: RTCIceServer[]; at: number } | null = null

async function loadIceServers(): Promise<RTCIceServer[]> {
  if (cachedIce && Date.now() - cachedIce.at < 10 * 60 * 1000) return cachedIce.servers
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch('/api/webrtc/ice-servers', { signal: ctrl.signal })
    clearTimeout(t)
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data.iceServers) && data.iceServers.length) {
        const hasTurn = data.iceServers.some((s: RTCIceServer) =>
          ([] as string[]).concat(s.urls as any).some((u) => u.startsWith('turn')))
        if (!hasTurn) {
          console.warn('[WebRTC] Backend returned no TURN server — calls across different networks will likely fail. Set METERED_* or TURN_* env vars on the backend.')
        }
        cachedIce = { servers: data.iceServers, at: Date.now() }
        return data.iceServers
      }
    }
  } catch (e) {
    console.warn('[WebRTC] Could not fetch ICE servers from backend, using fallback', e)
  }
  return FALLBACK_ICE_SERVERS
}

const randomId = () => Math.random().toString(36).slice(2, 10)

/** Lower receive-side buffering — big win for perceived latency. */
function tuneReceiver(receiver: RTCRtpReceiver) {
  try { (receiver as any).playoutDelayHint = 0 } catch { /* unsupported */ }
  try { (receiver as any).jitterBufferTarget = 0 } catch { /* unsupported */ }
}

/** Prefer smooth, low-delay video over resolution; cap bitrate to avoid queueing
 *  and to leave uplink room for the forensic frame upload. */
async function tuneSender(sender: RTCRtpSender) {
  if (!sender.track) return
  try {
    if (sender.track.kind === 'video') {
      ;(sender.track as any).contentHint = 'motion'
      const p = sender.getParameters()
      if (!p.encodings || p.encodings.length === 0) p.encodings = [{}]
      // ~700 kbps is plenty for a talking head and roughly halves TURN usage
      p.encodings[0].maxBitrate = 700_000
      p.encodings[0].maxFramerate = 30
      ;(p as any).degradationPreference = 'maintain-framerate'
      await sender.setParameters(p)
    }
  } catch (e) {
    console.debug('[WebRTC] sender tuning skipped:', e)
  }
}

export function useWebRTC(
  sessionId: string,
  role: 'candidate' | 'interviewer',
  localStream: MediaStream | null,
  onData?: (msg: any) => void
) {
  const [state, setState] = useState<WebRTCState>('idle')
  const [error, setError] = useState('')
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pcIdRef = useRef<string>('')
  const remotePcIdRef = useRef<string>('')
  const dcRef = useRef<RTCDataChannel | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const iceServersRef = useRef<RTCIceServer[]>(FALLBACK_ICE_SERVERS)
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([])
  const makingOffer = useRef(false)
  const stopped = useRef(true)
  const isInitialized = useRef(false)
  const remoteStreamRef = useRef<MediaStream>(new MediaStream())
  const localStreamRef = useRef<MediaStream | null>(localStream)
  const onDataRef = useRef(onData)
  const timers = useRef<{ ping?: any; reconnect?: any; disconnect?: any }>({})
  const peerPresent = useRef(false)
  // Signaling messages are processed strictly one after another so an offer,
  // its ICE candidates and duplicates can never race each other.
  const opChain = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => { onDataRef.current = onData }, [onData])

  const sendSignal = useCallback((msg: any) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ...msg, pcId: pcIdRef.current }))
    }
  }, [])

  /** Put local tracks onto the transceivers. Returns true when a track now has to
   *  be SENT on a transceiver that was negotiated as receive-only (e.g. the
   *  interviewer's camera came up after the call connected) - that needs a new
   *  offer/answer round, replaceTrack alone is not enough. */
  const attachLocalTracks = useCallback(async (pc: RTCPeerConnection, stream: MediaStream | null): Promise<boolean> => {
    if (!stream) return false
    let needsNegotiation = false
    for (const track of stream.getTracks()) {
      const tc = pc.getTransceivers().find(
        (t) => t.currentDirection !== 'stopped' && t.receiver.track?.kind === track.kind
      )
      if (!tc) continue
      if (tc.direction !== 'sendrecv') {
        tc.direction = 'sendrecv'
        if (tc.currentDirection && tc.currentDirection !== 'sendrecv' && tc.currentDirection !== 'sendonly') {
          needsNegotiation = true
        }
      }
      if (tc.sender.track !== track) {
        try {
          await tc.sender.replaceTrack(track)
          try { tc.sender.setStreams?.(stream) } catch { /* ignore */ }
        } catch (err) {
          console.warn(`[WebRTC] replaceTrack failed for ${track.kind}:`, err)
        }
      }
      tuneSender(tc.sender)
    }
    return needsNegotiation
  }, [])


  const setupDataChannel = useCallback((pc: RTCPeerConnection) => {
    // Negotiated channel: both sides create it with the same id, no extra signaling.
    const dc = pc.createDataChannel('sync', { negotiated: true, id: 0, ordered: true })
    dc.onmessage = (e) => {
      try { onDataRef.current?.(JSON.parse(e.data)) } catch { /* ignore */ }
    }
    dc.onopen = () => console.log('[WebRTC] Data channel open (P2P code sync active)')
    dcRef.current = dc
  }, [])

  const flushIceCandidates = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || !pc.remoteDescription) return
    const queue = iceCandidateQueue.current
    iceCandidateQueue.current = []
    for (const c of queue) {
      try { await pc.addIceCandidate(c) } catch (e) { console.warn('[WebRTC] queued ICE add failed', e) }
    }
  }, [])

  const createAndSendOffer = useCallback(async (iceRestart = false, force = false) => {
    const pc = pcRef.current
    if (!pc || pc.signalingState === 'closed') return
    if (makingOffer.current) return
    if (pc.signalingState !== 'stable' && !iceRestart) {
      // Offer still unanswered (e.g. interviewer just joined) → re-send it.
      if (pc.signalingState === 'have-local-offer' && pc.localDescription) {
        sendSignal({ type: 'offer', sdp: pc.localDescription.sdp })
      }
      return
    }
    // Already connected and nothing to renegotiate
    if (!iceRestart && !force && pc.connectionState === 'connected') return
    try {
      makingOffer.current = true
      await attachLocalTracks(pc, localStreamRef.current)
      const offer = await pc.createOffer({ iceRestart })
      await pc.setLocalDescription(offer)
      sendSignal({ type: 'offer', sdp: offer.sdp })
      console.log(`[WebRTC] Offer sent${iceRestart ? ' (ICE restart)' : ''}`)
    } catch (e) {
      console.error('[WebRTC] Failed to create/send offer:', e)
    } finally {
      makingOffer.current = false
    }
  }, [attachLocalTracks, sendSignal])

  // Local stream changed (camera switch / toggle / camera became available) →
  // swap tracks in place; if this side now SENDS something it was only
  // receiving before, renegotiate so the other side actually gets it.
  useEffect(() => {
    localStreamRef.current = localStream
    const pc = pcRef.current
    if (!pc || !localStream) return
    attachLocalTracks(pc, localStream).then((needsNegotiation) => {
      if (!needsNegotiation || pc !== pcRef.current) return
      console.log('[WebRTC] Local media changed mid-call - renegotiating')
      if (role === 'interviewer') sendSignal({ type: 'renegotiate' })
      else createAndSendOffer(false, true)
    })
  }, [localStream, attachLocalTracks, createAndSendOffer, sendSignal, role])

  /** Build a fresh RTCPeerConnection (called at start and whenever the remote peer is new). */
  const buildPeerConnection = useCallback(() => {
    const old = pcRef.current
    if (old) { try { old.close() } catch { /* ignore */ } }

    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
      ...(import.meta.env.VITE_FORCE_TURN === 'true' ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {}),
    })
    pcRef.current = pc
    pcIdRef.current = randomId()
    remotePcIdRef.current = ''
    iceCandidateQueue.current = []
    remoteStreamRef.current = new MediaStream()
    setRemoteStream(null)

    // Exactly one audio + one video transceiver on each side, created up front.
    // The offerer's m-lines are matched by the answerer's transceivers created
    // via addTransceiver in the same order, so tracks can be swapped in any time.
    if (role === 'candidate') {
      pc.addTransceiver('audio', { direction: 'sendrecv' })
      pc.addTransceiver('video', { direction: 'sendrecv' })
      attachLocalTracks(pc, localStreamRef.current)
    }
    setupDataChannel(pc)

    pc.ontrack = (event) => {
      tuneReceiver(event.receiver)
      const rs = remoteStreamRef.current
      if (!rs.getTracks().some((t) => t.id === event.track.id)) {
        rs.getTracks().filter((t) => t.kind === event.track.kind).forEach((t) => rs.removeTrack(t))
        rs.addTrack(event.track)
      }
      const publish = () => setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()))
      event.track.onunmute = publish
      publish()
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ type: 'ice-candidate', candidate: event.candidate.toJSON() })
      }
    }

    pc.onicecandidateerror = (e: any) => {
      // 701 = server unreachable. Auth errors (401) mean bad TURN credentials.
      if (e.errorCode && e.errorCode !== 701) {
        console.warn(`[WebRTC] ICE server error ${e.errorCode} ${e.errorText} (${e.url})`)
      }
    }

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      console.log(`[WebRTC] connection: ${s}`)
      if (pc !== pcRef.current) return
      if (s === 'connected') {
        clearTimeout(timers.current.disconnect)
        setState('connected')
        setError('')
        // Log which path was chosen — 'relay' means TURN is in use.
        pc.getStats().then((stats) => {
          stats.forEach((r: any) => {
            if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
              const l = stats.get(r.localCandidateId), rm = stats.get(r.remoteCandidateId)
              console.log(`[WebRTC] Path: local=${l?.candidateType}/${l?.protocol} remote=${rm?.candidateType}, RTT=${Math.round((r.currentRoundTripTime || 0) * 1000)}ms`)
            }
          })
        }).catch(() => {})
      } else if (s === 'disconnected') {
        // Give it a few seconds to self-heal, then ICE-restart.
        clearTimeout(timers.current.disconnect)
        timers.current.disconnect = setTimeout(() => {
          if (pcRef.current === pc && pc.connectionState !== 'connected' && role === 'candidate') {
            createAndSendOffer(true)
          }
        }, 4000)
      } else if (s === 'failed') {
        if (role === 'candidate') {
          console.warn('[WebRTC] Connection failed — attempting ICE restart')
          createAndSendOffer(true)
        } else {
          sendSignal({ type: 'restart-request' })
        }
        setState('connecting')
        setError('Reconnecting video… (if this persists, the TURN relay is not reachable)')
      }
    }

    return pc
  }, [role, attachLocalTracks, setupDataChannel, sendSignal, createAndSendOffer])

  const handleOffer = useCallback(async (sdp: string, fromPcId: string) => {
    let pc = pcRef.current
    // A new candidate connection (refresh / rejoin) → start from a clean PC.
    if (!pc || (remotePcIdRef.current && fromPcId && fromPcId !== remotePcIdRef.current)) {
      console.log('[WebRTC] New remote peer connection — rebuilding')
      pc = buildPeerConnection()
    }
    if (fromPcId) remotePcIdRef.current = fromPcId
    // Duplicate of the offer we already answered → ignore.
    if (pc.signalingState === 'stable' && pc.remoteDescription?.sdp === sdp) return
    try {
      if (pc.signalingState !== 'stable') {
        await pc.setLocalDescription({ type: 'rollback' }).catch(() => {})
      }
      await pc.setRemoteDescription({ type: 'offer', sdp })
      await flushIceCandidates()
      await attachLocalTracks(pc, localStreamRef.current)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      sendSignal({ type: 'answer', sdp: answer.sdp })
      setState((s) => (s === 'connected' ? s : 'connecting'))
      console.log('[WebRTC] Answer sent')
    } catch (e) {
      console.error('[WebRTC] Failed to handle offer:', e)
    }
  }, [buildPeerConnection, flushIceCandidates, attachLocalTracks, sendSignal])

  const handleAnswer = useCallback(async (sdp: string, fromPcId: string) => {
    const pc = pcRef.current
    if (!pc || pc.signalingState !== 'have-local-offer') return // duplicate/stale answer
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp })
      if (fromPcId) remotePcIdRef.current = fromPcId
      await flushIceCandidates()
    } catch (e) {
      console.error('[WebRTC] Failed to handle answer:', e)
    }
  }, [flushIceCandidates])

  const handleRemoteIce = useCallback(async (c: RTCIceCandidateInit, fromPcId: string) => {
    const pc = pcRef.current
    if (!pc) return
    // Drop candidates belonging to an old remote connection
    if (fromPcId && remotePcIdRef.current && fromPcId !== remotePcIdRef.current) return
    if (pc.remoteDescription) {
      try { await pc.addIceCandidate(c) } catch (e) { console.warn('[WebRTC] addIceCandidate failed', e) }
    } else {
      iceCandidateQueue.current.push(c)
    }
  }, [])

  const connectSignaling = useCallback(() => {
    if (stopped.current) return
    const ws = new WebSocket(buildSignalingUrl(sessionId, role))
    wsRef.current = ws

    ws.onopen = () => {
      console.log(`[WebRTC] Signaling connected as ${role}`)
      ws.send(JSON.stringify({ type: 'ready', pcId: pcIdRef.current }))
    }

    ws.onmessage = (event) => {
      let msg: any
      try { msg = JSON.parse(event.data) } catch { return }
      const fromPcId: string = msg.pcId || ''
      if (msg.type === 'pong') return
      opChain.current = opChain.current.then(() => handleSignal(msg, fromPcId)).catch((e) => {
        console.warn('[WebRTC] signaling handler error', e)
      })
    }

    const handleSignal = async (msg: any, fromPcId: string) => {
      switch (msg.type) {
        case 'room-ready':
        case 'ready':
        case 'peer-joined':
          peerPresent.current = true
          if (role === 'candidate') {
            const pc = pcRef.current
            // Interviewer is a fresh connection → rebuild and re-offer.
            if (pc && remotePcIdRef.current && fromPcId && fromPcId !== remotePcIdRef.current) {
              buildPeerConnection()
            } else if (pc && pc.connectionState === 'failed') {
              buildPeerConnection()
            }
            await createAndSendOffer()
          }
          break
        case 'offer':
          if (role === 'interviewer') await handleOffer(msg.sdp, fromPcId)
          break
        case 'answer':
          if (role === 'candidate') await handleAnswer(msg.sdp, fromPcId)
          break
        case 'ice-candidate':
          if (msg.candidate) await handleRemoteIce(msg.candidate, fromPcId)
          break
        case 'restart-request':
          if (role === 'candidate') await createAndSendOffer(true)
          break
        case 'renegotiate':
          // The interviewer's camera/mic became available mid-call: offer again
          if (role === 'candidate') await createAndSendOffer(false, true)
          break
        case 'peer-left':
          console.log(`[WebRTC] Peer left: ${msg.role}`)
          peerPresent.current = false
          setState('waiting')
          buildPeerConnection()
          break
        default:
          break
      }
    }

    ws.onclose = () => {
      if (wsRef.current !== ws || stopped.current) return
      console.warn('[WebRTC] Signaling closed — reconnecting in 2s')
      timers.current.reconnect = setTimeout(connectSignaling, 2000)
    }
    ws.onerror = () => { /* onclose handles reconnect */ }
  }, [sessionId, role, buildPeerConnection, createAndSendOffer, handleOffer, handleAnswer, handleRemoteIce])

  const initialize = useCallback(async () => {
    if (isInitialized.current || !sessionId) return
    isInitialized.current = true
    stopped.current = false
    setState('waiting')
    setError('')

    iceServersRef.current = await loadIceServers()
    if (stopped.current) return

    console.log(`[WebRTC] Initializing as ${role} for session ${sessionId}`)
    buildPeerConnection()
    connectSignaling()

    timers.current.ping = setInterval(() => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
    }, 20000)
  }, [sessionId, role, buildPeerConnection, connectSignaling])

  /** Send a JSON message to the peer over the P2P data channel. Returns false if not open. */
  const sendData = useCallback((msg: any): boolean => {
    const dc = dcRef.current
    if (dc && dc.readyState === 'open') {
      try { dc.send(JSON.stringify(msg)); return true } catch { return false }
    }
    return false
  }, [])

  const stop = useCallback(() => {
    stopped.current = true
    clearInterval(timers.current.ping)
    clearTimeout(timers.current.reconnect)
    clearTimeout(timers.current.disconnect)

    const ws = wsRef.current
    wsRef.current = null
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'bye' })) } catch { /* ignore */ }
      }
      ws.close()
    }
    if (pcRef.current) {
      try { pcRef.current.close() } catch { /* ignore */ }
      pcRef.current = null
    }
    dcRef.current = null
    setState('idle')
    setError('')
    setRemoteStream(null)
    remoteStreamRef.current = new MediaStream()
    iceCandidateQueue.current = []
    remotePcIdRef.current = ''
    isInitialized.current = false
  }, [])

  return { state, error, remoteStream, initialize, stop, sendData }
}
