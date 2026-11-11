"""
WebRTC ICE server configuration.

GET /api/webrtc/ice-servers  →  {"iceServers": [...], "turn": bool, "source": str}

Why this exists: on ONE laptop, two browser tabs connect directly (host
candidates) so video works without any relay. On TWO laptops on different
networks — or on campus/office Wi-Fi with client isolation, mobile hotspots,
CGNAT — a direct path usually doesn't exist and the media must go through a
TURN relay. The relay credentials that were hard-coded in the frontend build
were rejected by Metered ("TURN allocate error"), so cross-laptop calls never
connected. Credentials now come from backend env vars and can be rotated
without rebuilding the frontend.

Configure ONE of these on the backend (Render → Environment):

  Option A — Metered (recommended, free tier: https://dashboard.metered.ca):
      METERED_DOMAIN=yourapp.metered.live
      METERED_API_KEY=<API key from the dashboard → TURN Server → Credentials>

  Option B — any TURN server with static credentials (Metered static
  credentials, coturn on a VPS, Twilio, Xirsys, ...):
      TURN_URLS=turn:host:80,turn:host:80?transport=tcp,turn:host:443,turns:host:443?transport=tcp
      TURN_USERNAME=...
      TURN_CREDENTIAL=...
"""
import asyncio
import json
import os
import time
import urllib.request
from fastapi import APIRouter

router = APIRouter()

_STUN = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}]
_cache: dict = {"at": 0.0, "servers": None, "source": ""}
_CACHE_TTL_S = 30 * 60


def _fetch_metered(domain: str, api_key: str) -> list:
    domain = domain.replace("https://", "").replace("http://", "").strip("/")
    url = f"https://{domain}/api/v1/turn/credentials?apiKey={api_key}"
    req = urllib.request.Request(url, headers={"User-Agent": "DeepVerify/2.0"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode())
    if not isinstance(data, list) or not data:
        raise ValueError(f"Unexpected Metered response: {str(data)[:200]}")
    return data


def _static_turn() -> list:
    urls = [u.strip() for u in os.getenv("TURN_URLS", "").split(",") if u.strip()]
    user = os.getenv("TURN_USERNAME", "").strip()
    cred = os.getenv("TURN_CREDENTIAL", "").strip()
    if urls and user and cred:
        return [{"urls": urls, "username": user, "credential": cred}]
    return []


def _has_turn(servers: list) -> bool:
    for s in servers:
        urls = s.get("urls", [])
        urls = [urls] if isinstance(urls, str) else urls
        if any(u.startswith("turn") for u in urls):
            return True
    return False


@router.get("/api/webrtc/ice-servers")
async def get_ice_servers():
    now = time.time()
    if _cache["servers"] and now - _cache["at"] < _CACHE_TTL_S:
        servers = _cache["servers"]
        return {"iceServers": servers, "turn": _has_turn(servers), "source": _cache["source"]}

    servers, source = [], "stun-only"
    domain, key = os.getenv("METERED_DOMAIN", ""), os.getenv("METERED_API_KEY", "")
    if domain and key:
        try:
            servers = await asyncio.to_thread(_fetch_metered, domain, key)
            source = "metered"
        except Exception as e:
            print(f"[ICE] Metered credential fetch failed: {e}")
    if not servers:
        static = _static_turn()
        if static:
            servers, source = _STUN + static, "static"
    if not servers:
        print("[ICE] WARNING: no TURN server configured — calls between different networks will fail")
        servers = _STUN

    _cache.update(at=now, servers=servers, source=source)
    return {"iceServers": servers, "turn": _has_turn(servers), "source": source}
