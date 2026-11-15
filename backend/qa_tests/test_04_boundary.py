"""LEVEL 4 - BOUNDARY & ERROR TESTS (12 edge cases).
Camera disable, missing pulse, tab switching, copy-paste block, injected deepfakes,
score clamping, bad tokens, bad consent, compiler limits, malformed socket data, AWS errors.
"""
import time
import unittest

import boto3
import numpy as np
from botocore.stub import Stubber

from qa_tests import _bootstrap  # noqa: F401
from qa_tests._harness import AppHarness, uid
from modules import prnu
from modules.axiom import axiom_fusion_engine as fuse, get_trust_status
from modules.face_verifier import face_verifier_service as svc
from modules.rppg import compute_pos_signal, detect_liveness

OK = dict(pce=80.0, snr_rppg=8.0, cv_jitter=0.03, behavioral_score=1.0)


def _wait(pred, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.05)
    return False


class TestBoundaryAndErrors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = AppHarness()

    @classmethod
    def tearDownClass(cls):
        cls.h.close()

    def _candidate_events(self, events, settle=0.4):
        sid = self.h.create_session()["session_id"]
        ps = self.h.subscribe(f"alerts:{sid}")
        with self.h.client.websocket_connect(f"/ws/candidate/{sid}") as ws:
            for e in events:
                ws.send_json(e)
            time.sleep(settle)
            alerts = self.h.drain(ps, wait=0.5)
        return sid, alerts

    # 1 ----------------------------------------------------------------------------------
    def test_01_camera_disabled_zeroes_trust_and_alerts_critical(self):
        r = fuse(**OK, camera_active=False)
        self.assertEqual(r["trust_score"], 0.0)
        self.assertTrue(all(v == 0.0 for v in r["breakdown"].values()))
        self.assertEqual(r["alerts"][0]["severity"], "CRITICAL")
        self.assertTrue(get_trust_status(r["trust_score"]).startswith("Integrity Alert"))

    # 2 ----------------------------------------------------------------------------------
    def test_02_missing_pulse_is_not_live_and_flags_critical(self):
        flat = [(180.0, 120.0, 100.0)] * 360                    # camera sees no colour change at all
        live, snr, bpm = detect_liveness(compute_pos_signal(flat, 30.0), fs=30.0, rgb_window=flat)
        self.assertEqual((live, bpm), (False, 0.0))
        self.assertLess(fuse(**{**OK, "snr_rppg": snr})["breakdown"]["rppg"], 30.0)   # points withheld
        r = fuse(**{**OK, "snr_rppg": -5.0})                    # synthetic face: strongly negative SNR
        self.assertTrue(any(a["module"] == "rPPG" and a["severity"] == "CRITICAL" for a in r["alerts"]))
        self.assertEqual(r["breakdown"]["rppg"], 0.0)

    # 3 ----------------------------------------------------------------------------------
    def test_03_repeated_tab_switching_escalates_to_high(self):
        _, alerts = self._candidate_events([{"type": "TAB_SWITCH"}] * 3)
        tab = [a for a in alerts if a.get("alertType") == "TAB_SWITCH"]
        self.assertEqual(len(tab), 3)
        self.assertEqual([a["severity"] for a in tab], ["MEDIUM", "MEDIUM", "HIGH"])
        self.assertEqual(len({a["alertId"] for a in tab}), 3)         # unique ids, none dropped

    # 4 ----------------------------------------------------------------------------------
    def test_04_copy_paste_attempts_are_blocked_and_reported(self):
        sid, alerts = self._candidate_events([
            {"type": "CLIPBOARD_VIOLATION", "action": "Ctrl+C"},
            {"type": "LARGE_PASTE", "char_count": 850}])
        kinds = {a["alertType"]: a for a in alerts}
        self.assertEqual(kinds["CLIPBOARD_VIOLATION"]["severity"], "MEDIUM")
        self.assertEqual(kinds["LARGE_PASTE"]["severity"], "HIGH")
        self.assertTrue(_wait(lambda: len(self.h.find("behavioral_events", {"session_id": sid})) == 2))

    # 5 ----------------------------------------------------------------------------------
    def test_05_injected_video_from_another_source_fails_identity(self):
        rng = np.random.default_rng(42)
        k = prnu.estimate_prnu_reference([rng.integers(0, 256, (240, 320, 3), dtype=np.uint8) for _ in range(3)])
        res = prnu.analyze_frame_prnu(rng.integers(0, 256, (240, 320, 3), dtype=np.uint8), k)
        self.assertFalse(res["is_authentic"])
        r = fuse(**{**OK, "pce": res["pce"]}, prnu_match=prnu.match_score(res["pce"]), prnu_state="mismatch")
        self.assertEqual(r["breakdown"]["prnu"], 0.0)
        self.assertLess(r["trust_score"], 80)

    # 6 ----------------------------------------------------------------------------------
    def test_06_extreme_inputs_are_clamped_to_0_100(self):
        for kw in (dict(pce=-5, snr_rppg=-100, cv_jitter=9, behavioral_score=-3),
                   dict(pce=1e9, snr_rppg=1e9, cv_jitter=0, behavioral_score=99)):
            r = fuse(**kw)
            self.assertTrue(0.0 <= r["trust_score"] <= 100.0)
            for v in r["breakdown"].values():
                if v is not None:
                    self.assertTrue(0.0 <= v <= 30.0)

    # 7 ----------------------------------------------------------------------------------
    def test_07_garbage_token_and_unknown_ids_are_rejected(self):
        c = self.h.client
        self.assertEqual(c.get("/api/sessions/by-token/not.a.jwt").status_code, 401)
        for path in (f"/api/sessions/{uid('X')}", f"/api/sessions/{uid('X')}/status",
                     f"/api/reports/{uid('X')}/summary", f"/api/reports/{uid('X')}/pdf"):
            self.assertEqual(c.get(path).status_code, 404, path)

    # 8 ----------------------------------------------------------------------------------
    def test_08_wrong_consent_text_and_invalid_body_are_refused(self):
        c, sid = self.h.client, self.h.create_session()["session_id"]
        self.assertEqual(c.post(f"/api/sessions/{sid}/consent", json={"consent_text": "I consent"}).status_code, 400)
        self.assertEqual(c.post(f"/api/sessions/{sid}/consent", json={}).status_code, 422)
        self.assertEqual(c.post(f"/api/sessions/{uid('X')}/consent", json={"consent_text": "I CONSENT"}).status_code, 404)
        self.assertEqual(c.post("/api/sessions", json={"candidate_name": ""}).status_code, 422)

    # 9 ----------------------------------------------------------------------------------
    def test_09_runaway_code_is_killed_by_the_timeout(self):
        sid = self.h.create_session()["session_id"]
        t = time.time()
        r = self.h.client.post("/api/compiler/run", json={"session_id": sid, "code": "while True: pass"}).json()
        self.assertEqual(r["status"], "TIMEOUT")
        self.assertLess(time.time() - t, 15.0)

    # 10 ---------------------------------------------------------------------------------
    def test_10_empty_and_broken_code_return_clean_errors(self):
        sid = self.h.create_session()["session_id"]
        empty = self.h.client.post("/api/compiler/run", json={"session_id": sid, "code": "   "}).json()
        self.assertEqual((empty["status"], empty["exit_code"]), ("ERROR", 1))
        broken = self.h.client.post("/api/compiler/run", json={"session_id": sid, "code": "def ("}).json()
        self.assertNotEqual(broken["exit_code"], 0)
        self.assertIn("SyntaxError", broken["stderr"])

    # 11 ---------------------------------------------------------------------------------
    def test_11_malformed_socket_messages_do_not_kill_the_stream(self):
        sid = self.h.create_session()["session_id"]
        ps = self.h.subscribe(f"alerts:{sid}")
        with self.h.client.websocket_connect(f"/ws/candidate/{sid}") as ws:
            ws.send_text("{not json")
            ws.send_json({"type": "UNKNOWN_EVENT_TYPE"})
            ws.send_json({"type": "TAB_SWITCH"})          # must still be processed afterwards
            time.sleep(0.4)
            alerts = self.h.drain(ps, wait=0.5)
        self.assertEqual([a["alertType"] for a in alerts if a.get("alertType") == "TAB_SWITCH"], ["TAB_SWITCH"])

    # 12 ---------------------------------------------------------------------------------
    def test_12_aws_rekognition_errors_are_returned_not_raised(self):
        saved = svc._rekognition_client
        client = boto3.client("rekognition", region_name="us-east-1",
                              aws_access_key_id="testing", aws_secret_access_key="testing")
        stub = Stubber(client)
        stub.add_client_error("detect_faces", service_error_code="ThrottlingException",
                              service_message="Rate exceeded")
        svc._rekognition_client = client
        try:
            with stub:
                r = svc.validate_reference_photo(b"\xff\xd8" + b"x" * 2000)
            self.assertFalse(r["valid"])
            self.assertEqual(r["error_code"], "ThrottlingException")
            tiny = svc.validate_reference_photo(b"tiny")          # corrupt / too small, no AWS call
            self.assertEqual(tiny["error_code"], "INVALID_IMAGE")
        finally:
            svc._rekognition_client = saved


if __name__ == "__main__":
    unittest.main()
