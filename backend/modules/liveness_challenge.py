"""
Active Liveness Challenge — server-verified head-turn challenges.

Why: pre-recorded, AI-generated and re-rendered (deepfake) videos reproduce the
passive signals PRNU/rPPG look at, but they cannot react to a random instruction
issued at an unpredictable moment. This module periodically asks the candidate
to turn their head LEFT/RIGHT in a random order and verifies the movement from
the frames the server actually receives (not from browser-reported numbers, so a
tampered page can't fake a pass).

Flow (per session, driven by frames.py):
    ChallengeManager.on_frame(frame_bgr, now) -> list of messages to send to the
    candidate on the frames WebSocket, plus state changes the caller turns into
    alerts / trust-score effects.

Rules for a step to pass (all must hold):
  * face visible and roughly frontal when the step is issued (or within the
    first 1.5 s of it), so a video that is already turned can't pass instantly;
  * yaw moves past +THRESH in the requested direction for >= 2 consecutive
    frames, no earlier than MIN_LATENCY after the instruction (human reaction);
  * the head did not first turn clearly the WRONG way during the step.
A challenge = 2 steps (LEFT/RIGHT in random order). One retry is given after a
failure; a second consecutive failure is a confirmed FAIL.
"""
from __future__ import annotations

import logging
import os
import random
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Tunables (seconds / normalised yaw units) ─────────────────────────────────
FIRST_DELAY = float(os.getenv('DV_LIVENESS_FIRST_DELAY', '25'))     # after face first seen
INTERVAL_MIN = float(os.getenv('DV_LIVENESS_INTERVAL_MIN', '120'))
INTERVAL_MAX = float(os.getenv('DV_LIVENESS_INTERVAL_MAX', '240'))
STEP_TIMEOUT = 8.0          # time allowed per step (UI countdown)
MAX_LATENCY = 5.0           # the turn must happen within this. Humans take ~1–2 s, plus ~2 s
                            # to hear the spoken prompt and network/frame delay
N_STEPS = 3
STILL_STD = 0.035           # yaw std over the 1.5 s before a challenge = 'holding still'
STILL_WAIT = 8.0            # wait up to this long for a still moment, then issue anyway
NO_FACE_WAIT = 15.0         # challenge due but no face: wait this long, then issue anyway (fails closed)
MIN_LATENCY = 0.25          # faster than this is not a human reacting
RETRY_DELAY = 4.0
THRESH = 0.13               # yaw change needed (≈ 20–25° head turn)
WRONG_WAY = 0.16            # clear turn the wrong way first = fail
FRONTAL_MAX = 0.10          # |yaw - baseline| considered "facing front"
CONSEC = 2
ENABLED = os.getenv('DV_LIVENESS_CHALLENGES', '1') == '1'

INSTRUCTIONS = {
    'LEFT': 'Turn your head to your LEFT',
    'RIGHT': 'Turn your head to your RIGHT',
}


# ── Head yaw estimation ──────────────────────────────────────────────────────
class MediaPipeYaw:
    """
    Normalised yaw from MediaPipe FaceMesh landmarks:
        yaw = (nose_x - midpoint(face_edges)) / face_width
    ≈ 0 facing camera, positive = subject turned to THEIR left (image right,
    for the un-mirrored frames the browser sends). None if no face.
    """

    # The browser draws every camera into a 320x240 canvas, so 16:9 and portrait
    # cameras arrive horizontally squashed/stretched. Yaw is a ratio of horizontal
    # distances, so it is unaffected by undoing that; the face detector is not.
    # Widths tried (height 240): as received, 16:9 landscape, 4:3 portrait, 16:9 portrait.
    _WIDTHS = (None, 427, 180, 135)

    def __init__(self):
        import mediapipe as mp  # noqa: F401  (import here: optional dependency)
        self._mp = mp
        self._meshes = {}
        self._good_w = None   # width that last found a face — try it first
        self.last_landmarks = None   # landmarks from the last call (normalised; reused by rPPG)
        self._mesh(None)      # build one now so a broken MediaPipe install fails at startup, not per frame

    def _mesh(self, w):
        if w not in self._meshes:
            self._meshes[w] = self._mp.solutions.face_mesh.FaceMesh(
                static_image_mode=False, max_num_faces=1, refine_landmarks=False,
                min_detection_confidence=0.5, min_tracking_confidence=0.5)
        return self._meshes[w]

    def __call__(self, frame_bgr) -> Optional[float]:
        import cv2
        order = [self._good_w] + [w for w in self._WIDTHS if w != self._good_w]
        res = None
        for w in order:
            img = frame_bgr if w is None else cv2.resize(frame_bgr, (w, frame_bgr.shape[0]))
            res = self._mesh(w).process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            if res.multi_face_landmarks:
                self._good_w = w
                break
        if res is None or not res.multi_face_landmarks:
            self.last_landmarks = None
            return None
        lm = res.multi_face_landmarks[0].landmark
        self.last_landmarks = lm
        nose, right_edge, left_edge = lm[1].x, lm[234].x, lm[454].x  # 234: subject's right (image left)
        width = left_edge - right_edge
        if width < 1e-3:
            return None
        return float((nose - (left_edge + right_edge) / 2.0) / width)

    def close(self):
        for m in self._meshes.values():
            try:
                m.close()
            except Exception:
                pass


def make_yaw_estimator() -> Optional[Callable]:
    try:
        return MediaPipeYaw()
    except Exception as e:  # mediapipe missing / broken → challenges disabled, never false-fail
        logger.warning("[Liveness] MediaPipe unavailable (%s) — liveness challenges disabled", e)
        return None


# ── Challenge state machine ──────────────────────────────────────────────────
@dataclass
class _Step:
    direction: str
    issued_at: float
    baseline: Optional[float]
    frontal_seen: bool = False
    consec: int = 0
    wrong_way: bool = False
    face_frames: int = 0
    rel_min: float = 0.0
    rel_max: float = 0.0
    frames: int = 0


@dataclass
class ChallengeManager:
    session_id: str
    yaw_fn: Optional[Callable] = None
    rng: random.Random = field(default_factory=random.Random)

    # public state
    status: str = 'idle'            # idle | active | passed | failed
    passes: int = 0
    failures: int = 0               # confirmed (after retry) failures
    last_fail_reason: str = ''

    # internal
    _first_face_at: Optional[float] = None
    _next_at: Optional[float] = None
    _seq: List[str] = field(default_factory=list)
    _step_idx: int = 0
    _step: Optional[_Step] = None
    _challenge_id: str = ''
    _attempt: int = 0
    _yaw_hist: List[tuple] = field(default_factory=list)   # (t, yaw) last few seconds
    _base: Optional[float] = None                           # front-facing yaw at challenge start

    @property
    def enabled(self) -> bool:
        return ENABLED and self.yaw_fn is not None

    # -- scheduling ------------------------------------------------------------
    def request_now(self, now: Optional[float] = None):
        """Ask for a challenge as soon as possible (e.g. interviewer button)."""
        now = time.time() if now is None else now
        if self._step is None:
            self._next_at = now

    def _schedule_next(self, now: float, delay: Optional[float] = None):
        self._next_at = now + (delay if delay is not None else self.rng.uniform(INTERVAL_MIN, INTERVAL_MAX))

    def _baseline(self, now: float) -> Optional[float]:
        recent = [y for t, y in self._yaw_hist if now - t <= 1.5]
        return float(np.median(recent)) if len(recent) >= 3 else None

    def _is_still(self, now: float) -> bool:
        recent = [y for t, y in self._yaw_hist if now - t <= 1.5]
        return len(recent) >= 5 and float(np.std(recent)) <= STILL_STD

    def _start(self, now: float, retry: bool) -> List[dict]:
        self._attempt = self._attempt + 1 if retry else 1
        self._challenge_id = str(uuid.uuid4())[:8]
        # Random 3-turn sequence, never all the same direction
        while True:
            self._seq = [self.rng.choice(['LEFT', 'RIGHT']) for _ in range(N_STEPS)]
            if len(set(self._seq)) > 1:
                break
        self._step_idx = 0
        self._base = self._baseline(now)
        self.status = 'active'
        return self._issue_step(now)

    def _issue_step(self, now: float) -> List[dict]:
        d = self._seq[self._step_idx]
        # Every step is measured from the front-facing pose at challenge start,
        # so coming back to centre after step 1 can't count as a turn in step 2.
        self._step = _Step(direction=d, issued_at=now, baseline=self._base)
        print(f"[Liveness] {self.session_id} issue step {self._step_idx + 1}/{len(self._seq)} {d} attempt={self._attempt} base={self._base}", flush=True)
        return [{
            'type': 'LIVENESS_CHALLENGE',
            'challenge_id': self._challenge_id,
            'step': self._step_idx + 1,
            'of': len(self._seq),
            'direction': d,
            'instruction': INSTRUCTIONS[d],
            'timeout_ms': int(STEP_TIMEOUT * 1000),
            'retry': self._attempt > 1,
        }]

    # -- per frame ---------------------------------------------------------------
    def on_frame(self, frame_bgr, now: Optional[float] = None) -> List[dict]:
        """Feed every received frame. Returns messages for the candidate."""
        if not self.enabled:
            return []
        now = time.time() if now is None else now
        yaw = self.yaw_fn(frame_bgr)
        if self._first_face_at is None:
            # Schedule from the first FRAME, not the first detected face — a feed
            # that never shows a usable face must not escape challenges.
            self._first_face_at = now
            self._schedule_next(now, FIRST_DELAY)
        if yaw is not None:
            self._yaw_hist.append((now, yaw))
        self._yaw_hist = [(t, y) for t, y in self._yaw_hist if now - t <= 4.0]

        out: List[dict] = []
        if self._step is None:
            if self._next_at is not None and now >= self._next_at:
                waited = now - self._next_at
                if self._baseline(now) is None and waited < NO_FACE_WAIT:
                    pass  # no face right now — give the candidate a moment to come back
                elif self._baseline(now) is not None and not self._is_still(now) and waited < STILL_WAIT:
                    pass  # wait for a still moment so earlier motion can't count
                else:
                    out += self._start(now, retry=self.status == 'retry_pending')
            return out

        st = self._step
        elapsed = now - st.issued_at
        st.frames += 1
        if yaw is not None:
            st.face_frames += 1
            if st.baseline is None:
                st.baseline = yaw
            rel = yaw - st.baseline
            st.rel_min = min(st.rel_min, rel)
            st.rel_max = max(st.rel_max, rel)
            sign = 1.0 if st.direction == 'LEFT' else -1.0
            # Must pass through front-facing first. Step 1: within 1.5 s of the
            # instruction (a clip that is already turned can't pass). Later steps
            # start from the previous turn, so any time before the turn counts.
            first_step = self._step_idx == 0
            if abs(rel) <= FRONTAL_MAX and (elapsed <= 2.5 or not first_step):
                st.frontal_seen = True
            if st.frontal_seen and -sign * rel >= WRONG_WAY and st.consec == 0:
                st.wrong_way = True
            if st.frontal_seen and sign * rel >= THRESH and MIN_LATENCY <= elapsed <= MAX_LATENCY + 0.3:
                st.consec += 1
            else:
                st.consec = 0
            if st.consec >= CONSEC and st.frontal_seen and not st.wrong_way:
                return self._step_passed(now)

        if elapsed >= STEP_TIMEOUT or (elapsed > MAX_LATENCY + 0.3 and st.consec == 0):
            if st.face_frames == 0:
                reason = 'no face visible during the challenge'
            elif not st.frontal_seen:
                reason = 'face was not facing the camera when the challenge started'
            elif st.wrong_way:
                reason = f'head turned the wrong way (asked {st.direction})'
            else:
                reason = f'no head turn to the {st.direction} within {MAX_LATENCY:.1f}s'
            return self._step_failed(now, reason)
        return out

    def _step_passed(self, now: float) -> List[dict]:
        st = self._step
        print(f"[Liveness] {self.session_id} PASS step {self._step_idx + 1} {st.direction} rel[min={st.rel_min:+.3f} max={st.rel_max:+.3f}] t={now - st.issued_at:.1f}s", flush=True)
        self._step_idx += 1
        if self._step_idx < len(self._seq):
            return self._issue_step(now)
        self._step = None
        self.status = 'passed'
        self.passes += 1
        self._schedule_next(now)
        return [{'type': 'LIVENESS_CHALLENGE_RESULT', 'challenge_id': self._challenge_id,
                 'passed': True, 'message': 'Thanks — liveness check passed.'}]

    def _step_failed(self, now: float, reason: str) -> List[dict]:
        st = self._step
        if st is not None:
            print(f"[Liveness] {self.session_id} FAIL step {self._step_idx + 1} {st.direction}: {reason} | rel[min={st.rel_min:+.3f} max={st.rel_max:+.3f}] need {'+' if st.direction == 'LEFT' else '-'}{THRESH} frames={st.frames} face={st.face_frames} frontal={st.frontal_seen} wrong_way={st.wrong_way} base={st.baseline} attempt={self._attempt}", flush=True)
        self._step = None
        if self._attempt < 2:
            self.status = 'retry_pending'
            self._schedule_next(now, RETRY_DELAY)
            return [{'type': 'LIVENESS_CHALLENGE_RESULT', 'challenge_id': self._challenge_id,
                     'passed': False, 'final': False,
                     'message': "We couldn't confirm that — let's try once more."}]
        self.status = 'failed'
        self.failures += 1
        self.last_fail_reason = reason
        self._schedule_next(now, self.rng.uniform(45, 75))  # re-check sooner after a failure
        return [{'type': 'LIVENESS_CHALLENGE_RESULT', 'challenge_id': self._challenge_id,
                 'passed': False, 'final': True, 'reason': reason,
                 'message': 'Liveness check could not be completed. Your interviewer has been notified.'}]

    def cancel(self, now: Optional[float] = None) -> List[dict]:
        """Abort a running challenge without counting it as a failure (e.g. the
        candidate's tab went to the background, so they can't see the prompt and
        the browser stops updating the camera image). Re-issued soon after."""
        now = time.time() if now is None else now
        if self._step is None:
            return []
        print(f"[Liveness] {self.session_id} CANCELLED step {self._step_idx + 1} (candidate tab hidden)", flush=True)
        self._step = None
        self.status = 'idle'
        self._schedule_next(now, 8.0)
        return [{'type': 'LIVENESS_CHALLENGE_RESULT', 'challenge_id': self._challenge_id,
                 'passed': False, 'final': False, 'cancelled': True,
                 'message': 'Liveness check paused - keep this tab open. It will restart shortly.'}]

    @property
    def active(self) -> bool:
        return self._step is not None

    def close(self):
        if hasattr(self.yaw_fn, 'close'):
            self.yaw_fn.close()
