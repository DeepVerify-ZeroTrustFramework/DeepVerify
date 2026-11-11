"""
Active Liveness Challenge — server-verified head-turn challenges.

Why: pre-recorded, AI-generated and re-rendered (deepfake) videos reproduce the
passive signals PRNU/rPPG look at, but they cannot react to a random instruction
issued at an unpredictable moment. This module periodically asks the candidate
to turn their head LEFT/RIGHT in a random order and verifies the movement from
the frames the server actually receives (not from browser-reported numbers, so a
tampered page can't fake a pass).

Flow (per session, driven by frames.py):
    A check is requested (start of interview, interviewer button, or automatic
    in the live demo), then ChallengeManager.on_frame(frame_bgr, now) returns
    messages for the candidate and events the caller turns into alerts.

Rules: no time limit. A step starts counting once the candidate faces the
camera; it passes when the head turns >= THRESH the requested way for CONSEC
frames. A clear, held turn the other way is a wrong attempt (new random
direction). MAX_WRONG wrong attempts -> the interviewer is told it failed, but
the check stays open. The candidate may close it (skip). Mirrored cameras are
handled: the first check learns the orientation from a consistent sequence.
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
# Automatic checks (live demo only; real interviews run on request)
FIRST_DELAY = float(os.getenv('DV_LIVENESS_FIRST_DELAY', '25'))
INTERVAL_MIN = float(os.getenv('DV_LIVENESS_INTERVAL_MIN', '120'))
INTERVAL_MAX = float(os.getenv('DV_LIVENESS_INTERVAL_MAX', '240'))
MIN_LATENCY = 0.25          # faster than this after facing front is not a human reacting
THRESH = 0.13               # yaw change needed (about a 20-25 deg head turn)
WRONG_WAY = 0.16            # a held turn this far the other way = wrong attempt
FRONTAL_MAX = 0.10          # |yaw - normal pose| considered "facing front"
CONSEC = 3                  # frames past THRESH needed for a step to pass (~0.3 s held)
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
#
# A check runs only when asked for: once at the start of the interview (the
# candidate's page asks as soon as identity verification and full screen are
# done) and whenever the interviewer presses "Run liveness check". The live
# demo additionally schedules automatic checks (auto=True).
#
# There is NO time limit. Each step waits until the candidate faces the camera
# ("armed"), then until they turn in the requested direction. A clear, held turn
# the other way is a wrong attempt: the candidate gets a new random direction.
# After MAX_WRONG wrong attempts the interviewer is told the check failed, but
# the check stays open and the candidate may still pass it. The candidate can
# close it at any time (skip); the interviewer is told about that too.
# Nothing here ever stops the interview.

N_STEPS_KNOWN = 2           # steps once the camera orientation is known
N_STEPS_UNKNOWN = 3         # first check: step 1 also learns mirrored/normal
MAX_WRONG = 3               # wrong-direction attempts before "failed" is reported
ARM_FRAMES = 3              # frames facing front before a step starts counting
WRONG_CONSEC = 3            # a wrong turn must be held this many frames
POSE_WINDOW = 20.0          # seconds of normal-pose history used as "front"


@dataclass
class _Step:
    direction: str
    issued_at: float
    armed_at: Optional[float] = None
    arm_count: int = 0
    consec: dict = field(default_factory=lambda: {False: 0, True: 0})
    first_hit: dict = field(default_factory=lambda: {False: None, True: None})
    wrong: dict = field(default_factory=lambda: {False: 0, True: 0})
    face_frames: int = 0
    frames: int = 0
    rel_min: float = 0.0
    rel_max: float = 0.0


@dataclass
class ChallengeManager:
    session_id: str
    yaw_fn: Optional[Callable] = None
    rng: random.Random = field(default_factory=random.Random)

    # public state
    status: str = 'idle'            # idle | active | passed | failed | skipped
    passes: int = 0
    failures: int = 0               # checks reported failed (MAX_WRONG wrong attempts)
    skips: int = 0
    last_fail_reason: str = ''

    # Live demo only: automatic checks
    auto: bool = False
    first_delay: Optional[float] = None
    interval: Optional[tuple] = None
    # Live demo only: a step with no correct turn within this many seconds counts
    # as a wrong attempt (so a still replay visibly fails). None = no time limit.
    step_timeout: Optional[float] = None
    # Live demo only: end the check once it has been reported as failed.
    close_on_fail: bool = False

    # internal
    _pending: Optional[str] = None          # origin of a requested check not yet issued
    _origin: str = ''
    _challenge_id: str = ''
    _seq: List[str] = field(default_factory=list)
    _step_idx: int = 0
    _step: Optional[_Step] = None
    _hyps: tuple = (False, True)
    _mirror: Optional[bool] = None          # camera orientation, learned on the first pass
    _base: Optional[float] = None           # candidate's normal (front) yaw for this check
    _wrong_attempts: int = 0
    _fail_reported: bool = False
    _started_at: float = 0.0
    _reactions: List[float] = field(default_factory=list)
    _yaw_recent: List[tuple] = field(default_factory=list)
    _yaw_long: List[tuple] = field(default_factory=list)
    _first_frame_at: Optional[float] = None
    _next_auto_at: Optional[float] = None

    @property
    def enabled(self) -> bool:
        return ENABLED and self.yaw_fn is not None

    @property
    def active(self) -> bool:
        return self._step is not None

    @property
    def busy(self) -> bool:
        return self._step is not None or self._pending is not None

    # -- requests ------------------------------------------------------------
    def request_now(self, now: Optional[float] = None, origin: str = 'interviewer') -> str:
        """Ask for a check. Returns 'started', 'busy' or 'unavailable'."""
        if not self.enabled:
            return 'unavailable'
        if self.busy:
            return 'busy'
        self._pending = origin
        return 'started'

    def skip(self, now: Optional[float] = None) -> List[dict]:
        """The candidate closed the check."""
        now = time.time() if now is None else now
        if not self.busy:
            return []
        origin = self._origin if self._step is not None else (self._pending or '')
        cid = self._challenge_id or str(uuid.uuid4())[:8]
        print(f"[Liveness] {self.session_id} SKIPPED by candidate (origin={origin}, wrong={self._wrong_attempts})", flush=True)
        self._step = None
        self._pending = None
        self.status = 'skipped'
        self.skips += 1
        self._schedule_auto(now)
        return [{'type': 'LIVENESS_CHALLENGE_RESULT', 'challenge_id': cid,
                 'passed': False, 'skipped': True, 'final': True, 'origin': origin,
                 'wrong_attempts': self._wrong_attempts,
                 'waited_s': round(now - self._started_at, 1) if self._started_at else 0.0,
                 'message': 'Liveness check closed. Your interviewer has been notified.'}]

    def cancel(self, now: Optional[float] = None) -> List[dict]:
        """Kept for compatibility: checks no longer time out, so nothing to cancel."""
        return []

    def _schedule_auto(self, now: float, delay: Optional[float] = None):
        if not self.auto:
            return
        lo, hi = self.interval if self.interval else (INTERVAL_MIN, INTERVAL_MAX)
        self._next_auto_at = now + (delay if delay is not None else self.rng.uniform(lo, hi))

    def _pose_base(self, now: float) -> Optional[float]:
        long_ = [y for t, y in self._yaw_long if now - t <= POSE_WINDOW]
        if len(long_) >= 15:
            return float(np.median(long_))
        recent = [y for t, y in self._yaw_recent if now - t <= 1.5]
        return float(np.median(recent)) if len(recent) >= 3 else None

    # -- per frame -----------------------------------------------------------
    def on_frame(self, frame_bgr, now: Optional[float] = None) -> List[dict]:
        """Feed every received frame (not while the candidate's tab is hidden)."""
        if not self.enabled:
            return []
        now = time.time() if now is None else now
        yaw = self.yaw_fn(frame_bgr)
        if self._first_frame_at is None:
            self._first_frame_at = now
            self._schedule_auto(now, self.first_delay if self.first_delay is not None else FIRST_DELAY)
        if yaw is not None:
            self._yaw_recent.append((now, yaw))
            if self._step is None:
                self._yaw_long.append((now, yaw))
        self._yaw_recent = [(t, y) for t, y in self._yaw_recent if now - t <= 4.0]
        self._yaw_long = [(t, y) for t, y in self._yaw_long if now - t <= POSE_WINDOW]

        if self._step is None:
            if (self.auto and self._pending is None and self._next_auto_at is not None
                    and now >= self._next_auto_at):
                self._pending = 'auto'
            if self._pending is not None:
                return self._begin(now)
            return []
        return self._advance(now, yaw)

    def _begin(self, now: float) -> List[dict]:
        self._origin = self._pending or ''
        self._pending = None
        self._challenge_id = str(uuid.uuid4())[:8]
        self._wrong_attempts = 0
        self._fail_reported = False
        self._started_at = now
        self._reactions = []
        self._base = self._pose_base(now)
        self.status = 'active'
        self._new_sequence()
        print(f"[Liveness] {self.session_id} START origin={self._origin} seq={self._seq} base={self._base} mirror={self._mirror}", flush=True)
        return self._issue_step(now)

    def _new_sequence(self):
        n = N_STEPS_UNKNOWN if self._mirror is None else N_STEPS_KNOWN
        while True:
            self._seq = [self.rng.choice(['LEFT', 'RIGHT']) for _ in range(n)]
            if len(set(self._seq)) > 1:
                break
        self._step_idx = 0
        self._hyps = (False, True) if self._mirror is None else (self._mirror,)

    def _issue_step(self, now: float, note: Optional[str] = None) -> List[dict]:
        d = self._seq[self._step_idx]
        self._step = _Step(direction=d, issued_at=now)
        return [{
            'type': 'LIVENESS_CHALLENGE',
            'challenge_id': self._challenge_id,
            'step': self._step_idx + 1,
            'of': len(self._seq),
            'direction': d,
            'instruction': INSTRUCTIONS[d],
            'timeout_ms': 0,                      # no time limit
            'retry': self._wrong_attempts > 0,
            'note': note,
            'origin': self._origin,
            'wrong_attempts': self._wrong_attempts,
            'max_wrong': MAX_WRONG,
            'failed_reported': self._fail_reported,
        }]

    def _advance(self, now: float, yaw: Optional[float]) -> List[dict]:
        st = self._step
        st.frames += 1
        out: List[dict] = []
        if self.step_timeout is not None and now - st.issued_at >= self.step_timeout:
            return self._wrong_attempt(now, f'no head turn to the {st.direction} within {self.step_timeout:.0f}s')
        rel = None
        if yaw is not None:
            st.face_frames += 1
            if self._base is None:
                self._base = self._pose_base(now)
            if self._base is not None:
                rel = yaw - self._base
                st.rel_min = min(st.rel_min, rel)
                st.rel_max = max(st.rel_max, rel)
        else:
            st.arm_count = 0
            for m in (False, True):
                st.consec[m] = 0
                st.wrong[m] = 0

        if rel is not None:
            if st.armed_at is None:
                st.arm_count = st.arm_count + 1 if abs(rel) <= FRONTAL_MAX else 0
                if st.arm_count >= ARM_FRAMES:
                    st.armed_at = now
            else:
                sign = 1.0 if st.direction == 'LEFT' else -1.0
                since = now - st.armed_at
                for m in self._hyps:
                    sg = -sign if m else sign
                    if sg * rel >= THRESH and since >= MIN_LATENCY:
                        if st.consec[m] == 0:
                            st.first_hit[m] = now
                        st.consec[m] += 1
                    else:
                        st.consec[m] = 0
                    st.wrong[m] = st.wrong[m] + 1 if -sg * rel >= WRONG_WAY else 0
                    if st.consec[m] >= CONSEC:
                        # This orientation explains the step; later steps must match it.
                        self._hyps = (m,)
                        self._reactions.append(max(0.0, (st.first_hit[m] or now) - st.armed_at))
                        return self._step_passed(now)
                if all(st.wrong[m] >= WRONG_CONSEC for m in self._hyps):
                    return self._wrong_attempt(now)

        if st.frames % 3 == 0:
            prog = 0.0
            wrong_pose = False
            if rel is not None and st.armed_at is not None:
                sign = 1.0 if st.direction == 'LEFT' else -1.0
                prog = max(max(0.0, (-sign if m else sign) * rel) for m in self._hyps) / THRESH
                wrong_pose = all(st.wrong[m] > 0 for m in self._hyps)
            out.append({'type': 'LIVENESS_PROGRESS', 'challenge_id': self._challenge_id,
                        'step': self._step_idx + 1, 'face': yaw is not None,
                        'armed': st.armed_at is not None,
                        'progress': round(min(prog, 1.5), 2), 'wrong_way': wrong_pose,
                        'wrong_attempts': self._wrong_attempts})
        return out

    def _wrong_attempt(self, now: float, reason: Optional[str] = None) -> List[dict]:
        st = self._step
        self._wrong_attempts += 1
        reason = reason or f'head turned the wrong way (asked {st.direction})'
        self.last_fail_reason = reason
        print(f"[Liveness] {self.session_id} WRONG attempt {self._wrong_attempts} {st.direction} rel[min={st.rel_min:+.3f} max={st.rel_max:+.3f}] base={self._base}", flush=True)
        out: List[dict] = []
        if self._wrong_attempts >= MAX_WRONG and not self._fail_reported:
            self._fail_reported = True
            self.failures += 1
            self.status = 'failed'
            out.append({'type': 'LIVENESS_CHECK_FAILED', 'challenge_id': self._challenge_id,
                        'origin': self._origin, 'wrong_attempts': self._wrong_attempts,
                        'reason': reason,
                        'message': "That didn't match the instructions. Your interviewer has been "
                                   "notified - you can keep trying or close this check."})
        if self._fail_reported and self.close_on_fail:
            self._step = None
            self._schedule_auto(now)
            return out + [{'type': 'LIVENESS_CHALLENGE_RESULT', 'challenge_id': self._challenge_id,
                           'passed': False, 'final': True, 'origin': self._origin,
                           'reason': reason, 'wrong_attempts': self._wrong_attempts,
                           'message': 'Liveness check could not be completed.'}]
        # Start over with a fresh random sequence (the candidate must come back to front first)
        self._new_sequence()
        return out + self._issue_step(now, note='wrong_way')

    def _step_passed(self, now: float) -> List[dict]:
        st = self._step
        print(f"[Liveness] {self.session_id} PASS step {self._step_idx + 1} {st.direction} hyps={self._hyps} reaction={self._reactions[-1]:.2f}s", flush=True)
        self._step_idx += 1
        if self._step_idx < len(self._seq):
            return self._issue_step(now)
        self._step = None
        self.status = 'passed'
        self.passes += 1
        if self._mirror is None and len(self._hyps) == 1:
            self._mirror = self._hyps[0]
            print(f"[Liveness] {self.session_id} camera orientation learned: {'MIRRORED' if self._mirror else 'normal'}", flush=True)
        self._schedule_auto(now)
        avg = round(float(np.mean(self._reactions)), 2) if self._reactions else None
        return [{'type': 'LIVENESS_CHALLENGE_RESULT', 'challenge_id': self._challenge_id,
                 'passed': True, 'final': True, 'origin': self._origin,
                 'reaction_s': avg, 'wrong_attempts': self._wrong_attempts,
                 'after_fail': self._fail_reported,
                 'total_s': round(now - self._started_at, 1),
                 'message': 'Thanks - liveness check passed.'}]

    def close(self):
        if hasattr(self.yaw_fn, 'close'):
            self.yaw_fn.close()
