"""Shared fixtures: the real FastAPI app wired to in-memory MongoDB and Redis.

* MongoDB  -> mongomock-motor (an in-memory, API-compatible Motor client)
* Redis    -> fakeredis (real redis-py asyncio API, in-process server)
* AWS      -> botocore Stubber (see test_integration_rekognition.py)

The application code itself is NOT mocked: routes, auth, AXIOM, PRNU, jitter, behavioural
scoring and the PDF builder all run for real. Only the network services behind them are swapped.
"""
import io
import os
import uuid
from qa_tests import _bootstrap  # noqa: F401  (must be first)

import cv2
import fakeredis.aioredis
import numpy as np
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

import api.main as main_module
import db.mongo as mongo_module
import db.redis_client as redis_module
from modules.face_verifier import face_verifier_service


async def _connect_mongodb():
    mongo_module._client = AsyncMongoMockClient()
    mongo_module._db = mongo_module._client["deepverify_test"]
    await mongo_module._db.sessions.create_index("session_id", unique=True)
    await mongo_module._db.users.create_index("email", unique=True)


async def _close_mongodb():
    return None


async def _connect_redis():
    redis_module._redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    await redis_module._redis.ping()


async def _close_redis():
    return None


class AppHarness:
    """Starts the real app (lifespan included) against the in-memory backends."""

    def __init__(self):
        # The lifespan looks these names up in api.main at start-up.
        main_module.connect_mongodb = _connect_mongodb
        main_module.close_mongodb = _close_mongodb
        main_module.connect_redis = _connect_redis
        main_module.close_redis = _close_redis
        # Safety net: a test must never reach the real AWS Rekognition service.
        self._saved_rek = face_verifier_service._rekognition_client
        face_verifier_service._rekognition_client = None
        self.client = TestClient(main_module.app)
        self.client.__enter__()

    def close(self):
        self.client.__exit__(None, None, None)
        face_verifier_service._rekognition_client = self._saved_rek

    # -- run a coroutine function inside the app's event loop --------------------------
    def run(self, fn, *args):
        return self.client.portal.call(fn, *args)

    # -- Redis helpers -------------------------------------------------------------------
    def subscribe(self, *channels):
        async def _sub():
            ps = redis_module.get_redis().pubsub()
            await ps.subscribe(*channels)
            for _ in channels:                 # consume the subscribe confirmations
                await ps.get_message(timeout=0.2)
            return ps
        return self.run(_sub)

    def drain(self, pubsub, wait=0.6, limit=50):
        """Return every message currently queued on a subscription (decoded JSON)."""
        import json

        async def _drain():
            out = []
            for _ in range(limit):
                m = await pubsub.get_message(ignore_subscribe_messages=True, timeout=wait)
                if m is None:
                    break
                out.append(json.loads(m["data"]))
            return out
        return self.run(_drain)

    # -- Mongo helpers -------------------------------------------------------------------
    def find(self, collection, query=None):
        async def _f():
            return await mongo_module.get_db()[collection].find(query or {}).to_list(1000)
        return self.run(_f)

    def insert(self, collection, doc):
        async def _i():
            await mongo_module.get_db()[collection].insert_one(dict(doc))
        return self.run(_i)

    # -- Domain helpers ------------------------------------------------------------------
    def create_session(self, **over):
        body = {"candidate_name": "Test Candidate", "candidate_email": "cand@example.com",
                "interviewer_name": "Rita Recruiter", "role": "SDE", "duration": 30}
        body.update(over)
        r = self.client.post("/api/sessions", json=body)
        assert r.status_code == 201, r.text
        return r.json()


def uid(prefix="t"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def jpeg_bytes(w=320, h=240, seed=0, noise=True):
    rng = np.random.default_rng(seed)
    img = rng.integers(0, 256, (h, w, 3), dtype=np.uint8) if noise else np.full((h, w, 3), 128, np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


def prnu_packet(cam_w=1280, cam_h=720, seed=0):
    """Binary PRNU crop exactly as the browser sends it: b'DVPR' + camW + camH + JPEG."""
    from modules.prnu import PRNU_MAGIC
    return PRNU_MAGIC + cam_w.to_bytes(2, "big") + cam_h.to_bytes(2, "big") + jpeg_bytes(seed=seed)
