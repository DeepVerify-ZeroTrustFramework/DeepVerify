"""LEVEL 2 - INTEGRATION (part A: REST + authentication, 3 tests)."""
import unittest
from qa_tests import _bootstrap  # noqa: F401
from qa_tests._harness import AppHarness, uid


class TestRestAndAuth(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = AppHarness()

    @classmethod
    def tearDownClass(cls):
        cls.h.close()

    def test_01_health_and_ping_endpoints(self):
        c = self.h.client
        self.assertEqual(c.get("/api/health").json()["status"], "ok")
        self.assertEqual(c.get("/api/ping").json()["status"], "ok")

    def test_02_recruiter_register_login_and_profile(self):
        c, email = self.h.client, f"{uid('rec')}@corp.com"
        reg = c.post("/api/auth/register/recruiter", json={
            "full_name": "Rita Recruiter", "email": email, "password": "Passw0rd!",
            "company_name": "Acme", "designation": "Talent Lead"})
        self.assertEqual(reg.status_code, 201, reg.text)
        login = c.post("/api/auth/login", json={"email": email.upper(), "password": "Passw0rd!"})
        self.assertEqual(login.status_code, 200, login.text)
        me = c.get("/api/auth/me", headers={"Authorization": f"Bearer {login.json()['token']}"})
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["email"], email)
        self.assertEqual(me.json()["role"], "recruiter")

    def test_03_bad_password_and_bad_token_are_rejected(self):
        c, email = self.h.client, f"{uid('rec')}@corp.com"
        c.post("/api/auth/register/recruiter", json={
            "full_name": "Rita R", "email": email, "password": "Passw0rd!",
            "company_name": "Acme", "designation": "Lead"})
        self.assertEqual(c.post("/api/auth/login", json={"email": email, "password": "nope"}).status_code, 401)
        self.assertEqual(c.get("/api/auth/me", headers={"Authorization": "Bearer junk.token.here"}).status_code, 401)
        self.assertIn(c.get("/api/auth/me").status_code, (401, 403))


if __name__ == "__main__":
    unittest.main()
