"""
WebSocket handlers for real-time candidate telemetry and dashboard updates.

/ws/candidate/{session_id} — Receives gaze/behavioral/integrity events from candidate
/ws/dashboard/{session_id} — Pushes trust updates + alerts to interviewer
"""
import json
import asyncio
from typing import Dict, Optional
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from db.mongo import get_sessions_collection, get_telemetry_collection, get_alerts_collection, get_behavioral_events_collection
from modules.axiom import axiom_fusion_engine

router = APIRouter()

from db.redis_client import publish_trust_score, publish_alert

# Active candidate connections: session_id -> WebSocket
_candidate_connections: Dict[str, WebSocket] = {}

# Telemetry state per session (in-memory for speed)
_session_telemetry: Dict[str, dict] = {}

# Code editor state per session
_session_code: Dict[str, dict] = {}


def get_session_code(session_id: str) -> dict:
    """Get latest code state for a session."""
    return _session_code.get(session_id, {
        "code": "",
        "language": "python",
        "timestamp": datetime.utcnow().isoformat(),
    })


def _get_telemetry(session_id: str) -> dict:
    """Get or create telemetry state for a session."""
    if session_id not in _session_telemetry:
        _session_telemetry[session_id] = {
            "gaze_deltas": [],
            "yaw_readings": [],
            "tab_switches_5min": 0,
            "large_pastes_5min": 0,
            "multi_faces_5min": 0,
            "prohibited_objects_5min": 0,
            "absences_5min": 0,
            "multi_monitors_5min": 0,
            "last_pce": 0.0,
            "last_snr_rppg": 0.0,
            "last_cv_jitter": 0.05,
            "last_hr_bpm": 72.0,
            "face_count": 1,
            "camera_active": True,
            "virtual_camera_detected": False,
            "acknowledged_alerts": [],
            "prnu_excused": False,
            "rppg_excused": False,
            "jitter_excused": False,
            "_gaze_alert_cooldown": 0,
            "_multiface_alert_cooldown": 0,
            "_absence_alert_cooldown": 0,
            "_object_alert_cooldown": 0,
            "_reflection_alert_cooldown": 0,
            "_monitor_alert_cooldown": 0,
        }
    return _session_telemetry[session_id]


async def _get_session_thresholds(session_id: str) -> dict:
    """Load per-candidate thresholds from MongoDB."""
    try:
        collection = get_sessions_collection()
        doc = await collection.find_one({"session_id": session_id})
        if not doc:
            return {"pce_tau": 60.0, "snr_beta": 3.0, "jitter_gamma": 0.15}
        thresholds = doc.get("thresholds", {})
        enrollment = doc.get("enrollment", {})
        if enrollment.get("snr_baseline"):
            thresholds["snr_beta"] = enrollment["snr_baseline"]
        if "pce_tau" not in thresholds or thresholds.get("pce_tau", 0) < 25.0:
            thresholds["pce_tau"] = 45.0
        return thresholds
    except Exception:
        return {"pce_tau": 60.0, "snr_beta": 3.0, "jitter_gamma": 0.15}


async def revert_anomaly_penalty(session_id: str, alert_id: str, alert_doc: Optional[dict] = None) -> dict:
    """
    When an interviewer acknowledges an anomaly/issue, it is marked as a False Positive / Excused.
    This function reverses the score penalty, decrements anomaly counters, recalculates the
    multi-modal trust score, and broadcasts the restored score to the dashboard.
    """
    telemetry = _get_telemetry(session_id)
    ack_list = telemetry.setdefault("acknowledged_alerts", [])
    if alert_id not in ack_list:
        ack_list.append(alert_id)

    alert_type = ""
    module_name = ""
    if alert_doc:
        alert_type = (alert_doc.get("alert_type") or alert_doc.get("alertType") or "").upper()
        module_name = (alert_doc.get("module") or "").upper()

    # Decrement specific violation counts
    if "FACE" in alert_type or "FACE" in alert_id.upper():
        telemetry["multi_faces_5min"] = max(0, telemetry.get("multi_faces_5min", 0) - 1)
    elif "PROHIBITED" in alert_type or "OBJECT" in alert_type or "OBJ" in alert_id.upper() or "PHONE" in alert_type:
        telemetry["prohibited_objects_5min"] = max(0, telemetry.get("prohibited_objects_5min", 0) - 1)
    elif "ABSEN" in alert_type or "ABSENCE" in alert_id.upper():
        telemetry["absences_5min"] = max(0, telemetry.get("absences_5min", 0) - 1)
    elif "MONITOR" in alert_type or "SCREEN" in alert_type:
        telemetry["multi_monitors_5min"] = max(0, telemetry.get("multi_monitors_5min", 0) - 1)
    elif "CLIPBOARD" in alert_type or "PASTE" in alert_type:
        telemetry["large_pastes_5min"] = max(0, telemetry.get("large_pastes_5min", 0) - 1)
    elif "TAB" in alert_type or "BLUR" in alert_type or "SWITCH" in alert_type:
        telemetry["tab_switches_5min"] = max(0, telemetry.get("tab_switches_5min", 0) - 1)
    elif "GAZE" in alert_type or "EYE" in alert_type:
        telemetry["gaze_deltas"] = telemetry.get("gaze_deltas", [])[:-15]
        telemetry["yaw_readings"] = telemetry.get("yaw_readings", [])[:-10]
    elif "VIRTUAL" in alert_type or "OBS" in alert_type:
        telemetry["virtual_camera_detected"] = False

    if module_name == "PRNU" or "FINGERPRINT" in alert_type or "PRNU" in alert_type or "PRNU" in alert_id.upper():
        telemetry["prnu_excused"] = True
    elif module_name == "RPPG" or "PULSE" in alert_type or "LIVENESS" in alert_type or "RPPG" in alert_type:
        telemetry["rppg_excused"] = True
    elif module_name == "JITTER" or "RENDERING" in alert_type or "CADENCE" in alert_type or "JITTER" in alert_type:
        telemetry["jitter_excused"] = True

    # Recalculate score immediately
    thresholds = await _get_session_thresholds(session_id)
    from modules.behavioral import compute_behavioral_score
    behavioral_score = compute_behavioral_score(telemetry, {
        "lambda_gaze": thresholds.get("behavioral_lambda", 0.22),
    })

    pce_val = telemetry["last_pce"]
    if telemetry.get("prnu_excused"):
        pce_val = max(pce_val, thresholds.get("pce_tau", 60.0) + 5.0)

    snr_val = telemetry["last_snr_rppg"]
    if telemetry.get("rppg_excused"):
        snr_val = max(snr_val, thresholds.get("snr_beta", 3.0) + 1.0)

    cv_val = telemetry["last_cv_jitter"]
    if telemetry.get("jitter_excused"):
        cv_val = min(cv_val, thresholds.get("jitter_gamma", 0.15) * 0.5)

    cam_active = telemetry.get("camera_active", True)
    if telemetry.get("virtual_camera_detected", False):
        cam_active = False

    result = axiom_fusion_engine(
        pce=pce_val,
        snr_rppg=snr_val,
        cv_jitter=cv_val,
        behavioral_score=behavioral_score,
        thresholds=thresholds,
        camera_active=cam_active,
    )

    # Filter out acknowledged alerts from list
    ack_set = set(telemetry.get("acknowledged_alerts", []))
    result["alerts"] = [
        a for a in result.get("alerts", [])
        if a.get("alert_id") not in ack_set and a.get("alertId") not in ack_set
    ]

    trust_update = {
        "type": "TRUST_UPDATE",
        "trust_score": result["trust_score"],
        "breakdown": result["breakdown"],
        "raw": {
            "pce": pce_val,
            "snr_rppg": snr_val,
            "cv_jitter": cv_val,
            "behavioral_score": behavioral_score,
            "hr_bpm": telemetry["last_hr_bpm"],
            "face_count": telemetry.get("face_count", 1),
        },
        "timestamp": datetime.utcnow().isoformat(),
    }

    await _push_to_dashboard(session_id, trust_update)

    # Publish ALERT_ACKNOWLEDGED event to alert channel
    await publish_alert(session_id, {
        "type": "ALERT_ACKNOWLEDGED",
        "alert_id": alert_id,
        "alertId": alert_id,
        "new_score": result["trust_score"],
        "breakdown": result["breakdown"],
    })

    # Store updated telemetry in mongo
    try:
        telemetry_col = get_telemetry_collection()
        await telemetry_col.insert_one({
            "session_id": session_id,
            "timestamp": datetime.utcnow(),
            "trust_score": result["trust_score"],
            "breakdown": result["breakdown"],
            "raw": trust_update["raw"],
            "reverted_alert_id": alert_id,
        })
    except Exception:
        pass

    return result


async def _push_to_dashboard(session_id: str, message: dict):
    """Publish a message to the connected interviewer dashboard via Redis."""
    if message.get("type") == "ALERT":
        try:
            alerts_col = get_alerts_collection()
            alert_id = message.get("alertId") or message.get("alert_id")
            existing = await alerts_col.find_one({"$or": [{"alertId": alert_id}, {"alert_id": alert_id}]})
            if not existing:
                await alerts_col.insert_one({
                    "session_id": session_id,
                    "acknowledged": False,
                    **message,
                })
        except Exception as err:
            print(f"[Alert DB Insert Error]: {err}")

        await publish_alert(session_id, message)
    else:
        await publish_trust_score(session_id, message)


@router.websocket("/ws/candidate/{session_id}")
async def ws_candidate(websocket: WebSocket, session_id: str):
    """
    Candidate telemetry WebSocket.
    Receives: GAZE, TAB_SWITCH, WINDOW_BLUR, LARGE_PASTE, PROHIBITED_OBJECT, MULTI_MONITOR, CLIPBOARD_VIOLATION.
    Processes through behavioral module and triggers Axiom fusion.
    """
    await websocket.accept()
    _candidate_connections[session_id] = websocket
    telemetry = _get_telemetry(session_id)

    print(f"[WS] Candidate connected for session {session_id}")

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")
            timestamp = datetime.utcnow()
            events_col = get_behavioral_events_collection()

            if msg_type == "GAZE":
                delta = msg.get("delta", 0.0)
                yaw = msg.get("yaw", 0.0)
                face_count = msg.get("face_count", 1)
                is_absent = msg.get("is_absent", False)
                is_multi_face = msg.get("is_multi_face", False)
                screen_reflection = msg.get("screen_reflection", {})

                telemetry["gaze_deltas"].append(delta)
                telemetry["yaw_readings"].append(yaw)
                telemetry["face_count"] = face_count
                telemetry["gaze_deltas"] = telemetry["gaze_deltas"][-300:]
                telemetry["yaw_readings"] = telemetry["yaw_readings"][-300:]

                # 1. Multi-Face Detection Alert
                if is_multi_face or face_count > 1:
                    telemetry["multi_faces_5min"] += 1
                    mf_cooldown = telemetry.get("_multiface_alert_cooldown", 0)
                    if mf_cooldown <= 0:
                        alert_msg = {
                            "type": "ALERT",
                            "alertId": f"multiface-{timestamp.timestamp():.0f}",
                            "alertType": "MULTI_FACE_DETECTED",
                            "module": "BEHAVIORAL",
                            "severity": "CRITICAL",
                            "description": f"Multiple faces detected in camera feed ({face_count} people visible)",
                            "value": face_count,
                            "timestamp": timestamp.isoformat(),
                        }
                        await _push_to_dashboard(session_id, alert_msg)
                        telemetry["_multiface_alert_cooldown"] = 8  # ~4 seconds cooldown
                    else:
                        telemetry["_multiface_alert_cooldown"] = mf_cooldown - 1
                elif telemetry.get("_multiface_alert_cooldown", 0) > 0:
                    telemetry["_multiface_alert_cooldown"] -= 1

                # 2. Candidate Absence Alert
                if is_absent or face_count == 0:
                    telemetry["absences_5min"] += 1
                    abs_cooldown = telemetry.get("_absence_alert_cooldown", 0)
                    if abs_cooldown <= 0:
                        alert_msg = {
                            "type": "ALERT",
                            "alertId": f"absence-{timestamp.timestamp():.0f}",
                            "alertType": "CANDIDATE_ABSENCE",
                            "module": "BEHAVIORAL",
                            "severity": "HIGH",
                            "description": "Candidate face not detected in camera frame",
                            "value": 0,
                            "timestamp": timestamp.isoformat(),
                        }
                        await _push_to_dashboard(session_id, alert_msg)
                        telemetry["_absence_alert_cooldown"] = 8
                    else:
                        telemetry["_absence_alert_cooldown"] = abs_cooldown - 1
                elif telemetry.get("_absence_alert_cooldown", 0) > 0:
                    telemetry["_absence_alert_cooldown"] -= 1

                # 3. Screen Reflection Detection Alert
                if screen_reflection.get("detected", False):
                    ref_cooldown = telemetry.get("_reflection_alert_cooldown", 0)
                    if ref_cooldown <= 0:
                        glare_val = screen_reflection.get("glareRatio", 0.0)
                        alert_msg = {
                            "type": "ALERT",
                            "alertId": f"reflection-{timestamp.timestamp():.0f}",
                            "alertType": "SCREEN_REFLECTION",
                            "module": "BEHAVIORAL",
                            "severity": "MEDIUM",
                            "description": f"Specular glare / secondary screen reflection detected on glasses ({glare_val:.0%})",
                            "value": glare_val,
                            "timestamp": timestamp.isoformat(),
                        }
                        await _push_to_dashboard(session_id, alert_msg)
                        telemetry["_reflection_alert_cooldown"] = 12
                    else:
                        telemetry["_reflection_alert_cooldown"] = ref_cooldown - 1
                elif telemetry.get("_reflection_alert_cooldown", 0) > 0:
                    telemetry["_reflection_alert_cooldown"] -= 1

                # 4. Head Pose & Gaze Deviation
                recent_3_yaw = telemetry["yaw_readings"][-3:]
                is_head_turn = False
                avg_yaw = 0.0
                if len(recent_3_yaw) >= 3:
                    avg_yaw = sum(abs(y) for y in recent_3_yaw) / len(recent_3_yaw)
                    if avg_yaw > 10.0:
                        is_head_turn = True

                recent_10_delta = telemetry["gaze_deltas"][-10:]
                is_gaze_anomaly = False
                avg_delta = 0.0
                if len(recent_10_delta) >= 10:
                    avg_delta = sum(recent_10_delta) / len(recent_10_delta)
                    if avg_delta > 0.15:
                        is_gaze_anomaly = True

                if (is_head_turn or is_gaze_anomaly) and not is_absent:
                    gaze_alert_count = telemetry.get("_gaze_alert_cooldown", 0)
                    if gaze_alert_count <= 0:
                        desc = f"Extreme head turn detected ({avg_yaw:.1f}°)" if is_head_turn else f"Sustained off-screen gaze detected (Δ={avg_delta:.3f})"
                        alert_msg = {
                            "type": "ALERT",
                            "alertId": f"gaze-{timestamp.timestamp():.0f}",
                            "alertType": "GAZE_ANOMALY",
                            "module": "BEHAVIORAL",
                            "severity": "HIGH" if is_head_turn else "MEDIUM",
                            "description": desc,
                            "value": round(avg_yaw if is_head_turn else avg_delta, 3),
                            "timestamp": timestamp.isoformat(),
                        }
                        await _push_to_dashboard(session_id, alert_msg)
                        telemetry["_gaze_alert_cooldown"] = 10
                    else:
                        telemetry["_gaze_alert_cooldown"] = gaze_alert_count - 1
                elif telemetry.get("_gaze_alert_cooldown", 0) > 0:
                    telemetry["_gaze_alert_cooldown"] -= 1

            elif msg_type == "PROHIBITED_OBJECT":
                obj_name = msg.get("object", "electronic device")
                score = msg.get("score", 0.8)
                telemetry["prohibited_objects_5min"] += 1

                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "PROHIBITED_OBJECT",
                    "timestamp": timestamp,
                    "metadata": {"object": obj_name, "score": score},
                })

                obj_cooldown = telemetry.get("_object_alert_cooldown", 0)
                if obj_cooldown <= 0:
                    alert_msg = {
                        "type": "ALERT",
                        "alertId": f"obj-{timestamp.timestamp():.0f}",
                        "alertType": "PROHIBITED_OBJECT",
                        "module": "BEHAVIORAL",
                        "severity": "CRITICAL",
                        "description": f"Prohibited item detected: {obj_name.upper()} ({score:.0%} confidence)",
                        "value": score,
                        "timestamp": timestamp.isoformat(),
                    }
                    await _push_to_dashboard(session_id, alert_msg)
                    telemetry["_object_alert_cooldown"] = 6
                else:
                    telemetry["_object_alert_cooldown"] = obj_cooldown - 1

            elif msg_type == "MULTI_MONITOR":
                telemetry["multi_monitors_5min"] += 1
                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "MULTI_MONITOR",
                    "timestamp": timestamp,
                    "metadata": msg,
                })

                mon_cooldown = telemetry.get("_monitor_alert_cooldown", 0)
                if mon_cooldown <= 0:
                    alert_msg = {
                        "type": "ALERT",
                        "alertId": f"monitor-{timestamp.timestamp():.0f}",
                        "alertType": "MULTI_MONITOR_DETECTED",
                        "module": "BEHAVIORAL",
                        "severity": "CRITICAL",
                        "description": "Multiple active displays / monitors detected on candidate workstation",
                        "value": 2.0,
                        "timestamp": timestamp.isoformat(),
                    }
                    await _push_to_dashboard(session_id, alert_msg)
                    telemetry["_monitor_alert_cooldown"] = 15
                else:
                    telemetry["_monitor_alert_cooldown"] = mon_cooldown - 1

            elif msg_type == "CLIPBOARD_VIOLATION":
                action = msg.get("action", msg.get("shortcut", "CLIPBOARD"))
                telemetry["large_pastes_5min"] += 1

                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "CLIPBOARD_VIOLATION",
                    "timestamp": timestamp,
                    "metadata": {"action": action},
                })

                alert_msg = {
                    "type": "ALERT",
                    "alertId": f"clip-{timestamp.timestamp():.0f}",
                    "alertType": "CLIPBOARD_VIOLATION",
                    "module": "BEHAVIORAL",
                    "severity": "MEDIUM",
                    "description": f"Unauthorized clipboard action intercepted ({action})",
                    "value": 1.0,
                    "timestamp": timestamp.isoformat(),
                }
                await _push_to_dashboard(session_id, alert_msg)

            elif msg_type == "CONTEXT_MENU_BLOCKED":
                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "CONTEXT_MENU_BLOCKED",
                    "timestamp": timestamp,
                    "metadata": {},
                })

                alert_msg = {
                    "type": "ALERT",
                    "alertId": f"context-{timestamp.timestamp():.0f}",
                    "alertType": "CONTEXT_MENU_BLOCKED",
                    "module": "BEHAVIORAL",
                    "severity": "LOW",
                    "description": "Candidate attempted right-click context menu (blocked)",
                    "value": 1.0,
                    "timestamp": timestamp.isoformat(),
                }
                await _push_to_dashboard(session_id, alert_msg)

            elif msg_type == "DEVTOOLS_ATTEMPT":
                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "DEVTOOLS_ATTEMPT",
                    "timestamp": timestamp,
                    "metadata": msg,
                })

                alert_msg = {
                    "type": "ALERT",
                    "alertId": f"devtools-{timestamp.timestamp():.0f}",
                    "alertType": "DEVTOOLS_ATTEMPT",
                    "module": "BEHAVIORAL",
                    "severity": "HIGH",
                    "description": "Developer tools keyboard shortcut intercepted",
                    "value": 1.0,
                    "timestamp": timestamp.isoformat(),
                }
                await _push_to_dashboard(session_id, alert_msg)

            elif msg_type == "TAB_SWITCH":
                telemetry["tab_switches_5min"] += 1
                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "TAB_SWITCH",
                    "timestamp": timestamp,
                    "metadata": msg.get("metadata", {}),
                })
                alert_msg = {
                    "type": "ALERT",
                    "alertId": f"tab-{timestamp.timestamp():.0f}",
                    "alertType": "TAB_SWITCH",
                    "module": "BEHAVIORAL",
                    "severity": "HIGH" if telemetry["tab_switches_5min"] >= 3 else "MEDIUM",
                    "description": f"Candidate switched tabs (#{telemetry['tab_switches_5min']} in session)",
                    "value": telemetry["tab_switches_5min"],
                    "timestamp": timestamp.isoformat(),
                }
                await _push_to_dashboard(session_id, alert_msg)

            elif msg_type == "WINDOW_BLUR":
                duration_ms = msg.get("duration_ms", 0)
                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "WINDOW_BLUR",
                    "timestamp": timestamp,
                    "metadata": {"duration_ms": duration_ms},
                })
                if duration_ms > 2000:
                    alert_msg = {
                        "type": "ALERT",
                        "alertId": f"blur-{timestamp.timestamp():.0f}",
                        "alertType": "WINDOW_BLUR",
                        "module": "BEHAVIORAL",
                        "severity": "MEDIUM",
                        "description": f"Window lost focus for {duration_ms/1000:.1f}s",
                        "value": duration_ms / 1000,
                        "timestamp": timestamp.isoformat(),
                    }
                    await _push_to_dashboard(session_id, alert_msg)

            elif msg_type == "LARGE_PASTE":
                telemetry["large_pastes_5min"] += 1
                char_count = msg.get("char_count", 0)
                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "LARGE_PASTE",
                    "timestamp": timestamp,
                    "metadata": {"char_count": char_count},
                })
                alert_msg = {
                    "type": "ALERT",
                    "alertId": f"paste-{timestamp.timestamp():.0f}",
                    "alertType": "LARGE_PASTE",
                    "module": "BEHAVIORAL",
                    "severity": "HIGH",
                    "description": f"Large text paste detected ({char_count} characters)",
                    "value": char_count,
                    "timestamp": timestamp.isoformat(),
                }
                await _push_to_dashboard(session_id, alert_msg)

            elif msg_type == "CODE_CHANGE":
                code_content = msg.get("code", "")
                code_lang = msg.get("language", "python")
                _session_code[session_id] = {
                    "code": code_content,
                    "language": code_lang,
                    "timestamp": timestamp.isoformat(),
                }
                from db.redis_client import publish_code_update
                await publish_code_update(session_id, {
                    "type": "CODE_CHANGE",
                    "code": code_content,
                    "language": code_lang,
                    "timestamp": timestamp.isoformat(),
                })
                continue

            elif msg_type == "VIRTUAL_CAMERA_DETECTED":
                dev_name = msg.get("device", "Virtual Camera / OBS")
                telemetry["virtual_camera_detected"] = True
                alert_msg = {
                    "type": "ALERT",
                    "alertId": f"vircam-{timestamp.timestamp():.0f}",
                    "alertType": "VIRTUAL_CAMERA_DETECTED",
                    "module": "CAMERA",
                    "severity": "CRITICAL",
                    "description": f"Virtual camera / OBS video feed detected: {dev_name}",
                    "value": 1.0,
                    "timestamp": timestamp.isoformat(),
                }
                await _push_to_dashboard(session_id, alert_msg)

            elif msg_type == "VIRTUAL_CAMERA_RESOLVED":
                telemetry["virtual_camera_detected"] = False

            elif msg_type in ("CAMERA_STATUS", "MEDIA_STATUS"):
                cam_active = bool(msg.get("enabled", msg.get("video_enabled", True)))
                telemetry["camera_active"] = cam_active
                if not cam_active:
                    telemetry["last_pce"] = 0.0
                    telemetry["last_snr_rppg"] = -10.0
                    telemetry["last_cv_jitter"] = 0.0
                    telemetry["face_count"] = 0

            elif msg_type == "FRAME_METRICS":
                # Forensic metrics (PCE, rPPG SNR, Jitter) MUST be calculated server-side
                # from actual ingested video frames in frames.py. Disallow client self-reporting.
                pass

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            # Run Axiom fusion and push to dashboard
            thresholds = await _get_session_thresholds(session_id)

            from modules.behavioral import compute_behavioral_score
            behavioral_score = compute_behavioral_score(telemetry, {
                "lambda_gaze": thresholds.get("behavioral_lambda", 0.22),
            })

            pce_val = telemetry["last_pce"]
            if telemetry.get("prnu_excused"):
                pce_val = max(pce_val, thresholds.get("pce_tau", 60.0) + 5.0)

            snr_val = telemetry["last_snr_rppg"]
            if telemetry.get("rppg_excused"):
                snr_val = max(snr_val, thresholds.get("snr_beta", 3.0) + 1.0)

            cv_val = telemetry["last_cv_jitter"]
            if telemetry.get("jitter_excused"):
                cv_val = min(cv_val, thresholds.get("jitter_gamma", 0.15) * 0.5)

            cam_active = telemetry.get("camera_active", True)
            if telemetry.get("virtual_camera_detected", False):
                cam_active = False

            result = axiom_fusion_engine(
                pce=pce_val,
                snr_rppg=snr_val,
                cv_jitter=cv_val,
                behavioral_score=behavioral_score,
                thresholds=thresholds,
                camera_active=cam_active,
            )

            # Filter out acknowledged alerts so they do not continuously re-alert
            ack_set = set(telemetry.get("acknowledged_alerts", []))
            result["alerts"] = [
                a for a in result.get("alerts", [])
                if a.get("alert_id") not in ack_set and a.get("alertId") not in ack_set
            ]

            trust_update = {
                "type": "TRUST_UPDATE",
                "trust_score": result["trust_score"],
                "breakdown": result["breakdown"],
                "raw": {
                    "pce": pce_val,
                    "snr_rppg": snr_val,
                    "cv_jitter": cv_val,
                    "behavioral_score": behavioral_score,
                    "hr_bpm": telemetry["last_hr_bpm"],
                    "face_count": telemetry.get("face_count", 1),
                },
                "timestamp": timestamp.isoformat(),
            }
            await _push_to_dashboard(session_id, trust_update)

            # Store telemetry entry (every 5th message)
            frame_count = telemetry.get("_frame_count", 0) + 1
            telemetry["_frame_count"] = frame_count
            if frame_count % 5 == 0:
                telemetry_col = get_telemetry_collection()
                await telemetry_col.insert_one({
                    "session_id": session_id,
                    "timestamp": timestamp,
                    "trust_score": result["trust_score"],
                    "breakdown": result["breakdown"],
                    "raw": trust_update["raw"],
                })

    except WebSocketDisconnect:
        print(f"[WS] Candidate disconnected from session {session_id}")
        if _candidate_connections.get(session_id) == websocket:
            del _candidate_connections[session_id]
        await _push_to_dashboard(session_id, {
            "type": "STATUS_CHANGE",
            "status": "DISCONNECTED",
            "timestamp": datetime.utcnow().isoformat(),
        })


def _get_alert_description(alert_type: str) -> str:
    """Get human-readable description for an alert type."""
    descriptions = {
        "IDENTITY_FRAUD": "Camera sensor fingerprint mismatch detected — possible device swap",
        "LIVENESS_FAIL": "No biological pulse signal detected — possible synthetic video",
        "DEEPFAKE_RENDERING": "Network jitter pattern consistent with GPU rendering pipeline",
        "ASSISTANCE_FRAUD": "Behavioral pattern suggests external assistance",
        "GAZE_ANOMALY": "Sustained off-screen gaze detected",
        "MULTI_FACE_DETECTED": "Multiple faces detected in camera feed",
        "CANDIDATE_ABSENCE": "Candidate face not detected in camera frame",
        "PROHIBITED_OBJECT": "Prohibited item detected (phone, book, secondary device)",
        "SCREEN_REFLECTION": "Secondary screen reflection / glare detected on glasses",
        "MULTI_MONITOR_DETECTED": "Multiple monitors / displays detected on candidate system",
        "CLIPBOARD_VIOLATION": "Unauthorized copy/paste action intercepted",
        "CONTEXT_MENU_BLOCKED": "Right-click context menu attempt blocked",
        "DEVTOOLS_ATTEMPT": "Developer tools access attempt blocked",
        "TAB_SWITCH": "Candidate switched to another tab/window",
        "LARGE_PASTE": "Large text paste detected in code editor",
        "WINDOW_BLUR": "Candidate's window lost focus for extended period",
        "PRNU_PASS": "Camera fingerprint verified — authentic device confirmed",
        "RPPG_PASS": "Biological pulse confirmed — live human present",
        "PRNU_WARN": "Camera fingerprint quality degraded — monitoring",
    }
    return descriptions.get(alert_type, f"Alert: {alert_type}")
