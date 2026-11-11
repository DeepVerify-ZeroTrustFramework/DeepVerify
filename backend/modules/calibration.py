"""
Forensic Calibration Layer — Learned Decision Boundary.

Replaces hardcoded PCE/SNR thresholds with a trained meta-classifier that
learns the real/fake boundary across compression conditions.

Architecture:
    Raw module outputs → Feature vector (9D) → LogisticRegression → P(authentic)

The calibration model is trained on labeled session data (real vs fake).
When no model is available, falls back to source-aware heuristic scoring.

Features:
    1. PCE (PRNU)
    2. SNR_dB (rPPG)
    3. Heart Rate BPM (rPPG)
    4. Signal Amplitude (rPPG)
    5. SCR — Spectral Concentration Ratio (rPPG)
    6. Spectral Flatness (rPPG)
    7. CV Jitter (Jitter)
    8. Behavioral Score (Behavioral)
    9. log(frame_pixels) — compression context
"""
import os
import numpy as np
from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)

# Path to trained model file
MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'models')
MODEL_PATH = os.path.join(MODEL_DIR, 'calibration_model.pkl')

# Cached model (loaded once on first call)
_calibration_model = None
_model_loaded = False


def _load_model():
    """Load the trained calibration model from disk. Called once."""
    global _calibration_model, _model_loaded
    if _model_loaded:
        return _calibration_model

    _model_loaded = True

    if not os.path.exists(MODEL_PATH):
        logger.info("[Calibration] No trained model found at %s — using heuristic fallback", MODEL_PATH)
        return None

    try:
        import joblib
        _calibration_model = joblib.load(MODEL_PATH)
        info = get_model_info(_calibration_model)
        logger.info("[Calibration] Loaded %s model from %s (trained on: %s)",
                    info['model_type'], MODEL_PATH, info['trained_on'])
        if info['trained_on'] in ('synthetic', 'unknown'):
            # A model fit only to synthetic distributions mis-scores real
            # WebRTC sessions (e.g. genuine PCE≈7, CV≈1.0 → P(real)≈0.02),
            # so by default fall back to the heuristic until a model trained
            # on real labeled data exists. Set DV_ALLOW_SYNTHETIC_CALIBRATION=1
            # to force the placeholder model anyway.
            if os.getenv('DV_ALLOW_SYNTHETIC_CALIBRATION', '0') != '1':
                logger.warning(
                    "[Calibration] Ignoring model trained on '%s' data — using heuristic "
                    "fallback. Retrain with scripts/train_calibration.py on labeled "
                    "sessions, or set DV_ALLOW_SYNTHETIC_CALIBRATION=1 to force it.",
                    info['trained_on'])
                _calibration_model = None
                return None
            logger.warning(
                "[Calibration] Using model trained on '%s' data "
                "(DV_ALLOW_SYNTHETIC_CALIBRATION=1). Treat its probabilities as a placeholder.",
                info['trained_on'])
        return _calibration_model
    except Exception as e:
        logger.warning("[Calibration] Failed to load model: %s — using heuristic fallback", e)
        return None


def build_feature_vector(
    pce: float,
    snr_db: float,
    hr_bpm: float = 72.0,
    amplitude: float = 0.1,
    scr: float = 0.5,
    spectral_flatness: float = 0.3,
    cv_jitter: float = 0.05,
    behavioral_score: float = 1.0,
    frame_pixels: int = 76800,  # 320x240
) -> np.ndarray:
    """
    Build the 9-dimensional feature vector for the calibration model.

    Args:
        pce: Peak-to-Correlation Energy from PRNU
        snr_db: Signal-to-Noise Ratio from rPPG (dB)
        hr_bpm: Heart rate in BPM
        amplitude: rPPG signal amplitude
        scr: Spectral Concentration Ratio
        spectral_flatness: Spectral flatness value
        cv_jitter: Coefficient of Variation from jitter module
        behavioral_score: Composite behavioral score ∈ [0, 1]
        frame_pixels: Total pixels in frame (width * height)

    Returns:
        numpy array of shape (1, 9)
    """
    return np.array([[
        float(pce),
        float(snr_db),
        float(hr_bpm),
        float(amplitude),
        float(scr),
        float(spectral_flatness),
        float(cv_jitter),
        float(behavioral_score),
        float(np.log(max(frame_pixels, 1))),  # log(pixels) as compression context
    ]])


def get_calibrated_authenticity(
    pce: float,
    snr_db: float,
    source: str = 'webrtc',
    hr_bpm: float = 72.0,
    amplitude: float = 0.1,
    scr: float = 0.5,
    spectral_flatness: float = 0.3,
    cv_jitter: float = 0.05,
    behavioral_score: float = 1.0,
    frame_pixels: int = 76800,
) -> float:
    """
    Get calibrated probability that the session is authentic.

    Returns P(authentic) ∈ [0, 1]:
        1.0 = definitely real person, real camera
        0.0 = definitely fake / deepfake / pre-recorded

    Uses trained model if available, otherwise falls back to source-aware
    heuristic scoring.

    Args:
        pce: PCE from PRNU module
        snr_db: SNR from rPPG module
        source: 'webrtc', 'upload', or 'static'
        hr_bpm: Heart rate BPM
        amplitude: rPPG signal amplitude
        scr: Spectral Concentration Ratio
        spectral_flatness: Spectral flatness
        cv_jitter: CV from jitter module
        behavioral_score: Behavioral score ∈ [0, 1]
        frame_pixels: Frame pixel count

    Returns:
        Calibrated probability of authenticity ∈ [0, 1]
    """
    model = _load_model()

    if model is not None:
        # Use trained model
        try:
            features = build_feature_vector(
                pce, snr_db, hr_bpm, amplitude, scr,
                spectral_flatness, cv_jitter, behavioral_score, frame_pixels
            )
            features_scaled = model['scaler'].transform(features)
            prob = model['clf'].predict_proba(features_scaled)[0][1]
            return float(prob)
        except Exception as e:
            logger.warning("[Calibration] Model prediction failed: %s — using fallback", e)

    # Fallback: source-aware heuristic scoring
    return _heuristic_authenticity(pce, snr_db, source, cv_jitter, behavioral_score)


def _heuristic_authenticity(
    pce: float,
    snr_db: float,
    source: str,
    cv_jitter: float,
    behavioral_score: float,
) -> float:
    """
    Heuristic authenticity scoring when no trained model is available.

    Uses source-aware thresholds to compute a probability-like score.
    This is the fallback that ensures the system works out-of-the-box
    without any training data.
    """
    # Source-aware PCE thresholds
    # PRNU v2 (native crops, shrinkage residual): one scale for all sources — impostors ≤ ~41
    pce_thresholds = {'webrtc': 60.0, 'upload': 60.0, 'static': 60.0}
    tau = pce_thresholds.get(source, 10.0)

    # PCE sub-score: sigmoid-like curve centered at threshold
    # PCE >> tau → 1.0, PCE << tau → 0.0
    pce_ratio = pce / max(tau, 1e-6)
    pce_score = 1.0 / (1.0 + np.exp(-5.0 * (pce_ratio - 1.0)))  # sigmoid at ratio=1.0

    # SNR sub-score: must be positive for biological pulse
    if snr_db >= 3.0:
        snr_score = 1.0
    elif snr_db >= 0.0:
        snr_score = 0.5 + 0.5 * (snr_db / 3.0)
    elif snr_db >= -2.0:
        snr_score = 0.3 * (1.0 + snr_db / 2.0)
    else:
        snr_score = 0.0

    # Jitter sub-score
    gamma = {'webrtc': 0.85, 'upload': 0.30, 'static': 0.15}.get(source, 0.85)
    if cv_jitter <= gamma:
        jitter_score = 1.0
    else:
        jitter_score = max(0.0, 1.0 - (cv_jitter - gamma) / gamma)

    # Weighted combination
    # PRNU and rPPG dominate (60% combined) — zero-trust property
    prob = (
        0.35 * pce_score +
        0.30 * snr_score +
        0.15 * jitter_score +
        0.20 * max(0.0, min(1.0, behavioral_score))
    )

    return float(max(0.0, min(1.0, prob)))


def get_model_info(model: Optional[dict] = None) -> Dict:
    """
    Describe the loaded calibration model (for logs, dashboards and the paper).

    Older .pkl bundles have no metadata; they are reported as 'unknown'.
    """
    model = model if model is not None else _load_model()
    if model is None:
        return {'model_type': 'heuristic', 'trained_on': 'none', 'n_real': 0, 'n_fake': 0}
    meta = model.get('meta', {}) if isinstance(model, dict) else {}
    clf = model.get('clf') if isinstance(model, dict) else None
    return {
        'model_type': meta.get('model_type', type(clf).__name__ if clf is not None else 'unknown'),
        'trained_on': meta.get('trained_on', 'unknown'),
        'n_real': meta.get('n_real'),
        'n_fake': meta.get('n_fake'),
        'n_groups': meta.get('n_groups'),
        'cv_accuracy': meta.get('cv_accuracy'),
        'cv_auc': meta.get('cv_auc'),
        'trained_at': meta.get('trained_at'),
    }


def reload_model():
    """Force reload the calibration model from disk."""
    global _calibration_model, _model_loaded
    _model_loaded = False
    _calibration_model = None
    return _load_model()
