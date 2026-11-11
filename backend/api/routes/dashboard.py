"""
Interviewer Dashboard WebSocket endpoint.

Subscribes to Redis pub/sub channels for a session and forwards
trust score updates and alerts to the interviewer's dashboard in real-time.
"""
import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from db.redis_client import get_pubsub
from db.mongo import get_sessions_collection, get_telemetry_collection, get_alerts_collection, get_invitations_collection
from api.routes.ws_handlers import get_session_code, revert_anomaly_penalty
from api.routes import live_bus

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
        await live_bus.safe_send(websocket, {"error": "Session not found"})
        await websocket.close(code=4004)
        return

    # Send initial session info
    await live_bus.safe_send(websocket, {
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
        await live_bus.safe_send(websocket, {
            "type": "SCORE_HISTORY",
            "history": history,
        })

    # Send historical alerts
    alerts_col = get_alerts_collection()
    # Alerts the interviewer cleared from the feed stay in the database (for the
    # report and scoring) but are not re-sent to the live feed.
    alert_cursor = alerts_col.find(
        {"session_id": session_id, "cleared_from_feed": {"$ne": True}},
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
        await live_bus.safe_send(websocket, {
            "type": "EXISTING_ALERTS",
            "alerts": list(reversed(existing_alerts)),
        })

    cleared_count = await alerts_col.count_documents(
        {"session_id": session_id, "cleared_from_feed": True})
    if cleared_count:
        await live_bus.safe_send(websocket, {"type": "ALERTS_CLEARED_COUNT", "count": cleared_count})

    # Send current code editor state if candidate has already typed code
    curr_code = get_session_code(session_id)
    if curr_code and curr_code.get("code"):
        await live_bus.safe_send(websocket, {
            "type": "CODE_CHANGE",
            **curr_code,
        })

    # Register for the in-process fast path (live code sync)
    live_bus.register_dashboard(session_id, websocket)

    # Subscribe to Redis pub/sub for real-time updates
    holder = {'pubsub': await get_pubsub(session_id)}

    try:
        # Run two tasks: listen to Redis and listen to WebSocket (for commands).
        # Neither ends on an error any more - previously ONE exception (a Redis
        # connection drop, a failing DB call in a command) silently closed the
        # interviewer's socket and alerts stopped arriving for the rest of the call.
        redis_task = asyncio.create_task(_listen_redis(holder, websocket, session_id))
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
        live_bus.unregister_dashboard(session_id, websocket)
        try:
            await holder['pubsub'].unsubscribe()
            await holder['pubsub'].close()
        except Exception:
            pass


async def _listen_redis(holder: dict, websocket: WebSocket, session_id: str):
    """Forward Redis pub/sub messages to the interviewer. Survives Redis hiccups:
    on a connection error it re-subscribes instead of giving up."""
    while True:
        try:
            message = await holder['pubsub'].get_message(ignore_subscribe_messages=True, timeout=1.0)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[Dashboard] Redis listener error for {session_id}: {e!r} - re-subscribing")
            try:
                await holder['pubsub'].close()
            except Exception:
                pass
            await asyncio.sleep(1.0)
            try:
                holder['pubsub'] = await get_pubsub(session_id)
            except Exception as e2:
                print(f"[Dashboard] Re-subscribe failed for {session_id}: {e2!r}")
            continue

        if not (message and message.get('type') == 'message'):
            continue
        try:
            channel = message.get('channel', '')
            data = message.get('data', '{}')
            try:
                parsed = json.loads(data) if isinstance(data, str) else data
            except json.JSONDecodeError:
                parsed = {"raw": data}
            if not isinstance(parsed, dict):
                continue

            if f'trust_score:{session_id}' in channel:
                default_type = "TRUST_UPDATE"
            elif f'alerts:{session_id}' in channel:
                default_type = "ALERT"
            elif f'code:{session_id}' in channel:
                default_type = "CODE_CHANGE"
            else:
                continue
            await live_bus.safe_send(websocket, {"type": parsed.get("type", default_type), **parsed})
        except Exception as e:
            print(f"[Dashboard] Could not forward message for {session_id}: {e!r}")
        # No sleep here: get_message(timeout=...) already blocks while idle.


async def _listen_websocket(websocket: WebSocket, session_id: str):
    """Listen to WebSocket for commands from the interviewer. A failing command is
    logged and the socket stays open (it used to close the whole dashboard)."""
    while True:
        try:
            data = await websocket.receive_json()
        except WebSocketDisconnect:
            print(f"[Dashboard] Interviewer disconnected from session {session_id}")
            return
        except (ValueError, TypeError):
            continue            # not JSON - ignore
        except Exception:
            return              # socket closed / broken
        if not isinstance(data, dict):
            continue
        try:
            await _handle_command(websocket, session_id, data)
        except Exception as e:
            import traceback
            print(f"[Dashboard] Command {data.get('command') or data.get('type')} failed for {session_id}: {e!r}")
            traceback.print_exc()


async def _handle_command(websocket: WebSocket, session_id: str, data: dict):
    command = data.get('command', '') or data.get('type', '')

    if command == 'FLAG_SESSION':
        collection = get_sessions_collection()
        await collection.update_one(
            {"session_id": session_id},
            {"$set": {"flagged_for_review": True, "status": "FLAGGED"}}
        )
        await live_bus.safe_send(websocket, {
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
        # Synchronize status to invitations so candidate inbox is cleaned
        invitations_col = get_invitations_collection()
        await invitations_col.update_many(
            {"session_id": session_id},
            {"$set": {"status": "COMPLETED"}}
        )
        await live_bus.safe_send(websocket, {
            "type": "COMMAND_ACK",
            "command": "END_SESSION",
            "message": "Session ended",
        })

    elif command == 'RUN_LIVENESS':
        # Interviewer button: open a liveness check on the candidate's screen now.
        from api.routes.frames import request_liveness_from_interviewer
        res = await request_liveness_from_interviewer(session_id)
        msgs = {
            'started': 'Liveness check sent to the candidate',
            'busy': 'A liveness check is already open on the candidate\'s screen',
            'unavailable': 'Liveness checks are unavailable on this server (face tracking not loaded)',
            'no_candidate': 'The candidate\'s camera stream is not connected yet',
        }
        await live_bus.safe_send(websocket, {
            "type": "COMMAND_ACK",
            "command": "RUN_LIVENESS",
            "result": res,
            "message": msgs.get(res, res),
        })

    elif command == 'CLEAR_ALERTS':
        # Visual-only: hide these alerts from the interviewer's live feed.
        # Does NOT acknowledge/excuse them and does NOT touch the trust
        # score; they remain in the database and in the session report.
        ids = [str(i) for i in (data.get('alert_ids') or []) if i][:2000]
        cleared = 0
        if ids:
            from datetime import datetime
            res = await get_alerts_collection().update_many(
                {"session_id": session_id,
                 "$or": [{"alertId": {"$in": ids}}, {"alert_id": {"$in": ids}}]},
                {"$set": {"cleared_from_feed": True,
                          "cleared_at": datetime.utcnow().isoformat()}},
            )
            cleared = res.modified_count
        await live_bus.safe_send(websocket, {
            "type": "COMMAND_ACK",
            "command": "CLEAR_ALERTS",
            "cleared": cleared,
            "message": "Anomaly feed cleared (scores unchanged)",
        })

    elif command in ('ACK_ALERT', 'ACKNOWLEDGE_ALERT'):
        alert_id = data.get('alert_id') or data.get('alertId')
        if alert_id:
            from datetime import datetime
            alerts_col = get_alerts_collection()
            alert_doc = await alerts_col.find_one({
                "$or": [{"alert_id": alert_id}, {"alertId": alert_id}]
            })
            await alerts_col.update_many(
                {"$or": [{"alert_id": alert_id}, {"alertId": alert_id}]},
                {"$set": {
                    "acknowledged": True,
                    "status": "EXCUSED",
                    "acknowledged_at": datetime.utcnow().isoformat(),
                }}
            )

            # Revert anomaly penalty and recalculate live trust score
            rev_result = await revert_anomaly_penalty(session_id, alert_id, alert_doc)

            await live_bus.safe_send(websocket, {
                "type": "COMMAND_ACK",
                "command": "ACK_ALERT",
                "alert_id": alert_id,
                "alertId": alert_id,
                "new_score": rev_result.get("trust_score"),
                "message": "Anomaly excused as false positive — penalty score refunded",
            })

