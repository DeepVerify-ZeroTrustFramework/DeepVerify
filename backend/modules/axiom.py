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
    thresholds: Optional[Dict] = None
) -> Dict:
    """
    Compute fused trust score from all 4 forensic modules.

    Trust Score T ∈ [0, 100]:
    PRNU (30%) + rPPG (30%) + Jitter (15%) + Behavioral (25%) = 100%

    Args:
        pce: Peak-to-Correlation Energy from PRNU module
        snr_rppg: Signal-to-Noise Ratio from rPPG module (dB)
        cv_jitter: Coefficient of Variation from jitter module
        behavioral_score: Composite behavioral score ∈ [0, 1]
        thresholds: Per-session thresholds {pce_threshold, snr_threshold_db, jitter_gamma}

    Returns:
        Dict with trust_score, alerts, breakdown
    """
    thresholds = thresholds or {}
    T = 100.0
    alerts: List[Dict] = []

    # --- Thresholds (per-session from enrollment) ---
    tau = thresholds.get('pce_tau', 60.0)              # PRNU PCE threshold
    beta = thresholds.get('snr_beta', 3.0)             # rPPG SNR threshold (per-candidate)
    gamma = thresholds.get('jitter_gamma', 0.15)       # Jitter CV threshold (per-connection)

    # --- PRNU Component (30 points max) ---
    prnu_penalty = 0.0
    if pce < tau:
        prnu_penalty = 30.0 * (1.0 - min(pce / tau, 1.0))
        T -= prnu_penalty

        if pce < tau * 0.5:
            alerts.append({
                'alert_id': str(uuid.uuid4()),
                'alert_type': AlertType.IDENTITY_FRAUD.value,
                'module': 'PRNU',
                'severity': AlertSeverity.HIGH.value,
                'value': pce,
                'timestamp': datetime.utcnow().isoformat(),
                'acknowledged': False,
                'message': f'Camera fingerprint mismatch: PCE={pce:.1f} (threshold={tau})',
            })

    # --- rPPG Component (30 points max) ---
    rppg_penalty = 0.0
    if snr_rppg < beta:
        rppg_penalty = 30.0 * max(0.0, (beta - snr_rppg) / beta)
        T -= rppg_penalty

        if snr_rppg < 0:
            alerts.append({
                'alert_id': str(uuid.uuid4()),
                'alert_type': AlertType.LIVENESS_FAIL.value,
                'module': 'rPPG',
                'severity': AlertSeverity.CRITICAL.value,
                'value': snr_rppg,
                'timestamp': datetime.utcnow().isoformat(),
                'acknowledged': False,
                'message': f'No biological pulse detected: SNR={snr_rppg:.1f}dB',
            })

    # --- Jitter Component (15 points max) ---
    jitter_penalty = 0.0
    if cv_jitter > gamma:
        jitter_penalty = 15.0 * min((cv_jitter - gamma) / gamma, 1.0)
        T -= jitter_penalty

        if cv_jitter > gamma * 2:
            alerts.append({
                'alert_id': str(uuid.uuid4()),
                'alert_type': AlertType.DEEPFAKE_RENDERING.value,
                'module': 'JITTER',
                'severity': AlertSeverity.HIGH.value,
                'value': cv_jitter,
                'timestamp': datetime.utcnow().isoformat(),
                'acknowledged': False,
                'message': f'Rendering overhead detected: CV={cv_jitter:.3f} (threshold={gamma})',
            })

    # --- Behavioral Component (25 points max) ---
    behavioral_penalty = 25.0 * (1.0 - behavioral_score)
    T -= behavioral_penalty

    if behavioral_score < 0.4:
        alerts.append({
            'alert_id': str(uuid.uuid4()),
            'alert_type': AlertType.ASSISTANCE_FRAUD.value,
            'module': 'BEHAVIORAL',
            'severity': AlertSeverity.MEDIUM.value,
            'value': behavioral_score,
            'timestamp': datetime.utcnow().isoformat(),
            'acknowledged': False,
            'message': f'Suspicious behavior detected: score={behavioral_score:.2f}',
        })

    # Clamp to [0, 100]
    T = max(0.0, min(100.0, T))

    # --- Compute breakdown contributions ---
    breakdown = {
        'prnu': round(min(30.0, 30.0 - prnu_penalty), 2),
        'rppg': round(min(30.0, 30.0 - rppg_penalty), 2),
        'jitter': round(min(15.0, 15.0 - jitter_penalty), 2),
        'behavioral': round(25.0 * behavioral_score, 2),
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
