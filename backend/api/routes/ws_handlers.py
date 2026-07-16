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

# Active dashboard connections: session_id -> WebSocket
_dashboard_connections: Dict[str, WebSocket] = {}

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
    """Push a message to the connected interviewer dashboard."""
    ws = _dashboard_connections.get(session_id)
    if ws:
        try:
            await ws.send_json(message)
        except Exception:
            pass


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
                telemetry["gaze_deltas"].append(delta)
                telemetry["yaw_readings"].append(yaw)
                # Keep last 300 readings (~2.5 min at 500ms)
                telemetry["gaze_deltas"] = telemetry["gaze_deltas"][-300:]
                telemetry["yaw_readings"] = telemetry["yaw_readings"][-300:]

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

            elif msg_type == "WINDOW_BLUR":
                events_col = get_behavioral_events_collection()
                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "WINDOW_BLUR",
                    "timestamp": timestamp,
                    "metadata": {"duration_ms": msg.get("duration_ms", 0)},
                })

            elif msg_type == "LARGE_PASTE":
                telemetry["large_pastes_5min"] += 1
                events_col = get_behavioral_events_collection()
                await events_col.insert_one({
                    "session_id": session_id,
                    "type": "LARGE_PASTE",
                    "timestamp": timestamp,
                    "metadata": {"char_count": msg.get("char_count", 0)},
                })

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

            # Push alerts if any
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

            # Store telemetry entry
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
        if session_id in _candidate_connections:
            del _candidate_connections[session_id]
        # Notify dashboard
        await _push_to_dashboard(session_id, {
            "type": "STATUS_CHANGE",
            "status": "DISCONNECTED",
            "timestamp": datetime.utcnow().isoformat(),
        })


@router.websocket("/ws/dashboard/{session_id}")
async def ws_dashboard(websocket: WebSocket, session_id: str):
    """
    Dashboard WebSocket.
    Pushes: TRUST_UPDATE (on candidate events) and ALERT events to interviewer.
    """
    await websocket.accept()
    _dashboard_connections[session_id] = websocket

    print(f"[WS] Dashboard connected for session {session_id}")

    # Send initial state (empty — no mock data)
    await websocket.send_json({
        "type": "CONNECTED",
        "session_id": session_id,
        "timestamp": datetime.utcnow().isoformat(),
    })

    try:
        while True:
            # Keep alive — listen for pings and commands
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue

            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg.get("type") == "ACKNOWLEDGE_ALERT":
                alert_id = msg.get("alertId")
                if alert_id:
                    alerts_col = get_alerts_collection()
                    await alerts_col.update_one(
                        {"alertId": alert_id, "session_id": session_id},
                        {"$set": {"acknowledged": True}}
                    )
                    await websocket.send_json({
                        "type": "ALERT_ACKNOWLEDGED",
                        "alertId": alert_id,
                    })

    except WebSocketDisconnect:
        print(f"[WS] Dashboard disconnected from session {session_id}")
        if session_id in _dashboard_connections:
            del _dashboard_connections[session_id]


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
        "PRNU_PASS": "Camera fingerprint verified — authentic device confirmed",
        "RPPG_PASS": "Biological pulse confirmed — live human present",
        "PRNU_WARN": "Camera fingerprint quality degraded — monitoring",
    }
    return descriptions.get(alert_type, f"Alert: {alert_type}")
