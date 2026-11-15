"""LEVEL 1 - UNIT TESTING (14 tests)
Subsystems: PRNU wavelet extraction, rPPG peak detection, AXIOM score weighting, JWT generation.
All tests call the real project modules (no re-implemented logic).
Run:  python -m unittest qa_tests.test_01_unit -v      (from backend/)
"""
import unittest
from datetime import timedelta

import numpy as np
from fastapi import HTTPException
from jose import jwt

from qa_tests import _bootstrap  # noqa: F401
from api.routes.session import create_jwt, decode_jwt, JWT_SECRET, JWT_ALGORITHM
from auth import security as sec
from modules import prnu
from modules.axiom import axiom_fusion_engine, get_trust_status, get_trust_color
from modules.rppg import compute_pos_signal, detect_liveness

GENUINE = dict(pce=80.0, snr_rppg=8.0, cv_jitter=0.03, behavioral_score=1.0)


def _frames(n, seed, h=240, w=320):
    rng = np.random.default_rng(seed)
    return [rng.integers(0, 256, (h, w, 3), dtype=np.uint8) for _ in range(n)]


def _rgb_series(hz=None, seconds=12, fs=30.0, seed=1):
    """Synthetic skin-colour time series; hz=None gives no pulse (pure noise)."""
    rng = np.random.default_rng(seed)
    t = np.arange(0, seconds, 1 / fs)
    if hz is None:
        return [tuple(rng.normal(120, 3, 3)) for _ in t]
    p = np.sin(2 * np.pi * hz * t)
    return [(180 + 0.5 * a + rng.normal(0, .05), 120 + a + rng.normal(0, .05), 100 + 0.3 * a + rng.normal(0, .05))
            for a in p]


class TestPRNUWaveletExtraction(unittest.TestCase):
    def test_01_noise_residual_has_input_shape(self):
        frame = _frames(1, 0, 100, 100)[0]
        self.assertEqual(prnu.extract_noise_residual(frame).shape, (100, 100, 3))

    def test_02_reference_fingerprint_is_finite_and_full_size(self):
        k = prnu.estimate_prnu_reference(_frames(3, 1))
        self.assertEqual(k.shape, (240, 320, 3))
        self.assertTrue(np.isfinite(k).all())

    def test_03_match_score_bands(self):
        self.assertEqual(prnu.match_score(prnu.PCE_MATCH + 1), 1.0)
        self.assertEqual(prnu.match_score(prnu.PCE_MISMATCH - 1), 0.0)
        self.assertEqual(prnu.match_score((prnu.PCE_MATCH + prnu.PCE_MISMATCH) / 2), 0.5)


class TestRPPGPeakDetection(unittest.TestCase):
    def test_04_detects_72_bpm_pulse(self):
        ts = _rgb_series(hz=1.2)
        live, snr, bpm = detect_liveness(compute_pos_signal(ts, 30.0), fs=30.0, rgb_window=ts)
        self.assertTrue(live)
        self.assertAlmostEqual(bpm, 72.0, delta=3.0)
        self.assertGreater(snr, 3.0)

    def test_05_noise_without_pulse_is_not_live(self):
        ts = _rgb_series(hz=None)
        live, snr, _ = detect_liveness(compute_pos_signal(ts, 30.0), fs=30.0, rgb_window=ts)
        self.assertFalse(live)
        self.assertLess(snr, 3.0)

    def test_06_pos_projection_output_length_and_short_input(self):
        self.assertEqual(len(compute_pos_signal(_rgb_series(hz=1.2), 30.0)), 360)
        self.assertEqual(len(compute_pos_signal(_rgb_series(hz=1.2)[:10], 30.0)), 0)


class TestAxiomScoreWeighting(unittest.TestCase):
    def test_07_layer_weights_cap_at_30_30_15_25(self):
        r = axiom_fusion_engine(pce=1e6, snr_rppg=1e3, cv_jitter=0.0, behavioral_score=5.0)
        self.assertEqual(r["breakdown"]["prnu"], 30.0)
        self.assertEqual(r["breakdown"]["rppg"], 30.0)
        self.assertEqual(r["breakdown"]["jitter"], 15.0)
        self.assertEqual(r["breakdown"]["behavioral"], 25.0)
        self.assertEqual(r["trust_score"], 100.0)

    def test_08_genuine_candidate_is_verified_with_no_alerts(self):
        r = axiom_fusion_engine(**GENUINE)
        self.assertGreaterEqual(r["trust_score"], 80)
        self.assertEqual(get_trust_status(r["trust_score"]), "Session Verified")
        self.assertEqual(r["alerts"], [])

    def test_09_zero_trust_prnu_and_rppg_failure_cannot_pass(self):
        r = axiom_fusion_engine(pce=0.0, snr_rppg=-50.0, cv_jitter=0.03, behavioral_score=1.0,
                                prnu_match=0.0, prnu_state="mismatch")
        self.assertLess(r["trust_score"], 60)
        self.assertEqual(r["breakdown"]["prnu"], 0.0)
        self.assertEqual(r["breakdown"]["rppg"], 0.0)

    def test_10_verdict_bands_and_colours(self):
        self.assertEqual(get_trust_status(80), "Session Verified")
        self.assertEqual(get_trust_status(60), "Caution")
        self.assertTrue(get_trust_status(59.9).startswith("Integrity Alert"))
        self.assertEqual((get_trust_color(95), get_trust_color(70), get_trust_color(10)),
                         ("#2E7D32", "#E07B00", "#C62828"))


class TestJWTGeneration(unittest.TestCase):
    def test_11_access_token_round_trip_keeps_claims(self):
        p = sec.decode_access_token(sec.create_access_token({"sub": "u1", "role": "recruiter"}))
        self.assertEqual((p["sub"], p["role"]), ("u1", "recruiter"))
        self.assertIn("exp", p)

    def test_12_expired_token_rejected_with_401(self):
        t = sec.create_access_token({"sub": "u1"}, expires_delta=timedelta(seconds=-5))
        with self.assertRaises(HTTPException) as c:
            sec.decode_access_token(t)
        self.assertEqual(c.exception.status_code, 401)

    def test_13_tampered_or_foreign_signature_rejected(self):
        good = sec.create_access_token({"sub": "u1"})
        forged = jwt.encode({"sub": "evil"}, "another-secret", algorithm="HS256")
        for bad in (good[:-3] + "abc", forged):
            with self.assertRaises(HTTPException):
                sec.decode_access_token(bad)

    def test_14_session_token_is_scoped_to_session_and_role(self):
        p = decode_jwt(create_jwt("DV-2025-0001", "candidate"))
        self.assertEqual((p["session_id"], p["role"]), ("DV-2025-0001", "candidate"))
        self.assertEqual(jwt.decode(create_jwt("S", "interviewer"), JWT_SECRET, algorithms=[JWT_ALGORITHM])["role"],
                         "interviewer")


if __name__ == "__main__":
    unittest.main()
