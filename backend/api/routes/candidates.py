"""
Candidate Search and Directory Routes for DeepVerify.
Enables recruiters to search and browse verified candidate profiles.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from db.mongo import get_users_collection
from models.user import CandidatePublicProfile, UserRole
from auth.security import require_recruiter

router = APIRouter(prefix="/candidates", tags=["Candidates Directory"])


@router.get("", response_model=List[CandidatePublicProfile])
async def list_candidates(
    skip: int = 0,
    limit: int = 50,
    current_user: dict = Depends(require_recruiter)
):
    """List registered candidates (for recruiters)."""
    users_col = get_users_collection()
    cursor = users_col.find(
        {"role": UserRole.CANDIDATE.value},
        {"password_hash": 0}
    ).skip(skip).limit(limit)

    results = []
    async for doc in cursor:
        results.append(CandidatePublicProfile(
            user_id=doc["user_id"],
            full_name=doc.get("full_name", "Anonymous"),
            email=doc.get("email", ""),
            college=doc.get("college"),
            degree=doc.get("degree"),
            graduation_year=doc.get("graduation_year"),
            profile_photo_url=doc.get("profile_photo_url"),
        ))
    return results


@router.get("/search", response_model=List[CandidatePublicProfile])
async def search_candidates(
    q: str = Query(..., min_length=1, description="Search query for name, college, degree, or email"),
    current_user: dict = Depends(require_recruiter)
):
    """Search registered candidates by text query."""
    users_col = get_users_collection()
    regex = {"$regex": q.strip(), "$options": "i"}

    cursor = users_col.find(
        {
            "role": UserRole.CANDIDATE.value,
            "$or": [
                {"full_name": regex},
                {"email": regex},
                {"college": regex},
                {"degree": regex},
            ]
        },
        {"password_hash": 0}
    ).limit(30)

    results = []
    async for doc in cursor:
        results.append(CandidatePublicProfile(
            user_id=doc["user_id"],
            full_name=doc.get("full_name", "Anonymous"),
            email=doc.get("email", ""),
            college=doc.get("college"),
            degree=doc.get("degree"),
            graduation_year=doc.get("graduation_year"),
            profile_photo_url=doc.get("profile_photo_url"),
        ))
    return results
