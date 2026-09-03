"""
Behavioral Telemetry Scoring Module.

Computes a composite behavioral score B ∈ [0, 1] from sub-scores:
- Gaze deviation (weight 0.30)
- Tab switch frequency (weight 0.20)
- Clipboard paste & shortcut activity (weight 0.15)
- Head pose extremity (weight 0.15)
- Integrity multiplier based on:
  - Multi-face presence & Candidate absence
  - Prohibited object detections (phones, books, tablets)
  - Multiple monitor usage
  - Screen reflections / specular glare on lenses
"""
import numpy as np
from typing import Dict, List, Optional
import time


# Base Weights
W_GAZE = 0.30
W_TAB_SWITCH = 0.20
W_CLIPBOARD = 0.15
W_HEAD_POSE = 0.15
W_INTEGRITY = 0.20


class BehavioralTracker:
    """
    Stateful behavioral telemetry tracker for a single session.
    Accumulates events and gaze/pose/integrity data, computes behavioral score on demand.
    """

    def __init__(self, session_id: str, gaze_lambda: float = 0.3):
        self.session_id = session_id
        self.gaze_lambda = gaze_lambda

        # Event buffers
        self.tab_switch_times: List[float] = []
        self.window_blur_times: List[float] = []
        self.large_paste_times: List[float] = []
        self.large_paste_sizes: List[int] = []

        # Advanced Integrity Events
        self.multi_face_times: List[float] = []
        self.absence_times: List[float] = []
        self.prohibited_object_times: List[float] = []
        self.multi_monitor_times: List[float] = []
        self.screen_reflection_times: List[float] = []

        # Gaze and pose data
        self.gaze_deltas: List[float] = []
        self.gaze_timestamps: List[float] = []
        self.yaw_readings: List[float] = []
        self.pitch_readings: List[float] = []
        self.roll_readings: List[float] = []

        # Counters
        self.total_tab_switches: int = 0
        self.total_large_pastes: int = 0
        self.total_multi_faces: int = 0
        self.total_prohibited_objects: int = 0

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
        elif event_type in ("LARGE_PASTE", "CLIPBOARD_VIOLATION"):
            self.large_paste_times.append(ts)
            self.large_paste_sizes.append(metadata.get("char_count", metadata.get("charCount", 0)))
            self.total_large_pastes += 1
        elif event_type == "MULTI_FACE":
            self.multi_face_times.append(ts)
            self.total_multi_faces += 1
        elif event_type in ("FACE_ABSENCE", "ABSENCE"):
            self.absence_times.append(ts)
        elif event_type == "PROHIBITED_OBJECT":
            self.prohibited_object_times.append(ts)
            self.total_prohibited_objects += 1
        elif event_type == "MULTI_MONITOR":
            self.multi_monitor_times.append(ts)
        elif event_type == "SCREEN_REFLECTION":
            self.screen_reflection_times.append(ts)

    def record_gaze_data(self, gaze_x: float, gaze_y: float, delta: float,
                         yaw: float, pitch: float, roll: float,
                         timestamp: Optional[float] = None):
        """Record gaze and head pose data."""
        ts = timestamp or time.time()
        self.gaze_deltas.append(delta)
        self.gaze_timestamps.append(ts)
        self.yaw_readings.append(yaw)
        self.pitch_readings.append(pitch)
        self.roll_readings.append(roll)

        max_buffer = 3600
        if len(self.gaze_deltas) > max_buffer:
            self.gaze_deltas = self.gaze_deltas[-max_buffer // 2:]
            self.gaze_timestamps = self.gaze_timestamps[-max_buffer // 2:]
            self.yaw_readings = self.yaw_readings[-max_buffer // 2:]
            self.pitch_readings = self.pitch_readings[-max_buffer // 2:]
            self.roll_readings = self.roll_readings[-max_buffer // 2:]

    def compute_score(self) -> float:
        """
        Compute composite behavioral score B ∈ [0, 1].
        """
        gaze_score = self._compute_gaze_score()
        switch_score = self._compute_switch_score()
        paste_score = self._compute_paste_score()
        pose_score = self._compute_pose_score()
        integrity_score = self._compute_integrity_score()

        B = (W_GAZE * gaze_score +
             W_TAB_SWITCH * switch_score +
             W_CLIPBOARD * paste_score +
             W_HEAD_POSE * pose_score +
             W_INTEGRITY * integrity_score)

        return float(max(0.0, min(1.0, B)))

    def _compute_gaze_score(self) -> float:
        if len(self.gaze_deltas) < 10:
            return 1.0

        recent = self.gaze_deltas[-60:]
        sustained_deviation = np.mean([
            1.0 if d > self.gaze_lambda else 0.0
            for d in recent
        ])
        return float(1.0 - sustained_deviation)

    def _compute_switch_score(self) -> float:
        now = time.time()
        five_min_ago = now - 300
        recent_switches = sum(1 for t in self.tab_switch_times if t > five_min_ago)
        switch_rate = recent_switches / 5.0

        return float(max(0.0, 1.0 - switch_rate / 3.0))

    def _compute_paste_score(self) -> float:
        now = time.time()
        five_min_ago = now - 300
        recent_pastes = sum(1 for t in self.large_paste_times if t > five_min_ago)

        return float(max(0.0, 1.0 - recent_pastes / 2.0))

    def _compute_pose_score(self) -> float:
        if len(self.yaw_readings) < 10:
            return 1.0

        recent_yaw = self.yaw_readings[-60:]
        extreme_pose = np.mean([
            1.0 if abs(y) > 10.0 else 0.0
            for y in recent_yaw
        ])
        return float(1.0 - extreme_pose)

    def _compute_integrity_score(self) -> float:
        """Score based on absence, multi-face, prohibited objects, multi-monitor."""
        now = time.time()
        five_min_ago = now - 300

        recent_mf = sum(1 for t in self.multi_face_times if t > five_min_ago)
        recent_obj = sum(1 for t in self.prohibited_object_times if t > five_min_ago)
        recent_abs = sum(1 for t in self.absence_times if t > five_min_ago)
        recent_mon = sum(1 for t in self.multi_monitor_times if t > five_min_ago)

        penalty = (recent_mf * 0.35 + recent_obj * 0.40 + recent_abs * 0.20 + recent_mon * 0.25)
        return float(max(0.0, 1.0 - penalty))

    def get_stats(self) -> Dict:
        return {
            "total_tab_switches": self.total_tab_switches,
            "total_large_pastes": self.total_large_pastes,
            "total_multi_faces": self.total_multi_faces,
            "total_prohibited_objects": self.total_prohibited_objects,
            "recent_gaze_deviation": float(np.mean(self.gaze_deltas[-10:])) if self.gaze_deltas else 0.0,
            "behavioral_score": self.compute_score(),
        }


def compute_behavioral_score(session_telemetry: Dict, session_baseline: Dict) -> float:
    """
    Standalone behavioral score computation.
    """
    lambda_gaze = session_baseline.get('lambda_gaze',
                  session_baseline.get('gazeRangeX', 0.15))

    # Gaze deviation score
    gaze_deltas = session_telemetry.get('gaze_deltas', [])
    if gaze_deltas:
        recent_deviations = gaze_deltas[-60:]
        sustained_deviation = np.mean([d > lambda_gaze for d in recent_deviations])
        gaze_score = 1.0 - sustained_deviation
    else:
        gaze_score = 1.0

    # Tab switch score
    tab_switches = (session_telemetry.get('tab_switches_5min', 0) or
                    session_telemetry.get('tab_switches_last_5min', 0))
    switch_rate = tab_switches / 5.0
    switch_score = max(0.0, 1.0 - switch_rate / 3.0)

    # Clipboard score
    large_pastes = (session_telemetry.get('large_pastes_5min', 0) or
                    session_telemetry.get('large_pastes_last_5min', 0))
    paste_score = max(0.0, 1.0 - large_pastes / 2.0)

    # Head pose score
    yaw_readings = session_telemetry.get('yaw_readings', [])
    if yaw_readings:
        recent_yaw = yaw_readings[-60:]
        extreme_pose = np.mean([abs(y) > 10.0 for y in recent_yaw])
        pose_score = 1.0 - extreme_pose
    else:
        pose_score = 1.0

    # Integrity penalties
    multi_faces = session_telemetry.get('multi_faces_5min', 0)
    prohibited_objs = session_telemetry.get('prohibited_objects_5min', 0)
    absences = session_telemetry.get('absences_5min', 0)
    multi_monitors = session_telemetry.get('multi_monitors_5min', 0)

    integrity_penalty = (multi_faces * 0.35 + prohibited_objs * 0.40 +
                         absences * 0.20 + multi_monitors * 0.25)
    integrity_score = max(0.0, 1.0 - integrity_penalty)

    B = (W_GAZE * gaze_score +
         W_TAB_SWITCH * switch_score +
         W_CLIPBOARD * paste_score +
         W_HEAD_POSE * pose_score +
         W_INTEGRITY * integrity_score)

    return float(max(0.0, min(1.0, B)))
