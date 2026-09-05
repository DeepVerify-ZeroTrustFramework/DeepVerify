"""
WebRTC Signaling WebSocket — Peer-to-Peer relay server.

Routes:
    /ws/signaling/{session_id}?role=candidate|interviewer

The server acts purely as a signaling relay. It does NOT touch media.
Media flows directly between the two browser peers via WebRTC.

Flow:
    1. Candidate connects → stored in room
    2. Interviewer connects → stored in room → both get "room-ready"
    3. Candidate creates SDP offer → relayed to interviewer
    4. Interviewer creates SDP answer → relayed to candidate
    5. ICE candidates exchanged via relay
    6. Media flows peer-to-peer (STUN/TURN)
"""
import json
import asyncio
from typing import Dict
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

# Session signaling rooms: session_id -> {role: websocket}
_rooms: Dict[str, Dict[str, WebSocket]] = {}


@router.websocket("/ws/signaling/{session_id}")
async def websocket_signaling(websocket: WebSocket, session_id: str):
    """
    WebRTC signaling relay for a session.
    Query param: ?role=candidate or ?role=interviewer
    """
    # Validate role
    role = websocket.query_params.get("role", "")
    if role not in ("candidate", "interviewer"):
        await websocket.accept()
        await websocket.send_json({"error": "Invalid role. Use 'candidate' or 'interviewer'."})
        await websocket.close(code=4000)
        return

    await websocket.accept()
    other_role = "interviewer" if role == "candidate" else "candidate"

    # Register in room
    if session_id not in _rooms:
        _rooms[session_id] = {}
    _rooms[session_id][role] = websocket

    print(f"[Signaling] {role} joined room {session_id}")

    # If both peers are now connected, announce room-ready
    room = _rooms.get(session_id, {})
    if "candidate" in room and "interviewer" in room:
        print(f"[Signaling] Both peers present in room {session_id} — sending room-ready")
        for r in ("candidate", "interviewer"):
            await _send_to_peer(session_id, r, {
                "type": "room-ready",
                "participants": ["candidate", "interviewer"],
            })
    else:
        print(f"[Signaling] {role} waiting for peer in room {session_id}")

    # Main message loop
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            # Relay signaling messages to the other peer
            if msg_type in ("offer", "answer", "ice-candidate", "ready", "bye"):
                msg["from"] = role
                if msg_type in ("offer", "answer"):
                    sdp = msg.get("sdp", "")
                    m_lines = [l for l in sdp.splitlines() if l.startswith("m=") or l.startswith("a=send") or l.startswith("a=recv") or l.startswith("a=inactive") or l.startswith("a=msid:")]
                    print(f"[Signaling] Relaying '{msg_type}' from {role} → {other_role} in {session_id}:\n  " + "\n  ".join(m_lines))
                else:
                    print(f"[Signaling] Relaying '{msg_type}' from {role} → {other_role} in {session_id}")
                await _send_to_peer(session_id, other_role, msg)

                # When a peer explicitly signals 'ready', if both are present, re-trigger room-ready
                if msg_type == "ready":
                    room = _rooms.get(session_id, {})
                    if "candidate" in room and "interviewer" in room:
                        print(f"[Signaling] Both peers ready in {session_id} — triggering room-ready")
                        for r in ("candidate", "interviewer"):
                            await _send_to_peer(session_id, r, {
                                "type": "room-ready",
                                "participants": ["candidate", "interviewer"],
                            })
            else:
                print(f"[Signaling] Unknown message type '{msg_type}' from {role}")

    except WebSocketDisconnect:
        print(f"[Signaling] {role} disconnected from room {session_id}")
    except Exception as e:
        print(f"[Signaling] Error in {role} handler for {session_id}: {e}")
    finally:
        # Safe cleanup — only remove if this dying socket is still the active one
        was_active = _cleanup_room(session_id, role, websocket)

        # Notify remaining peer only if this was the active socket
        if was_active:
            print(f"[Signaling] Active {role} departed — notifying {other_role}")
            await _send_to_peer(session_id, other_role, {
                "type": "peer-left",
                "role": role,
            })


def _cleanup_room(session_id: str, role: str, websocket: WebSocket) -> bool:
    """Safely remove a peer from its room ONLY if it matches the current socket."""
    room = _rooms.get(session_id)
    if room is None:
        return False
    if room.get(role) == websocket:
        room.pop(role, None)
        if not room:
            _rooms.pop(session_id, None)
            print(f"[Signaling] Room {session_id} is empty — removed")
        return True
    return False


async def _send_to_peer(session_id: str, target_role: str, message: dict):
    """Send a JSON message to the specified peer. Silently fails if peer is gone."""
    room = _rooms.get(session_id)
    if not room:
        return
    ws = room.get(target_role)
    if not ws:
        return
    try:
        await ws.send_json(message)
    except Exception:
        pass
