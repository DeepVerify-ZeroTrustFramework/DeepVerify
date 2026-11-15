"""LEVEL 2 - INTEGRATION (part B: MongoDB session persistence, 5 tests).
Uses an in-memory, Motor-compatible MongoDB (mongomock-motor)."""
import unittest
from qa_tests import _bootstrap  # noqa: F401
from qa_tests._harness import AppHarness, uid


class TestMongoSessionPersistence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = AppHarness()

    @classmethod
    def tearDownClass(cls):
        cls.h.close()

    def test_01_create_session_is_persisted_with_tokens(self):
        s = self.h.create_session()
        doc = self.h.find("sessions", {"session_id": s["session_id"]})[0]
        self.assertEqual(doc["candidate_name"], "Test Candidate")
        self.assertEqual(doc["status"], "PENDING")
        self.assertEqual(doc["token"], s["token"])
        self.assertTrue(doc["interviewer_token"])

    def test_02_get_session_and_by_token_round_trip(self):
        c, s = self.h.client, self.h.create_session(candidate_name="Round Trip")
        self.assertEqual(c.get(f"/api/sessions/{s['session_id']}").json()["candidate_name"], "Round Trip")
        by_tok = c.get(f"/api/sessions/by-token/{s['token']}").json()
        self.assertEqual((by_tok["session_id"], by_tok["token_role"]), (s["session_id"], "candidate"))
        self.assertEqual(c.get("/api/sessions/DV-DOES-NOT-EXIST").status_code, 404)

    def test_03_status_patch_stamps_start_and_end_times(self):
        c, s = self.h.client, self.h.create_session()
        sid = s["session_id"]
        self.assertEqual(c.patch(f"/api/sessions/{sid}", json={"status": "ACTIVE"}).status_code, 200)
        doc = self.h.find("sessions", {"session_id": sid})[0]
        self.assertEqual(doc["status"], "ACTIVE")
        self.assertIsNotNone(doc.get("start_time"))
        c.patch(f"/api/sessions/{sid}", json={"status": "COMPLETED"})
        doc = self.h.find("sessions", {"session_id": sid})[0]
        self.assertIsNotNone(doc.get("end_time"))
        self.assertEqual(c.get(f"/api/sessions/{sid}/status").json()["status"], "COMPLETED")

    def test_04_consent_is_stored_only_for_exact_text(self):
        c, sid = self.h.client, self.h.create_session()["session_id"]
        self.assertEqual(c.post(f"/api/sessions/{sid}/consent", json={"consent_text": "i agree"}).status_code, 400)
        self.assertEqual(c.post(f"/api/sessions/{sid}/consent", json={"consent_text": "I CONSENT"}).status_code, 200)
        self.assertEqual(self.h.find("sessions", {"session_id": sid})[0]["consent_text"], "I CONSENT")

    def test_05_user_is_stored_hashed_and_email_is_unique(self):
        c, email = self.h.client, f"{uid('cand')}@mail.com"
        form = {"full_name": "Cand Idate", "email": email, "password": "Secret123", "college": "Amrita",
                "degree": "BTech", "graduation_year": "2027"}
        self.assertEqual(c.post("/api/auth/register/candidate", data=form).status_code, 201)
        stored = self.h.find("users", {"email": email})[0]
        self.assertNotEqual(stored["password_hash"], "Secret123")
        self.assertTrue(stored["password_hash"].startswith("$2"))      # bcrypt
        self.assertEqual(c.post("/api/auth/register/candidate", data=form).status_code, 400)
        self.assertEqual(len(self.h.find("users", {"email": email})), 1)


if __name__ == "__main__":
    unittest.main()
