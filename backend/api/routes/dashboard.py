"""
Interviewer Dashboard WebSocket endpoint.

Subscribes to Redis pub/sub channels for a session and forwards
trust score updates and alerts to the interviewer's dashboard in real-time.
"""
import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from db.redis_client import get_pubsub
from db.mongo import get_sessions_collection, get_telemetry_collection, get_alerts_collection

router = APIRouter()


@router.websocket("/ws/dashboard/{session_id}")
async def websocket_dashboard(websocket: WebSocket, session_id: str):
    """
    WebSocket for interviewer dashboard — streams trust score updates and alerts.

    The interviewer connects here and receives:
    - Trust score updates (every ~3-4 seconds)
    - Alerts (immediately on detection)
    - Session stats

    Data flow: Backend analysis → Redis pub/sub → This WebSocket → Dashboard UI
    """
    await websocket.accept()

    # Verify session exists
    collection = get_sessions_collection()
    session_doc = await collection.find_one({"session_id": session_id})
    if not session_doc:
        await websocket.send_json({"error": "Session not found"})
        await websocket.close(code=4004)
        return

    # Send initial session info
    await websocket.send_json({
        "type": "SESSION_INFO",
        "session_id": session_id,
        "candidate_name": session_doc.get("candidate_name", "Unknown"),
        "status": session_doc.get("status", "PENDING"),
        "created_at": session_doc.get("created_at", "").isoformat() if session_doc.get("created_at") else None,
        "start_time": session_doc.get("start_time", "").isoformat() if session_doc.get("start_time") else None,
    })

    # Send historical telemetry (score history)
    telemetry_col = get_telemetry_collection()
    cursor = telemetry_col.find(
        {"session_id": session_id},
        {"_id": 0, "trust_score": 1, "timestamp": 1, "breakdown": 1}
    ).sort("timestamp", 1).limit(500)

    history = []
    async for entry in cursor:
        history.append({
            "trust_score": entry.get("trust_score", 100),
            "timestamp": entry.get("timestamp", "").isoformat() if entry.get("timestamp") else None,
            "breakdown": entry.get("breakdown", {}),
        })

    if history:
        await websocket.send_json({
            "type": "SCORE_HISTORY",
            "history": history,
        })

    # Send historical alerts
    alerts_col = get_alerts_collection()
    alert_cursor = alerts_col.find(
        {"session_id": session_id},
        {"_id": 0}
    ).sort("timestamp", -1).limit(50)

    existing_alerts = []
    async for alert in alert_cursor:
        # Convert datetime to string for JSON serialization
        if 'timestamp' in alert and hasattr(alert['timestamp'], 'isoformat'):
            alert['timestamp'] = alert['timestamp'].isoformat()
        if 'alert_id' in alert and 'alertId' not in alert:
            alert['alertId'] = alert['alert_id']
        if 'alert_type' in alert and 'alertType' not in alert:
            alert['alertType'] = alert['alert_type']
        if 'message' in alert and 'description' not in alert:
            alert['description'] = alert['message']
        existing_alerts.append(alert)

    if existing_alerts:
        await websocket.send_json({
            "type": "EXISTING_ALERTS",
            "alerts": list(reversed(existing_alerts)),
        })

    # Subscribe to Redis pub/sub for real-time updates
    pubsub = await get_pubsub(session_id)

    try:
        # Run two tasks: listen to Redis and listen to WebSocket (for commands)
        redis_task = asyncio.create_task(_listen_redis(pubsub, websocket, session_id))
        ws_task = asyncio.create_task(_listen_websocket(websocket, session_id))

        # Wait for either to complete (disconnect)
        done, pending = await asyncio.wait(
            [redis_task, ws_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        # Cancel pending tasks
        for task in pending:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    except WebSocketDisconnect:
        print(f"[Dashboard] Interviewer disconnected from session {session_id}")
    finally:
        await pubsub.unsubscribe()
        await pubsub.close()


async def _listen_redis(pubsub, websocket: WebSocket, session_id: str):
    """Listen to Redis pub/sub and forward messages to WebSocket."""
    try:
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get('type') == 'message':
                channel = message.get('channel', '')
                data = message.get('data', '{}')

                try:
                    parsed = json.loads(data) if isinstance(data, str) else data
                except json.JSONDecodeError:
                    parsed = {"raw": data}

                if f'trust_score:{session_id}' in channel:
                    msg_type = parsed.get("type", "TRUST_UPDATE")
                    await websocket.send_json({
                        "type": msg_type,
                        **parsed,
                    })
                elif f'alerts:{session_id}' in channel:
                    msg_type = parsed.get("type", "ALERT")
                    await websocket.send_json({
                        "type": msg_type,
                        **parsed,
                    })

            await asyncio.sleep(0.1)  # Small delay to prevent tight loop
    except (WebSocketDisconnect, Exception):
        pass


async def _listen_websocket(websocket: WebSocket, session_id: str):
    """Listen to WebSocket for commands from the interviewer."""
    try:
        while True:
            data = await websocket.receive_json()
            command = data.get('command', '')

            if command == 'FLAG_SESSION':
                collection = get_sessions_collection()
                await collection.update_one(
                    {"session_id": session_id},
                    {"$set": {"flagged_for_review": True, "status": "FLAGGED"}}
                )
                await websocket.send_json({
                    "type": "COMMAND_ACK",
                    "command": "FLAG_SESSION",
                    "message": "Session flagged for review",
                })

            elif command == 'END_SESSION':
                collection = get_sessions_collection()
                from datetime import datetime
                await collection.update_one(
                    {"session_id": session_id},
                    {"$set": {"status": "COMPLETED", "end_time": datetime.utcnow()}}
                )
                await websocket.send_json({
                    "type": "COMMAND_ACK",
                    "command": "END_SESSION",
                    "message": "Session ended",
                })

            elif command == 'ACK_ALERT':
                alert_id = data.get('alert_id')
                if alert_id:
                    alerts_col = get_alerts_collection()
                    await alerts_col.update_one(
                        {"alert_id": alert_id},
                        {"$set": {"acknowledged": True}}
                    )

    except (WebSocketDisconnect, Exception):
        pass
