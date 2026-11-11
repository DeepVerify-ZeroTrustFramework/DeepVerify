"""
Forensic Data Logger — Automatic Telemetry Collection for Calibration Training.

Logs every frame analysis result to MongoDB `forensic_logs` collection.
This data is used by train_calibration.py to train the calibration model.

Each log entry contains the raw module outputs + context features, with a
`label` field that starts as null and is manually filled as "real" or "fake"
by the research team.
"""
from datetime import datetime
from typing import Optional, Dict
import logging

logger = logging.getLogger(__name__)

# Cache the collection reference
_forensic_logs_collection = None


def _get_collection():
    """Get or create the forensic_logs MongoDB collection."""
    global _forensic_logs_collection
    if _forensic_logs_collection is None:
        try:
            from db.mongo import get_db
            db = get_db()
            _forensic_logs_collection = db['forensic_logs']
        except Exception as e:
            logger.warning("[ForensicLogger] Could not connect to MongoDB: %s", e)
            return None
    return _forensic_logs_collection


async def log_frame_analysis(
    session_id: str,
    pce: float,
    snr_db: float,
    hr_bpm: float,
    amplitude: float = 0.0,
    scr: float = 0.0,
    spectral_flatness: float = 0.0,
    cv_jitter: float = 0.0,
    behavioral_score: float = 1.0,
    frame_width: int = 320,
    frame_height: int = 240,
    frame_pixels: Optional[int] = None,
    source: str = 'webrtc',
    trust_score: float = 100.0,
    calibrated_prob: float = 1.0,
    label: Optional[str] = None,
    extra: Optional[Dict] = None,
):
    """
    Log a single frame analysis result for future model training.

    Args:
        session_id: Session identifier
        pce: PCE value from PRNU
        snr_db: SNR from rPPG (dB)
        hr_bpm: Detected heart rate
        amplitude: rPPG signal amplitude
        scr: Spectral Concentration Ratio
        spectral_flatness: Spectral flatness value
        cv_jitter: CV from jitter module
        behavioral_score: Behavioral score ∈ [0, 1]
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels
        frame_pixels: Incoming frame pixel count (before any server-side
            resize). Overrides frame_width * frame_height when given.
        source: 'webrtc', 'upload', or 'static'
        trust_score: Computed trust score
        calibrated_prob: Calibrated authenticity probability
        label: Ground truth label ('real', 'fake', or None)
        extra: Additional metadata
    """
    collection = _get_collection()
    if collection is None:
        return

    doc = {
        "session_id": session_id,
        "timestamp": datetime.utcnow(),
        "pce": float(pce),
        "snr_db": float(snr_db),
        "hr_bpm": float(hr_bpm),
        "amplitude": float(amplitude),
        "scr": float(scr),
        "spectral_flatness": float(spectral_flatness),
        "cv_jitter": float(cv_jitter),
        "behavioral_score": float(behavioral_score),
        "frame_pixels": int(frame_pixels) if frame_pixels else frame_width * frame_height,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "source": source,
        "trust_score": float(trust_score),
        "calibrated_prob": float(calibrated_prob),
        "label": label,  # null until manually labeled
    }

    if extra:
        doc["extra"] = extra

    try:
        await collection.insert_one(doc)
    except Exception as e:
        logger.debug("[ForensicLogger] Insert failed: %s", e)
