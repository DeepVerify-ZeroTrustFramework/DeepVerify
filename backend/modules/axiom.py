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

CALIBRATION LAYER: When a trained model is available, the PRNU component
uses a learned decision boundary instead of a fixed threshold. This adapts
to WebRTC compression, camera quality, and resolution differences.

Alert severity levels:
- CRITICAL: rPPG liveness fail (SNR < 0) — likely deepfake/pre-recorded
- HIGH: PRNU identity fraud (PCE < threshold) or deepfake rendering (CV > 2γ)
- MEDIUM: Assistance fraud (behavioral score < 0.4)
"""
from typing import Dict, List, Optional
from models.schemas import Alert, AlertType, AlertSeverity, TrustScoreBreakdown
from modules.calibration import get_calibrated_authenticity
import uuid
from datetime import datetime


def axiom_fusion_engine(
    pce: float,
    snr_rppg: float,
    cv_jitter: float,
    behavioral_score: float,
    thresholds: Optional[Dict] = None,
    camera_active: bool = True,
    source: str = 'webrtc',
    liveness_failed: bool = False,
    prnu_match: Optional[float] = None,
    prnu_state: str = '',
    # Extended features for calibration model (optional)
    hr_bpm: float = 72.0,
    amplitude: float = 0.1,
    scr: float = 0.5,
    spectral_flatness: float = 0.3,
    frame_pixels: int = 76800,
    rppg_good_frac: Optional[float] = None,   # uploads: share of windows with a plausible, stable pulse
    pulse_mismatch: bool = False,             # face and neck never show the same heart rate
    ai_face_fake: bool = False,               # external AI face check flagged a swapped / AI-generated face
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
        source: 'webrtc', 'upload', or 'static' — compression context
        hr_bpm: Heart rate BPM from rPPG (for calibration model)
        amplitude: rPPG signal amplitude (for calibration model)
        scr: Spectral Concentration Ratio (for calibration model)
        spectral_flatness: Spectral flatness (for calibration model)
        frame_pixels: Frame pixel count (for calibration model)

    Returns:
        Dict with trust_score, alerts, breakdown, calibrated_prob
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
            'calibrated_prob': 0.0,
        }

    thresholds = thresholds or {}
    T = 100.0
    alerts: List[Dict] = []

    # --- Get calibrated authenticity probability ---
    calibrated_prob = get_calibrated_authenticity(
        pce=pce,
        snr_db=snr_rppg,
        source=source,
        hr_bpm=hr_bpm,
        amplitude=amplitude,
        scr=scr,
        spectral_flatness=spectral_flatness,
        cv_jitter=cv_jitter,
        behavioral_score=behavioral_score,
        frame_pixels=frame_pixels,
    )

    # --- Thresholds (per-session from enrollment, used as fallback context) ---
    tau = thresholds.get('pce_tau', thresholds.get('pce_threshold', 11.0))
    # Source-aware threshold override
    source_tau = {'webrtc': 10.0, 'upload': 25.0, 'static': 60.0}
    if tau > 15.0:
        tau = source_tau.get(source, 10.0)

    beta = thresholds.get('snr_beta', 3.0)
    if beta < 1.0:
        beta = 3.0

    # v2 jitter = regularity of the camera's own frame timing (see jitter.py).
    # A steady webcam scores ~0.05; points are lost from 0.20, all 15 at 0.40.
    # (The per-session jitter_gamma was tuned for the old arrival-time metric.)
    gamma = 0.20

    # --- PRNU Component (30 points max) ---
    # v2: points come from the PRNU tracker's sensor-match decision on native
    # crops (match 1.0 → 30 pts). While the fingerprint is still being built
    # (first ~10 s) the component is neutral (15 pts) and raises nothing; the
    # tracker itself publishes the mismatch alert once, when it persists.
    # Legacy path (no tracker info): calibrated probability as before.
    if prnu_match is not None:
        prnu_score = 30.0 * max(0.0, min(1.0, prnu_match))
        if source == 'upload' and prnu_state in ('low_signal', 'waiting', 'enrolling', 'checking'):
            prnu_score = 0.0
    elif source == 'upload':
        prnu_score = 0.0    # file: no confirmed sensor fingerprint → no identity credit
    elif prnu_state in ('waiting', 'enrolling', 'checking', 'low_signal'):
        prnu_score = 15.0   # not decided / not measurable on this camera: neutral, no alert
    else:
        prnu_score = calibrated_prob * 30.0
    prnu_penalty = 30.0 - prnu_score
    T -= prnu_penalty

    if prnu_match is None and prnu_state not in ('waiting', 'enrolling', 'checking', 'low_signal') and calibrated_prob < 0.4:
        aid = str(uuid.uuid4())
        ts = datetime.utcnow().isoformat()
        msg = f'Camera fingerprint anomaly: PCE={pce:.1f}, confidence={calibrated_prob:.2f}'
        alerts.append({
            'alert_id': aid,
            'alertId': aid,
            'alert_type': AlertType.IDENTITY_FRAUD.value,
            'alertType': AlertType.IDENTITY_FRAUD.value,
            'module': 'PRNU',
            'severity': AlertSeverity.HIGH.value if calibrated_prob < 0.2 else AlertSeverity.MEDIUM.value,
            'value': float(pce),
            'timestamp': ts,
            'acknowledged': False,
            'message': msg,
            'description': msg,
        })

    # --- rPPG Component (30 points max) ---
    # Smooth continuous scoring: avoids cliff-edge jumping (0, 21, 30)
    rppg_penalty = 0.0
    rppg_penalty_applied = False
    if rppg_good_frac is not None:
        # Score the share of windows with a plausible pulse, not the last window
        # alone. Upload: whole clip, full marks at >= 60%. Live: rolling ~15 s,
        # full marks at >= 45% so normal head motion doesn't cost a real person
        # points; the alert needs a sustained loss (< 20%).
        full_at = 0.60 if source == 'upload' else 0.45
        alert_below = 0.40 if source == 'upload' else 0.20
        rppg_penalty = 30.0 - 30.0 * max(0.0, min(1.0, rppg_good_frac / full_at))
        T -= rppg_penalty
        if rppg_good_frac < alert_below:
            aid = str(uuid.uuid4())
            ts = datetime.utcnow().isoformat()
            scope = 'across the video' if source == 'upload' else 'over the last 15 s'
            msg = f'No stable biological pulse {scope}: only {rppg_good_frac * 100:.0f}% of windows show one'
            alerts.append({
                'alert_id': aid, 'alertId': aid,
                'alert_type': AlertType.LIVENESS_FAIL.value, 'alertType': AlertType.LIVENESS_FAIL.value,
                'module': 'rPPG', 'severity': AlertSeverity.CRITICAL.value,
                'value': float(rppg_good_frac), 'timestamp': ts, 'acknowledged': False,
                'message': msg, 'description': msg,
            })
    elif snr_rppg < beta:
        if snr_rppg >= 0.0:
            rppg_penalty = 12.0 * (1.0 - (snr_rppg / beta))
        else:
            rppg_penalty = 12.0 + 18.0 * min(1.0, abs(snr_rppg) / 2.5)

        T -= rppg_penalty
        rppg_penalty_applied = True

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

    # Recorded/uploaded video: a "pulse" outside the resting human range, or with
    # no concentrated spectral peak, is noise being read as a heartbeat (AI video
    # gave 179 BPM and still scored full points). Penalise it as half-credit.
    if source == 'upload' and rppg_good_frac is None and snr_rppg >= 0.0:
        implausible = not (42.0 <= hr_bpm <= 150.0)
        weak_peak = scr < 0.30 or spectral_flatness > 0.75
        if (implausible or weak_peak) and rppg_penalty < 15.0:
            T -= (15.0 - rppg_penalty)
            rppg_penalty = 15.0

    # Face-neck pulse cross-check: one heart drives both, so a real person's face
    # and neck show the same heart rate some of the time. A generated or swapped
    # face flickers independently of the neck. With the neck in view,
    # (almost) never agreeing costs rPPG half its points. Provisional: measured on
    # 28 recorded videos (no real person below 9% agreement). Needs 60 s live /
    # 22 s uploaded so chance zero-agreement cannot flag a real person.
    if pulse_mismatch and rppg_penalty < 15.0:
        T -= (15.0 - rppg_penalty)
        rppg_penalty = 15.0
        aid = str(uuid.uuid4())
        ts = datetime.utcnow().isoformat()
        msg = 'Pulse in the face and the neck do not match - the face may be generated or swapped'
        alerts.append({
            'alert_id': aid, 'alertId': aid,
            'alert_type': AlertType.LIVENESS_FAIL.value, 'alertType': AlertType.LIVENESS_FAIL.value,
            'module': 'rPPG', 'severity': AlertSeverity.MEDIUM.value,
            'value': 0.0, 'timestamp': ts, 'acknowledged': False,
            'message': msg, 'description': msg,
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

    # Uploaded file (demo mode): there is no network stream or person at the
    # keyboard, so jitter and behavioral measure nothing and used to hand out 40
    # free points. Score only PRNU + rPPG, rescaled to 100. And never call a file
    # AUTHENTIC without positive evidence: if PRNU could not confirm a sensor
    # fingerprint, the score stays below the verified band.
    prnu_confirmed = prnu_match is not None and prnu_match >= 1.0
    prnu_mismatch = prnu_match is not None and prnu_match <= 0.0 and prnu_state == 'mismatch'
    # Uploaded file: there is no independent reference camera, only the file
    # itself. Matching a file against its own pattern proves nothing: codec
    # artefacts and AI-generated texture repeat across frames just like sensor
    # noise (tested: Gemini videos self-match at PCE 800-5000, a real webcam file
    # at 1800-2500). So PRNU is not applicable to uploads. Judge on rPPG alone,
    # never above 79 (no identity check), and call it inconclusive rather than
    # turning "no evidence" into "deepfake" or "authentic".
    prnu_unmeasured = source == 'upload'
    if source == 'upload':
        if prnu_unmeasured:
            T = min((30.0 - rppg_penalty) / 30.0 * 100.0, 79.0)
        else:
            T = (prnu_score + (30.0 - rppg_penalty)) / 60.0 * 100.0
            if not prnu_confirmed:
                T = min(T, 79.0)
        jitter_penalty = 0.0
        behavioral_score_clamped = 1.0

    # Clamp to [0, 100]
    T = max(0.0, min(100.0, T))

    # ACTIVE LIVENESS: a confirmed failed head-turn challenge caps the score in
    # the alert band until a later challenge passes. Passive signals (PRNU, rPPG)
    # can be reproduced by a good fake; reacting to a random instruction can't.
    # On its own a failed challenge costs 20 points (lands in "Caution", the
    # interviewer sees the alert). Only when another signal agrees (PRNU says a
    # different camera, or rPPG has lost the pulse) does it cap the score at 35.
    # AI FACE CHECK (Sightengine snapshot): a swapped or AI-generated face costs 20
    # points and counts as confirming evidence for a failed liveness challenge.
    ai_face_penalty = 0.0
    if ai_face_fake:
        before = T
        T = max(0.0, T - 20.0)
        ai_face_penalty = round(before - T, 2)

    liveness_penalty = 0.0
    if liveness_failed:
        corroborated = ((prnu_match is not None and prnu_match <= 0.0) or
                        (rppg_good_frac is not None and rppg_good_frac < 0.20) or
                        ai_face_fake)
        before = T
        T = min(T, 35.0) if corroborated else max(0.0, T - 20.0)
        liveness_penalty = round(before - T, 2)

    # --- Compute breakdown contributions ---
    breakdown = {
        'prnu': round(max(0.0, min(30.0, prnu_score)), 2),
        'rppg': round(max(0.0, min(30.0, 30.0 - rppg_penalty)), 2),
        'jitter': round(max(0.0, min(15.0, 15.0 - jitter_penalty)), 2),
        'behavioral': round(max(0.0, min(25.0, 25.0 * behavioral_score_clamped)), 2),
    }

    return {
        'trust_score': round(T, 2),
        'alerts': alerts,
        'breakdown': breakdown,
        'calibrated_prob': round(calibrated_prob, 4),
        'liveness_failed': bool(liveness_failed),
        'liveness_penalty': liveness_penalty,
        'ai_face_fake': bool(ai_face_fake),
        'ai_face_penalty': ai_face_penalty,
        # inconclusive = nothing measured as wrong, but no identity check either
        'inconclusive': bool(prnu_unmeasured and T >= 60.0),
        'prnu_measurable': not prnu_unmeasured,
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
