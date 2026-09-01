"""
WebSocket handlers for real-time candidate telemetry and dashboard updates.

/ws/candidate/{session_id} — Receives gaze/behavioral events from candidate
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


def _get_telemetry(session_id: str) -> dict:
    """Get or create telemetry state for a session."""
    if session_id not in _session_telemetry:
        _session_telemetry[session_id] = {
            "gaze_deltas": [],
            "yaw_readings": [],
            "tab_switches_5min": 0,
            "large_pastes_5min": 0,
            "last_pce": 80.0,
            "last_snr_rppg": 7.0,
            "last_cv_jitter": 0.05,
            "last_hr_bpm": 72.0,
        }
    return _session_telemetry[session_id]


async def _get_session_thresholds(session_id: str) -> dict:
    """Load per-candidate thresholds from MongoDB."""
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        return {"pce_tau": 60.0, "snr_beta": 3.0, "jitter_gamma": 0.15}
    thresholds = doc.get("thresholds", {})
    enrollment = doc.get("enrollment", {})
    # Use per-candidate beta from enrollment if available
    if enrollment.get("snr_baseline"):
        thresholds["snr_beta"] = enrollment["snr_baseline"]
    return thresholds


async def _push_to_dashboard(session_id: str, message: dict):
    """Publish a message to the connected interviewer dashboard via Redis."""
    if message.get("type") == "ALERT":
        await publish_alert(session_id, message)
    else:
        await publish_trust_score(session_id, message)


@router.websocket("/ws/candidate/{session_id}")
async def ws_candidate(websocket: WebSocket, session_id: str):
    """
    Candidate telemetry WebSocket.
    Receives: GAZE, TAB_SWITCH, WINDOW_BLUR, LARGE_PASTE events.
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

            if msg_type == "GAZE":
                delta = msg.get("delta", 0.0)
                yaw = msg.get("yaw", 0.0)
                print(f"[GAZE] session={session_id} delta={delta:.4f} yaw={yaw:.2f} readings={len(telemetry['yaw_readings'])}")
                telemetry["gaze_deltas"].append(delta)
                telemetry["yaw_readings"].append(yaw)
                # Keep last 300 readings (~2.5 min at 500ms)
                telemetry["gaze_deltas"] = telemetry["gaze_deltas"][-300:]
                telemetry["yaw_readings"] = telemetry["yaw_readings"][-300:]

                # Check for extreme head pose (last 3 readings ~ 1.5 seconds)
                recent_3_yaw = telemetry["yaw_readings"][-3:]
                is_head_turn = False
                avg_yaw = 0.0
                if len(recent_3_yaw) >= 3:
                    avg_yaw = sum(abs(y) for y in recent_3_yaw) / len(recent_3_yaw)
                    if avg_yaw > 10.0:  # Lowered threshold to account for normalized landmark scale
                        is_head_turn = True

                # Check for sustained gaze anomaly (last 10 readings ~ 5 seconds)
                recent_10_delta = telemetry["gaze_deltas"][-10:]
                is_gaze_anomaly = False
                avg_delta = 0.0
                if len(recent_10_delta) >= 10:
                    avg_delta = sum(recent_10_delta) / len(recent_10_delta)
                    if avg_delta > 0.15:  # Lowered threshold
                        is_gaze_anomaly = True
                    
                if is_head_turn or is_gaze_anomaly:
                    # Only fire alert once per burst (cooldown via counter)
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
                        telemetry["_gaze_alert_cooldown"] = 10  # ~5 seconds cooldown
                    else:
                        telemetry["_gaze_alert_cooldown"] = gaze_alert_count - 1
                elif telemetry.get("_gaze_alert_cooldown", 0) > 0:
                    telemetry["_gaze_alert_cooldown"] -= 1

            elif msg_type == "TAB_SWITCH":
                telemetry["tab_switches_5min"] += 1
                # Store event
                events_col = get_behavioral_events_collection()
                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "TAB_SWITCH",
                    "timestamp": timestamp,
                    "metadata": msg.get("metadata", {}),
                })
                # Push immediate alert to dashboard
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
                events_col = get_behavioral_events_collection()
                duration_ms = msg.get("duration_ms", 0)
                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "WINDOW_BLUR",
                    "timestamp": timestamp,
                    "metadata": {"duration_ms": duration_ms},
                })
                # Alert if blur was long (> 3 seconds)
                if duration_ms > 3000:
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
                events_col = get_behavioral_events_collection()
                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "LARGE_PASTE",
                    "timestamp": timestamp,
                    "metadata": {"char_count": char_count},
                })
                # Push immediate alert
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

            elif msg_type == "FRAME_METRICS":
                # Updated from frame analysis pipeline
                if "pce" in msg:
                    telemetry["last_pce"] = msg["pce"]
                if "snr_rppg" in msg:
                    telemetry["last_snr_rppg"] = msg["snr_rppg"]
                if "cv_jitter" in msg:
                    telemetry["last_cv_jitter"] = msg["cv_jitter"]
                if "hr_bpm" in msg:
                    telemetry["last_hr_bpm"] = msg["hr_bpm"]

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            # Run Axiom fusion and push to dashboard
            thresholds = await _get_session_thresholds(session_id)

            # Compute behavioral score
            from modules.behavioral import compute_behavioral_score
            behavioral_score = compute_behavioral_score(telemetry, {
                "lambda_gaze": thresholds.get("behavioral_lambda", 0.22),
            })

            result = axiom_fusion_engine(
                pce=telemetry["last_pce"],
                snr_rppg=telemetry["last_snr_rppg"],
                cv_jitter=telemetry["last_cv_jitter"],
                behavioral_score=behavioral_score,
                thresholds=thresholds,
            )

            # Push trust update to dashboard
            trust_update = {
                "type": "TRUST_UPDATE",
                "trust_score": result["trust_score"],
                "breakdown": result["breakdown"],
                "raw": {
                    "pce": telemetry["last_pce"],
                    "snr_rppg": telemetry["last_snr_rppg"],
                    "cv_jitter": telemetry["last_cv_jitter"],
                    "behavioral_score": behavioral_score,
                    "hr_bpm": telemetry["last_hr_bpm"],
                },
                "timestamp": timestamp.isoformat(),
            }
            await _push_to_dashboard(session_id, trust_update)

            # Push Axiom-generated alerts (PRNU/rPPG/Jitter threshold breaches)
            for alert in result.get("alerts", []):
                alert_msg = {
                    "type": "ALERT",
                    "alertId": alert.get("alert_id", str(id(alert))),
                    "alertType": alert["type"],
                    "module": alert["module"],
                    "severity": alert["severity"],
                    "description": _get_alert_description(alert["type"]),
                    "value": alert["value"],
                    "timestamp": timestamp.isoformat(),
                }
                await _push_to_dashboard(session_id, alert_msg)

                # Store alert in DB
                alerts_col = get_alerts_collection()
                await alerts_col.insert_one({
                    "session_id": session_id,
                    **alert_msg,
                    "acknowledged": False,
                })

            # Store telemetry entry (throttled — every 5th message)
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
        # Notify dashboard
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
        "TAB_SWITCH": "Candidate switched to another tab/window",
        "LARGE_PASTE": "Large text paste detected in code editor",
        "WINDOW_BLUR": "Candidate's window lost focus for extended period",
        "PRNU_PASS": "Camera fingerprint verified — authentic device confirmed",
        "RPPG_PASS": "Biological pulse confirmed — live human present",
        "PRNU_WARN": "Camera fingerprint quality degraded — monitoring",
    }
    return descriptions.get(alert_type, f"Alert: {alert_type}")
