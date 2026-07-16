"""
Pydantic models for DeepVerify API — request/response schemas and DB documents.
IEEE ICOSAAS 2026 · Zero-Trust Interview Integrity Platform.
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uuid
import random


# --- Enums ---

class SessionStatus(str, Enum):
    PENDING = "PENDING"
    CHECKING = "CHECKING"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    FLAGGED = "FLAGGED"


class AlertSeverity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AlertType(str, Enum):
    IDENTITY_FRAUD = "IDENTITY_FRAUD"
    LIVENESS_FAIL = "LIVENESS_FAIL"
    DEEPFAKE_RENDERING = "DEEPFAKE_RENDERING"
    ASSISTANCE_FRAUD = "ASSISTANCE_FRAUD"
    GAZE_ANOMALY = "GAZE_ANOMALY"
    TAB_SWITCH = "TAB_SWITCH"
    LARGE_PASTE = "LARGE_PASTE"
    PRNU_PASS = "PRNU_PASS"
    RPPG_PASS = "RPPG_PASS"
    PRNU_WARN = "PRNU_WARN"


class BehavioralEventType(str, Enum):
    TAB_SWITCH = "TAB_SWITCH"
    WINDOW_BLUR = "WINDOW_BLUR"
    LARGE_PASTE = "LARGE_PASTE"
    GAZE_ANOMALY = "GAZE_ANOMALY"
    GAZE = "GAZE"


class ConnectionType(str, Enum):
    FIBER = "fiber"
    WIFI = "wifi"
    CELLULAR = "cellular"


class InterviewType(str, Enum):
    TECHNICAL = "Technical"
    DESIGN = "Design"
    BEHAVIOURAL = "Behavioural"
    MIXED = "Mixed"


# --- Helpers ---

def generate_session_id() -> str:
    return f"DV-2025-{random.randint(1000, 9999)}"


# --- Request Schemas ---

class SessionCreate(BaseModel):
    candidate_name: str = Field(..., min_length=1, max_length=200)
    candidate_email: str = Field(..., min_length=1)
    interviewer_name: str = Field(..., min_length=1)
    interviewer_id: str = Field(default_factory=lambda: f"int_{uuid.uuid4().hex[:8]}")
    role: str = Field(default="Software Engineer")
    duration: int = Field(default=60, description="Duration in minutes")
    interview_type: str = Field(default="Technical")
    modules: Optional[Dict[str, bool]] = None


class ConsentRecord(BaseModel):
    consent_text: str = Field(..., description="Must be exactly 'I CONSENT'")
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class SystemCheckResult(BaseModel):
    permissions_granted: bool = False
    virtual_camera_detected: bool = False
    virtual_camera_name: Optional[str] = None
    network_check_passed: bool = False
    connection_type: ConnectionType = ConnectionType.WIFI
    baseline_rtt_ms: float = 0.0
    prnu_enrolled: bool = False
    rppg_baseline_captured: bool = False
    gaze_baseline_captured: bool = False
    consent_given: bool = False


class NetworkBaseline(BaseModel):
    connection_type: ConnectionType
    baseline_rtt_ms: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class GazeBaseline(BaseModel):
    lambda_gaze: float = Field(..., description="Gaze deviation threshold")
    natural_yaw_range: float = Field(default=15.0)
    gaze_range_x: float = Field(default=0.0, description="Natural horizontal gaze range")
    gaze_range_y: float = Field(default=0.0, description="Natural vertical gaze range")
    natural_head_pose: Dict[str, float] = Field(
        default_factory=lambda: {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}
    )


class RPPGBaseline(BaseModel):
    baseline_hr: float = Field(..., description="Baseline heart rate in BPM")
    snr_baseline: float = Field(..., description="SNR baseline in dB — used as per-candidate β")
    skin_tone_calibration: Optional[float] = None


class GazeData(BaseModel):
    gaze_x: float
    gaze_y: float
    delta: float
    yaw: float
    pitch: float
    roll: float = 0.0
    timestamp: float


class BehavioralEvent(BaseModel):
    event_type: BehavioralEventType
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class StatusUpdate(BaseModel):
    status: Optional[SessionStatus] = None
    check_completed: Optional[bool] = None
    check_step: Optional[int] = None


# --- Response Schemas ---

class SessionResponse(BaseModel):
    session_id: str
    candidate_name: str
    candidate_email: str = ""
    interviewer_id: str
    interviewer_name: Optional[str] = None
    role: str = ""
    duration: int = 60
    interview_type: str = "Technical"
    status: SessionStatus
    token: str = Field(..., description="Candidate access token (JWT)")
    interviewer_token: str = Field(..., description="Interviewer access token")
    candidate_url: str = ""
    dashboard_url: str = ""
    check_completed: bool = False
    created_at: datetime
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class SessionStatusResponse(BaseModel):
    status: SessionStatus
    check_step: int = 0
    check_completed: bool = False
    candidate_name: str = ""


class TrustScoreBreakdown(BaseModel):
    prnu: float = 30.0
    rppg: float = 30.0
    jitter: float = 15.0
    behavioral: float = 25.0


class Alert(BaseModel):
    alert_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    alert_type: str
    module: str
    severity: str
    value: float
    description: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    acknowledged: bool = False


class TrustScoreUpdate(BaseModel):
    session_id: str
    trust_score: float
    breakdown: TrustScoreBreakdown
    raw: Dict[str, float] = Field(default_factory=dict)
    alerts: List[Alert] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class TelemetryEntry(BaseModel):
    session_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    trust_score: float
    pce: float = 0.0
    snr_rppg: float = 0.0
    cv_jitter: float = 0.0
    behavioral_score: float = 0.0
    hr_bpm: float = 0.0
    breakdown: TrustScoreBreakdown = Field(default_factory=TrustScoreBreakdown)


# --- Session Document (full MongoDB document shape) ---

class EnrollmentData(BaseModel):
    prnu_reference_path: Optional[str] = None
    snr_baseline: Optional[float] = None
    baseline_hr: Optional[float] = None
    gaze_baseline: Optional[GazeBaseline] = None
    connection_type: Optional[ConnectionType] = None
    rppg_baseline: Optional[RPPGBaseline] = None
    enrolled_at: Optional[datetime] = None


class SessionThresholds(BaseModel):
    pce_tau: float = 60.0
    snr_beta: float = 3.0  # Will be overridden per-candidate from enrollment
    jitter_gamma: float = 0.15  # Will be set per connection type
    behavioral_lambda: float = 0.3  # Will be set per gaze baseline


class SessionModules(BaseModel):
    prnu: bool = True
    rppg: bool = True
    jitter: bool = True
    behavioral: bool = True  # Always active, cannot be disabled


class SessionDocument(BaseModel):
    session_id: str = Field(default_factory=generate_session_id)
    candidate_name: str
    candidate_email: str = ""
    interviewer_id: str
    interviewer_name: Optional[str] = None
    role: str = "Software Engineer"
    duration: int = 60
    interview_type: str = "Technical"
    modules: SessionModules = Field(default_factory=SessionModules)
    status: SessionStatus = SessionStatus.PENDING
    check_completed: bool = False
    check_step: int = 0
    token: str = Field(default_factory=lambda: str(uuid.uuid4()))
    interviewer_token: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    token_expiry: datetime = Field(default_factory=lambda: datetime.utcnow() + timedelta(hours=24))
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    consent_timestamp: Optional[datetime] = None
    consent_text: Optional[str] = None
    enrollment: EnrollmentData = Field(default_factory=EnrollmentData)
    thresholds: SessionThresholds = Field(default_factory=SessionThresholds)
    system_check: Optional[SystemCheckResult] = None
    flagged_for_review: bool = False
    flag_reason: Optional[str] = None
    flagged_at: Optional[datetime] = None
