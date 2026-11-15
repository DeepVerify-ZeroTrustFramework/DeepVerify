"""LEVEL 2 - INTEGRATION (part D: WebSocket frame / telemetry ingestion, 7 tests)."""
import time
import unittest
from starlette.websockets import WebSocketDisconnect
from qa_tests import _bootstrap  # noqa: F401
from qa_tests._harness import AppHarness, uid, jpeg_bytes, prnu_packet
import api.routes.frames as frames_mod


def _wait(pred, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.05)
    return False


class TestWebSocketIngestion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = AppHarness()

    @classmethod
    def tearDownClass(cls):
        cls.h.close()

    def test_01_frames_socket_rejects_unknown_session(self):
        with self.assertRaises(WebSocketDisconnect) as ctx:
            with self.h.client.websocket_connect(f"/ws/frames/{uid('NOPE')}") as ws:
                ws.receive_text()
        self.assertEqual(ctx.exception.code, 4004)

    def test_02_jpeg_i_frames_are_ingested_and_counted(self):
        sid = self.h.create_session()["session_id"]
        with self.h.client.websocket_connect(f"/ws/frames/{sid}") as ws:
            for i in range(3):
                ws.send_bytes(jpeg_bytes(seed=i))
            self.assertTrue(_wait(lambda: frames_mod._session_analyzers.get(sid, {}).get("frame_count", 0) >= 3))
            an = frames_mod._session_analyzers[sid]
            self.assertTrue(an["camera_active"])
            self.assertEqual(an["frame_count"], 3)

    def test_03_prnu_crop_packet_reaches_the_prnu_tracker(self):
        sid = self.h.create_session()["session_id"]
        with self.h.client.websocket_connect(f"/ws/frames/{sid}") as ws:
            ws.send_bytes(prnu_packet(1280, 720, seed=1))
            self.assertTrue(_wait(lambda: frames_mod._session_analyzers.get(sid, {}).get("prnu_state") is not None))
            self.assertIsNotNone(frames_mod._session_analyzers[sid]["prnu_state"])

    def test_04_behavioural_events_are_persisted_and_alerted(self):
        sid = self.h.create_session()["session_id"]
        ps = self.h.subscribe(f"alerts:{sid}")
        with self.h.client.websocket_connect(f"/ws/candidate/{sid}") as ws:
            ws.send_json({"type": "TAB_SWITCH"})
            self.assertTrue(_wait(lambda: len(self.h.find("behavioral_events", {"session_id": sid})) >= 1))
        alerts = [a for a in self.h.drain(ps) if a.get("alertType") == "TAB_SWITCH"]
        self.assertEqual(len(alerts), 1)
        self.assertEqual(self.h.find("behavioral_events", {"session_id": sid})[0]["type"], "TAB_SWITCH")

    def test_05_multi_face_gaze_message_raises_critical_alert(self):
        sid = self.h.create_session()["session_id"]
        ps = self.h.subscribe(f"alerts:{sid}")
        with self.h.client.websocket_connect(f"/ws/candidate/{sid}") as ws:
            ws.send_json({"type": "GAZE", "delta": 0.1, "yaw": 0.0, "face_count": 2, "is_multi_face": True})
            alerts = self.h.drain(ps)
        multi = [a for a in alerts if a.get("alertType") == "MULTI_FACE_DETECTED"]
        self.assertEqual(len(multi), 1)
        self.assertEqual(multi[0]["severity"], "CRITICAL")

    def test_06_dashboard_socket_rejects_unknown_session(self):
        with self.h.client.websocket_connect(f"/ws/dashboard/{uid('NOPE')}") as ws:
            self.assertEqual(ws.receive_json(), {"error": "Session not found"})
            with self.assertRaises(WebSocketDisconnect) as ctx:
                ws.receive_json()
        self.assertEqual(ctx.exception.code, 4004)

    def test_07_dashboard_socket_sends_session_info_first(self):
        s = self.h.create_session(candidate_name="Dash Board")
        with self.h.client.websocket_connect(f"/ws/dashboard/{s['session_id']}") as ws:
            first = ws.receive_json()
        self.assertEqual(first["type"], "SESSION_INFO")
        self.assertEqual(first["candidate_name"], "Dash Board")
        self.assertEqual(first["session_id"], s["session_id"])


if __name__ == "__main__":
    unittest.main()
