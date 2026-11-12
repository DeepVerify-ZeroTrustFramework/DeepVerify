"""
Frame analysis WebSocket endpoint.

Receives binary JPEG I-frames from the candidate's browser via WebSocket,
dispatches to PRNU + rPPG analysis pipelines, runs axiom fusion every ~3-4 seconds,
and publishes trust score updates to Redis for the interviewer dashboard.
"""
import json
import time
import asyncio
import numpy as np
import cv2
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from db.mongo import get_sessions_collection, get_telemetry_collection, get_alerts_collection, get_behavioral_events_collection
from db.redis_client import publish_trust_score, publish_alert
from modules.prnu import PRNUTracker, parse_prnu_packet, PRNU_MAGIC
from modules.rppg import RPPGAnalyzer, skin_patch_rgb
from modules.jitter import JitterAnalyzer
from modules.behavioral import BehavioralTracker
from modules.axiom import axiom_fusion_engine
from modules.liveness_challenge import ChallengeManager, make_yaw_estimator
# Demo pages (LiveDemo / uploaded Demo) keep Naren's ORIGINAL liveness behaviour
# (commit a38f5eb), unchanged. Interviews use ChallengeManager above.
from modules.liveness_challenge_demo import ChallengeManager as DemoChallengeManager
import uuid
from api.routes.enrollment import get_prnu_reference
from datetime import datetime

router = APIRouter()

# rPPG face-crop stream: b'DVRP' + JPEG. The browser crops the face (box sent by
# the server as FACE_BOX) from the camera's own pixels at ~15 fps, so the pulse is
# read from cleaner, more frequent samples than the 10 fps 320x240 frames.
RPPG_MAGIC = b'DVRP'
# AI face check (Sightengine): full-resolution snapshot requested from the browser,
# sent back as b'DVSN' + JPEG. Few per session (free-plan budget).
SNAP_MAGIC = b'DVSN'
AI_FACE_MAX_PER_SESSION = 3           # free plan: ~25 checks/day, 10 operations each
AI_FACE_FIRST_AFTER_FRAMES = 200      # ~20 s of frames at 10 fps
AI_FACE_MIN_GAP = 30.0                # seconds between checks
AI_DEEPFAKE_FLAG = 0.30               # tested: real faces <= 0.12, face swaps 0.32-0.90
AI_GENAI_FLAG = 0.50                  # tested: real faces 0.001, AI-generated 0.87-0.99
RPPG_CROP_FS = 15.0
import os as _os
FACE_NECK_SCORING = _os.getenv('DV_FACE_NECK_SCORING', '0') == '1'

# Active session analyzers (keyed by session_id)
_session_analyzers: dict = {}


def get_or_create_analyzers(session_id: str, thresholds: dict = None, source: str = 'webrtc',
                            strict_prnu: bool = False, demo: bool = False):
    """Get or create the analysis pipeline for a session."""
    if session_id not in _session_analyzers:
        thresholds = thresholds or {}
        _session_analyzers[session_id] = {
            'rppg': RPPGAnalyzer(
                fs=10.0,
                window_seconds=4.0,
                snr_threshold_db=thresholds.get('snr_beta', 3.0),
                source=source,
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
            # PRNU v2: fed with native-resolution crops (b'DVPR' packets) from the browser
            'prnu': PRNUTracker(enrolled=get_prnu_reference(session_id), strict_reference=strict_prnu),
            'prnu_mismatch_streak': 0,
            'last_pce': 0.0,  # Zero-Trust default: unverified until live calculation passes
            '_alert_last': {},   # alert_type -> last publish time (de-duplication)
            'last_snr': 0.0,  # Zero-Trust default: unverified until live calculation passes
            'last_cv': 0.05,
            'last_hr_bpm': 72.0,
            # Extra rPPG diagnostics + context for the calibration layer.
            # Neutral defaults match modules/calibration.py until real values arrive.
            'last_amplitude': 0.1,
            'last_scr': 0.5,
            'last_flatness': 0.3,
            'last_frame_pixels': 320 * 240,
            'camera_active': True,
            'last_frame_received_at': time.time(),
            # One FaceMesh per session, shared: its landmarks place the rPPG skin
            # patches and its yaw drives the head-turn challenges.
            'face_mesh': make_yaw_estimator(),
            '_last_yaw': None,
            # rPPG from the face-crop stream (preferred when the browser sends it)
            'rppg_crop': RPPGAnalyzer(
                fs=RPPG_CROP_FS,
                window_seconds=4.0,
                snr_threshold_db=thresholds.get('snr_beta', 3.0),
                source=source,
            ),
            'crop_mesh': None,          # built on the first crop
            'last_rppg_crop_at': 0.0,
            '_face_box_sent_at': 0.0,
            # AI face check (external, a few snapshots per session)
            'ai_face': {'checks': 0, 'want': None, 'pending_since': 0.0, 'last_at': 0.0,
                        'first_done': False, 'flag': False},
        }
        a = _session_analyzers[session_id]
        # Active liveness. Demo pages: Naren's original automatic checks.
        a['is_demo'] = demo
        a['liveness'] = (DemoChallengeManager if demo else ChallengeManager)(
            session_id, yaw_fn=(lambda _f, a=a: a.get('_last_yaw')) if a['face_mesh'] is not None else None)
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
    # Determine source based on interview type
    interview_type = session_doc.get('interview_type', 'Technical')
    source = 'upload' if interview_type == 'Demo' else 'webrtc'
    # Live demo: streamed like an interview, but any source (webcam, OBS, a video
    # file) is judged against the webcam enrolled at the start of the demo.
    live_demo = interview_type == 'LiveDemo'

    is_demo = interview_type in ('Demo', 'LiveDemo')
    analyzers = get_or_create_analyzers(session_id, merged_thresholds, source=source, strict_prnu=live_demo,
                                        demo=is_demo)
    if live_demo and analyzers.get('liveness') is not None:
        # Demo pacing: first check after ~10 s, then every 30-45 s
        analyzers['liveness'].first_delay = 10.0
        analyzers['liveness'].interval = (30.0, 45.0)
    K_hat = None  # PRNU v2 reference lives in analyzers['prnu']
    ref = analyzers['prnu'].enrolled
    print(f"[Frames] Session {session_id} connected. PRNU enrollment fingerprint: "
          f"{'%dx%d camera' % (ref['width'], ref['height']) if ref else 'none (will self-enroll from first crops)'}")

    try:
        while True:
            data = await websocket.receive()

            if 'bytes' in data and data['bytes'] and data['bytes'][:4] == PRNU_MAGIC:
                # Binary message: native-resolution PRNU crop
                try:
                    await _process_prnu_crop(session_id, data['bytes'], analyzers, merged_thresholds)
                except Exception as e:
                    print(f"[PRNU] Error processing crop: {e}")

            elif 'bytes' in data and data['bytes'] and data['bytes'][:4] == SNAP_MAGIC:
                # Binary message: full-resolution snapshot for the AI face check
                asyncio.create_task(_run_ai_face_check(session_id, data['bytes'][4:], analyzers))

            elif 'bytes' in data and data['bytes'] and data['bytes'][:4] == RPPG_MAGIC:
                # Binary message: native-resolution face crop for rPPG
                try:
                    _process_rppg_crop(data['bytes'][4:], analyzers, merged_thresholds)
                except Exception as e:
                    print(f"[rPPG] Error processing face crop: {e}")

            elif 'bytes' in data and data['bytes']:
                # Binary message: JPEG I-frame
                try:
                    await _process_frame(
                        session_id, data['bytes'], analyzers, K_hat, merged_thresholds, source,
                        websocket=websocket,
                    )
                except Exception as e:
                    print(f"[Frames] Error processing frame: {e}")

            elif 'text' in data and data['text']:
                # Text message: JSON behavioral event or gaze data
                try:
                    msg = json.loads(data['text'])
                    if msg.get('type') == 'LIVENESS_REQUEST' and analyzers.get('is_demo'):
                        # Live demo button: run a head-turn check now (original behaviour)
                        if analyzers.get('liveness') is not None:
                            analyzers['liveness'].request_now()
                        continue
                    if msg.get('type') in ('LIVENESS_REQUEST', 'LIVENESS_START') and not analyzers.get('is_demo'):
                        continue    # liveness checks are switched off for interviews (demo only)
                    if msg.get('type') in ('LIVENESS_REQUEST', 'LIVENESS_START'):
                        # LIVENESS_START: candidate page, once identity check + full
                        # screen are done. LIVENESS_REQUEST: live-demo button.
                        origin = 'start' if msg.get('type') == 'LIVENESS_START' else 'demo'
                        res = await _start_liveness(session_id, analyzers, origin)
                        if res == 'unavailable':
                            await websocket.send_json({'type': 'LIVENESS_UNAVAILABLE'})
                        continue
                    if msg.get('type') == 'LIVENESS_SKIP':
                        lm = analyzers.get('liveness')
                        if lm is not None:
                            await _emit_liveness(session_id, websocket, lm.skip(), analyzers, merged_thresholds)
                        continue
                    if msg.get('type') == 'SOURCE_KIND':
                        # Live demo: informational only. Files get head-turn checks too
                        # (a replay failing them is the point); never used in the verdict.
                        analyzers['source_is_file'] = msg.get('kind') == 'file'
                        continue
                    if msg.get('type') == 'TAB_VISIBILITY':
                        hidden = bool(msg.get('hidden'))
                        analyzers['tab_hidden'] = hidden
                        if not hidden:
                            analyzers['tab_visible_since'] = time.time()
                        continue
                    await _process_event(session_id, msg, analyzers)
                except json.JSONDecodeError:
                    pass

    except (WebSocketDisconnect, RuntimeError):
        print(f"[Frames] Session {session_id} disconnected.")
        _save_rppg_trace(session_id, source)
        # Clean up analyzers after disconnect
        if session_id in _session_analyzers:
            try:
                _session_analyzers[session_id]['liveness'].close()
                for _k in ('face_mesh', 'crop_mesh'):
                    if _session_analyzers[session_id].get(_k):
                        _session_analyzers[session_id][_k].close()
            except Exception:
                pass
            del _session_analyzers[session_id]


async def _process_frame(session_id: str, frame_bytes: bytes, analyzers: dict,
                          K_hat, thresholds: dict, source: str = 'webrtc', websocket=None):
    """Process a single JPEG frame through PRNU and rPPG pipelines."""
    # Decode JPEG
    nparr = np.frombuffer(frame_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        return

    # Record the incoming resolution BEFORE resizing — this is the compression
    # context feature for the calibration layer (it is constant after resize).
    analyzers['last_frame_pixels'] = int(frame.shape[0] * frame.shape[1])

    # Resize to 320x240 (matching PRNU enrollment dimensions)
    frame = cv2.resize(frame, (320, 240))
    analyzers['frame_count'] += 1

    analyzers['last_frame_received_at'] = time.time()
    analyzers['camera_active'] = True

    # PRNU runs on the separate native-resolution crops (see _process_prnu_crop):
    # these downscaled frames have lost the sensor pattern.

    # --- Face landmarks (shared by rPPG skin patches and head-turn yaw) ---
    landmarks = []
    mesh = analyzers.get('face_mesh')
    if mesh is not None:
        try:
            analyzers['_last_yaw'] = mesh(frame)
            landmarks = mesh.last_landmarks or []
        except Exception as e:
            analyzers['_last_yaw'] = None
            analyzers['_fm_err'] = repr(e)
    # Diagnostics every 50 frames (~5 s): is the face tracker seeing the candidate?
    d = analyzers.setdefault('_fm_diag', [0, 0])
    d[0] += 1
    d[1] += 1 if landmarks else 0
    if d[0] >= 50:
        print(f"[FaceMesh] {session_id} face found in {d[1]}/{d[0]} frames | frame={frame.shape[1]}x{frame.shape[0]} "
              f"mean_brightness={float(frame.mean()):.0f} raw_pixels={analyzers.get('last_frame_pixels')} "
              f"mesh={'on' if mesh is not None else 'OFF'} crops_live={time.time() - analyzers.get('last_rppg_crop_at', 0.0) < 2.0} "
              f"last_error={analyzers.pop('_fm_err', None)}", flush=True)
        d[0] = d[1] = 0

    # --- Tell the browser where the face is, so it can send rPPG face crops ---
    if websocket is not None and landmarks and time.time() - analyzers.get('_face_box_sent_at', 0.0) >= 0.5:
        try:
            xs = [p.x for p in landmarks]
            ys = [p.y for p in landmarks]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            mx, my = 0.12 * (x1 - x0), 0.12 * (y1 - y0)
            x0, y0 = max(0.0, x0 - mx), max(0.0, y0 - my)
            # Extend downwards to include the neck: its pulse is a cross-check for
            # face-swaps (a swap replaces the face, not the neck).
            x1, y1 = min(1.0, x1 + mx), min(1.0, y1 + 0.45 * (y1 - y0))
            analyzers['_face_box_sent_at'] = time.time()
            await websocket.send_json({'type': 'FACE_BOX', 'x': round(x0, 4), 'y': round(y0, 4),
                                       'w': round(x1 - x0, 4), 'h': round(y1 - y0, 4)})
        except Exception:
            pass

    # --- AI face check: ask the browser for a snapshot when one is due ---
    af = analyzers.get('ai_face')
    if af is not None and websocket is not None:
        if not af['first_done'] and analyzers['frame_count'] >= AI_FACE_FIRST_AFTER_FRAMES:
            af['first_done'] = True
            _request_ai_face_check(analyzers, 'routine')
        now_t = time.time()
        if af['want'] and (now_t - af['pending_since'] > 15.0):
            af['pending_since'] = now_t
            try:
                await websocket.send_json({'type': 'SNAPSHOT_REQUEST', 'reason': af['want']})
            except Exception:
                pass

    # --- rPPG Analysis ---
    # Preferred input: the face-crop stream (see _process_rppg_crop). Fall back to
    # these 10 fps frames only while no crops are arriving (older browser build).
    if time.time() - analyzers.get('last_rppg_crop_at', 0.0) > 2.0:
        rppg_result = analyzers['rppg'].add_sample(frame, landmarks)
        _ingest_rppg(analyzers, rppg_result, thresholds)

    # --- Active liveness challenge (server-verified head turns) ---
    # Uploaded demo videos have no live person to challenge, so skip it there.
    # While the candidate's tab is hidden (or just came back) they can't see the
    # prompt and the browser stops updating the camera image, so pause the
    # challenge instead of failing it. Leaving the tab is flagged separately.
    tab_away = (analyzers.get('tab_hidden', False) or
                time.time() - analyzers.get('tab_visible_since', 0.0) < 2.0)
    # Demo pages: original behaviour (timed checks, cancelled while the tab is hidden).
    if analyzers.get('is_demo') and websocket is not None and analyzers.get('liveness') is not None and source != 'upload':
        lm_ = analyzers['liveness']
        if tab_away:
            for m in lm_.cancel() if lm_.active else []:
                try:
                    await websocket.send_json(m)
                except Exception:
                    pass
            liveness_msgs = []
        else:
            try:
                liveness_msgs = lm_.on_frame(frame)
            except Exception as e:
                print(f"[Liveness] Error: {e}")
                liveness_msgs = []
        for m in liveness_msgs:
            # The challenge asks for head turns: keep the gaze module from flagging them.
            try:
                from api.routes.ws_handlers import _get_telemetry
                quiet = 10.0 if m.get('type') == 'LIVENESS_CHALLENGE' else 4.0
                _get_telemetry(session_id)['_liveness_quiet_until'] = time.time() + quiet
            except Exception:
                pass
            try:
                await websocket.send_json(m)
            except Exception:
                pass
            await _handle_liveness_event_demo(session_id, m, analyzers, thresholds)

    elif websocket is not None and analyzers.get('liveness') is not None and source != 'upload':
        lm_ = analyzers['liveness']
        # A hidden tab pauses the check (no time limit, so nothing is lost).
        if not tab_away:
            try:
                liveness_msgs = lm_.on_frame(frame)
            except Exception as e:
                print(f"[Liveness] Error: {e}")
                liveness_msgs = []
            await _emit_liveness(session_id, websocket, liveness_msgs, analyzers, thresholds)

    # --- Jitter: the camera's own frame timing (FRAME_TIMING messages) ---
    # Server arrival times only reflect the browser's send timer and our own
    # processing, so they are no longer used for the score.
    jm = analyzers['jitter'].compute_camera_metrics()
    if jm and jm['scored']:
        analyzers['last_cv'] = float(jm['cv'])
    if jm and time.time() - analyzers.get('_jitter_log_at', 0.0) >= 10.0:
        analyzers['_jitter_log_at'] = time.time()
        print(f"[Jitter] {session_id} camera {jm['fps']} fps, clock={jm['clock']}, robust_cv={jm['robust_cv']}, "
              f"irregular={jm['irregular_frac']}, score_cv={jm['cv']} ({'scored' if jm['scored'] else 'info only'})")

    # Synchronize into in-memory telemetry so behavioral events don't overwrite real forensic scores
    try:
        from api.routes.ws_handlers import _get_telemetry
        telemetry = _get_telemetry(session_id)
        telemetry["last_pce"] = analyzers['last_pce']
        telemetry["last_snr_rppg"] = analyzers['last_snr']
        telemetry["last_cv_jitter"] = analyzers['last_cv']
        telemetry["last_hr_bpm"] = analyzers.get('last_hr_bpm', 72.0)
        telemetry["last_amplitude"] = analyzers['last_amplitude']
        telemetry["last_scr"] = analyzers['last_scr']
        telemetry["last_flatness"] = analyzers['last_flatness']
        telemetry["rppg_good_frac"] = _rppg_good_frac(analyzers)
        telemetry["last_frame_pixels"] = analyzers['last_frame_pixels']
    except Exception:
        pass

    # --- Axiom Fusion (every ~3 seconds) ---
    now = time.time()
    if now - analyzers['last_fusion_time'] >= 3.0:
        analyzers['last_fusion_time'] = now
        await _run_fusion(session_id, analyzers, thresholds)


async def _publish_once(session_id: str, analyzers: dict, alert: dict, cooldown: float = 60.0) -> bool:
    """Publish an alert unless the same alert type was published within `cooldown` s."""
    key = alert.get('alert_type') or alert.get('alertType')
    now = time.time()
    last = analyzers.setdefault('_alert_last', {}).get(key, 0.0)
    if now - last < cooldown:
        return False
    analyzers['_alert_last'][key] = now
    alert['type'] = 'ALERT'
    await publish_alert(session_id, alert)
    try:
        await get_alerts_collection().insert_one({'session_id': session_id,
                                                  **{k: v for k, v in alert.items() if k != 'type'}})
    except Exception:
        pass
    return True


async def _process_prnu_crop(session_id: str, packet: bytes, analyzers: dict, thresholds: dict):
    """Native-resolution crop → PRNU tracker → state, alerts, challenge trigger."""
    parsed = parse_prnu_packet(packet)
    if parsed is None:
        return
    crop, cam_w, cam_h = parsed
    tr: PRNUTracker = analyzers['prnu']
    was_res_changed = tr.res_changed
    decision = tr.add_crop(crop, cam_w, cam_h)

    if tr.res_changed and not was_res_changed:
        await _publish_once(session_id, analyzers, _make_alert(
            'PRNU_CAMERA_CHANGE', 'HIGH', 'PRNU',
            f'Camera resolution ({cam_w}x{cam_h}) differs from the system check or changed mid-session — possible switch to another device or video source',
            float(cam_w * cam_h)))
        _request_liveness(analyzers)

    analyzers['prnu_state'] = tr.state
    if decision is None:
        return
    analyzers['last_pce'] = float(decision['pce'])
    analyzers['prnu_match'] = None if decision['match'] is None else float(decision['match'])
    analyzers['prnu_state'] = decision['state']
    # Hold a confirmed match through brief "uncertain" readings (head motion, a
    # dim moment), so PRNU doesn't flicker 30 -> 15 -> 30. A clear mismatch
    # still counts immediately.
    _now = time.time()
    if decision['state'] == 'match':
        analyzers['_prnu_last_match_at'] = _now
    elif decision['state'] == 'uncertain' and _now - analyzers.get('_prnu_last_match_at', 0.0) <= 30.0:
        analyzers['prnu_match'] = 1.0
    print(f"[PRNU] {session_id} PCE={decision['pce']:.1f} state={decision['state']} ref={decision['reference']}")

    # (Uploaded files: PRNU is not applicable, so no low-signal notice either.)
    if decision['state'] == 'low_signal' and analyzers['rppg'].source != 'upload':
        # This camera's sensor pattern isn't measurable (heavy in-camera denoising
        # or very low light). Say so once; never accuse the candidate because of it.
        await _publish_once(session_id, analyzers, _make_alert(
            'PRNU_LOW_SIGNAL', 'LOW', 'PRNU',
            'Camera fingerprint signal too weak on this device — PRNU check is neutral for this session '
            '(liveness challenges, rPPG and face match still apply)', float(decision['pce'])), cooldown=1e9)

    # Escalate in steps (decisions arrive ~3/s):
    #   ~2 s of mismatch  → MEDIUM "verifying" + an immediate liveness challenge
    #   ~20 s of mismatch → HIGH identity-fraud
    # A short blip (motion, light change) never accuses anyone.
    if decision['state'] == 'mismatch':
        analyzers['prnu_mismatch_streak'] = analyzers.get('prnu_mismatch_streak', 0) + 1
    elif decision['state'] == 'match':
        analyzers['prnu_mismatch_streak'] = 0
    streak = analyzers['prnu_mismatch_streak']
    # Points: a mismatch must persist (6 readings, ~2 s) before PRNU drops to 0.
    # A single early or blip mismatch counts as undecided (15), not as fraud.
    if decision['state'] == 'mismatch' and streak < 6:
        analyzers['prnu_match'] = 0.5
    where = ('the camera enrolled at the system check' if decision['reference'] == 'enrollment'
             else 'the camera used earlier in this interview')
    if streak == 6:
        await _publish_once(session_id, analyzers, _make_alert(
            'PRNU_FINGERPRINT_CHANGE', 'MEDIUM', 'PRNU',
            f'Live video no longer matches the camera fingerprint of {where} (PCE={decision["pce"]:.1f}, needs ≥60) '
            + ('— running a liveness check' if analyzers.get('is_demo') else '— verifying identity'), float(decision['pce'])))
        _request_liveness(analyzers)
    elif streak == 60:
        await _publish_once(session_id, analyzers, _make_alert(
            'IDENTITY_FRAUD', 'HIGH', 'PRNU',
            f'Live video has not matched the camera fingerprint of {where} for 20 s (PCE={decision["pce"]:.1f}) '
            f'— a different camera, a replayed recording or an injected video', float(decision['pce'])))

    try:
        from api.routes.ws_handlers import _get_telemetry
        t = _get_telemetry(session_id)
        t['last_pce'] = analyzers['last_pce']
        t['prnu_match'] = analyzers.get('prnu_match')
        t['prnu_state'] = analyzers.get('prnu_state', tr.state)
    except Exception:
        pass


def _make_alert(alert_type: str, severity: str, module: str, text: str, value: float) -> dict:
    aid = str(uuid.uuid4())
    return {'alert_id': aid, 'alertId': aid, 'alert_type': alert_type, 'alertType': alert_type,
            'module': module, 'severity': severity, 'value': float(value),
            'timestamp': datetime.utcnow().isoformat(), 'acknowledged': False,
            'message': text, 'description': text}


def _region_rgbs(img, landmarks):
    """Mean (R, G, B) of forehead, left cheek, right cheek and neck (below the chin)."""
    from modules.rppg import SKIN_PATCHES
    h, w = img.shape[:2]
    out = []
    for idx in SKIN_PATCHES:
        pts = np.array([[landmarks[i].x * w, landmarks[i].y * h] for i in idx], np.int32)
        m = np.zeros((h, w), np.uint8)
        cv2.fillConvexPoly(m, cv2.convexHull(pts), 1)
        out.append(tuple(cv2.mean(img, mask=m)[:3][::-1]) if m.sum() >= 15 else (np.nan,) * 3)
    # Neck: a band under the chin (152), between the jaw corners (172, 397)
    cy = landmarks[152].y * h
    fh = (landmarks[152].y - landmarks[10].y) * h
    xa, xb = sorted((landmarks[172].x * w, landmarks[397].x * w))
    x0, x1 = int(xa + 0.15 * (xb - xa)), int(xb - 0.15 * (xb - xa))
    y0, y1 = int(cy + 0.08 * fh), int(cy + 0.30 * fh)
    y0, y1 = max(0, y0), min(h, y1)
    if y1 - y0 >= 4 and x1 - x0 >= 4:
        b, g, r = img[y0:y1, x0:x1].reshape(-1, 3).mean(0)
        out.append((float(r), float(g), float(b)))
    else:
        out.append((np.nan,) * 3)
    return out


def _face_neck_mismatch(session_id: str, analyzers: dict) -> bool:
    """True when, with the neck in view, the face and neck (almost) never show the
    same heart rate (< 5% of 8 s windows within 8 BPM).

    Needs enough windows to be sure: a real person agrees ~10-50% of the time,
    so a short clip can show zero agreement by chance (3 windows: ~44%).
    Live: the last 60 s (~53 windows). Upload: at least 22 s (15 windows)."""
    tr = analyzers.get('rppg_trace', [])
    need = 330 if analyzers['rppg'].source == 'upload' else 900
    if len(tr) < need:
        return False
    x = np.array(tr[-900:], dtype=np.float64)
    if x[-1, 0] - x[0, 0] > 90.0 or np.mean(~np.isnan(x[:, 14])) < 0.8:
        return False                      # gaps in the stream, or neck not in view
    try:
        from scipy.signal import butter, filtfilt

        def fill(m):
            m = m.copy()
            for c in range(m.shape[1]):
                v = m[:, c]; bad = np.isnan(v)
                if bad.all():
                    return None
                if bad.any():
                    v[bad] = np.interp(np.flatnonzero(bad), np.flatnonzero(~bad), v[~bad])
            return m

        def pos(rgb):
            C = rgb / rgb.mean(0)
            S1 = C[:, 1] - C[:, 2]; S2 = C[:, 1] + C[:, 2] - 2 * C[:, 0]
            return S1 + (S1.std() / (S2.std() + 1e-12)) * S2

        face, neck = fill(x[:, 1:4]), fill(x[:, 14:17])
        if face is None or neck is None:
            return False
        fs = RPPG_CROP_FS
        b, a = butter(3, [0.7 / (fs / 2), 3.0 / (fs / 2)], btype='band')
        f = np.fft.rfftfreq(2048, 1 / fs); band = (f >= 0.7) & (f <= 3.0)
        n = int(8 * fs); agree = []
        for s in range(0, len(x) - n + 1, int(fs)):
            hf = filtfilt(b, a, pos(face[s:s + n])); hn = filtfilt(b, a, pos(neck[s:s + n]))
            pf = np.abs(np.fft.rfft(hf, 2048))[band]; pn = np.abs(np.fft.rfft(hn, 2048))[band]
            agree.append(abs(f[band][np.argmax(pf)] - f[band][np.argmax(pn)]) * 60 <= 8)
        frac = float(np.mean(agree))
        if time.time() - analyzers.get('_fn_log_at', 0.0) >= 10.0:
            analyzers['_fn_log_at'] = time.time()
            print(f"[rPPG] {session_id} face-neck same heart rate in {frac:.0%} of {len(agree)} windows")
        flagged = frac < 0.05
        if flagged:
            print(f"[rPPG] {session_id} face-neck MISMATCH ({frac:.0%} agreement)"
                  f"{'' if FACE_NECK_SCORING else ' - shadow mode, not scored'}")
        # Shadow mode by default: logged, not scored, until validated on live
        # sessions (set DV_FACE_NECK_SCORING=1 to let it cost rPPG points).
        return flagged and FACE_NECK_SCORING
    except Exception as e:
        print(f"[rPPG] face-neck check error: {e}")
        return False


# Skin landmarks for the blood-flow map: forehead, cheeks, nose, chin/jaw
PERFUSION_LMS = [10, 67, 109, 338, 297, 151, 108, 337, 69, 299,
                 116, 117, 118, 119, 123, 147, 187, 205, 50, 36,
                 345, 346, 347, 348, 352, 376, 411, 425, 280, 266,
                 5, 4, 195, 197, 152, 175, 199, 200, 32, 262]


def _patch_rgbs(img, landmarks):
    """Mean (R, G, B) of a small square patch around each PERFUSION_LMS landmark."""
    h, w = img.shape[:2]
    fw = abs(landmarks[454].x - landmarks[234].x) * w
    r = max(2, int(0.035 * fw))
    out = np.full((len(PERFUSION_LMS), 3), np.nan)
    for k, idx in enumerate(PERFUSION_LMS):
        x, y = int(landmarks[idx].x * w), int(landmarks[idx].y * h)
        if r <= x < w - r and r <= y < h - r:
            out[k] = img[y - r:y + r, x - r:x + r].reshape(-1, 3).mean(0)[::-1]
    return out


def _save_rppg_trace(session_id: str, source: str):
    """Write the session's skin-colour trace to uploads/rppg_traces/<session>.npz
    (columns: time, R, G, B, face_found, then R,G,B for forehead, left cheek,
    right cheek, neck). Used to evaluate rPPG on real test
    sessions: live people vs a deepfake replayed on a screen in front of a webcam."""
    a = _session_analyzers.get(session_id)
    if not a or len(a.get('rppg_trace', [])) < 150:
        return
    try:
        import os
        os.makedirs('uploads/rppg_traces', exist_ok=True)
        path = f'uploads/rppg_traces/{session_id}.npz'
        np.savez(path, trace=np.array(a['rppg_trace'], dtype=np.float64),
                 patches=np.array(a.get('rppg_patches', []), dtype=np.float32),
                 source=source, fps=RPPG_CROP_FS)
        print(f"[rPPG] saved {len(a['rppg_trace'])} trace samples to {path}")
    except Exception as e:
        print(f"[rPPG] could not save trace: {e}")


def _ingest_rppg(analyzers: dict, rppg_result, thresholds: dict):
    """Store an rPPG window result (from either input stream)."""
    if not rppg_result:
        return
    analyzers['last_snr'] = float(rppg_result['snr_db'])
    if 'heart_rate_bpm' in rppg_result and rppg_result['heart_rate_bpm'] > 0:
        analyzers['last_hr_bpm'] = float(rppg_result['heart_rate_bpm'])
    analyzers['last_amplitude'] = float(rppg_result.get('amplitude', analyzers['last_amplitude']))
    analyzers['last_scr'] = float(rppg_result.get('scr', analyzers['last_scr']))
    analyzers['last_flatness'] = float(rppg_result.get('spectral_flatness', analyzers['last_flatness']))
    # Per-window verdict history: plausible pulse in this window or not.
    hr_raw = float(rppg_result.get('raw_hr_bpm', rppg_result.get('heart_rate_bpm', 0.0)) or 0.0)
    good = (float(rppg_result['snr_db']) >= float(thresholds.get('snr_beta', 3.0))
            and 42.0 <= hr_raw <= 150.0
            and float(rppg_result.get('scr', 0.0)) >= 0.30
            and float(rppg_result.get('spectral_flatness', 1.0)) <= 0.75)
    hist = analyzers.setdefault('rppg_good_hist', [])
    hist.append((time.time(), 1 if good else 0))
    if len(hist) > 6000:
        del hist[:2000]


def _process_rppg_crop(jpeg: bytes, analyzers: dict, thresholds: dict):
    """Native-resolution face crop (~15 fps) -> skin patches -> rPPG."""
    crop = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if crop is None or crop.shape[0] < 24 or crop.shape[1] < 24:
        return
    analyzers['last_rppg_crop_at'] = time.time()
    if analyzers.get('crop_mesh') is None:
        analyzers['crop_mesh'] = make_yaw_estimator() or False
    landmarks = []
    if analyzers['crop_mesh']:
        try:
            analyzers['crop_mesh'](crop)
            landmarks = analyzers['crop_mesh'].last_landmarks or []
        except Exception:
            landmarks = []
    now = time.time()
    rgb = skin_patch_rgb(crop, landmarks) if landmarks else None
    if rgb is None:
        # Face not found in this crop. Mixing in a non-skin region would create a
        # colour jump that reads as "no pulse", so hold the last skin value through
        # a brief miss, and restart cleanly after a longer one.
        last = analyzers.get('_last_crop_rgb')
        if last is not None and now - last[1] <= 1.0:
            rgb = last[0]
        else:
            analyzers['rppg_crop'].rgb_buffer = []
            return
    else:
        analyzers['_last_crop_rgb'] = (rgb, now)
    # Keep the raw skin-colour traces (combined, per region, and neck): used by the
    # face-neck pulse check and saved so recorded test sessions can be analysed.
    tr = analyzers.setdefault('rppg_trace', [])
    if len(tr) < 15 * 60 * 30:          # cap: 30 minutes at 15 fps
        regions = _region_rgbs(crop, landmarks) if landmarks else [(np.nan,) * 3] * 4
        tr.append((now, rgb[0], rgb[1], rgb[2], 1.0 if landmarks else 0.0,
                   *[v for reg in regions for v in reg]))
        # 40-patch blood-flow map (shadow data for spatial rPPG methods)
        pt = analyzers.setdefault('rppg_patches', [])
        pt.append(_patch_rgbs(crop, landmarks) if landmarks else np.full((len(PERFUSION_LMS), 3), np.nan))
    _ingest_rppg(analyzers, analyzers['rppg_crop'].add_rgb(*rgb), thresholds)


def _rppg_good_frac(analyzers: dict):
    """Share of rPPG windows with a plausible pulse: whole clip for uploads,
    the last 15 s for live sessions (needs >= 10 s of data). None until enough data."""
    hist = analyzers.get('rppg_good_hist', [])
    if analyzers['rppg'].source != 'upload':
        now = time.time()
        hist = [h for h in hist if now - h[0] <= 15.0]
        if len(hist) < 30 or hist[-1][0] - hist[0][0] < 10.0:
            return None
    elif len(hist) < 20:
        return None
    return sum(g for _, g in hist) / len(hist)


def _request_liveness(analyzers: dict):
    """A passive check flagged something.
    Demo pages: challenge right away (original behaviour). Interviews: the
    interviewer starts checks (the alert text suggests it); just queue an AI face check."""
    if analyzers.get('is_demo'):
        lm = analyzers.get('liveness')
        if lm is not None and getattr(lm, 'enabled', False):
            lm.request_now()
    _request_ai_face_check(analyzers, 'anomaly')


def _request_ai_face_check(analyzers: dict, reason: str):
    """Queue one AI face check (snapshot), within the per-session budget."""
    from modules.ai_face_check import enabled as _ai_enabled
    af = analyzers.get('ai_face')
    if af is None or not _ai_enabled() or af['want']:
        return
    if af['checks'] >= AI_FACE_MAX_PER_SESSION or time.time() - af['last_at'] < AI_FACE_MIN_GAP:
        return
    af['want'] = reason
    af['pending_since'] = 0.0


async def _run_ai_face_check(session_id: str, jpeg: bytes, analyzers: dict):
    """Send the snapshot to Sightengine (deepfake + genai) and report the result."""
    from modules.ai_face_check import check_face_image
    af = analyzers.get('ai_face')
    if af is None or not af['want'] or len(jpeg) < 1000:
        return
    reason = af['want']
    af['want'] = None
    af['checks'] += 1
    af['last_at'] = time.time()
    r = await asyncio.to_thread(check_face_image, jpeg)
    if not r.get('ok'):
        print(f"[AIFace] {session_id} check failed: {r.get('error')}")
        return
    df = float(r.get('deepfake') or 0.0); ai = float(r.get('ai_generated') or 0.0)
    flagged = df >= AI_DEEPFAKE_FLAG or ai >= AI_GENAI_FLAG
    print(f"[AIFace] {session_id} ({reason}) deepfake={df:.3f} ai_generated={ai:.3f} -> {'FLAG' if flagged else 'ok'} "
          f"(check {af['checks']}/{AI_FACE_MAX_PER_SESSION})")
    if flagged:
        af['flag'] = True
        try:
            from api.routes.ws_handlers import _get_telemetry
            _get_telemetry(session_id)['ai_face_fake'] = True
        except Exception:
            pass
        what = 'swapped / AI-modified' if df >= AI_DEEPFAKE_FLAG else 'AI-generated'
        alert = _make_alert('AI_FACE_FAKE', 'HIGH', 'AI_FACE',
                            f'AI face check: the face appears {what} (deepfake {df:.2f}, AI-generated {ai:.2f})',
                            max(df, ai))
    else:
        alert = _make_alert('AI_FACE_OK', 'LOW', 'AI_FACE',
                            f'AI face check passed (deepfake {df:.2f}, AI-generated {ai:.2f})', max(df, ai))
    alert['type'] = 'ALERT'
    try:
        await publish_alert(session_id, alert)
        await get_alerts_collection().insert_one({'session_id': session_id, **{k: v for k, v in alert.items() if k != 'type'}})
    except Exception as e:
        print(f"[AIFace] Could not publish alert: {e}")


async def _start_liveness(session_id: str, analyzers: dict, origin: str) -> str:
    """Queue a liveness check; it is issued on the candidate's next frame."""
    lm = analyzers.get('liveness')
    if lm is None or not getattr(lm, 'enabled', False):
        return 'unavailable'
    res = lm.request_now(origin=origin)
    if res == 'started':
        await _publish_liveness_status(session_id, {'state': 'requested', 'origin': origin})
    return res


async def request_liveness_from_interviewer(session_id: str) -> str:
    """Interviewer's "Run liveness check" button.
    Returns 'started', 'busy', 'unavailable' or 'no_candidate'."""
    analyzers = _session_analyzers.get(session_id)
    if analyzers is None:
        return 'no_candidate'
    # Liveness checks are switched off for interviews (demo pages only).
    return 'unavailable'


async def _publish_liveness_status(session_id: str, data: dict):
    """Live liveness state for the interviewer dashboard (not an alert)."""
    try:
        await publish_trust_score(session_id, {'type': 'LIVENESS_STATUS',
                                               'timestamp': datetime.utcnow().isoformat(), **data})
    except Exception as e:
        print(f"[Liveness] Could not publish status: {e}")


async def _emit_liveness(session_id: str, websocket, msgs: list, analyzers: dict, thresholds: dict):
    """Send liveness messages to the candidate and turn results into alerts."""
    for m in msgs:
        # The check asks for head turns: keep the gaze module from flagging them.
        try:
            from api.routes.ws_handlers import _get_telemetry
            _get_telemetry(session_id)['_liveness_quiet_until'] = time.time() + 6.0
        except Exception:
            pass
        try:
            await websocket.send_json(m)
        except Exception:
            pass
        try:
            await _handle_liveness_event(session_id, m, analyzers, thresholds)
        except Exception as e:
            print(f"[Liveness] Event handling error: {e}")


_ORIGIN_TEXT = {'start': 'start-of-interview', 'interviewer': 'interviewer-requested',
                'demo': 'demo', 'auto': 'automatic'}


async def _handle_liveness_event(session_id: str, msg: dict, analyzers: dict, thresholds: dict):
    """Turn liveness events into dashboard alerts, status and the trust-score flag.

    Never stops or blocks the interview: the interviewer is informed and decides.
    """
    t = msg.get('type')
    if t == 'LIVENESS_PROGRESS':
        return
    lm = analyzers['liveness']
    if t == 'LIVENESS_CHALLENGE':
        if msg.get('step') == 1:
            await _publish_liveness_status(session_id, {
                'state': 'active', 'origin': msg.get('origin'),
                'wrong_attempts': msg.get('wrong_attempts', 0),
                'challenge_id': msg.get('challenge_id')})
        return

    kind = _ORIGIN_TEXT.get(msg.get('origin') or '', '')
    if t == 'LIVENESS_CHECK_FAILED':
        alert_type, severity, failed, state = 'LIVENESS_FAIL', 'CRITICAL', True, 'failed'
        text = (f"Liveness check ({kind}) FAILED: {msg.get('wrong_attempts')} wrong-direction attempts "
                f"- last one: {msg.get('reason', '')}. Possible pre-recorded, AI-generated or injected video. "
                f"The check is still open - the candidate may keep trying or close it.")
    elif t == 'LIVENESS_CHALLENGE_RESULT' and msg.get('skipped'):
        alert_type, severity, failed, state = 'LIVENESS_SKIPPED', 'HIGH', True, 'skipped'
        text = (f"Candidate closed the {kind} liveness check without completing it"
                f"{' after ' + str(msg.get('wrong_attempts')) + ' wrong attempts' if msg.get('wrong_attempts') else ''}. "
                f"You can run another check from the dashboard.")
    elif t == 'LIVENESS_CHALLENGE_RESULT' and msg.get('passed'):
        failed, state = False, 'passed'
        wrong = int(msg.get('wrong_attempts') or 0)
        react = msg.get('reaction_s')
        timing = f"average reaction {react:.1f}s" if isinstance(react, (int, float)) else ''
        if wrong:
            alert_type, severity = 'LIVENESS_PASS', 'MEDIUM'
            text = (f"Liveness check ({kind}) passed after {wrong} wrong-direction attempt"
                    f"{'s' if wrong != 1 else ''} ({timing}, {msg.get('total_s')}s total).")
        else:
            alert_type, severity = 'LIVENESS_PASS', 'LOW'
            text = f"Liveness check ({kind}) passed - random head turns verified ({timing})."
    else:
        return

    analyzers['liveness_failed'] = failed
    if failed:
        _request_ai_face_check(analyzers, 'liveness_fail')
    try:
        from api.routes.ws_handlers import _get_telemetry
        _get_telemetry(session_id)['liveness_failed'] = failed
    except Exception:
        pass

    await _publish_liveness_status(session_id, {
        'state': state, 'origin': msg.get('origin'),
        'wrong_attempts': msg.get('wrong_attempts', 0),
        'reaction_s': msg.get('reaction_s'), 'challenge_id': msg.get('challenge_id'),
        'passes': lm.passes, 'failures': lm.failures, 'skips': lm.skips})

    aid = str(uuid.uuid4())
    alert = {
        'type': 'ALERT', 'alert_id': aid, 'alertId': aid,
        'alert_type': alert_type, 'alertType': alert_type,
        'module': 'LIVENESS', 'severity': severity,
        'value': float(msg.get('wrong_attempts') or 0),
        'timestamp': datetime.utcnow().isoformat(), 'acknowledged': False,
        'message': text, 'description': text,
    }
    try:
        await publish_alert(session_id, alert)
        await get_alerts_collection().insert_one({'session_id': session_id, **{k: v for k, v in alert.items() if k != 'type'}})
    except Exception as e:
        print(f"[Liveness] Could not publish alert: {e}")
    # Update the trust gauge right away rather than waiting for the next fusion tick
    analyzers['last_fusion_time'] = time.time()
    await _run_fusion(session_id, analyzers, thresholds)


async def _handle_liveness_event_demo(session_id: str, msg: dict, analyzers: dict, thresholds: dict):
    """Demo pages only (original, unchanged): challenge result -> alert + trust-score effect."""
    if msg.get('type') != 'LIVENESS_CHALLENGE_RESULT':
        return
    lm = analyzers['liveness']
    if msg.get('passed'):
        alert_type, severity = 'LIVENESS_PASS', 'LOW'
        text = f'Active liveness check passed (random head turns verified) — {lm.passes} passed so far'
        failed = False
    elif msg.get('final'):
        alert_type, severity = 'LIVENESS_FAIL', 'CRITICAL'
        text = (f"Active liveness check FAILED twice: {msg.get('reason', 'no response')}. "
                f"Possible pre-recorded, AI-generated or injected video.")
        failed = True
    else:
        return  # first miss — candidate gets one retry before anything is flagged

    analyzers['liveness_failed'] = failed
    if failed:
        _request_ai_face_check(analyzers, 'liveness_fail')
    try:
        from api.routes.ws_handlers import _get_telemetry
        _get_telemetry(session_id)['liveness_failed'] = failed
    except Exception:
        pass

    aid = str(uuid.uuid4())
    alert = {
        'type': 'ALERT', 'alert_id': aid, 'alertId': aid,
        'alert_type': alert_type, 'alertType': alert_type,
        'module': 'LIVENESS', 'severity': severity,
        'value': float(lm.passes if not failed else lm.failures),
        'timestamp': datetime.utcnow().isoformat(), 'acknowledged': False,
        'message': text, 'description': text,
    }
    try:
        await publish_alert(session_id, alert)
        await get_alerts_collection().insert_one({'session_id': session_id, **{k: v for k, v in alert.items() if k != 'type'}})
    except Exception as e:
        print(f"[Liveness] Could not publish alert: {e}")
    # Update the trust gauge right away rather than waiting for the next fusion tick
    analyzers['last_fusion_time'] = time.time()
    await _run_fusion(session_id, analyzers, thresholds)


FRAME_STALL_CAMERA_OFF_S = 10.0
FRAME_STALL_CAMERA_OFF_DEMO_S = 3.0   # demo pages: original value, unchanged


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

    elif event_type == 'FRAME_TIMING':
        analyzers['jitter'].add_camera_intervals(msg.get('intervals', []), str(msg.get('clock', '')))

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
    # Treat the camera as off only after a LONG gap. On a real two-laptop call the
    # candidate's uplink also carries the WebRTC video, so frame uploads can stall
    # for a few seconds; the old 3s limit flagged a working camera as "turned off"
    # and zeroed PRNU / rPPG / jitter / behavioral. An explicit CAMERA_STATUS
    # from the candidate still switches it off immediately.
    stall_s = FRAME_STALL_CAMERA_OFF_DEMO_S if analyzers.get('is_demo') else FRAME_STALL_CAMERA_OFF_S
    if time.time() - analyzers.get('last_frame_received_at', time.time()) > stall_s:
        is_cam_active = False

    pce_val = analyzers['last_pce']
    snr_val = analyzers['last_snr']
    cv_val = analyzers['last_cv']
    prnu_match_val = analyzers.get('prnu_match')   # None until the PRNU tracker has decided
    ack_set = set()

    try:
        from api.routes.ws_handlers import _get_telemetry
        telemetry = _get_telemetry(session_id)
        if telemetry.get("prnu_excused"):
            pce_val = max(pce_val, thresholds.get('pce_threshold', 45.0) + 5.0)
            prnu_match_val = 1.0
        if telemetry.get("rppg_excused"):
            snr_val = max(snr_val, thresholds.get('snr_beta', 2.0) + 1.0)
        if telemetry.get("jitter_excused"):
            cv_val = min(cv_val, thresholds.get('jitter_gamma', 0.15) * 0.5)
        if telemetry.get("virtual_camera_detected"):
            is_cam_active = False
        ack_set = set(telemetry.get("acknowledged_alerts", []))
    except Exception:
        pass

    pulse_mismatch = _face_neck_mismatch(session_id, analyzers)
    try:
        from api.routes.ws_handlers import _get_telemetry
        _get_telemetry(session_id)['pulse_mismatch'] = pulse_mismatch
    except Exception:
        pass
    result = axiom_fusion_engine(
        pce=pce_val,
        snr_rppg=snr_val,
        cv_jitter=cv_val,
        behavioral_score=behavioral_score,
        thresholds={
            'pce_tau': thresholds.get('pce_threshold', 60.0),
            'snr_beta': thresholds.get('snr_beta', 2.0),
            'jitter_gamma': thresholds.get('jitter_gamma', 0.15),
        },
        camera_active=is_cam_active,
        source=analyzers['rppg'].source,  # Use dynamic source (webrtc vs upload)
        hr_bpm=float(analyzers.get('last_hr_bpm', 72.0)),
        liveness_failed=bool(analyzers.get('liveness_failed', False)),
        prnu_match=prnu_match_val,
        prnu_state=analyzers.get('prnu_state', analyzers['prnu'].state),
        amplitude=float(analyzers.get('last_amplitude', 0.1)),
        scr=float(analyzers.get('last_scr', 0.5)),
        spectral_flatness=float(analyzers.get('last_flatness', 0.3)),
        frame_pixels=int(analyzers.get('last_frame_pixels', 320 * 240)),
        rppg_good_frac=_rppg_good_frac(analyzers),
        pulse_mismatch=pulse_mismatch,
        ai_face_fake=bool(analyzers.get('ai_face', {}).get('flag', False)),
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

    # Publish individual alerts — at most once per alert type per minute, so a
    # persisting condition shows as one alert, not one every 3 seconds.
    now_ts = time.time()
    last_pub = analyzers.setdefault('_alert_last', {})
    fresh = []
    for alert in result.get('alerts', []):
        key = alert.get('alert_type') or alert.get('alertType')
        if now_ts - last_pub.get(key, 0.0) >= 60.0:
            last_pub[key] = now_ts
            fresh.append(alert)
    for alert in fresh:
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

    # Log forensic data for calibration model training
    try:
        from modules.forensic_logger import log_frame_analysis
        # Log the RAW measured values, not the interviewer-excused overrides
        # (pce_val/snr_val/cv_val may have been boosted above) — otherwise the
        # training data would teach the model the excusal, not the physics.
        # Skip logging while the camera is off or PRNU is still enrolling,
        # since those rows are placeholders, not measurements.
        if is_cam_active and analyzers.get('last_pce', 0.0) > 0.0:
            await log_frame_analysis(
                session_id=session_id,
                pce=float(analyzers['last_pce']),
                snr_db=float(analyzers['last_snr']),
                hr_bpm=float(analyzers.get('last_hr_bpm', 72.0)),
                amplitude=float(analyzers.get('last_amplitude', 0.1)),
                scr=float(analyzers.get('last_scr', 0.5)),
                spectral_flatness=float(analyzers.get('last_flatness', 0.3)),
                cv_jitter=float(analyzers['last_cv']),
                behavioral_score=behavioral_score,
                frame_pixels=int(analyzers.get('last_frame_pixels', 320 * 240)),
                source=analyzers['rppg'].source,
                trust_score=result['trust_score'],
                calibrated_prob=result.get('calibrated_prob', 1.0),
                extra={
                    'excused': {
                        'prnu': bool(pce_val != analyzers['last_pce']),
                        'rppg': bool(snr_val != analyzers['last_snr']),
                        'jitter': bool(cv_val != analyzers['last_cv']),
                    },
                },
            )
    except Exception:
        pass  # Non-critical — don't break fusion on logging failure

