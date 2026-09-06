"""
Invitations and In-App Messaging Routes for DeepVerify.
Recruiters create interview invites that appear in Candidate Inboxes.
"""
import uuid
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, status

from db.mongo import get_invitations_collection, get_sessions_collection, get_users_collection
from models.user import InvitationCreate, InvitationResponse, UserRole
from models.schemas import (
    SessionDocument, SessionModules, FaceVerificationData, FaceVerificationStatus
)
from auth.security import require_recruiter, require_candidate, get_current_user
from api.routes.session import create_jwt

router = APIRouter(prefix="/invitations", tags=["Invitations & Messaging"])


@router.post("", response_model=InvitationResponse, status_code=status.HTTP_201_CREATED)
async def send_invitation(
    data: InvitationCreate,
    current_user: dict = Depends(require_recruiter)
):
    """
    Recruiter creates an interview invitation for a candidate.
    Automatically provisions a zero-trust session linked to the candidate's profile photo.
    """
    users_col = get_users_collection()
    cand_email = data.candidate_email.lower().strip()

    candidate = await users_col.find_one({"email": cand_email, "role": UserRole.CANDIDATE.value})
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Candidate with email '{cand_email}' was not found. Ensure the candidate has registered on DeepVerify."
        )

    # Prevent duplicate / overlapping active invites
    invitations_col = get_invitations_collection()
    sessions_col = get_sessions_collection()

    existing_invites_cursor = invitations_col.find({
        "$or": [
            {"candidate_email": cand_email},
            {"candidate_id": candidate.get("user_id")},
        ],
        "status": {"$in": ["PENDING", "ACCEPTED", "IN_PROGRESS"]}
    })
    async for inv in existing_invites_cursor:
        sess = await sessions_col.find_one({"session_id": inv.get("session_id")})
        sess_status = sess.get("status") if sess else inv.get("status")
        if sess_status not in ["COMPLETED", "CANCELLED", "EXPIRED"]:
            cand_name = candidate.get("full_name") or cand_email
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"There is already an existing active invitation for {cand_name} ({cand_email}). You can only send another invite once the previous interview is completed or cancelled."
            )
        else:
            # Sync completed status to stale invitation record
            await invitations_col.update_one(
                {"_id": inv["_id"]},
                {"$set": {"status": sess_status}}
            )

    # Provision zero-trust session document
    session_doc = SessionDocument(
        candidate_name=candidate.get("full_name", "Candidate"),
        candidate_email=cand_email,
        interviewer_id=current_user.get("user_id", "recruiter"),
        interviewer_name=current_user.get("full_name", "Interviewer"),
        role=data.role_title,
        duration=data.duration,
        modules=SessionModules(prnu=True, rppg=True, jitter=True, behavioral=True),
    )

    # Link candidate's profile photo to session face verification
    ref_photo = candidate.get("profile_photo_url")
    if ref_photo:
        session_doc.face_verification = FaceVerificationData(
            reference_image_url=ref_photo,
            verified=False,
            status=FaceVerificationStatus.PENDING,
            message="Linked from candidate verified profile.",
        )

    # Generate session tokens
    candidate_jwt = create_jwt(session_doc.session_id, "candidate")
    interviewer_jwt = create_jwt(session_doc.session_id, "interviewer")
    session_doc.token = candidate_jwt
    session_doc.interviewer_token = interviewer_jwt

    await sessions_col.insert_one(session_doc.model_dump())

    # Create invitation in invitations collection
    invitation_id = f"inv_{uuid.uuid4().hex[:10]}"
    invitation_doc = {
        "invitation_id": invitation_id,
        "recruiter_id": current_user["user_id"],
        "recruiter_name": current_user["full_name"],
        "recruiter_company": current_user.get("company_name", "Company"),
        "candidate_email": cand_email,
        "candidate_name": candidate.get("full_name"),
        "candidate_id": candidate.get("user_id"),
        "session_id": session_doc.session_id,
        "session_token": candidate_jwt,
        "interviewer_token": interviewer_jwt,
        "role_title": data.role_title,
        "duration": data.duration,
        "message": data.message,
        "status": "PENDING",
        "created_at": datetime.utcnow(),
    }

    invitations_col = get_invitations_collection()
    await invitations_col.insert_one(invitation_doc)

    return InvitationResponse(
        invitation_id=invitation_id,
        recruiter_id=current_user["user_id"],
        recruiter_name=current_user["full_name"],
        recruiter_company=current_user.get("company_name", "Company"),
        candidate_email=cand_email,
        candidate_name=candidate.get("full_name"),
        candidate_id=candidate.get("user_id"),
        session_id=session_doc.session_id,
        session_token=candidate_jwt,
        role_title=data.role_title,
        duration=data.duration,
        message=data.message,
        status="PENDING",
        created_at=invitation_doc["created_at"],
    )


@router.get("/my", response_model=List[InvitationResponse])
async def get_my_invitations(
    include_completed: bool = False,
    current_user: dict = Depends(require_candidate)
):
    """
    Candidate retrieves interview invitations sent to their account.
    By default, excludes completed, cancelled, or expired sessions so active inbox remains clean.
    """
    invitations_col = get_invitations_collection()
    sessions_col = get_sessions_collection()

    cursor = invitations_col.find({
        "$or": [
            {"candidate_email": current_user["email"]},
            {"candidate_id": current_user["user_id"]},
        ]
    }).sort("created_at", -1)

    results = []
    async for doc in cursor:
        sess = await sessions_col.find_one({"session_id": doc.get("session_id")})
        sess_status = sess.get("status") if sess else doc.get("status", "PENDING")

        # Sync invitation status if session state transitioned
        if doc.get("status") != sess_status:
            await invitations_col.update_one(
                {"_id": doc["_id"]},
                {"$set": {"status": sess_status}}
            )

        # Unless explicitly requested, filter out completed/cancelled/expired interviews from active inbox
        if not include_completed and sess_status in ["COMPLETED", "CANCELLED", "EXPIRED"]:
            continue

        results.append(InvitationResponse(
            invitation_id=doc["invitation_id"],
            recruiter_id=doc["recruiter_id"],
            recruiter_name=doc.get("recruiter_name", "Recruiter"),
            recruiter_company=doc.get("recruiter_company", "Company"),
            candidate_email=doc["candidate_email"],
            candidate_name=doc.get("candidate_name"),
            candidate_id=doc.get("candidate_id"),
            session_id=doc["session_id"],
            session_token=doc["session_token"],
            role_title=doc.get("role_title", "Software Engineer"),
            duration=doc.get("duration", 60),
            message=doc.get("message"),
            status=sess_status,
            created_at=doc.get("created_at", datetime.utcnow()),
        ))
    return results


@router.get("/sent", response_model=List[dict])
async def get_sent_invitations(current_user: dict = Depends(require_recruiter)):
    """Recruiter retrieves all invitations they have sent, synchronized with live session status."""
    invitations_col = get_invitations_collection()
    sessions_col = get_sessions_collection()
    cursor = invitations_col.find(
        {"recruiter_id": current_user["user_id"]}
    ).sort("created_at", -1)

    results = []
    async for doc in cursor:
        sess = await sessions_col.find_one({"session_id": doc.get("session_id")})
        sess_status = sess.get("status") if sess else doc.get("status", "PENDING")
        if doc.get("status") != sess_status:
            await invitations_col.update_one(
                {"_id": doc["_id"]},
                {"$set": {"status": sess_status}}
            )

        doc_copy = dict(doc)
        doc_copy.pop("_id", None)
        doc_copy["status"] = sess_status
        results.append(doc_copy)
    return results


@router.delete("/{invitation_id}")
async def cancel_invitation(
    invitation_id: str,
    current_user: dict = Depends(require_recruiter)
):
    """Recruiter cancels/revokes an active invitation."""
    invitations_col = get_invitations_collection()
    sessions_col = get_sessions_collection()

    inv = await invitations_col.find_one({
        "invitation_id": invitation_id,
        "recruiter_id": current_user["user_id"]
    })
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found")

    await invitations_col.update_one(
        {"invitation_id": invitation_id},
        {"$set": {"status": "CANCELLED"}}
    )
    if inv.get("session_id"):
        await sessions_col.update_one(
            {"session_id": inv["session_id"]},
            {"$set": {"status": "CANCELLED"}}
        )

    return {"ok": True, "message": "Invitation cancelled successfully"}
