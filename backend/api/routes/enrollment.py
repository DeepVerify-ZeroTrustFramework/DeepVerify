"""
Enrollment routes — PRNU reference capture, rPPG baseline, gaze baseline.
"""
import io
import numpy as np
import cv2
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import List, Optional
from models.schemas import RPPGBaseline, GazeBaseline
from db.mongo import get_sessions_collection
from modules.prnu import estimate_prnu_reference

router = APIRouter()

from pathlib import Path

# In-memory store for PRNU references (keyed by session_id)
_prnu_references: dict = {}
_UPLOADS_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def get_prnu_reference(session_id: str):
    """Retrieve stored PRNU reference fingerprint."""
    if session_id in _prnu_references:
        return _prnu_references[session_id]
    npy_path = _UPLOADS_DIR / f"prnu_{session_id}.npy"
    if npy_path.exists():
        try:
            k = np.load(str(npy_path))
            _prnu_references[session_id] = k
            return k
        except Exception as e:
            print(f"[PRNU] Error loading reference from disk: {e}")
    return None


@router.post("/enroll/{session_id}")
@router.post("/sessions/{session_id}/enroll/prnu")
async def enroll_prnu(session_id: str, frames: List[UploadFile] = File(...)):
    """
    Receive enrollment frames (target: 30-90 I-frames) and compute PRNU reference K̂.
    Each file is a JPEG image captured from the candidate's webcam.
    """
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    if len(frames) < 5:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least 5 frames for PRNU enrollment. Received {len(frames)}."
        )

    # Decode all JPEG frames to BGR numpy arrays
    decoded_frames = []
    for frame_file in frames:
        data = await frame_file.read()
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is not None:
            # Resize to 320x240 for consistent and fast PRNU extraction
            img = cv2.resize(img, (320, 240))
            decoded_frames.append(img)

    if len(decoded_frames) < 5:
        raise HTTPException(
            status_code=400,
            detail=f"Only {len(decoded_frames)} frames decoded successfully. Need at least 5."
        )

    # Compute PRNU reference fingerprint K̂ via MLE estimator
    K_hat = estimate_prnu_reference(decoded_frames)

    # Store reference in memory and on disk
    _prnu_references[session_id] = K_hat
    npy_path = _UPLOADS_DIR / f"prnu_{session_id}.npy"
    np.save(str(npy_path), K_hat)

    # Update session document
    await collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "enrollment.prnu_reference_path": str(npy_path),
            "enrollment.prnu_enrolled_frames": len(decoded_frames),
        }}
    )

    return {
        "message": "PRNU enrollment complete",
        "frames_processed": len(decoded_frames),
        "reference_shape": list(K_hat.shape),
    }


@router.post("/enroll/{session_id}/prnu-frames")
async def enroll_prnu_binary(session_id: str):
    """
    Alternative endpoint: receive frames via WebSocket binary for streaming enrollment.
    This REST endpoint handles batch upload as multipart form data.
    """
    # This is a convenience redirect — the main enrollment uses the above endpoint
    raise HTTPException(status_code=405, detail="Use POST /api/enroll/{session_id} with multipart form")


@router.post("/enroll/{session_id}/rppg-baseline")
@router.post("/sessions/{session_id}/enroll/rppg")
async def enroll_rppg_baseline(session_id: str, baseline: Optional[RPPGBaseline] = None):
    """
    Store rPPG baseline computed during the 60-second enrollment phase.
    The per-candidate SNR threshold β is set from this baseline.
    """
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    hr = baseline.baseline_hr if baseline else 72.0
    snr_base = baseline.snr_baseline if baseline else 3.5
    snr_beta = max(1.5, snr_base - 1.0)

    await collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "enrollment.rppg_baseline": {"baseline_hr": hr, "snr_baseline": snr_base},
            "enrollment.snr_baseline": snr_base,
            "thresholds.snr_beta": snr_beta,
        }}
    )

    return {
        "message": "rPPG baseline stored",
        "baseline_hr": hr,
        "snr_baseline": snr_base,
        "snr_beta_threshold": snr_beta,
    }


@router.post("/enroll/{session_id}/gaze-baseline")
@router.post("/sessions/{session_id}/enroll/gaze")
async def enroll_gaze_baseline(session_id: str, baseline: Optional[GazeBaseline] = None):
    """
    Store gaze calibration baseline from the 60-second 9-point exercise.
    Sets per-session behavioral threshold λ.
    """
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    lambda_threshold = 0.25
    if baseline:
        lambda_threshold = max(baseline.gaze_range_x, baseline.gaze_range_y) * 1.2

    await collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "enrollment.gaze_baseline": baseline.model_dump() if baseline else {},
            "thresholds.behavioral_lambda": lambda_threshold,
        }}
    )

    return {
        "message": "Gaze baseline stored",
        "behavioral_lambda": lambda_threshold,
    }
