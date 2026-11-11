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
from modules.prnu import estimate_prnu_reference, PRNU_VERSION, CROP_W, CROP_H

router = APIRouter()

from pathlib import Path

# In-memory store for PRNU references (keyed by session_id)
_prnu_references: dict = {}
_UPLOADS_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def get_prnu_reference(session_id: str):
    """
    Retrieve the stored PRNU v2 enrollment fingerprint:
        {'K': 2-D float array (CROP_H x CROP_W), 'width': camW, 'height': camH}
    Legacy v1 fingerprints (prnu_<id>.npy, built from downscaled frames with the
    old residual) are ignored — they cannot identify a camera.
    """
    if session_id in _prnu_references:
        return _prnu_references[session_id]
    npz_path = _UPLOADS_DIR / f"prnu_v{PRNU_VERSION}_{session_id}.npz"
    if npz_path.exists():
        try:
            z = np.load(str(npz_path))
            ref = {'K': z['K'], 'width': int(z['width']), 'height': int(z['height'])}
            _prnu_references[session_id] = ref
            return ref
        except Exception as e:
            print(f"[PRNU] Error loading reference from disk: {e}")
    return None


@router.post("/enroll/{session_id}")
@router.post("/sessions/{session_id}/enroll/prnu")
async def enroll_prnu(session_id: str, frames: List[UploadFile] = File(...),
                      mode: str = Form("scaled"), cam_width: int = Form(0), cam_height: int = Form(0)):
    """
    Receive enrollment frames and compute the PRNU reference K̂.

    mode="crop": each file is a native-resolution 320x240 centre crop of the
    camera frame (no resampling) and cam_width/cam_height give the camera
    resolution — this is the only mode that can fingerprint a sensor.
    Legacy clients send downscaled frames (mode="scaled"): accepted, but no
    fingerprint is stored and the interview builds one from its first seconds.
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
            if mode == "crop":
                if img.shape[:2] != (CROP_H, CROP_W):
                    continue  # crops must be exact native patches
            else:
                img = cv2.resize(img, (CROP_W, CROP_H))
            decoded_frames.append(img)

    if len(decoded_frames) < 5:
        raise HTTPException(
            status_code=400,
            detail=f"Only {len(decoded_frames)} frames decoded successfully. Need at least 5."
        )

    if mode != "crop" or cam_width <= 0 or cam_height <= 0:
        # Downscaled frames carry no usable sensor pattern — don't store a fingerprint
        await collection.update_one(
            {"session_id": session_id},
            {"$set": {"enrollment.prnu_enrolled_frames": len(decoded_frames),
                      "enrollment.prnu_mode": "scaled-legacy"}}
        )
        return {
            "message": "Frames received (legacy scaled mode) — fingerprint will be built during the interview",
            "frames_processed": len(decoded_frames),
        }

    # Compute PRNU reference fingerprint K̂ via MLE estimator (v2 residual)
    K_hat = estimate_prnu_reference(decoded_frames)[:, :, 1].astype(np.float32)
    ref = {'K': K_hat, 'width': int(cam_width), 'height': int(cam_height)}

    # Store reference in memory and on disk
    _prnu_references[session_id] = ref
    npz_path = _UPLOADS_DIR / f"prnu_v{PRNU_VERSION}_{session_id}.npz"
    np.savez_compressed(str(npz_path), K=K_hat, width=int(cam_width), height=int(cam_height))

    # Update session document
    await collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "enrollment.prnu_reference_path": str(npz_path),
            "enrollment.prnu_enrolled_frames": len(decoded_frames),
            "enrollment.prnu_mode": "crop",
            "enrollment.prnu_camera_resolution": [int(cam_width), int(cam_height)],
        }}
    )

    return {
        "message": "PRNU enrollment complete",
        "frames_processed": len(decoded_frames),
        "reference_shape": list(K_hat.shape),
        "camera_resolution": [int(cam_width), int(cam_height)],
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
