"""
WebRTC Signaling WebSocket endpoint.

Handles SDP offer/answer exchange and ICE candidate relay between
candidate and interviewer for establishing peer-to-peer video connection.

The server acts as a signaling relay — it does NOT process the media stream.
Media flows directly between peers (or via TURN relay if needed).
"""
import json
import asyncio
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

# Session signaling rooms: session_id -> {role: websocket}
_signaling_rooms: Dict[str, Dict[str, WebSocket]] = {}
# Lock for thread-safe room management
_room_locks: Dict[str, asyncio.Lock] = {}


def _get_lock(session_id: str) -> asyncio.Lock:
    if session_id not in _room_locks:
        _room_locks[session_id] = asyncio.Lock()
    return _room_locks[session_id]


@router.websocket("/ws/signaling/{session_id}")
async def websocket_signaling(websocket: WebSocket, session_id: str):
    """
    WebRTC signaling relay for a session.

    Each participant connects with a role query param: ?role=candidate or ?role=interviewer
    Messages are relayed to the other participant in the same session.

    Message types:
    - { type: "offer", sdp: "..." }      — SDP offer from caller
    - { type: "answer", sdp: "..." }     — SDP answer from callee
    - { type: "ice-candidate", candidate: {...} }  — ICE candidate
    - { type: "ready" }                   — Participant is ready
    """
    await websocket.accept()

    # Determine role from query params
    role = websocket.query_params.get("role", "candidate")
    if role not in ("candidate", "interviewer"):
        await websocket.send_json({"error": "Invalid role. Use 'candidate' or 'interviewer'."})
        await websocket.close(code=4000)
        return

    lock = _get_lock(session_id)

    async with lock:
        if session_id not in _signaling_rooms:
            _signaling_rooms[session_id] = {}

        _signaling_rooms[session_id][role] = websocket

    print(f"[Signaling] {role} joined session {session_id}")

    # Notify the other party that someone joined
    other_role = "interviewer" if role == "candidate" else "candidate"
    await _notify_peer(session_id, other_role, {
        "type": "peer-joined",
        "role": role,
    })

    # If both parties are now connected, notify both
    room = _signaling_rooms.get(session_id, {})
    if "candidate" in room and "interviewer" in room:
        for r in ("candidate", "interviewer"):
            try:
                await room[r].send_json({
                    "type": "room-ready",
                    "participants": list(room.keys()),
                })
            except Exception:
                pass

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")

            # Relay signaling messages to the other participant
            if msg_type in ("offer", "answer", "ice-candidate", "ready", "bye"):
                msg["from"] = role
                await _notify_peer(session_id, other_role, msg)

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        print(f"[Signaling] {role} left session {session_id}")

        async with lock:
            room = _signaling_rooms.get(session_id, {})
            if role in room:
                del room[role]
            if not room:
                del _signaling_rooms[session_id]
                if session_id in _room_locks:
                    del _room_locks[session_id]

        # Notify other party of disconnect
        await _notify_peer(session_id, other_role, {
            "type": "peer-left",
            "role": role,
        })


async def _notify_peer(session_id: str, target_role: str, message: dict):
    """Send a message to the other participant in the session."""
    room = _signaling_rooms.get(session_id, {})
    peer_ws = room.get(target_role)
    if peer_ws:
        try:
            await peer_ws.send_json(message)
        except Exception:
            pass  # Peer may have disconnected
