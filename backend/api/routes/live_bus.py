"""
In-process fast path between candidate and interviewer sockets.

Code-editor updates used to go candidate WS → Redis publish → Redis subscribe →
dashboard WS. On Render (single instance) that adds two remote Redis round-trips
and queues behind every trust-score update. When the interviewer's dashboard
socket lives in this same process we send to it directly.

Each WebSocket gets an asyncio.Lock so the Redis forwarder, command replies and
direct pushes never write to the same socket concurrently.
"""
import asyncio
from typing import Dict, Set
from fastapi import WebSocket

_dashboards: Dict[str, Set[WebSocket]] = {}
_locks: Dict[int, asyncio.Lock] = {}


def _lock(ws: WebSocket) -> asyncio.Lock:
    lk = _locks.get(id(ws))
    if lk is None:
        lk = _locks[id(ws)] = asyncio.Lock()
    return lk


async def safe_send(ws: WebSocket, message: dict) -> bool:
    try:
        async with _lock(ws):
            await ws.send_json(message)
        return True
    except Exception:
        return False


def register_dashboard(session_id: str, ws: WebSocket) -> None:
    _dashboards.setdefault(session_id, set()).add(ws)


def unregister_dashboard(session_id: str, ws: WebSocket) -> None:
    s = _dashboards.get(session_id)
    if s:
        s.discard(ws)
        if not s:
            _dashboards.pop(session_id, None)
    _locks.pop(id(ws), None)


def has_local_dashboard(session_id: str) -> bool:
    return bool(_dashboards.get(session_id))


async def send_to_dashboards(session_id: str, message: dict) -> int:
    """Send directly to every dashboard socket for this session in this process."""
    sockets = list(_dashboards.get(session_id, ()))
    if not sockets:
        return 0
    results = await asyncio.gather(*(safe_send(ws, message) for ws in sockets))
    return sum(1 for r in results if r)
