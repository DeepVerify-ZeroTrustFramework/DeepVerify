"""
DeepVerify — FastAPI Application Entry Point.
Zero-Trust Interview Integrity Platform.
IEEE ICOSAAS 2026.
"""
import os
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db.mongo import connect_mongodb, close_mongodb
from db.redis_client import connect_redis, close_redis
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from api.routes import (
    session, enrollment, frames, dashboard, signaling, report,
    ws_handlers, webrtc, tts, face_verification, auth, candidates, invitations
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: connect to MongoDB and Redis on startup, close on shutdown."""
    await connect_mongodb()
    await connect_redis()
    print("[DeepVerify] All services connected. Server ready.")
    yield
    await close_mongodb()
    await close_redis()
    print("[DeepVerify] Shutdown complete.")


app = FastAPI(
    title="DeepVerify API",
    description="Zero-Trust Interview Integrity Platform — Forensic Analysis Engine",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(auth.router, prefix="/api", tags=["Authentication"])
app.include_router(candidates.router, prefix="/api", tags=["Candidates Directory"])
app.include_router(invitations.router, prefix="/api", tags=["Invitations & Messaging"])
app.include_router(session.router, prefix="/api", tags=["Sessions"])
app.include_router(enrollment.router, prefix="/api", tags=["Enrollment"])
app.include_router(frames.router, tags=["Frames & Analysis"])
app.include_router(dashboard.router, tags=["Dashboard"])
app.include_router(signaling.router, tags=["WebRTC Signaling"])
app.include_router(report.router, prefix="/api", tags=["Reports"])
app.include_router(tts.router, prefix="/api", tags=["Text-to-Speech"])
app.include_router(face_verification.router, prefix="/api", tags=["Face Verification"])
app.include_router(ws_handlers.router, tags=["WebSocket Handlers"])
app.include_router(webrtc.router, tags=["WebRTC SFU"])

# Static directory for local image uploads fallback
uploads_dir = Path(__file__).resolve().parent.parent / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "deepverify", "version": "2.0.0"}


@app.get("/api/ping")
async def ping():
    """Returns server timestamp for RTT measurement during system check."""
    return {"timestamp": datetime.utcnow().isoformat(), "status": "ok"}
