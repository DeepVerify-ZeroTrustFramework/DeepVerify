"""
WebRTC ICE server configuration.

GET /api/webrtc/ice-servers  ->  {"iceServers": [...], "turn": bool, "source": str}

Why this exists: on ONE laptop, two browser tabs connect directly, so video works
without any relay. On TWO laptops on different networks (campus/office Wi-Fi with
client isolation, mobile hotspots, CGNAT) a direct path often doesn't exist and
the media must go through a TURN relay. Relay credentials live in backend env
vars so they can be rotated without rebuilding the frontend.

Every provider that is configured is ADDED to the list. The browser tries a
direct connection first, then prefers UDP relays over TCP/TLS ones, so the
Metered TLS-443 relay only carries traffic when nothing else gets through.

-- ExpressTURN (primary; free plan 1000 GB/month, UDP+TCP on port 3478) ---------
    EXPRESSTURN_URLS=turn:free.expressturn.com:3478,turn:free.expressturn.com:3478?transport=tcp
    EXPRESSTURN_USERNAME=<username from expressturn.com dashboard>
    EXPRESSTURN_CREDENTIAL=<password from expressturn.com dashboard>

-- Metered, static credential (backup; free plan 500 MB/month, has TLS on 443) ---
    METERED_TURN_URLS=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:80?transport=tcp,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp
    METERED_TURN_USERNAME=<username from dashboard.metered.ca -> TURN Server -> Credentials>
    METERED_TURN_CREDENTIAL=<password / credential from the same page>

-- Optional alternatives -----------------------------------------------------
  Metered via REST API (fetches the credential instead of a static one):
    METERED_DOMAIN=yourapp.metered.live
    METERED_API_KEY=<credential's "Show API Key" value>
  Cloudflare Realtime TURN (1000 GB/month free; requires a card on file):
    CF_TURN_KEY_ID=<TURN Token ID>
    CF_TURN_API_TOKEN=<TURN API token>
  Any other TURN server (coturn, Twilio, Xirsys, ...):
    TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL
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


def _fetch_cloudflare(key_id: str, api_token: str) -> list:
    url = f"https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers"
    body = json.dumps({"ttl": 86400}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
        "User-Agent": "DeepVerify/2.0",
    })
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode())
    servers = data.get("iceServers") if isinstance(data, dict) else data
    if isinstance(servers, dict):
        servers = [servers]
    if not servers:
        raise ValueError(f"Unexpected Cloudflare response: {str(data)[:200]}")
    # Browsers block port 53; drop those URLs to avoid slow ICE gathering.
    cleaned = []
    for s in servers:
        urls = s.get("urls", [])
        urls = [urls] if isinstance(urls, str) else urls
        urls = [u for u in urls if ":53" not in u.split("?")[0][-4:]]
        if urls:
            cleaned.append({**s, "urls": urls})
    return cleaned


# (env prefix, label) for static TURN providers, in priority order
_STATIC_PROVIDERS = [
    ("EXPRESSTURN", "expressturn"),     # primary relay
    ("METERED_TURN", "metered"),        # backup relay with TLS on 443
    ("TURN", "custom"),                 # any other TURN server
]


def _static_turn() -> tuple:
    """Return (ice_server_entries, [provider labels]) for every configured static provider."""
    out, labels = [], []
    for prefix, label in _STATIC_PROVIDERS:
        urls = [u.strip() for u in os.getenv(f"{prefix}_URLS", "").split(",") if u.strip()]
        user = os.getenv(f"{prefix}_USERNAME", "").strip()
        cred = os.getenv(f"{prefix}_CREDENTIAL", "").strip()
        if urls and user and cred:
            out.append({"urls": urls, "username": user, "credential": cred})
            labels.append(label)
    return out, labels


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
    cf_id, cf_token = os.getenv("CF_TURN_KEY_ID", ""), os.getenv("CF_TURN_API_TOKEN", "")
    if cf_id and cf_token:
        try:
            servers = await asyncio.to_thread(_fetch_cloudflare, cf_id, cf_token)
            source = "cloudflare"
        except Exception as e:
            print(f"[ICE] Cloudflare credential fetch failed: {e}")
    domain, key = os.getenv("METERED_DOMAIN", ""), os.getenv("METERED_API_KEY", "")
    if not servers and domain and key:
        try:
            servers = await asyncio.to_thread(_fetch_metered, domain, key)
            source = "metered-api"
        except Exception as e:
            print(f"[ICE] Metered credential fetch failed: {e}")
    # Static relays are always ADDED (see module docstring for priority).
    static, labels = _static_turn()
    if static:
        servers = (servers or list(_STUN)) + static
        names = ([] if source == "stun-only" else [source]) + labels
        source = "+".join(names)
    if not servers:
        print("[ICE] WARNING: no TURN server configured — calls between different networks will fail")
        servers = _STUN

    _cache.update(at=now, servers=servers, source=source)
    return {"iceServers": servers, "turn": _has_turn(servers), "source": source}
