"""
Read-only diagnostic: where are profile photos stored, and do they load?

Run inside the backend container:
    docker compose exec backend python scripts/check_photos.py

Prints (no secrets, emails partly masked):
  1. Whether Cloudinary credentials are present and accepted.
  2. For every user with a profile photo: storage type, and whether it is reachable
     from THIS machine (local file exists / Cloudinary URL returns 200).
Nothing is modified.
"""
import os
import sys
import urllib.request
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:
    pass

from pymongo import MongoClient

UPLOADS = Path(__file__).resolve().parent.parent / "uploads"


def mask(email: str) -> str:
    if "@" not in email:
        return email
    name, dom = email.split("@", 1)
    return (name[:3] + "***@" + dom) if len(name) > 3 else (name[:1] + "***@" + dom)


def cloudinary_status() -> str:
    cn = os.getenv("CLOUDINARY_CLOUD_NAME", "").strip()
    key = os.getenv("CLOUDINARY_API_KEY", "").strip()
    sec = os.getenv("CLOUDINARY_API_SECRET", "").strip()
    if not (cn and key and sec):
        return "NOT CONFIGURED (one or more CLOUDINARY_* values missing)"
    try:
        import cloudinary
        import cloudinary.api
    except Exception:
        return "CONFIGURED but the 'cloudinary' package is NOT INSTALLED in this container -> uploads fall back to local disk"
    try:
        cloudinary.config(cloud_name=cn, api_key=key, api_secret=sec, secure=True)
        cloudinary.api.ping()
        return "OK (credentials accepted)"
    except Exception as e:
        return f"CONFIGURED but REJECTED by Cloudinary: {type(e).__name__}: {str(e)[:160]} -> uploads fall back to local disk"


def reachable(url: str):
    if url.startswith("/api/uploads/"):
        p = UPLOADS / url.replace("/api/uploads/", "", 1)
        return ("local file", p.exists(), "file exists on this machine" if p.exists() else "file NOT on this machine")
    if url.startswith("http"):
        kind = "cloudinary" if "res.cloudinary.com" in url else "remote url"
        try:
            req = urllib.request.Request(url, method="GET", headers={"User-Agent": "DeepVerify-diagnostic"})
            with urllib.request.urlopen(req, timeout=10) as r:
                return (kind, r.status == 200, f"HTTP {r.status}")
        except urllib.error.HTTPError as e:
            return (kind, False, f"HTTP {e.code}")
        except Exception as e:
            return (kind, False, f"{type(e).__name__}")
    return ("unknown", False, "unrecognised URL format")


def main():
    print("=" * 72)
    print("Cloudinary:", cloudinary_status())
    print("Local uploads folder:", UPLOADS, "(profile_photos exists)" if (UPLOADS / "profile_photos").exists() else "(no profile_photos folder)")
    print("=" * 72)
    url = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    db = MongoClient(url, serverSelectionTimeoutMS=10000)[os.getenv("MONGODB_DB", "deepverify")]
    users = list(db.users.find({}, {"email": 1, "role": 1, "profile_photo_url": 1, "_id": 0}))
    with_photo = [u for u in users if u.get("profile_photo_url")]
    print(f"Users: {len(users)} total, {len(with_photo)} with a profile photo\n")
    bad = 0
    for u in with_photo:
        kind, ok, detail = reachable(u["profile_photo_url"])
        bad += 0 if ok else 1
        print(f"  [{'OK ' if ok else 'BAD'}] {u.get('role','?'):9s} {mask(u.get('email','?')):32s} {kind:11s} {detail}")
    print()
    print(f"Summary: {len(with_photo) - bad} photo(s) load, {bad} broken on this machine.")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
