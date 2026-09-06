"""
Frame analysis WebSocket endpoint.

Receives binary JPEG I-frames from the candidate's browser via WebSocket,
dispatches to PRNU + rPPG analysis pipelines, runs axiom fusion every ~3-4 seconds,
and publishes trust score updates to Redis for the interviewer dashboard.
"""
import json
import time
import numpy as np
import cv2
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from db.mongo import get_sessions_collection, get_telemetry_collection, get_alerts_collection, get_behavioral_events_collection
from db.redis_client import publish_trust_score, publish_alert
from modules.prnu import extract_noise_residual, compute_pce, estimate_prnu_reference
from modules.rppg import RPPGAnalyzer
from modules.jitter import JitterAnalyzer
from modules.behavioral import BehavioralTracker
from modules.axiom import axiom_fusion_engine
from api.routes.enrollment import get_prnu_reference
from datetime import datetime

router = APIRouter()

# Active session analyzers (keyed by session_id)
_session_analyzers: dict = {}


def get_or_create_analyzers(session_id: str, thresholds: dict = None):
    """Get or create the analysis pipeline for a session."""
    if session_id not in _session_analyzers:
        thresholds = thresholds or {}
        _session_analyzers[session_id] = {
            'rppg': RPPGAnalyzer(
                fs=10.0,
                window_seconds=4.0,
                snr_threshold_db=thresholds.get('snr_beta', 3.0),
            ),
            'jitter': JitterAnalyzer(
                session_id=session_id,
                connection_type=thresholds.get('connection_type', 'wifi'),
            ),
            'behavioral': BehavioralTracker(
                session_id=session_id,
                gaze_lambda=thresholds.get('behavioral_lambda', 0.3),
            ),
            'last_fusion_time': 0.0,
            'frame_count': 0,
            'prnu_enrollment_frames': [],
            'k_hat': None,
            'last_pce': 0.0,  # Zero-Trust default: unverified until live calculation passes
            'last_snr': 0.0,  # Zero-Trust default: unverified until live calculation passes
            'last_cv': 0.05,
            'last_hr_bpm': 72.0,
            'camera_active': True,
            'last_frame_received_at': time.time(),
        }
    return _session_analyzers[session_id]


@router.websocket("/ws/frames/{session_id}")
async def websocket_frames(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for receiving candidate frames and behavioral events.

    Binary messages: JPEG I-frames for PRNU + rPPG analysis
    Text messages: JSON behavioral events and gaze data
    """
    await websocket.accept()

    # Load session thresholds from DB
    collection = get_sessions_collection()
    session_doc = await collection.find_one({"session_id": session_id})
    if not session_doc:
        await websocket.close(code=4004, reason="Session not found")
        return

    thresholds = session_doc.get('thresholds', {})
    enrollment = session_doc.get('enrollment', {})

    # Merge thresholds
    merged_thresholds = {
        'snr_beta': thresholds.get('snr_beta', 3.0),
        'pce_threshold': thresholds.get('pce_tau', 60.0),
        'jitter_gamma': thresholds.get('jitter_gamma', 0.15),
        'behavioral_lambda': thresholds.get('behavioral_lambda', 0.3),
        'connection_type': enrollment.get('connection_type', 'wifi'),
    }

    analyzers = get_or_create_analyzers(session_id, merged_thresholds)
    K_hat = get_prnu_reference(session_id)

    print(f"[Frames] Session {session_id} connected. PRNU ref: {'loaded' if K_hat is not None else 'none'}")

    try:
        while True:
            data = await websocket.receive()

            if 'bytes' in data and data['bytes']:
                # Binary message: JPEG I-frame
                try:
                    await _process_frame(
                        session_id, data['bytes'], analyzers, K_hat, merged_thresholds
                    )
                except Exception as e:
                    print(f"[Frames] Error processing frame: {e}")

            elif 'text' in data and data['text']:
                # Text message: JSON behavioral event or gaze data
                try:
                    msg = json.loads(data['text'])
                    await _process_event(session_id, msg, analyzers)
                except json.JSONDecodeError:
                    pass

    except (WebSocketDisconnect, RuntimeError):
        print(f"[Frames] Session {session_id} disconnected.")
        # Clean up analyzers after disconnect
        if session_id in _session_analyzers:
            del _session_analyzers[session_id]


async def _process_frame(session_id: str, frame_bytes: bytes, analyzers: dict,
                          K_hat, thresholds: dict):
    """Process a single JPEG frame through PRNU and rPPG pipelines."""
    # Decode JPEG
    nparr = np.frombuffer(frame_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        return

    # Resize to 320x240 (matching PRNU enrollment dimensions)
    frame = cv2.resize(frame, (320, 240))
    analyzers['frame_count'] += 1

    # Ensure K_hat is loaded from memory, disk, or dynamically extracted for Demo Mode
    current_k_hat = K_hat
    if current_k_hat is None:
        current_k_hat = analyzers.get('k_hat')
    if current_k_hat is None:
        current_k_hat = get_prnu_reference(session_id)
        if current_k_hat is not None:
            analyzers['k_hat'] = current_k_hat

    # Dynamic Demo Mode PRNU Enrollment: Collect first 20 frames to build fingerprint
    if current_k_hat is None:
        analyzers['prnu_enrollment_frames'].append(frame.copy())
        if len(analyzers['prnu_enrollment_frames']) >= 20:
            print(f"[PRNU] Extracting dynamic fingerprint from 20 demo frames for {session_id}...")
            try:
                analyzers['k_hat'] = estimate_prnu_reference(analyzers['prnu_enrollment_frames'])
                current_k_hat = analyzers['k_hat']
                print(f"[PRNU] Dynamic fingerprint extraction complete.")
            except Exception as e:
                print(f"[PRNU] Dynamic extraction failed: {e}")
            # Free memory
            analyzers['prnu_enrollment_frames'] = []

    analyzers['last_frame_received_at'] = time.time()
    analyzers['camera_active'] = True

    # --- PRNU Analysis (every 10th frame: 1x per second) ---
    if analyzers['frame_count'] % 10 == 0:
        if current_k_hat is not None:
            try:
                W_test = extract_noise_residual(frame)
                pce = compute_pce(W_test, current_k_hat)
                prev_pce = analyzers.get('last_pce', 0.0)
                if prev_pce > 0.0:
                    smooth_pce = 0.7 * prev_pce + 0.3 * pce
                else:
                    smooth_pce = pce
                analyzers['last_pce'] = float(smooth_pce)
                print(f"[PRNU-DEBUG] Frame {analyzers['frame_count']} | Raw PCE={pce:.2f} | Smooth PCE={smooth_pce:.2f}")
            except Exception as e:
                print(f"[PRNU] Error: {e}")
                analyzers['last_pce'] = 0.0
        else:
            # Still collecting frames
            analyzers['last_pce'] = 0.0

    # --- rPPG Analysis (every frame) ---
    # Pass empty landmarks since we're doing simplified ROI extraction
    rppg_result = analyzers['rppg'].add_sample(frame, [])
    if rppg_result:
        analyzers['last_snr'] = float(rppg_result['snr_db'])
        if 'heart_rate_bpm' in rppg_result and rppg_result['heart_rate_bpm'] > 0:
            analyzers['last_hr_bpm'] = float(rppg_result['heart_rate_bpm'])

    # --- Jitter: record frame arrival time ---
    analyzers['jitter'].process_packet_timestamp(time.time())
    jitter_metrics = analyzers['jitter'].compute_detection_metrics()
    if jitter_metrics:
        analyzers['last_cv'] = float(jitter_metrics['cv'])

    # Synchronize into in-memory telemetry so behavioral events don't overwrite real forensic scores
    try:
        from api.routes.ws_handlers import _get_telemetry
        telemetry = _get_telemetry(session_id)
        telemetry["last_pce"] = analyzers['last_pce']
        telemetry["last_snr_rppg"] = analyzers['last_snr']
        telemetry["last_cv_jitter"] = analyzers['last_cv']
        telemetry["last_hr_bpm"] = analyzers.get('last_hr_bpm', 72.0)
    except Exception:
        pass

    # --- Axiom Fusion (every ~3 seconds) ---
    now = time.time()
    if now - analyzers['last_fusion_time'] >= 3.0:
        analyzers['last_fusion_time'] = now
        await _run_fusion(session_id, analyzers, thresholds)


async def _process_event(session_id: str, msg: dict, analyzers: dict):
    """Process a behavioral event or gaze data message."""
    event_type = msg.get('type', '')
    behavioral = analyzers['behavioral']

    if event_type == 'CAMERA_STATUS':
        camera_enabled = bool(msg.get('enabled', False))
        analyzers['camera_active'] = camera_enabled
        if not camera_enabled:
            analyzers['last_pce'] = 0.0
            analyzers['last_snr'] = -10.0
            analyzers['last_cv'] = 0.0
            try:
                from api.routes.ws_handlers import _get_telemetry
                telemetry = _get_telemetry(session_id)
                telemetry['camera_active'] = False
                telemetry['last_pce'] = 0.0
                telemetry['last_snr_rppg'] = -10.0
                telemetry['last_cv_jitter'] = 0.0
                telemetry['face_count'] = 0
            except Exception:
                pass
        await _run_fusion(session_id, analyzers, {})

    elif event_type in ('TAB_SWITCH', 'WINDOW_BLUR', 'LARGE_PASTE'):
        behavioral.record_event(event_type, metadata=msg.get('metadata', {}))

        # Store event in MongoDB
        events_col = get_behavioral_events_collection()
        await events_col.insert_one({
            'session_id': session_id,
            'type': event_type,
            'timestamp': datetime.utcnow(),
            'metadata': msg.get('metadata', {}),
        })

    elif event_type == 'GAZE_DATA':
        behavioral.record_gaze_data(
            gaze_x=msg.get('gaze_x', 0.5),
            gaze_y=msg.get('gaze_y', 0.5),
            delta=msg.get('delta', 0.0),
            yaw=msg.get('yaw', 0.0),
            pitch=msg.get('pitch', 0.0),
            roll=msg.get('roll', 0.0),
        )

    elif event_type == 'JITTER_STATS':
        # WebRTC stats fallback for jitter
        analyzers['jitter'].process_webrtc_stats(
            jitter=msg.get('jitter', 0.0),
            rtt=msg.get('rtt', 0.0),
            packets_lost=msg.get('packetsLost', 0),
        )


async def _run_fusion(session_id: str, analyzers: dict, thresholds: dict):
    """Run axiom fusion engine and publish results."""
    behavioral_score = analyzers['behavioral'].compute_score()
    try:
        from api.routes.ws_handlers import _get_telemetry
        telemetry = _get_telemetry(session_id)
        if telemetry.get("gaze_deltas"):
            from modules.behavioral import compute_behavioral_score
            behavioral_score = compute_behavioral_score(telemetry, {
                "lambda_gaze": thresholds.get("behavioral_lambda", 0.25),
            })
    except Exception:
        pass

    is_cam_active = analyzers.get('camera_active', True)
    if time.time() - analyzers.get('last_frame_received_at', time.time()) > 3.0:
        is_cam_active = False

    pce_val = analyzers['last_pce']
    snr_val = analyzers['last_snr']
    cv_val = analyzers['last_cv']
    ack_set = set()

    try:
        from api.routes.ws_handlers import _get_telemetry
        telemetry = _get_telemetry(session_id)
        if telemetry.get("prnu_excused"):
            pce_val = max(pce_val, thresholds.get('pce_threshold', 45.0) + 5.0)
        if telemetry.get("rppg_excused"):
            snr_val = max(snr_val, thresholds.get('snr_beta', 2.0) + 1.0)
        if telemetry.get("jitter_excused"):
            cv_val = min(cv_val, thresholds.get('jitter_gamma', 0.15) * 0.5)
        if telemetry.get("virtual_camera_detected"):
            is_cam_active = False
        ack_set = set(telemetry.get("acknowledged_alerts", []))
    except Exception:
        pass

    result = axiom_fusion_engine(
        pce=pce_val,
        snr_rppg=snr_val,
        cv_jitter=cv_val,
        behavioral_score=behavioral_score,
        thresholds={
            'pce_tau': thresholds.get('pce_threshold', 45.0),
            'snr_beta': thresholds.get('snr_beta', 2.0),
            'jitter_gamma': thresholds.get('jitter_gamma', 0.15),
        },
        camera_active=is_cam_active,
    )

    now_iso = datetime.utcnow().isoformat()
    # Add metadata
    result['type'] = 'TRUST_UPDATE'
    result['session_id'] = session_id
    result['timestamp'] = now_iso
    result['pce'] = pce_val
    result['snr_rppg'] = snr_val
    result['cv_jitter'] = cv_val
    result['behavioral_score'] = behavioral_score
    result['stats'] = analyzers['behavioral'].get_stats()
    result['raw'] = {
        'pce': float(pce_val),
        'snr_rppg': float(snr_val),
        'cv_jitter': float(cv_val),
        'behavioral_score': float(behavioral_score),
        'hr_bpm': float(analyzers.get('last_hr_bpm', 72.0)),
    }

    # Filter out acknowledged alerts from result['alerts']
    result['alerts'] = [
        a for a in result.get('alerts', [])
        if a.get('alert_id') not in ack_set and a.get('alertId') not in ack_set
    ]

    # Publish to Redis for dashboard consumption
    await publish_trust_score(session_id, result)

    # Publish individual alerts
    for alert in result.get('alerts', []):
        alert['type'] = 'ALERT'
        await publish_alert(session_id, alert)

        # Store alert in MongoDB
        alerts_col = get_alerts_collection()
        await alerts_col.insert_one({
            'session_id': session_id,
            **alert,
        })

    # Store telemetry in MongoDB
    telemetry_col = get_telemetry_collection()
    await telemetry_col.insert_one({
        'session_id': session_id,
        'timestamp': datetime.utcnow(),
        'trust_score': result['trust_score'],
        'pce': analyzers['last_pce'],
        'snr_rppg': analyzers['last_snr'],
        'cv_jitter': analyzers['last_cv'],
        'behavioral_score': behavioral_score,
        'breakdown': result['breakdown'],
        'raw': result['raw'],
    })
