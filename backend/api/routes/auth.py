"""
Authentication & User Profile Routes for DeepVerify.
Registration, Login, and Profile management for Candidates and Recruiters.
"""
import uuid
from datetime import datetime
import re
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends, status

from db.mongo import get_users_collection
from models.user import (
    UserRole, CandidateRegister, RecruiterRegister, UserLogin,
    UserResponse, AuthTokenResponse
)
from auth.security import (
    verify_password, get_password_hash, create_access_token, get_current_user
)
from modules.face_verifier import face_verifier_service

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register/candidate", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
async def register_candidate(
    full_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    college: str = Form(...),
    degree: str = Form(...),
    graduation_year: str = Form(...),
    phone: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
):
    """
    Register a new Candidate with profile details and passport photo.
    Validates face presence using AWS Rekognition / Face Verifier.
    """
    users_col = get_users_collection()
    normalized_email = email.lower().strip()

    # Check for existing user
    existing = await users_col.find_one({"email": normalized_email})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email address already exists."
        )

    if len(password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters long."
        )

    user_id = f"cand_{uuid.uuid4().hex[:10]}"
    profile_photo_url = None

    # Handle photo upload
    if photo:
        content = await photo.read()
        if len(content) >= 1000:
            # Validate face in photo
            validation = face_verifier_service.validate_reference_photo(content)
            if not validation.get("valid", False):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "error_code": validation.get("error_code", "INVALID_FACE"),
                        "message": validation.get("message", "Profile photo must contain a clear single face.")
                    }
                )

            # Store image in Cloudinary or local storage
            profile_photo_url = face_verifier_service.store_image(
                image_bytes=content,
                folder="profile_photos",
                filename=f"ref_{user_id}",
            )

    user_doc = {
        "user_id": user_id,
        "role": UserRole.CANDIDATE.value,
        "email": normalized_email,
        "password_hash": get_password_hash(password),
        "full_name": full_name.strip(),
        "phone": phone.strip() if phone else None,
        "college": college.strip(),
        "degree": degree.strip(),
        "graduation_year": graduation_year.strip(),
        "profile_photo_url": profile_photo_url,
        "created_at": datetime.utcnow(),
    }

    await users_col.insert_one(user_doc)

    user_res = UserResponse(
        user_id=user_id,
        email=normalized_email,
        role=UserRole.CANDIDATE.value,
        full_name=user_doc["full_name"],
        phone=user_doc["phone"],
        college=user_doc["college"],
        degree=user_doc["degree"],
        graduation_year=user_doc["graduation_year"],
        profile_photo_url=profile_photo_url,
        created_at=user_doc["created_at"],
    )

    token = create_access_token({
        "user_id": user_id,
        "email": normalized_email,
        "role": UserRole.CANDIDATE.value,
        "full_name": user_doc["full_name"],
    })

    return AuthTokenResponse(token=token, user=user_res)


@router.post("/register/recruiter", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
async def register_recruiter(data: RecruiterRegister):
    """Register a new Recruiter / Company account."""
    users_col = get_users_collection()
    normalized_email = data.email.lower().strip()

    existing = await users_col.find_one({"email": normalized_email})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email address already exists."
        )

    if len(data.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters long."
        )

    user_id = f"rec_{uuid.uuid4().hex[:10]}"

    user_doc = {
        "user_id": user_id,
        "role": UserRole.RECRUITER.value,
        "email": normalized_email,
        "password_hash": get_password_hash(data.password),
        "full_name": data.full_name.strip(),
        "company_name": data.company_name.strip(),
        "designation": data.designation.strip(),
        "created_at": datetime.utcnow(),
    }

    await users_col.insert_one(user_doc)

    user_res = UserResponse(
        user_id=user_id,
        email=normalized_email,
        role=UserRole.RECRUITER.value,
        full_name=user_doc["full_name"],
        company_name=user_doc["company_name"],
        designation=user_doc["designation"],
        created_at=user_doc["created_at"],
    )

    token = create_access_token({
        "user_id": user_id,
        "email": normalized_email,
        "role": UserRole.RECRUITER.value,
        "full_name": user_doc["full_name"],
        "company_name": user_doc["company_name"],
    })

    return AuthTokenResponse(token=token, user=user_res)


@router.post("/login", response_model=AuthTokenResponse)
async def login(data: UserLogin):
    """Authenticate user with email and password."""
    users_col = get_users_collection()
    normalized_email = data.email.lower().strip()

    query = {"email": normalized_email}
    if data.role:
        query["role"] = data.role.value

    user = await users_col.find_one(query)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password."
        )

    if not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password."
        )

    user_res = UserResponse(
        user_id=user["user_id"],
        email=user["email"],
        role=user["role"],
        full_name=user["full_name"],
        phone=user.get("phone"),
        college=user.get("college"),
        degree=user.get("degree"),
        graduation_year=user.get("graduation_year"),
        company_name=user.get("company_name"),
        designation=user.get("designation"),
        profile_photo_url=user.get("profile_photo_url"),
        created_at=user.get("created_at", datetime.utcnow()),
    )

    token = create_access_token({
        "user_id": user["user_id"],
        "email": user["email"],
        "role": user["role"],
        "full_name": user["full_name"],
        "company_name": user.get("company_name"),
    })

    return AuthTokenResponse(token=token, user=user_res)


@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(current_user: dict = Depends(get_current_user)):
    """Retrieve currently logged in user profile."""
    return UserResponse(
        user_id=current_user["user_id"],
        email=current_user["email"],
        role=current_user["role"],
        full_name=current_user["full_name"],
        phone=current_user.get("phone"),
        college=current_user.get("college"),
        degree=current_user.get("degree"),
        graduation_year=current_user.get("graduation_year"),
        company_name=current_user.get("company_name"),
        designation=current_user.get("designation"),
        profile_photo_url=current_user.get("profile_photo_url"),
        created_at=current_user.get("created_at", datetime.utcnow()),
    )


@router.post("/photo", response_model=UserResponse)
async def update_profile_photo(
    photo: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    """Upload or update profile photo."""
    content = await photo.read()
    if len(content) < 1000:
        raise HTTPException(status_code=400, detail="Invalid photo file.")

    validation = face_verifier_service.validate_reference_photo(content)
    if not validation.get("valid", False):
        raise HTTPException(
            status_code=400,
            detail=validation.get("message", "Profile photo must contain a clear single face.")
        )

    user_id = current_user["user_id"]
    profile_photo_url = face_verifier_service.store_image(
        image_bytes=content,
        folder="profile_photos",
        filename=f"ref_{user_id}",
    )

    users_col = get_users_collection()
    await users_col.update_one(
        {"user_id": user_id},
        {"$set": {"profile_photo_url": profile_photo_url}}
    )

    current_user["profile_photo_url"] = profile_photo_url
    return await get_current_user_profile(current_user)
