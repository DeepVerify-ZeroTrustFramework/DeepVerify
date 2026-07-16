"""
Behavioral Telemetry Scoring Module.

Computes a composite behavioral score B ∈ [0, 1] from 4 sub-scores:
- Gaze deviation (weight 0.35)
- Tab switch frequency (weight 0.25)
- Clipboard paste activity (weight 0.20)
- Head pose extremity (weight 0.20)

Per-session thresholds are calibrated from the Phase 0 baseline enrollment.
Global fixed thresholds are NOT used — this is the fairness fix from §VII.B.

B = w1*(gaze_score) + w2*(switch_score) + w3*(paste_score) + w4*(pose_score)
"""
import numpy as np
from typing import Dict, List, Optional
from collections import defaultdict
import time


# Weights from paper §IV.E
W_GAZE = 0.35
W_TAB_SWITCH = 0.25
W_CLIPBOARD = 0.20
W_HEAD_POSE = 0.20


class BehavioralTracker:
    """
    Stateful behavioral telemetry tracker for a single session.
    Accumulates events and gaze/pose data, computes behavioral score on demand.
    """

    def __init__(self, session_id: str, gaze_lambda: float = 0.3):
        self.session_id = session_id
        self.gaze_lambda = gaze_lambda  # Per-session calibrated threshold from enrollment

        # Event buffers
        self.tab_switch_times: List[float] = []
        self.window_blur_times: List[float] = []
        self.large_paste_times: List[float] = []
        self.large_paste_sizes: List[int] = []

        # Gaze and pose data (continuous stream)
        self.gaze_deltas: List[float] = []
        self.gaze_timestamps: List[float] = []
        self.yaw_readings: List[float] = []
        self.pitch_readings: List[float] = []
        self.roll_readings: List[float] = []

        # Counters for dashboard display
        self.total_tab_switches: int = 0
        self.total_large_pastes: int = 0

    def record_event(self, event_type: str, timestamp: Optional[float] = None,
                     metadata: Optional[Dict] = None):
        """Record a behavioral event from the candidate's browser."""
        ts = timestamp or time.time()
        metadata = metadata or {}

        if event_type == "TAB_SWITCH":
            self.tab_switch_times.append(ts)
            self.total_tab_switches += 1
        elif event_type == "WINDOW_BLUR":
            self.window_blur_times.append(ts)
        elif event_type == "LARGE_PASTE":
            self.large_paste_times.append(ts)
            self.large_paste_sizes.append(metadata.get("charCount", 0))
            self.total_large_pastes += 1

    def record_gaze_data(self, gaze_x: float, gaze_y: float, delta: float,
                         yaw: float, pitch: float, roll: float,
                         timestamp: Optional[float] = None):
        """Record gaze and head pose data from MediaPipe."""
        ts = timestamp or time.time()
        self.gaze_deltas.append(delta)
        self.gaze_timestamps.append(ts)
        self.yaw_readings.append(yaw)
        self.pitch_readings.append(pitch)
        self.roll_readings.append(roll)

        # Keep buffers manageable
        max_buffer = 3600  # ~30 minutes at 2Hz
        if len(self.gaze_deltas) > max_buffer:
            self.gaze_deltas = self.gaze_deltas[-max_buffer // 2:]
            self.gaze_timestamps = self.gaze_timestamps[-max_buffer // 2:]
            self.yaw_readings = self.yaw_readings[-max_buffer // 2:]
            self.pitch_readings = self.pitch_readings[-max_buffer // 2:]
            self.roll_readings = self.roll_readings[-max_buffer // 2:]

    def compute_score(self) -> float:
        """
        Compute composite behavioral score B ∈ [0, 1].

        B = w1*(gaze_score) + w2*(switch_score) + w3*(paste_score) + w4*(pose_score)

        Each sub-score is 1.0 (good) to 0.0 (bad).
        """
        gaze_score = self._compute_gaze_score()
        switch_score = self._compute_switch_score()
        paste_score = self._compute_paste_score()
        pose_score = self._compute_pose_score()

        B = (W_GAZE * gaze_score +
             W_TAB_SWITCH * switch_score +
             W_CLIPBOARD * paste_score +
             W_HEAD_POSE * pose_score)

        return float(B)

    def _compute_gaze_score(self) -> float:
        """
        Gaze deviation score (0=bad, 1=good).
        Measures fraction of recent samples with sustained off-screen gaze.
        """
        if len(self.gaze_deltas) < 10:
            return 1.0  # Not enough data — assume good

        # Use last 60 samples (~30 seconds at 2Hz)
        recent = self.gaze_deltas[-60:]
        sustained_deviation = np.mean([
            1.0 if d > self.gaze_lambda else 0.0
            for d in recent
        ])
        return float(1.0 - sustained_deviation)

    def _compute_switch_score(self) -> float:
        """
        Tab switch score (0=bad, 1=good).
        3+ switches per minute → score = 0.
        """
        now = time.time()
        # Count switches in last 5 minutes
        five_min_ago = now - 300
        recent_switches = sum(1 for t in self.tab_switch_times if t > five_min_ago)
        switch_rate = recent_switches / 5.0  # Per minute

        return float(max(0.0, 1.0 - switch_rate / 3.0))

    def _compute_paste_score(self) -> float:
        """
        Clipboard paste score (0=bad, 1=good).
        2+ large pastes in 5 minutes → score = 0.
        """
        now = time.time()
        five_min_ago = now - 300
        recent_pastes = sum(1 for t in self.large_paste_times if t > five_min_ago)

        return float(max(0.0, 1.0 - recent_pastes / 2.0))

    def _compute_pose_score(self) -> float:
        """
        Head pose score (0=bad, 1=good).
        >30° yaw = suspicious (looking away from screen).
        """
        if len(self.yaw_readings) < 10:
            return 1.0  # Not enough data — assume good

        # Use last 60 samples
        recent_yaw = self.yaw_readings[-60:]
        extreme_pose = np.mean([
            1.0 if abs(y) > 30.0 else 0.0
            for y in recent_yaw
        ])
        return float(1.0 - extreme_pose)

    def get_stats(self) -> Dict:
        """Get current behavioral stats for dashboard display."""
        return {
            "total_tab_switches": self.total_tab_switches,
            "total_large_pastes": self.total_large_pastes,
            "recent_gaze_deviation": float(np.mean(self.gaze_deltas[-10:])) if self.gaze_deltas else 0.0,
            "behavioral_score": self.compute_score(),
        }


def compute_behavioral_score(session_telemetry: Dict, session_baseline: Dict) -> float:
    """
    Standalone behavioral score computation (for use without BehavioralTracker).

    B = w1*(1 - normalize(Δgaze)) + w2*(1 - normalize(Nswitch)) +
        w3*(1 - normalize(Cpaste)) + w4*(1 - normalize(head_rotation))

    Args:
        session_telemetry: Dict with gaze_deltas, tab_switches_last_5min,
                          large_pastes_last_5min, yaw_readings
        session_baseline: Dict with gazeRangeX (= λ threshold)

    Returns:
        Behavioral score B ∈ [0, 1]
    """
    lambda_gaze = session_baseline.get('gazeRangeX', 0.3)

    # Gaze deviation score
    gaze_deltas = session_telemetry.get('gaze_deltas', [])
    if gaze_deltas:
        recent_deviations = gaze_deltas[-60:]
        sustained_deviation = np.mean([d > lambda_gaze for d in recent_deviations])
        gaze_score = 1.0 - sustained_deviation
    else:
        gaze_score = 1.0

    # Tab switch score
    switch_rate = session_telemetry.get('tab_switches_last_5min', 0) / 5.0
    switch_score = max(0, 1.0 - switch_rate / 3.0)

    # Clipboard score
    large_pastes = session_telemetry.get('large_pastes_last_5min', 0)
    paste_score = max(0, 1.0 - large_pastes / 2.0)

    # Head pose score
    yaw_readings = session_telemetry.get('yaw_readings', [])
    if yaw_readings:
        recent_yaw = yaw_readings[-60:]
        extreme_pose = np.mean([abs(y) > 30 for y in recent_yaw])
        pose_score = 1.0 - extreme_pose
    else:
        pose_score = 1.0

    B = (W_GAZE * gaze_score + W_TAB_SWITCH * switch_score +
         W_CLIPBOARD * paste_score + W_HEAD_POSE * pose_score)

    return float(B)
