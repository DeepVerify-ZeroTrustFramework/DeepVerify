"""LEVEL 3 - SYSTEM / END-TO-END TESTING (10 complete workflows).
Workflows: candidate onboarding, recruiter session issue, live interview, compiler sync,
PDF audit, report summary, session lifecycle, genuine candidate pipeline, deepfake pipeline.
The real FastAPI app runs end to end (REST + WebSockets + Redis + MongoDB); only the
network services behind it are in-memory.
"""
import time
import unittest
from datetime import datetime, timedelta

import numpy as np

from qa_tests import _bootstrap  # noqa: F401
from qa_tests._harness import AppHarness, uid
from modules import prnu
from modules.axiom import axiom_fusion_engine, get_trust_status


def _wait(pred, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.05)
    return False


def _collect(ws, until, limit=15):
    """Read dashboard socket messages until `until(msg)` is true (or limit)."""
    seen = []
    for _ in range(limit):
        m = ws.receive_json()
        seen.append(m)
        if until(m):
            break
    return seen


class TestSystemWorkflows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = AppHarness()

    @classmethod
    def tearDownClass(cls):
        cls.h.close()

    # 1 -----------------------------------------------------------------------------
    def test_01_full_candidate_onboarding(self):
        c, email = self.h.client, f"{uid('cand')}@mail.com"
        reg = c.post("/api/auth/register/candidate", data={
            "full_name": "Cand Idate", "email": email, "password": "Secret123", "college": "Amrita",
            "degree": "BTech", "graduation_year": "2027"})
        self.assertEqual(reg.status_code, 201)
        tok = c.post("/api/auth/login", json={"email": email, "password": "Secret123"}).json()["token"]
        self.assertEqual(c.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).json()["role"], "candidate")
        sid = self.h.create_session(candidate_email=email)["session_id"]
        self.assertEqual(c.post(f"/api/sessions/{sid}/consent", json={"consent_text": "I CONSENT"}).status_code, 200)
        self.assertEqual(c.post(f"/api/sessions/{sid}/network",
                                json={"connection_type": "wifi", "baseline_rtt_ms": 42.0}).status_code, 200)
        chk = c.post(f"/api/sessions/{sid}/system-check", json={
            "permissions_granted": True, "network_check_passed": True, "prnu_enrolled": True,
            "rppg_baseline_captured": True, "gaze_baseline_captured": True, "consent_given": True})
        self.assertEqual(chk.status_code, 200)
        c.patch(f"/api/sessions/{sid}", json={"check_completed": True, "check_step": 5})
        st = c.get(f"/api/sessions/{sid}/status").json()
        self.assertTrue(st["check_completed"])
        self.assertEqual(st["status"], "CHECKING")
        self.assertEqual(self.h.find("sessions", {"session_id": sid})[0]["system_check"]["prnu_enrolled"], True)

    # 2 -----------------------------------------------------------------------------
    def test_02_recruiter_issues_session_and_candidate_opens_link(self):
        c = self.h.client
        s = self.h.create_session(candidate_name="Link Opener", role="Backend Engineer")
        self.assertTrue(s["candidate_url"].startswith("/check/"))
        self.assertEqual(s["dashboard_url"], f"/dashboard/{s['session_id']}")
        opened = c.get(f"/api/sessions/by-token/{s['token']}").json()
        self.assertEqual(opened["candidate_name"], "Link Opener")
        self.assertEqual(opened["token_role"], "candidate")
        self.assertEqual(c.get(f"/api/sessions/by-token/{s['interviewer_token']}").json()["token_role"], "interviewer")

    # 3 -----------------------------------------------------------------------------
    def test_03_live_interview_tab_switch_reaches_recruiter_dashboard(self):
        sid = self.h.create_session()["session_id"]
        with self.h.client.websocket_connect(f"/ws/dashboard/{sid}") as dash:
            self.assertEqual(dash.receive_json()["type"], "SESSION_INFO")
            with self.h.client.websocket_connect(f"/ws/candidate/{sid}") as cand:
                cand.send_json({"type": "TAB_SWITCH"})
                got = _collect(dash, lambda m: m.get("alertType") == "TAB_SWITCH")
        alert = got[-1]
        self.assertEqual(alert["alertType"], "TAB_SWITCH")
        self.assertEqual(alert["module"], "BEHAVIORAL")

    # 4 -----------------------------------------------------------------------------
    def test_04_second_person_in_frame_raises_critical_dashboard_alert(self):
        sid = self.h.create_session()["session_id"]
        with self.h.client.websocket_connect(f"/ws/dashboard/{sid}") as dash:
            dash.receive_json()
            with self.h.client.websocket_connect(f"/ws/candidate/{sid}") as cand:
                cand.send_json({"type": "GAZE", "delta": 0.1, "yaw": 0.0, "face_count": 2, "is_multi_face": True})
                got = _collect(dash, lambda m: m.get("alertType") == "MULTI_FACE_DETECTED")
        self.assertEqual(got[-1]["severity"], "CRITICAL")
        self.assertTrue(_wait(lambda: any(a.get("alertType") == "MULTI_FACE_DETECTED"
                                          for a in self.h.find("alerts", {"session_id": sid}))))

    # 5 -----------------------------------------------------------------------------
    def test_05_monaco_compiler_run_is_synced_to_recruiter(self):
        sid = self.h.create_session()["session_id"]
        with self.h.client.websocket_connect(f"/ws/dashboard/{sid}") as dash:
            dash.receive_json()
            r = self.h.client.post("/api/compiler/run", json={"session_id": sid, "code": "print(sum(range(5)))"})
            self.assertEqual(r.status_code, 200)
            body = r.json()
            self.assertEqual((body["status"], body["stdout"].strip(), body["exit_code"]), ("SUCCESS", "10", 0))
            got = _collect(dash, lambda m: m.get("type") == "CODE_OUTPUT", limit=6)
        self.assertEqual(got[0]["type"], "CODE_RUNNING")
        out = got[-1]
        self.assertEqual((out["type"], out["stdout"].strip(), out["status"]), ("CODE_OUTPUT", "10", "SUCCESS"))

    # 6 -----------------------------------------------------------------------------
    def _seed_finished_session(self):
        s = self.h.create_session(candidate_name="Audit Subject")
        sid, now = s["session_id"], datetime.utcnow()
        for i, score in enumerate((96.0, 88.0, 54.0)):
            self.h.insert("telemetry", {"session_id": sid, "timestamp": now + timedelta(seconds=3 * i),
                                        "trust_score": score,
                                        "breakdown": {"prnu": 30, "rppg": 30 if score > 80 else 0,
                                                      "jitter": 15, "behavioral": 25}})
        self.h.insert("alerts", {"session_id": sid, "alert_id": uid("a"), "alert_type": "LIVENESS_FAIL",
                                 "alertType": "LIVENESS_FAIL", "module": "rPPG", "severity": "CRITICAL",
                                 "message": "No biological pulse detected", "description": "No biological pulse detected",
                                 "value": -5.0, "timestamp": now, "acknowledged": False})
        return sid

    def test_06_pdf_forensic_audit_report_is_generated(self):
        sid = self._seed_finished_session()
        r = self.h.client.get(f"/api/reports/{sid}/pdf")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "application/pdf")
        self.assertIn("attachment", r.headers["content-disposition"])
        self.assertTrue(r.content.startswith(b"%PDF"))
        self.assertIn(b"%%EOF", r.content[-64:])
        self.assertGreater(len(r.content), 3000)

    # 7 -----------------------------------------------------------------------------
    def test_07_report_summary_matches_recorded_telemetry(self):
        sid = self._seed_finished_session()
        s = self.h.client.get(f"/api/reports/{sid}/summary").json()
        self.assertTrue(s["has_data"])
        self.assertEqual((s["final_score"], s["lowest_score"]), (54.0, 54.0))
        self.assertAlmostEqual(s["average_score"], 79.3, places=1)
        self.assertEqual(s["alert_count"], 1)

    # 8 -----------------------------------------------------------------------------
    def test_08_session_lifecycle_pending_active_flagged(self):
        c, sid = self.h.client, self.h.create_session()["session_id"]
        self.assertEqual(c.get(f"/api/sessions/{sid}/status").json()["status"], "PENDING")
        c.patch(f"/api/sessions/{sid}", json={"status": "ACTIVE"})
        self.assertEqual(c.get(f"/api/sessions/{sid}/status").json()["status"], "ACTIVE")
        c.patch(f"/api/sessions/{sid}", json={"status": "FLAGGED"})
        doc = self.h.find("sessions", {"session_id": sid})[0]
        self.assertEqual(doc["status"], "FLAGGED")
        self.assertTrue(doc["flagged_for_review"])
        self.assertEqual(c.get(f"/api/reports/{sid}/summary").json()["status"], "FLAGGED")

    # 9 -----------------------------------------------------------------------------
    def test_09_genuine_candidate_pipeline_is_verified(self):
        rng = np.random.default_rng(10)
        cam = [rng.integers(0, 256, (240, 320, 3), dtype=np.uint8) for _ in range(3)]
        k = prnu.estimate_prnu_reference(cam)
        same_cam = prnu.analyze_frame_prnu(cam[0], k)               # frame from the enrolled camera
        self.assertGreater(same_cam["pce"], prnu.PCE_MATCH)
        r = axiom_fusion_engine(pce=same_cam["pce"], snr_rppg=11.2, cv_jitter=0.04, behavioral_score=0.97,
                                prnu_match=prnu.match_score(same_cam["pce"]), prnu_state="match")
        self.assertGreaterEqual(r["trust_score"], 80)
        self.assertEqual(get_trust_status(r["trust_score"]), "Session Verified")
        self.assertEqual(r["alerts"], [])

    # 10 ----------------------------------------------------------------------------
    def test_10_injected_deepfake_pipeline_drops_to_critical(self):
        rng = np.random.default_rng(11)
        enrolled = [rng.integers(0, 256, (240, 320, 3), dtype=np.uint8) for _ in range(3)]
        k = prnu.estimate_prnu_reference(enrolled)
        injected = rng.integers(0, 256, (240, 320, 3), dtype=np.uint8)   # frame from another source
        res = prnu.analyze_frame_prnu(injected, k)
        self.assertFalse(res["is_authentic"])
        r = axiom_fusion_engine(pce=res["pce"], snr_rppg=-5.0, cv_jitter=0.03, behavioral_score=1.0,
                                prnu_match=prnu.match_score(res["pce"]), prnu_state="mismatch")
        self.assertLess(r["trust_score"], 60)
        self.assertTrue(get_trust_status(r["trust_score"]).startswith("Integrity Alert"))
        self.assertTrue(any(a["severity"] == "CRITICAL" for a in r["alerts"]))


if __name__ == "__main__":
    unittest.main()
