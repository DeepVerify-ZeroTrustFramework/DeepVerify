"""Reproduces the observations listed in docs/testing/DEFECT_LOG.md, one by one, against the real code.
This is NOT part of the 60-test suite (the file name does not start with test_); it demonstrates behaviour.

    python -m qa_tests.repro_observations            (from backend/)
"""
import numpy as np

from qa_tests import _bootstrap  # noqa: F401
from qa_tests._harness import AppHarness
from modules import prnu
from modules.axiom import axiom_fusion_engine, get_trust_status
from modules.rppg import compute_pos_signal, detect_liveness


def show(tag, text):
    print(f"[{tag}] {text}")


def obs_01_weak_pulse_deepfake():
    rng = np.random.default_rng(11)
    k = prnu.estimate_prnu_reference([rng.integers(0, 256, (240, 320, 3), dtype=np.uint8) for _ in range(3)])
    res = prnu.analyze_frame_prnu(rng.integers(0, 256, (240, 320, 3), dtype=np.uint8), k)   # foreign sensor
    for snr in (-5.0, 1.0):
        r = axiom_fusion_engine(pce=res["pce"], snr_rppg=snr, cv_jitter=0.03, behavioral_score=1.0,
                                prnu_match=prnu.match_score(res["pce"]), prnu_state="mismatch")
        show("DL-01", f"PRNU mismatch + SNR {snr:+.1f} dB -> score {r['trust_score']}, "
                      f"{get_trust_status(r['trust_score'])}, alerts={[a['severity'] for a in r['alerts']]}")


def obs_02_flat_signal_sentinel():
    flat = [(180.0, 120.0, 100.0)] * 360
    live, snr, bpm = detect_liveness(compute_pos_signal(flat, 30.0), fs=30.0, rgb_window=flat)
    r = axiom_fusion_engine(pce=80, snr_rppg=snr, cv_jitter=0.03, behavioral_score=1.0)
    show("DL-02", f"flat (no-signal) feed -> detect_liveness={(live, snr, bpm)}, rPPG points={r['breakdown']['rppg']}/30, "
                  f"alerts={len(r['alerts'])}")


def obs_03_raw_pce_does_not_zero_prnu():
    a = axiom_fusion_engine(pce=0.0, snr_rppg=8, cv_jitter=0.03, behavioral_score=1.0)
    b = axiom_fusion_engine(pce=0.0, snr_rppg=8, cv_jitter=0.03, behavioral_score=1.0, prnu_match=0.0, prnu_state="mismatch")
    show("DL-03", f"pce=0 only -> PRNU {a['breakdown']['prnu']}/30 ; with prnu_match=0 + mismatch -> {b['breakdown']['prnu']}/30")


def obs_04_05_unauthenticated_endpoints_and_unsandboxed_code():
    h = AppHarness()
    try:
        r = h.client.post("/api/sessions", json={"candidate_name": "Anon", "candidate_email": "a@b.com",
                                                 "interviewer_name": "Nobody"})          # no Authorization header
        show("DL-04", f"POST /api/sessions without any token -> HTTP {r.status_code}")
        sid = r.json()["session_id"]
        code = "import os; print('requirements.txt' in os.listdir('.'))"
        r = h.client.post("/api/compiler/run", json={"session_id": sid, "code": code}).json()      # no token either
        show("DL-04", f"POST /api/compiler/run without any token -> status {r['status']}")
        show("DL-05", f"submitted code ran as the server process and could see the server's folder: "
                      f"{r['stdout'].strip().splitlines()}")
    finally:
        h.close()


if __name__ == "__main__":
    obs_01_weak_pulse_deepfake()
    obs_02_flat_signal_sentinel()
    obs_03_raw_pce_does_not_zero_prnu()
    obs_04_05_unauthenticated_endpoints_and_unsandboxed_code()
