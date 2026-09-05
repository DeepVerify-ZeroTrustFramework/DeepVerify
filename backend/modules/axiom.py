"""
Axiom Fusion Engine — Multi-Modal Trust Score Computation.

Fuses 4 forensic analysis modules into a single trust score T ∈ [0, 100]:
- PRNU Hardware Fingerprinting: 30 points
- rPPG Biological Liveness: 30 points
- Network Jitter Analysis: 15 points
- Behavioral Telemetry: 25 points

ZERO-TRUST PROPERTY: PRNU + rPPG combined (60 points) can drop T below 60
regardless of behavioral score → automatic alert fires. A candidate cannot
"good-behavior" their way past a failed hardware/liveness check.

Alert severity levels:
- CRITICAL: rPPG liveness fail (SNR < 0) — likely deepfake/pre-recorded
- HIGH: PRNU identity fraud (PCE < 30) or deepfake rendering (CV > 2γ)
- MEDIUM: Assistance fraud (behavioral score < 0.4)
"""
from typing import Dict, List, Optional
from models.schemas import Alert, AlertType, AlertSeverity, TrustScoreBreakdown
import uuid
from datetime import datetime


def axiom_fusion_engine(
    pce: float,
    snr_rppg: float,
    cv_jitter: float,
    behavioral_score: float,
    thresholds: Optional[Dict] = None,
    camera_active: bool = True,
) -> Dict:
    """
    Compute fused trust score from all 4 forensic modules.

    Trust Score T ∈ [0, 100]:
    PRNU (30%) + rPPG (30%) + Jitter (15%) + Behavioral (25%) = 100%

    When candidate video camera is disabled (camera_active=False),
    all 4 concepts drop strictly to 0.0 and trust score is 0.0.

    Args:
        pce: Peak-to-Correlation Energy from PRNU module
        snr_rppg: Signal-to-Noise Ratio from rPPG module (dB)
        cv_jitter: Coefficient of Variation from jitter module
        behavioral_score: Composite behavioral score ∈ [0, 1]
        thresholds: Per-session thresholds {pce_threshold, snr_threshold_db, jitter_gamma}
        camera_active: Whether candidate's video feed is active

    Returns:
        Dict with trust_score, alerts, breakdown
    """
    if not camera_active:
        aid = str(uuid.uuid4())
        ts = datetime.utcnow().isoformat()
        msg = 'Candidate video camera is turned off — forensic verification suspended'
        return {
            'trust_score': 0.0,
            'alerts': [{
                'alert_id': aid,
                'alertId': aid,
                'alert_type': AlertType.LIVENESS_FAIL.value,
                'alertType': AlertType.LIVENESS_FAIL.value,
                'module': 'CAMERA',
                'severity': AlertSeverity.CRITICAL.value,
                'value': 0.0,
                'timestamp': ts,
                'acknowledged': False,
                'message': msg,
                'description': msg,
            }],
            'breakdown': {
                'prnu': 0.0,
                'rppg': 0.0,
                'jitter': 0.0,
                'behavioral': 0.0,
            },
        }

    thresholds = thresholds or {}
    T = 100.0
    alerts: List[Dict] = []

    # --- Thresholds (per-session from enrollment) ---
    tau = thresholds.get('pce_tau', thresholds.get('pce_threshold', 6.0))
    if tau > 15.0:
        # Standardize uncompressed photo default (60.0) for compressed 320x240 video stream
        tau = 6.0

    beta = thresholds.get('snr_beta', 2.0)
    if beta > 2.5:
        beta = 2.0

    gamma = thresholds.get('jitter_gamma', 0.85)
    if gamma < 0.3:
        # Standardize kernel UDP packet threshold (0.15) for application WebSocket frame intervals (0.85)
        gamma = 0.85

    # --- PRNU Component (30 points max) ---
    prnu_penalty = 0.0
    if pce < tau:
        prnu_penalty = 30.0 * (1.0 - min(pce / tau, 1.0))
        T -= prnu_penalty

        if pce < tau * 0.4:
            aid = str(uuid.uuid4())
            ts = datetime.utcnow().isoformat()
            msg = f'Camera fingerprint mismatch: PCE={pce:.1f} (threshold={tau:.1f})'
            alerts.append({
                'alert_id': aid,
                'alertId': aid,
                'alert_type': AlertType.IDENTITY_FRAUD.value,
                'alertType': AlertType.IDENTITY_FRAUD.value,
                'module': 'PRNU',
                'severity': AlertSeverity.HIGH.value,
                'value': float(pce),
                'timestamp': ts,
                'acknowledged': False,
                'message': msg,
                'description': msg,
            })

    # --- rPPG Component (30 points max) ---
    # Smooth continuous scoring: avoids cliff-edge jumping (0, 21, 30)
    # Authentic human pulse (SNR >= 2.0 dB) -> 30/30
    # Moderate pulse / noise (SNR between 0 and 2.0 dB) -> 18 to 30
    # Flat / diffuse noise (SNR < 0 dB) -> 0 to 18
    # Synthetic / pre-recorded video (SNR < -2.5 dB) -> 0.0 and fires alert
    rppg_penalty = 0.0
    if snr_rppg < beta:
        if snr_rppg >= 0.0:
            rppg_penalty = 12.0 * (1.0 - (snr_rppg / beta))
        else:
            rppg_penalty = 12.0 + 18.0 * min(1.0, abs(snr_rppg) / 2.5)

        T -= rppg_penalty

        if snr_rppg < -1.0:
            aid = str(uuid.uuid4())
            ts = datetime.utcnow().isoformat()
            msg = f'No biological pulse detected: SNR={snr_rppg:.1f}dB (threshold={beta:.1f}dB)'
            alerts.append({
                'alert_id': aid,
                'alertId': aid,
                'alert_type': AlertType.LIVENESS_FAIL.value,
                'alertType': AlertType.LIVENESS_FAIL.value,
                'module': 'rPPG',
                'severity': AlertSeverity.CRITICAL.value,
                'value': float(snr_rppg),
                'timestamp': ts,
                'acknowledged': False,
                'message': msg,
                'description': msg,
            })

    # --- Jitter Component (15 points max) ---
    jitter_penalty = 0.0
    if cv_jitter > gamma:
        jitter_penalty = 15.0 * min((cv_jitter - gamma) / gamma, 1.0)
        T -= jitter_penalty

        if cv_jitter > gamma * 2:
            aid = str(uuid.uuid4())
            ts = datetime.utcnow().isoformat()
            msg = f'Rendering overhead detected: CV={cv_jitter:.3f} (threshold={gamma})'
            alerts.append({
                'alert_id': aid,
                'alertId': aid,
                'alert_type': AlertType.DEEPFAKE_RENDERING.value,
                'alertType': AlertType.DEEPFAKE_RENDERING.value,
                'module': 'JITTER',
                'severity': AlertSeverity.HIGH.value,
                'value': float(cv_jitter),
                'timestamp': ts,
                'acknowledged': False,
                'message': msg,
                'description': msg,
            })

    # --- Behavioral Component (25 points max) ---
    behavioral_score_clamped = max(0.0, min(1.0, behavioral_score))
    behavioral_penalty = 25.0 * (1.0 - behavioral_score_clamped)
    T -= behavioral_penalty

    if behavioral_score_clamped < 0.4:
        aid = str(uuid.uuid4())
        ts = datetime.utcnow().isoformat()
        msg = f'Suspicious behavior detected: score={behavioral_score_clamped:.2f}'
        alerts.append({
            'alert_id': aid,
            'alertId': aid,
            'alert_type': AlertType.ASSISTANCE_FRAUD.value,
            'alertType': AlertType.ASSISTANCE_FRAUD.value,
            'module': 'BEHAVIORAL',
            'severity': AlertSeverity.MEDIUM.value,
            'value': float(behavioral_score_clamped),
            'timestamp': ts,
            'acknowledged': False,
            'message': msg,
            'description': msg,
        })

    # Clamp to [0, 100]
    T = max(0.0, min(100.0, T))

    # --- Compute breakdown contributions ---
    breakdown = {
        'prnu': round(max(0.0, min(30.0, 30.0 - prnu_penalty)), 2),
        'rppg': round(max(0.0, min(30.0, 30.0 - rppg_penalty)), 2),
        'jitter': round(max(0.0, min(15.0, 15.0 - jitter_penalty)), 2),
        'behavioral': round(max(0.0, min(25.0, 25.0 * behavioral_score_clamped)), 2),
    }

    return {
        'trust_score': round(T, 2),
        'alerts': alerts,
        'breakdown': breakdown,
    }


def get_trust_status(trust_score: float) -> str:
    """Get human-readable trust status from score."""
    if trust_score >= 80:
        return "Session Verified"
    elif trust_score >= 60:
        return "Caution"
    else:
        return "Integrity Alert — Review Required"


def get_trust_color(trust_score: float) -> str:
    """Get status color for trust score."""
    if trust_score >= 80:
        return "#2E7D32"  # Green — verified
    elif trust_score >= 60:
        return "#E07B00"  # Amber — caution
    else:
        return "#C62828"  # Red — alert
