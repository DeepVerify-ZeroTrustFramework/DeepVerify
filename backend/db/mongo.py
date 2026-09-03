"""
MongoDB async client using Motor.
Provides database and collection accessors for all DeepVerify collections.
"""
import os
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase, AsyncIOMotorGridFSBucket
from typing import Optional

_client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase] = None
_gridfs: Optional[AsyncIOMotorGridFSBucket] = None


async def connect_mongodb():
    """Initialize MongoDB connection pool."""
    global _client, _db, _gridfs
    mongo_url = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    db_name = os.getenv("MONGODB_DB", "deepverify")
    _client = AsyncIOMotorClient(
        mongo_url,
        maxPoolSize=50,
        minPoolSize=10,
        serverSelectionTimeoutMS=5000,
    )
    _db = _client[db_name]
    _gridfs = AsyncIOMotorGridFSBucket(_db)

    # Create indexes for performance
    await _db.sessions.create_index("session_id", unique=True)
    await _db.sessions.create_index("token", unique=True)
    await _db.sessions.create_index("interviewer_token")
    await _db.sessions.create_index("status")
    await _db.telemetry.create_index([("session_id", 1), ("timestamp", 1)])
    await _db.alerts.create_index([("session_id", 1), ("timestamp", -1)])
    await _db.behavioral_events.create_index([("session_id", 1), ("timestamp", 1)])
    await _db.users.create_index("email", unique=True)
    await _db.users.create_index("user_id", unique=True)
    await _db.users.create_index("role")
    await _db.invitations.create_index("invitation_id", unique=True)
    await _db.invitations.create_index("candidate_email")
    await _db.invitations.create_index("candidate_id")
    await _db.invitations.create_index("recruiter_id")
    await _db.invitations.create_index("session_id")

    print(f"[MongoDB] Connected to {mongo_url}/{db_name}")


async def close_mongodb():
    """Close MongoDB connection."""
    global _client
    if _client:
        _client.close()
        print("[MongoDB] Connection closed")


def get_db() -> AsyncIOMotorDatabase:
    """Get database instance."""
    if _db is None:
        raise RuntimeError("MongoDB not connected. Call connect_mongodb() first.")
    return _db


def get_sessions_collection():
    return get_db().sessions


def get_users_collection():
    return get_db().users


def get_invitations_collection():
    return get_db().invitations


def get_telemetry_collection():
    return get_db().telemetry


def get_alerts_collection():
    return get_db().alerts


def get_behavioral_events_collection():
    return get_db().behavioral_events


def get_gridfs_bucket() -> AsyncIOMotorGridFSBucket:
    """Get GridFS bucket for PRNU reference fingerprint K̂ storage."""
    if _gridfs is None:
        raise RuntimeError("MongoDB not connected. Call connect_mongodb() first.")
    return _gridfs
