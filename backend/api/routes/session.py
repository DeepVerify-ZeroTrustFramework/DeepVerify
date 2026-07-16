"""
Session management routes — create, get, update sessions.
Generates JWT-scoped tokens for candidate and interviewer access.
"""
import os
from fastapi import APIRouter, HTTPException, status
from datetime import datetime, timedelta
from jose import jwt, JWTError
from models.schemas import (
    SessionCreate, SessionResponse, SessionDocument,
    ConsentRecord, SystemCheckResult, SessionStatus, SessionThresholds,
    StatusUpdate, SessionStatusResponse, SessionModules, NetworkBaseline
)
from db.mongo import get_sessions_collection

router = APIRouter()

JWT_SECRET = os.getenv("JWT_SECRET", "deepverify-dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24


def create_jwt(session_id: str, role: str, expiry_hours: int = JWT_EXPIRY_HOURS) -> str:
    """Generate a JWT token scoped to a session and role."""
    payload = {
        "session_id": session_id,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=expiry_hours),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    """Decode and validate a JWT token."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# --- Session CRUD ---

@router.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(data: SessionCreate):
    """Create a new interview session. Returns JWT candidate token and interviewer token."""
    # Build modules
    modules = SessionModules()
    if data.modules:
        modules.prnu = data.modules.get("prnu", True)
        modules.rppg = data.modules.get("rppg", True)
        modules.jitter = data.modules.get("jitter", True)
        modules.behavioral = True  # Always active

    doc = SessionDocument(
        candidate_name=data.candidate_name,
        candidate_email=data.candidate_email,
        interviewer_id=data.interviewer_id,
        interviewer_name=data.interviewer_name,
        role=data.role,
        duration=data.duration,
        interview_type=data.interview_type,
        modules=modules,
    )

    # Generate JWT tokens
    candidate_jwt = create_jwt(doc.session_id, "candidate")
    interviewer_jwt = create_jwt(doc.session_id, "interviewer")

    # Store plain tokens for DB lookup, but return JWTs to clients
    doc.token = candidate_jwt
    doc.interviewer_token = interviewer_jwt

    collection = get_sessions_collection()
    await collection.insert_one(doc.model_dump())

    return SessionResponse(
        session_id=doc.session_id,
        candidate_name=doc.candidate_name,
        candidate_email=doc.candidate_email,
        interviewer_id=doc.interviewer_id,
        interviewer_name=doc.interviewer_name,
        role=doc.role,
        duration=doc.duration,
        interview_type=doc.interview_type,
        status=doc.status,
        token=candidate_jwt,
        interviewer_token=interviewer_jwt,
        candidate_url=f"/check/{candidate_jwt}",
        dashboard_url=f"/dashboard/{doc.session_id}",
        check_completed=doc.check_completed,
        created_at=doc.created_at,
    )


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str):
    """Get session details by session ID."""
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(
        session_id=doc["session_id"],
        candidate_name=doc["candidate_name"],
        candidate_email=doc.get("candidate_email", ""),
        interviewer_id=doc["interviewer_id"],
        interviewer_name=doc.get("interviewer_name"),
        role=doc.get("role", ""),
        duration=doc.get("duration", 60),
        interview_type=doc.get("interview_type", "Technical"),
        status=doc["status"],
        token=doc["token"],
        interviewer_token=doc["interviewer_token"],
        candidate_url=f"/check/{doc['token']}",
        dashboard_url=f"/dashboard/{doc['session_id']}",
        check_completed=doc.get("check_completed", False),
        created_at=doc["created_at"],
        start_time=doc.get("start_time"),
        end_time=doc.get("end_time"),
    )


@router.get("/sessions/{session_id}/status", response_model=SessionStatusResponse)
async def get_session_status(session_id: str):
    """Get session status for polling (used by interviewer waiting room)."""
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionStatusResponse(
        status=doc["status"],
        check_step=doc.get("check_step", 0),
        check_completed=doc.get("check_completed", False),
        candidate_name=doc["candidate_name"],
    )


@router.get("/sessions/by-token/{token}")
async def get_session_by_token(token: str):
    """Decode JWT token and return associated session."""
    try:
        payload = decode_jwt(token)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    session_id = payload.get("session_id")
    role = payload.get("role")
    if not session_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": doc["session_id"],
        "candidate_name": doc["candidate_name"],
        "candidate_email": doc.get("candidate_email", ""),
        "interviewer_name": doc.get("interviewer_name"),
        "role": doc.get("role", ""),
        "duration": doc.get("duration", 60),
        "status": doc["status"],
        "check_completed": doc.get("check_completed", False),
        "check_step": doc.get("check_step", 0),
        "token_role": role,
        "token": doc["token"],
        "created_at": doc["created_at"].isoformat() if isinstance(doc["created_at"], datetime) else doc["created_at"],
    }


@router.patch("/sessions/{session_id}")
async def update_session(session_id: str, update: StatusUpdate):
    """Update session status and/or check completion state."""
    collection = get_sessions_collection()
    doc = await collection.find_one({"session_id": session_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")

    update_fields = {}

    if update.status is not None:
        update_fields["status"] = update.status.value
        if update.status == SessionStatus.ACTIVE:
            update_fields["start_time"] = datetime.utcnow()
        elif update.status in (SessionStatus.COMPLETED, SessionStatus.FLAGGED):
            update_fields["end_time"] = datetime.utcnow()
        if update.status == SessionStatus.FLAGGED:
            update_fields["flagged_for_review"] = True
            update_fields["flagged_at"] = datetime.utcnow()

    if update.check_completed is not None:
        update_fields["check_completed"] = update.check_completed

    if update.check_step is not None:
        update_fields["check_step"] = update.check_step

    if update_fields:
        await collection.update_one(
            {"session_id": session_id},
            {"$set": update_fields}
        )

    return {"ok": True, "updated": list(update_fields.keys())}


@router.post("/sessions/{session_id}/consent")
async def record_consent(session_id: str, consent: ConsentRecord):
    """Record candidate consent."""
    if consent.consent_text != "I CONSENT":
        raise HTTPException(status_code=400, detail="Consent text must be exactly 'I CONSENT'")

    collection = get_sessions_collection()
    result = await collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "consent_text": consent.consent_text,
            "consent_timestamp": consent.timestamp,
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


@router.post("/sessions/{session_id}/network")
async def record_network(session_id: str, baseline: NetworkBaseline):
    """Record network classification during system check."""
    # Set jitter gamma based on connection type
    gamma_map = {"fiber": 0.15, "wifi": 0.15, "cellular": 0.20}
    gamma = gamma_map.get(baseline.connection_type.value, 0.15)

    collection = get_sessions_collection()
    result = await collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "enrollment.connection_type": baseline.connection_type.value,
            "thresholds.jitter_gamma": gamma,
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True, "gamma": gamma, "connection_type": baseline.connection_type.value}


@router.post("/sessions/{session_id}/system-check")
async def save_system_check(session_id: str, check: SystemCheckResult):
    """Save completed system check results."""
    collection = get_sessions_collection()
    result = await collection.update_one(
        {"session_id": session_id},
        {"$set": {
            "system_check": check.model_dump(),
            "status": SessionStatus.CHECKING.value,
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


@router.patch("/sessions/{session_id}/status")
async def update_session_status(session_id: str, new_status: SessionStatus):
    """Update session status (legacy endpoint)."""
    collection = get_sessions_collection()
    update_fields = {"status": new_status.value}
    if new_status == SessionStatus.ACTIVE:
        update_fields["start_time"] = datetime.utcnow()
    elif new_status in (SessionStatus.COMPLETED, SessionStatus.FLAGGED):
        update_fields["end_time"] = datetime.utcnow()
    if new_status == SessionStatus.FLAGGED:
        update_fields["flagged_for_review"] = True
        update_fields["flagged_at"] = datetime.utcnow()

    result = await collection.update_one(
        {"session_id": session_id},
        {"$set": update_fields}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True, "status": new_status.value}
