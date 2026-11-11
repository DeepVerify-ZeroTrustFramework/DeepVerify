"""
AI face check — Sightengine `deepfake` (face swap / AI-modified face) and `genai`
(fully AI-generated image) models, called on single snapshots.

Hidden layer: the API key stays on the server (backend/.env):
    SIGHTENGINE_API_USER=...      (or SIGHTENGINE_USER)
    SIGHTENGINE_API_SECRET=...    (or SIGHTENGINE_SECRET)
Free plan budget is small (2000 operations/month), so callers send a few snapshots
per interview, never a stream. A daily cap protects the quota.
"""
import json
import os
import time
import uuid
import urllib.request
import urllib.error
from typing import Dict, Optional

API_URL = 'https://api.sightengine.com/1.0/check.json'
MAX_CALLS_PER_DAY = int(os.getenv('DV_SIGHTENGINE_MAX_PER_DAY', '80'))

_calls_today = {'day': '', 'n': 0}


def _creds():
    # Either naming works: SIGHTENGINE_API_USER/_SECRET or SIGHTENGINE_USER/_SECRET
    user = os.getenv('SIGHTENGINE_API_USER') or os.getenv('SIGHTENGINE_USER') or ''
    secret = os.getenv('SIGHTENGINE_API_SECRET') or os.getenv('SIGHTENGINE_SECRET') or ''
    return user, secret


def enabled() -> bool:
    user, secret = _creds()
    return bool(user) and bool(secret)


def _budget_ok() -> bool:
    day = time.strftime('%Y-%m-%d')
    if _calls_today['day'] != day:
        _calls_today['day'], _calls_today['n'] = day, 0
    return _calls_today['n'] < MAX_CALLS_PER_DAY


def _multipart(fields: Dict[str, str], file_bytes: bytes, filename: str = 'frame.jpg'):
    boundary = '----dv' + uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="media"; filename="{filename}"\r\n'
                 f'Content-Type: image/jpeg\r\n\r\n'.encode() + file_bytes + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    return b''.join(parts), f'multipart/form-data; boundary={boundary}'


def check_face_image(jpeg_bytes: bytes, models: str = 'deepfake,genai', timeout: float = 20.0) -> Dict:
    """Blocking call. Returns {'ok', 'deepfake', 'ai_generated', 'operations', 'error'}.
    Scores are 0-1 (higher = more likely fake); None when the model gave no score."""
    if not enabled():
        return {'ok': False, 'error': 'SIGHTENGINE_API_USER / SIGHTENGINE_API_SECRET not set'}
    if not _budget_ok():
        return {'ok': False, 'error': f'daily cap of {MAX_CALLS_PER_DAY} calls reached'}
    body, ctype = _multipart({
        'models': models,
        'api_user': _creds()[0],
        'api_secret': _creds()[1],
    }, jpeg_bytes)
    req = urllib.request.Request(API_URL, data=body, method='POST', headers={'Content-Type': ctype})
    _calls_today['n'] += 1
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read().decode())
        except Exception:
            return {'ok': False, 'error': f'HTTP {e.code}'}
    except Exception as e:
        return {'ok': False, 'error': str(e)}
    if data.get('status') != 'success':
        return {'ok': False, 'error': (data.get('error') or {}).get('message', str(data)[:200])}
    t = data.get('type') or {}
    return {
        'ok': True,
        'deepfake': t.get('deepfake'),
        'ai_generated': t.get('ai_generated'),
        'operations': (data.get('request') or {}).get('operations'),
        'error': None,
    }
