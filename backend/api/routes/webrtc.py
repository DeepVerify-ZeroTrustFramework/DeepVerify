"""
WebRTC SFU routes — DEPRECATED.

Video connections now use peer-to-peer WebRTC via the signaling WebSocket
at /ws/signaling/{session_id}. This file is kept as a stub to avoid
import errors in main.py until fully removed.
"""
from fastapi import APIRouter

router = APIRouter()
