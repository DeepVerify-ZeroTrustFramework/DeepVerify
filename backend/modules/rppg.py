"""
rPPG Biological Liveness Module.

Implements remote photoplethysmography (rPPG) using the POS method
(de Haan & Jeanne, 2013) to extract pulse signal from facial video.

Key operations:
- extract_rppg_signal(frame, landmarks) — extract mean RGB from forehead/cheek ROI
- compute_pos_signal(rgb_timeseries) — POS projection + Butterworth bandpass
- detect_liveness(signal, fs, beta) — FFT-based SNR check for biological pulse presence

Liveness check: SNR > β (per-candidate threshold from enrollment baseline)
"""
import numpy as np
from scipy import signal as sp_signal
from typing import List, Tuple, Optional


# MediaPipe FaceMesh landmark indices for ROI extraction
# Forehead region
FOREHEAD_LANDMARKS = [10, 338, 297, 332, 284, 251, 389, 356, 454,
                      323, 361, 288, 397, 365, 379, 378, 400, 377,
                      152, 148, 176, 149, 150, 136, 172, 58, 132,
                      93, 234, 127, 162, 21, 54, 103, 67, 109]

# Left cheek region
LEFT_CHEEK_LANDMARKS = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148]

# Right cheek region
RIGHT_CHEEK_LANDMARKS = [454, 323, 361, 288, 397, 365, 379, 378, 400, 377]

# Combined forehead + cheeks ROI
ROI_LANDMARKS = [10, 151, 9, 8, 168, 6, 197, 195, 5,  # forehead center line
                 234, 127, 162, 21, 54, 103, 67, 109,  # left forehead
                 454, 323, 361, 288, 397, 365,          # right forehead
                 50, 101, 36, 205, 187,                 # left cheek
                 280, 330, 266, 425, 411]               # right cheek


def get_roi_pixels(frame_bgr: np.ndarray, landmarks: list,
                   frame_h: int = 480, frame_w: int = 640) -> np.ndarray:
    """
    Extract ROI pixels from forehead and cheek regions using MediaPipe landmarks.

    Args:
        frame_bgr: BGR image
        landmarks: List of (x, y) tuples (normalized 0-1 coordinates from MediaPipe)
        frame_h: Frame height
        frame_w: Frame width

    Returns:
        Array of BGR pixel values from the ROI region
    """
    if not landmarks or len(landmarks) == 0:
        # Fallback: use center-upper region of frame as ROI
        roi = frame_bgr[frame_h // 6: frame_h // 3, frame_w // 4: 3 * frame_w // 4]
        return roi.reshape(-1, 3)

    # Convert normalized landmarks to pixel coordinates
    points = []
    for idx in ROI_LANDMARKS:
        if idx < len(landmarks):
            lm = landmarks[idx]
            x = int(lm[0] * frame_w) if isinstance(lm, (list, tuple)) else int(lm.x * frame_w)
            y = int(lm[1] * frame_h) if isinstance(lm, (list, tuple)) else int(lm.y * frame_h)
            points.append((x, y))

    if len(points) < 3:
        roi = frame_bgr[frame_h // 6: frame_h // 3, frame_w // 4: 3 * frame_w // 4]
        return roi.reshape(-1, 3)

    # Create bounding box from landmark points
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x_min, x_max = max(0, min(xs)), min(frame_w, max(xs))
    y_min, y_max = max(0, min(ys)), min(frame_h, max(ys))

    if x_max <= x_min or y_max <= y_min:
        roi = frame_bgr[frame_h // 6: frame_h // 3, frame_w // 4: 3 * frame_w // 4]
        return roi.reshape(-1, 3)

    roi = frame_bgr[y_min:y_max, x_min:x_max]
    return roi.reshape(-1, 3)


def extract_rppg_signal(frame_bgr: np.ndarray, landmarks: list) -> Tuple[float, float, float]:
    """
    Extract mean RGB values from facial ROI for a single frame.
    POS method — de Haan & Jeanne [5].

    Args:
        frame_bgr: BGR image
        landmarks: MediaPipe FaceMesh landmarks

    Returns:
        (mean_R, mean_G, mean_B) tuple — mean channel values over ROI
    """
    h, w = frame_bgr.shape[:2]
    roi_pixels = get_roi_pixels(frame_bgr, landmarks, h, w)

    if roi_pixels.size == 0:
        return 0.0, 0.0, 0.0

    # Mean RGB over ROI (OpenCV is BGR, so index 2=R, 1=G, 0=B)
    sR = float(np.mean(roi_pixels[:, 2]))  # Red channel
    sG = float(np.mean(roi_pixels[:, 1]))  # Green channel
    sB = float(np.mean(roi_pixels[:, 0]))  # Blue channel

    return sR, sG, sB


def compute_pos_signal(rgb_timeseries: List[Tuple[float, float, float]],
                       fs: float = 30.0) -> np.ndarray:
    """
    POS projection: H(t) = 3·sR - 2·sG, then h(t) = H + α·(sR - sB).

    The Plane-Orthogonal-to-Skin (POS) method projects the temporal RGB
    signal onto a plane orthogonal to the skin tone vector, isolating
    the pulse-induced color variation from motion artifacts.

    Args:
        rgb_timeseries: List of (R, G, B) tuples over time
        fs: Sampling frequency in Hz (default 30fps)

    Returns:
        Bandpass-filtered pulse signal as 1D numpy array
    """
    if len(rgb_timeseries) < 30:  # Need at least 1 second of data
        return np.array([])

    sR = np.array([x[0] for x in rgb_timeseries], dtype=np.float64)
    sG = np.array([x[1] for x in rgb_timeseries], dtype=np.float64)
    sB = np.array([x[2] for x in rgb_timeseries], dtype=np.float64)

    # Temporal normalization (removes slow illumination changes)
    window_size = int(fs * 1.6)  # ~1.6 second windows
    if window_size < 2:
        window_size = 2

    # Normalize by running mean
    for sig in [sR, sG, sB]:
        # Use cumulative sum for efficient running mean
        cumsum = np.cumsum(np.insert(sig, 0, 0))
        n = len(sig)
        for i in range(n):
            start = max(0, i - window_size // 2)
            end = min(n, i + window_size // 2 + 1)
            mean_val = (cumsum[end] - cumsum[start]) / (end - start)
            if mean_val > 1e-6:
                sig[i] = sig[i] / mean_val

    # POS projection
    H = 3.0 * sR - 2.0 * sG
    diff = sR - sB

    # Variance balancing factor α
    alpha = np.std(H) / (np.std(diff) + 1e-8)
    h = H + alpha * diff  # Final pulse signal

    # Butterworth bandpass filter [0.7, 3.5] Hz → 42-210 BPM
    nyquist = fs / 2.0
    low = 0.7 / nyquist
    high = 3.5 / nyquist

    # Clamp to valid range
    low = max(0.01, min(low, 0.99))
    high = max(low + 0.01, min(high, 0.99))

    b, a = sp_signal.butter(4, [low, high], btype='bandpass')
    h_filtered = sp_signal.filtfilt(b, a, h)

    return h_filtered


def detect_liveness(h_filtered: np.ndarray, fs: float = 30.0,
                    snr_threshold_db: float = 3.0) -> Tuple[bool, float, float]:
    """
    FFT-based liveness detection: check for dominant frequency + SNR > threshold.

    A real human face produces a periodic pulse signal with a clear spectral peak
    in the 0.7-3.5 Hz band (42-210 BPM). Deepfake videos, pre-recorded videos,
    and photos lack this biological signal.

    Args:
        h_filtered: Bandpass-filtered pulse signal from compute_pos_signal()
        fs: Sampling frequency in Hz
        snr_threshold_db: Per-candidate β threshold from enrollment (NOT global 3.0)

    Returns:
        (is_live, snr_db, heart_rate_bpm) tuple
    """
    if len(h_filtered) < 30:
        return False, 0.0, 0.0

    # Compute FFT power spectrum
    freqs = np.fft.rfftfreq(len(h_filtered), d=1.0 / fs)
    fft_mag = np.abs(np.fft.rfft(h_filtered)) ** 2

    # Bandpass mask [0.7, 3.5] Hz (physiological heart rate range)
    band_mask = (freqs >= 0.7) & (freqs <= 3.5)
    band_power = fft_mag[band_mask]

    if len(band_power) == 0:
        return False, 0.0, 0.0

    # Find peak in band
    peak_power = np.max(band_power)

    # Noise power: everything outside the band
    noise_mask = ~band_mask & (freqs > 0)  # Exclude DC
    noise_power_arr = fft_mag[noise_mask]
    noise_power = np.mean(noise_power_arr) if len(noise_power_arr) > 0 else 1e-10

    # SNR in dB
    snr_db = 10.0 * np.log10(peak_power / (noise_power + 1e-10))

    # Heart rate from peak frequency
    band_freqs = freqs[band_mask]
    peak_freq = band_freqs[np.argmax(band_power)]
    heart_rate_bpm = peak_freq * 60.0

    # Decision: SNR > β (per-candidate threshold from enrollment)
    is_live = snr_db > snr_threshold_db

    return bool(is_live), float(snr_db), float(heart_rate_bpm)


class RPPGAnalyzer:
    """
    Stateful rPPG analyzer that accumulates RGB samples over 5-second windows
    and produces liveness decisions.
    """

    def __init__(self, fs: float = 30.0, window_seconds: float = 5.0,
                 snr_threshold_db: float = 3.0):
        self.fs = fs
        self.window_size = int(fs * window_seconds)  # 150 frames at 30fps
        self.snr_threshold_db = snr_threshold_db
        self.rgb_buffer: List[Tuple[float, float, float]] = []
        self.last_result: Optional[dict] = None

    def add_sample(self, frame_bgr: np.ndarray, landmarks: list) -> Optional[dict]:
        """
        Add a frame sample. Returns analysis result when window is full.

        Args:
            frame_bgr: BGR image
            landmarks: MediaPipe landmarks

        Returns:
            Dict with is_live, snr_db, heart_rate_bpm when window is ready, else None
        """
        sR, sG, sB = extract_rppg_signal(frame_bgr, landmarks)

        # Skip invalid samples
        if sR < 1.0 and sG < 1.0 and sB < 1.0:
            return None

        self.rgb_buffer.append((sR, sG, sB))

        # Need at least window_size samples
        if len(self.rgb_buffer) < self.window_size:
            return None

        # Use sliding window (last window_size samples)
        window = self.rgb_buffer[-self.window_size:]
        h_filtered = compute_pos_signal(window, self.fs)

        if len(h_filtered) == 0:
            return None

        is_live, snr_db, heart_rate_bpm = detect_liveness(
            h_filtered, self.fs, self.snr_threshold_db
        )

        self.last_result = {
            "is_live": is_live,
            "snr_db": snr_db,
            "heart_rate_bpm": heart_rate_bpm,
            "samples_in_buffer": len(self.rgb_buffer),
        }

        # Keep buffer manageable (retain last 2 windows for overlap)
        max_buffer = self.window_size * 3
        if len(self.rgb_buffer) > max_buffer:
            self.rgb_buffer = self.rgb_buffer[-self.window_size * 2:]

        return self.last_result
