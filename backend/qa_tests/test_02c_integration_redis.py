"""LEVEL 2 - INTEGRATION (part C: Redis Pub/Sub, 5 tests).
Uses fakeredis (real redis-py asyncio client against an in-process Redis server)."""
import unittest
from qa_tests import _bootstrap  # noqa: F401
from qa_tests._harness import AppHarness, uid
import db.redis_client as rc
from modules.axiom import axiom_fusion_engine


class TestRedisPubSub(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = AppHarness()

    @classmethod
    def tearDownClass(cls):
        cls.h.close()

    def test_01_trust_score_published_on_session_channel(self):
        sid = uid("S"); ps = self.h.subscribe(f"trust_score:{sid}")
        self.h.run(rc.publish_trust_score, sid, {"type": "TRUST_UPDATE", "trust_score": 91.5})
        self.assertEqual(self.h.drain(ps), [{"type": "TRUST_UPDATE", "trust_score": 91.5}])

    def test_02_alert_published_on_alert_channel(self):
        sid = uid("S"); ps = self.h.subscribe(f"alerts:{sid}")
        self.h.run(rc.publish_alert, sid, {"alertType": "TAB_SWITCH", "severity": "MEDIUM"})
        got = self.h.drain(ps)
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["alertType"], "TAB_SWITCH")

    def test_03_channels_are_isolated_between_sessions(self):
        a, b = uid("A"), uid("B")
        ps_a = self.h.subscribe(f"alerts:{a}")
        self.h.run(rc.publish_alert, b, {"alertType": "OTHER_SESSION"})
        self.assertEqual(self.h.drain(ps_a, wait=0.3), [])

    def test_04_code_channel_and_combined_subscription(self):
        sid = uid("S")
        ps = self.h.run(rc.get_pubsub, sid)          # trust + alerts + code channels together
        self.h.run(rc.publish_code_update, sid, {"type": "CODE_CHANGE", "code": "print(1)"})
        self.h.run(rc.publish_trust_score, sid, {"trust_score": 70})

        async def _read():
            import json
            out = []
            for _ in range(6):
                m = await ps.get_message(ignore_subscribe_messages=True, timeout=0.4)
                if m:
                    out.append((m["channel"], json.loads(m["data"])))
            return out
        got = dict(self.h.run(_read))
        self.assertEqual(got[f"code:{sid}"]["code"], "print(1)")
        self.assertEqual(got[f"trust_score:{sid}"]["trust_score"], 70)

    def test_05_axiom_alert_payload_survives_json_round_trip(self):
        sid = uid("S"); ps = self.h.subscribe(f"alerts:{sid}")
        fused = axiom_fusion_engine(pce=5, snr_rppg=-5, cv_jitter=5, behavioral_score=0)
        for alert in fused["alerts"]:
            self.h.run(rc.publish_alert, sid, alert)
        got = self.h.drain(ps)
        self.assertEqual([a["alert_id"] for a in got], [a["alert_id"] for a in fused["alerts"]])
        self.assertEqual({a["severity"] for a in got}, {a["severity"] for a in fused["alerts"]})


if __name__ == "__main__":
    unittest.main()
