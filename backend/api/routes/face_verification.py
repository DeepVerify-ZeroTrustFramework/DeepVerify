"""
Face Verification routes — Reference Photo Upload and AWS Rekognition CompareFaces.
Zero-Trust Identity Verification for DeepVerify.
"""
import base64
import uuid
from datetime import datetime
from typing import Optional
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, status
from pydantic import BaseModel

from db.mongo import get_sessions_collection
from db.redis_client import publish_alert, publish_trust_score
from models.schemas import (
    FaceVerificationResponse, FaceVerificationStatus,
    Alert, AlertType, AlertSeverity
)
from modules.face_verifier import face_verifier_service, LOCAL_UPLOAD_DIR

router = APIRouter()

# In-memory cache for raw reference photo bytes (keyed by session_id) for instant comparison
_reference_photo_bytes: dict[str, bytes] = {}


def _get_reference_bytes(session_id: str, doc: dict) -> Optional[bytes]:
    """Retrieve reference photo bytes from memory or disk/URL."""
    if session_id in _reference_photo_bytes:
        return _reference_photo_bytes[session_id]

    # Try local storage path from document
    face_data = doc.get("face_verification", {})
    ref_url = face_data.get("reference_image_url", "")
    if ref_url and ref_url.startswith("/api/uploads/"):
        rel_path = ref_url.replace("/api/uploads/", "")
        local_file = LOCAL_UPLOAD_DIR / rel_path
        if local_file.exists():
            with open(local_file, "rb") as f:
                data = f.read()
                _reference_photo_bytes[session_id] = data
                return data

    return None


@router.post("/face-verification/reference-photo/{session_id}")
async def upload_reference_photo(
    session_id: str,
    file: UploadFile = File(...),
):
    """
    Candidate uploads their passport/identity photograph.
    Validates with AWS Rekognition DetectFaces to ensure exactly one clear face is present.
    Stores reference image to Cloudinary or secure local storage.
    """
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    content = await file.read()
    if len(content) < 1000:
        raise HTTPException(
            status_code=400,
            detail="The uploaded image file is invalid or too small. Please upload a clear JPG/PNG photo."
        )

    # 1. Validate with AWS Rekognition DetectFaces
    validation = face_verifier_service.validate_reference_photo(content)
    if not validation["valid"]:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": validation.get("error_code", "VALIDATION_FAILED"),
                "message": validation.get("message", "Face validation failed.")
            }
        )

    # 2. Store image via Cloudinary or local storage
    file_id = f"ref_{session_id}_{uuid.uuid4().hex[:6]}"
    image_url = face_verifier_service.store_image(
        image_bytes=content,
        folder="reference_photos",
        filename=file_id,
    )

    # 3. Cache raw bytes in memory for fast Rekognition comparison later
    _reference_photo_bytes[session_id] = content

    # 4. Update session document
    await collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "face_verification.reference_image_url": image_url,
            "face_verification.verified": False,
            "face_verification.status": FaceVerificationStatus.PENDING.value,
            "face_verification.message": "Reference photo uploaded and face validated.",
        }}
    )

    return {
        "ok": True,
        "session_id": session_id,
        "reference_image_url": image_url,
        "confidence": validation.get("confidence", 95.0),
        "message": "✓ Reference photograph validated successfully."
    }


@router.post("/face-verification/verify/{session_id}", response_model=FaceVerificationResponse)
async def verify_candidate_face(
    session_id: str,
    snapshot: Optional[UploadFile] = File(None),
    snapshot_base64: Optional[str] = Form(None),
):
    """
    Captures live snapshot from candidate video call,
    compares against stored reference photograph using AWS Rekognition CompareFaces.
    """
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    # Read live snapshot bytes
    live_bytes = None
    if snapshot is not None:
        live_bytes = await snapshot.read()
    elif snapshot_base64:
        try:
            # Handle data URL e.g. "data:image/jpeg;base64,..."
            if "," in snapshot_base64:
                _, b64_data = snapshot_base64.split(",", 1)
            else:
                b64_data = snapshot_base64
            live_bytes = base64.b64decode(b64_data)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid base64 image data: {str(e)}")

    if not live_bytes or len(live_bytes) < 1000:
        raise HTTPException(status_code=400, detail="Invalid snapshot image data.")

    # Retrieve source reference photo bytes
    ref_bytes = _get_reference_bytes(session_id, doc)
    if not ref_bytes:
        raise HTTPException(
            status_code=400,
            detail="Reference photograph has not been uploaded yet for this session. Please upload your ID photo first."
        )

    # Perform AWS Rekognition Face Comparison
    result = face_verifier_service.compare_candidate_faces(
        source_bytes=ref_bytes,
        target_bytes=live_bytes,
    )

    # Store live snapshot image
    file_id = f"live_{session_id}_{uuid.uuid4().hex[:6]}"
    live_snapshot_url = face_verifier_service.store_image(
        image_bytes=live_bytes,
        folder="live_snapshots",
        filename=file_id,
    )

    ref_url = doc.get("face_verification", {}).get("reference_image_url", "")
    is_verified = result["verified"]
    similarity_score = result.get("similarity")
    verification_status = result["status"]
    message = result["message"]
    error_code = result.get("error_code")

    # Update session in MongoDB
    update_data = {
        "face_verification.live_snapshot_url": live_snapshot_url,
        "face_verification.verified": is_verified,
        "face_verification.similarity": similarity_score,
        "face_verification.status": verification_status,
        "face_verification.message": message,
    }
    if is_verified:
        update_data["face_verification.verified_at"] = datetime.utcnow()

    await collection.update_one({"session_id": session_id}, {"$set": update_data})

    # If verification failed due to face mismatch, record a security alert
    if not is_verified and verification_status == "FAILED":
        alert = Alert(
            alert_type=AlertType.FACE_MISMATCH.value,
            module="rekognition",
            severity=AlertSeverity.CRITICAL.value,
            value=similarity_score or 0.0,
            description=f"Candidate face mismatch: similarity {similarity_score}% is below threshold.",
        )
        await collection.update_one(
            {"session_id": session_id},
            {
                "$push": {"alerts": alert.model_dump()},
                "$set": {"flagged_for_review": True, "flag_reason": "Face Verification Mismatch"}
            }
        )
        # Notify connected dashboard via Redis PubSub
        try:
            await publish_alert(session_id, alert.model_dump())
        except Exception:
            pass

    return FaceVerificationResponse(
        session_id=session_id,
        verified=is_verified,
        similarity=similarity_score,
        status=verification_status,
        message=message,
        reference_image_url=ref_url,
        live_snapshot_url=live_snapshot_url,
        error_code=error_code,
    )


@router.get("/face-verification/status/{session_id}")
async def get_face_verification_status(session_id: str):
    """Get current face verification status for a session."""
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    face_data = doc.get("face_verification", {})
    return {
        "session_id": session_id,
        "verified": face_data.get("verified", False),
        "similarity": face_data.get("similarity"),
        "status": face_data.get("status", "PENDING"),
        "message": face_data.get("message", "Pending identity verification."),
        "reference_image_url": face_data.get("reference_image_url"),
        "live_snapshot_url": face_data.get("live_snapshot_url"),
        "verified_at": face_data.get("verified_at"),
    }
