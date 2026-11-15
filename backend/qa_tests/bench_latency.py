"""Latency benchmark (NFR: alert latency < 1.0 s).

 1. Compute path : native-res frame -> PRNU analysis -> AXIOM fusion
 2. Alert path   : candidate WebSocket event -> backend -> Redis Pub/Sub -> recruiter dashboard WebSocket
                   (real app, in-memory Redis/Mongo; excludes real network and browser time)

    python -m qa_tests.bench_latency            (from backend/)
"""
import statistics
import time

import numpy as np

from qa_tests import _bootstrap  # noqa: F401
from qa_tests._harness import AppHarness
from modules import prnu
from modules.axiom import axiom_fusion_engine


def _stats(label, xs):
    xs = sorted(xs)
    p95 = xs[max(0, int(0.95 * len(xs)) - 1)]
    print(f"{label:<34} n={len(xs):<4} mean={statistics.mean(xs):7.1f} ms  median={statistics.median(xs):7.1f} ms  "
          f"p95={p95:7.1f} ms  max={xs[-1]:7.1f} ms")


def compute_path(n=100):
    rng = np.random.default_rng(0)
    mk = lambda: rng.integers(0, 256, (240, 320, 3), dtype=np.uint8)
    k = prnu.estimate_prnu_reference([mk() for _ in range(3)])
    prnu.analyze_frame_prnu(mk(), k)                      # warm-up (first call lazily initialises)
    out = []
    for _ in range(n):
        f = mk()
        t = time.perf_counter()
        res = prnu.analyze_frame_prnu(f, k)
        axiom_fusion_engine(pce=res["pce"], snr_rppg=-5, cv_jitter=0.03, behavioral_score=1,
                            prnu_match=prnu.match_score(res["pce"]), prnu_state="mismatch")
        out.append((time.perf_counter() - t) * 1000)
    _stats("compute: frame -> PRNU -> AXIOM", out)
    return out


def alert_path(n=60):
    h = AppHarness()
    sid = h.create_session()["session_id"]
    out = []
    with h.client.websocket_connect(f"/ws/dashboard/{sid}") as dash:
        dash.receive_json()
        with h.client.websocket_connect(f"/ws/candidate/{sid}") as cand:
            for _ in range(n):
                t = time.perf_counter()
                cand.send_json({"type": "TAB_SWITCH"})
                while dash.receive_json().get("alertType") != "TAB_SWITCH":
                    pass
                out.append((time.perf_counter() - t) * 1000)
    h.close()
    _stats("alert: candidate WS -> dashboard WS", out)
    return out


if __name__ == "__main__":
    a = compute_path()
    b = alert_path()
    worst = max(max(a), max(b))
    print(f"NFR < 1000 ms: {'MET' if worst < 1000 else 'NOT MET'} (worst observed {worst:.1f} ms)")
