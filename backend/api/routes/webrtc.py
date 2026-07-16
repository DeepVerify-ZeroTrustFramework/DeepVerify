"""
WebRTC signaling and SFU relay via aiortc.
Handles SDP offer/answer and ICE candidate exchange.
"""
from fastapi import APIRouter, HTTPException
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRelay
from aiortc.rtcicetransport import RTCIceCandidate
from typing import Dict
from pydantic import BaseModel

router = APIRouter()

relay = MediaRelay()
peer_connections: Dict[str, RTCPeerConnection] = {}
candidate_tracks: Dict[str, list] = {}


class SDPOffer(BaseModel):
    sdp: str
    type: str


class ICECandidate(BaseModel):
    candidate: str = ""
    sdpMid: str = ""
    sdpMLineIndex: int = 0


@router.post("/api/webrtc/offer/{session_id}/{role}")
async def handle_offer(session_id: str, role: str, offer: SDPOffer):
    """
    Handle WebRTC SDP offer from candidate or interviewer.
    role: 'candidate' | 'interviewer'
    Candidates publish their stream. Interviewers subscribe to relay.
    """
    if role not in ("candidate", "interviewer"):
        raise HTTPException(status_code=400, detail="Role must be 'candidate' or 'interviewer'")

    pc = RTCPeerConnection()
    key = f"{session_id}:{role}"
    peer_connections[key] = pc

    if role == "candidate":
        candidate_tracks[session_id] = []

    @pc.on("track")
    def on_track(track):
        if role == "candidate":
            # Relay candidate's video/audio to interviewer
            relay_track = relay.subscribe(track)
            candidate_tracks[session_id].append(relay_track)
            
            interviewer_key = f"{session_id}:interviewer"
            interviewer_pc = peer_connections.get(interviewer_key)
            if interviewer_pc:
                try:
                    interviewer_pc.addTrack(relay_track)
                except:
                    pass

    @pc.on("connectionstatechange")
    async def on_state_change():
        print(f"[WebRTC] {role} connection state: {pc.connectionState}")
        if pc.connectionState == "failed":
            await pc.close()
            if key in peer_connections:
                del peer_connections[key]
            if role == "candidate" and session_id in candidate_tracks:
                del candidate_tracks[session_id]

    if role == "interviewer":
        tracks = candidate_tracks.get(session_id, [])
        for t in tracks:
            pc.addTrack(t)

    desc = RTCSessionDescription(sdp=offer.sdp, type=offer.type)
    await pc.setRemoteDescription(desc)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type,
    }


@router.post("/api/webrtc/ice/{session_id}/{role}")
async def handle_ice(session_id: str, role: str, candidate: ICECandidate):
    """Handle incoming ICE candidate."""
    key = f"{session_id}:{role}"
    pc = peer_connections.get(key)
    if not pc:
        raise HTTPException(status_code=404, detail="No peer connection found for this session/role")

    if candidate.candidate:
        try:
            # Parse ICE candidate string
            parts = candidate.candidate.split()
            if len(parts) >= 8:
                ice = RTCIceCandidate(
                    component=int(parts[1]),
                    foundation=parts[0].replace("candidate:", ""),
                    ip=parts[4],
                    port=int(parts[5]),
                    priority=int(parts[3]),
                    protocol=parts[2],
                    type=parts[7],
                    sdpMid=candidate.sdpMid,
                    sdpMLineIndex=candidate.sdpMLineIndex,
                )
                await pc.addIceCandidate(ice)
        except Exception as e:
            print(f"[WebRTC] ICE candidate parse error: {e}")

    return {"ok": True}


@router.post("/api/webrtc/close/{session_id}/{role}")
async def close_connection(session_id: str, role: str):
    """Close a WebRTC peer connection."""
    key = f"{session_id}:{role}"
    pc = peer_connections.get(key)
    if pc:
        await pc.close()
        del peer_connections[key]
    if role == "candidate" and session_id in candidate_tracks:
        del candidate_tracks[session_id]
    return {"ok": True}
