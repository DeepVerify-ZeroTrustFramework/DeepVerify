"""
Redis async client for pub/sub trust score and alert updates.
"""
import os
from typing import Optional
import redis.asyncio as aioredis

_redis: Optional[aioredis.Redis] = None


async def connect_redis():
    """Initialize Redis connection."""
    global _redis
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    _redis = aioredis.from_url(
        redis_url,
        encoding="utf-8",
        decode_responses=True,
        max_connections=20,
    )
    # Test connection
    await _redis.ping()
    print(f"[Redis] Connected to {redis_url}")


async def close_redis():
    """Close Redis connection."""
    global _redis
    if _redis:
        await _redis.close()
        print("[Redis] Connection closed")


def get_redis() -> aioredis.Redis:
    """Get Redis client instance."""
    if _redis is None:
        raise RuntimeError("Redis not connected. Call connect_redis() first.")
    return _redis


async def publish_trust_score(session_id: str, data: dict):
    """Publish trust score update to session channel."""
    import json
    r = get_redis()
    channel = f"trust_score:{session_id}"
    await r.publish(channel, json.dumps(data))


async def publish_alert(session_id: str, alert: dict):
    """Publish alert to session alert channel."""
    import json
    r = get_redis()
    channel = f"alerts:{session_id}"
    await r.publish(channel, json.dumps(alert))


async def get_pubsub(session_id: str):
    """Create a pub/sub subscriber for a session's trust score and alerts."""
    r = get_redis()
    pubsub = r.pubsub()
    await pubsub.subscribe(
        f"trust_score:{session_id}",
        f"alerts:{session_id}",
    )
    return pubsub
