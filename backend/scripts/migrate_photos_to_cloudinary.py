"""
Repair photos that were saved to ONE machine's local disk while the database is shared.

Finds every image link of the form /api/uploads/... in the database (user profile photos
and interview-session reference photos / live snapshots). For each one whose file exists
on THIS machine, it uploads the file to Cloudinary (same naming as normal uploads:
deepverify/<folder>/<filename>) and rewrites every database link that pointed at it.

Run it on the machine that originally saved the photos, inside the backend container:

    docker compose exec backend python scripts/migrate_photos_to_cloudinary.py          # dry run
    docker compose exec backend python scripts/migrate_photos_to_cloudinary.py --apply  # do it

Dry run changes nothing. Files that are not on this machine are listed so you know which
machine to run it on (or which users should simply re-upload their photo).
"""
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:
    pass

UPLOADS = Path(__file__).resolve().parent.parent / "uploads"
LOCAL_PREFIX = "/api/uploads/"

# (collection, field) pairs that can hold an image link
FIELDS = [
    ("users", "profile_photo_url"),
    ("sessions", "face_verification.reference_image_url"),
    ("sessions", "face_verification.live_snapshot_url"),
]


def find_local_links(db):
    """Return {old_url: [(collection, field, count), ...]} for every /api/uploads/ link."""
    found = {}
    for coll, field in FIELDS:
        for doc in db[coll].find({field: {"$regex": "^/api/uploads/"}}, {field: 1}):
            val = doc
            for part in field.split("."):
                val = (val or {}).get(part)
            if isinstance(val, str):
                found.setdefault(val, {}).setdefault((coll, field), 0)
                found[val][(coll, field)] += 1
    return found


def local_path(url: str) -> Path:
    return UPLOADS / url[len(LOCAL_PREFIX):]


def public_id_for(url: str) -> str:
    # /api/uploads/profile_photos/ref_abc.jpg -> deepverify/profile_photos/ref_abc
    rel = url[len(LOCAL_PREFIX):]
    stem = rel[:-4] if rel.lower().endswith(".jpg") else rel.rsplit(".", 1)[0]
    return f"deepverify/{stem}"


def migrate(db, uploader, apply: bool, log=print):
    links = find_local_links(db)
    if not links:
        log("No local /api/uploads/ image links in the database. Nothing to do.")
        return {"migrated": 0, "missing": 0, "updated_docs": 0}
    migrated = missing = updated = 0
    for url, refs in sorted(links.items()):
        where = ", ".join(f"{c}.{f} x{n}" for (c, f), n in refs.items())
        p = local_path(url)
        if not p.exists():
            missing += 1
            log(f"  [NOT HERE] {url}  ({where}) - file is not on this machine")
            continue
        if not apply:
            log(f"  [WOULD MIGRATE] {url}  ({where})")
            migrated += 1
            continue
        res = uploader(p.read_bytes(), public_id_for(url))
        new_url = res.get("secure_url")
        if not new_url:
            log(f"  [FAILED] {url} - Cloudinary returned no URL")
            continue
        for (coll, field) in refs:
            r = db[coll].update_many({field: url}, {"$set": {field: new_url}})
            updated += getattr(r, "modified_count", 0)
        migrated += 1
        log(f"  [MIGRATED] {url} -> {new_url}  ({where})")
    return {"migrated": migrated, "missing": missing, "updated_docs": updated}


def main(argv):
    apply = "--apply" in argv
    cn = os.getenv("CLOUDINARY_CLOUD_NAME", "").strip()
    key = os.getenv("CLOUDINARY_API_KEY", "").strip()
    sec = os.getenv("CLOUDINARY_API_SECRET", "").strip()
    if not (cn and key and sec):
        print("Cloudinary is not configured in backend/.env on this machine (CLOUDINARY_* values are blank).")
        print("Add the team's Cloudinary keys first, restart the backend, then run this again.")
        return 1
    import cloudinary
    import cloudinary.api
    import cloudinary.uploader
    cloudinary.config(cloud_name=cn, api_key=key, api_secret=sec, secure=True)
    cloudinary.api.ping()

    def uploader(data: bytes, public_id: str):
        import io
        return cloudinary.uploader.upload(io.BytesIO(data), public_id=public_id, overwrite=True, resource_type="image")

    from pymongo import MongoClient
    db = MongoClient(os.getenv("MONGODB_URL", "mongodb://localhost:27017"), serverSelectionTimeoutMS=10000)[os.getenv("MONGODB_DB", "deepverify")]
    print("=" * 72)
    print("APPLY MODE - uploading and updating links" if apply else "DRY RUN - nothing will be changed (add --apply to migrate)")
    print("=" * 72)
    s = migrate(db, uploader, apply)
    print("=" * 72)
    verb = "Migrated" if apply else "Would migrate"
    print(f"{verb}: {s['migrated']} image(s); not on this machine: {s['missing']}; database fields updated: {s['updated_docs']}")
    if s["missing"]:
        print("For images 'NOT HERE': run this on the machine that saved them, or have those users re-upload in Settings.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
