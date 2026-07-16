"""
Enrollment routes — PRNU reference capture, rPPG baseline, gaze baseline.
"""
import io
import numpy as np
import cv2
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import List
from models.schemas import RPPGBaseline, GazeBaseline
from db.mongo import get_sessions_collection
from modules.prnu import estimate_prnu_reference

router = APIRouter()

# In-memory store for PRNU references (keyed by session_id)
# In production, store as numpy files on disk or object storage
_prnu_references: dict = {}


def get_prnu_reference(session_id: str):
    """Retrieve stored PRNU reference fingerprint."""
    return _prnu_references.get(session_id)


@router.post("/enroll/{session_id}")
async def enroll_prnu(session_id: str, frames: List[UploadFile] = File(...)):
    """
    Receive enrollment frames (target: 90 I-frames) and compute PRNU reference K̂.
    Each file is a JPEG image captured from the candidate's webcam.
    """
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    if len(frames) < 10:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least 10 frames for PRNU enrollment. Received {len(frames)}."
        )

    # Decode all JPEG frames to BGR numpy arrays
    decoded_frames = []
    for frame_file in frames:
        data = await frame_file.read()
        nparr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is not None:
            # Resize to smaller dimensions for faster PRNU computation
            # 320x240 is sufficient for PRNU MLE — sensor noise pattern scales with position
            img = cv2.resize(img, (320, 240))
            decoded_frames.append(img)

    if len(decoded_frames) < 10:
        raise HTTPException(
            status_code=400,
            detail=f"Only {len(decoded_frames)} frames decoded successfully. Need at least 10."
        )

    # Compute PRNU reference fingerprint K̂ via MLE estimator
    K_hat = estimate_prnu_reference(decoded_frames)

    # Store reference in memory (keyed by session_id)
    _prnu_references[session_id] = K_hat

    # Update session document
    await collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "enrollment.prnu_reference_path": f"memory:{session_id}",
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
async def enroll_rppg_baseline(session_id: str, baseline: RPPGBaseline):
    """
    Store rPPG baseline computed during the 60-second enrollment phase.
    The per-candidate SNR threshold β is set from this baseline.
    """
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    # Set per-candidate SNR threshold β
    # Use baseline SNR minus a margin, but not below 1.5 dB (absolute floor)
    snr_beta = max(1.5, baseline.snr_baseline - 1.0)

    await collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "enrollment.rppg_baseline": baseline.model_dump(),
            "enrollment.snr_baseline": baseline.snr_baseline,
            "thresholds.snr_beta": snr_beta,
        }}
    )

    return {
        "message": "rPPG baseline stored",
        "baseline_hr": baseline.baseline_hr,
        "snr_baseline": baseline.snr_baseline,
        "snr_beta_threshold": snr_beta,
    }


@router.post("/enroll/{session_id}/gaze-baseline")
async def enroll_gaze_baseline(session_id: str, baseline: GazeBaseline):
    """
    Store gaze calibration baseline from the 60-second 9-point exercise.
    Sets per-session behavioral threshold λ.
    """
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    # Set per-session λ: natural gaze range + 20% margin
    lambda_threshold = max(baseline.gaze_range_x, baseline.gaze_range_y) * 1.2

    await collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "enrollment.gaze_baseline": baseline.model_dump(),
            "thresholds.behavioral_lambda": lambda_threshold,
        }}
    )

    return {
        "message": "Gaze baseline stored",
        "gaze_range_x": baseline.gaze_range_x,
        "gaze_range_y": baseline.gaze_range_y,
        "behavioral_lambda": lambda_threshold,
    }
