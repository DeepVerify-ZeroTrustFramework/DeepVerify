"""
User & Profile Data Models for DeepVerify.
Zero-Trust Interview Integrity Platform.
"""
import re
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime
from enum import Enum
import uuid


class UserRole(str, Enum):
    CANDIDATE = "candidate"
    RECRUITER = "recruiter"


class InvitationStatus(str, Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    COMPLETED = "COMPLETED"


# --- Request Models ---

class CandidateRegister(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: str = Field(..., min_length=5, max_length=150)
    password: str = Field(..., min_length=6, max_length=100)
    phone: Optional[str] = None
    college: str = Field(..., min_length=2, max_length=200)
    degree: str = Field(..., min_length=2, max_length=150)
    graduation_year: str = Field(..., min_length=4, max_length=20)

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(r"^[^@]+@[^@]+\.[^@]+$", clean):
            raise ValueError("Invalid email format.")
        return clean


class RecruiterRegister(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: str = Field(..., min_length=5, max_length=150)
    password: str = Field(..., min_length=6, max_length=100)
    company_name: str = Field(..., min_length=2, max_length=150)
    designation: str = Field(..., min_length=2, max_length=150)

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(r"^[^@]+@[^@]+\.[^@]+$", clean):
            raise ValueError("Invalid email format.")
        return clean


class UserLogin(BaseModel):
    email: str
    password: str
    role: Optional[UserRole] = None


# --- Response Models ---

class UserResponse(BaseModel):
    user_id: str
    email: str
    role: str
    full_name: str
    phone: Optional[str] = None
    college: Optional[str] = None
    degree: Optional[str] = None
    graduation_year: Optional[str] = None
    company_name: Optional[str] = None
    designation: Optional[str] = None
    profile_photo_url: Optional[str] = None
    created_at: datetime


class AuthTokenResponse(BaseModel):
    token: str
    token_type: str = "bearer"
    user: UserResponse


class CandidatePublicProfile(BaseModel):
    user_id: str
    full_name: str
    email: str
    college: Optional[str] = None
    degree: Optional[str] = None
    graduation_year: Optional[str] = None
    profile_photo_url: Optional[str] = None


# --- Invitation Models ---

class InvitationCreate(BaseModel):
    candidate_email: str
    role_title: str = Field(default="Software Engineer", min_length=2)
    duration: int = Field(default=60, ge=15, le=180)
    message: Optional[str] = None

    @field_validator("candidate_email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(r"^[^@]+@[^@]+\.[^@]+$", clean):
            raise ValueError("Invalid email format.")
        return clean


class InvitationResponse(BaseModel):
    invitation_id: str
    recruiter_id: str
    recruiter_name: str
    recruiter_company: str
    candidate_email: str
    candidate_name: Optional[str] = None
    candidate_id: Optional[str] = None
    session_id: str
    session_token: str
    role_title: str
    duration: int
    message: Optional[str] = None
    status: str = "PENDING"
    created_at: datetime
