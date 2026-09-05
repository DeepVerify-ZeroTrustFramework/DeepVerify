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


import cv2

# Haar cascade for face detection when landmarks are absent
_face_cascade = None
try:
    _cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    _face_cascade = cv2.CascadeClassifier(_cascade_path)
except Exception:
    _face_cascade = None


def get_roi_pixels(frame_bgr: np.ndarray, landmarks: list,
                   frame_h: int = 480, frame_w: int = 640) -> np.ndarray:
    """
    Extract ROI pixels from forehead and cheek regions using MediaPipe landmarks,
    falling back to OpenCV Haar face detection when landmarks are unavailable.

    Args:
        frame_bgr: BGR image
        landmarks: List of (x, y) tuples (normalized 0-1 coordinates from MediaPipe)
        frame_h: Frame height
        frame_w: Frame width

    Returns:
        Array of BGR pixel values from the ROI region
    """
    # 1. MediaPipe landmarks provided
    if landmarks and len(landmarks) > 0:
        points = []
        for idx in ROI_LANDMARKS:
            if idx < len(landmarks):
                lm = landmarks[idx]
                x = int(lm[0] * frame_w) if isinstance(lm, (list, tuple)) else int(lm.x * frame_w)
                y = int(lm[1] * frame_h) if isinstance(lm, (list, tuple)) else int(lm.y * frame_h)
                points.append((x, y))

        if len(points) >= 3:
            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            x_min, x_max = max(0, min(xs)), min(frame_w, max(xs))
            y_min, y_max = max(0, min(ys)), min(frame_h, max(ys))

            if x_max > x_min and y_max > y_min:
                roi = frame_bgr[y_min:y_max, x_min:x_max]
                if roi.size > 0:
                    return roi.reshape(-1, 3)

    # 2. Fallback: OpenCV Haar Cascade face detection
    if _face_cascade is not None and not _face_cascade.empty():
        try:
            gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
            # Use smaller minSize (30x30) and lower minNeighbors (2) for reliable face capture at 320x240
            faces = _face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=2, minSize=(30, 30))
            if len(faces) > 0:
                fx, fy, fw, fh = max(faces, key=lambda r: r[2] * r[3])
                # Forehead ROI: upper 10% to 35% of face, center 60% width
                y1 = max(0, fy + int(fh * 0.10))
                y2 = min(frame_h, fy + int(fh * 0.35))
                x1 = max(0, fx + int(fw * 0.20))
                x2 = min(frame_w, fx + int(fw * 0.80))
                if y2 > y1 and x2 > x1:
                    roi = frame_bgr[y1:y2, x1:x2]
                    if roi.size > 0:
                        return roi.reshape(-1, 3)
        except Exception:
            pass

    # 3. Last-resort static fallback: central face area (where user's head sits in frame)
    y1, y2 = int(frame_h * 0.15), int(frame_h * 0.55)
    x1, x2 = int(frame_w * 0.25), int(frame_w * 0.75)
    roi = frame_bgr[y1:y2, x1:x2]
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
    if len(rgb_timeseries) < 32:  # Need at least 32 samples for 4th-order Butterworth padlen (27)
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
    try:
        padlen = min(27, len(h) - 1)
        h_filtered = sp_signal.filtfilt(b, a, h, padlen=padlen)
    except Exception:
        return np.array([])

    return h_filtered


def detect_liveness(h_filtered: np.ndarray, fs: float = 10.0,
                    snr_threshold_db: float = 3.0) -> Tuple[bool, float, float]:
    """
    FFT-based liveness detection using in-band harmonic signal-to-noise ratio.
    Reference: de Haan & Jeanne (2013) POS method; Wang et al. (2017).

    A real human pulse produces a sharp spectral peak at fundamental cardiac frequency f0
    (0.7-3.5 Hz / 42-210 BPM) and its harmonic 2*f0.
    Pre-recorded video, screens, and noise lack coherent periodicity and exhibit
    flat/diffuse spectral power across the physiological band, yielding low in-band SNR.

    Args:
        h_filtered: Bandpass-filtered pulse signal from compute_pos_signal()
        fs: Sampling frequency in Hz
        snr_threshold_db: Per-candidate β threshold from enrollment

    Returns:
        (is_live, snr_db, heart_rate_bpm) tuple
    """
    if len(h_filtered) < 20:
        return False, 0.0, 0.0

    # Zero-pad to 256 points for smooth sub-Hz frequency resolution (~2.3 BPM per bin at 10Hz)
    N = len(h_filtered)
    N_fft = max(256, 2 ** int(np.ceil(np.log2(N)) + 2))
    windowed = (h_filtered - np.mean(h_filtered)) * np.hanning(N)
    freqs = np.fft.rfftfreq(N_fft, d=1.0 / fs)
    fft_mag = np.abs(np.fft.rfft(windowed, n=N_fft)) ** 2

    # Physiological band [0.7, 3.5] Hz
    band_mask = (freqs >= 0.7) & (freqs <= 3.5)
    band_freqs = freqs[band_mask]
    band_power = fft_mag[band_mask]

    if len(band_power) == 0 or np.sum(band_power) < 1e-12:
        return False, 0.0, 0.0

    # 1. Peak frequency f0 in physiological band
    peak_idx = np.argmax(band_power)
    f0 = float(band_freqs[peak_idx])
    peak_power = float(band_power[peak_idx])
    heart_rate_bpm = float(f0 * 60.0)

    # 2. In-band harmonic signal window (f0 +- 0.18 Hz and 2*f0 +- 0.18 Hz)
    delta_f = 0.18
    fund_mask = (band_freqs >= (f0 - delta_f)) & (band_freqs <= (f0 + delta_f))
    harm_mask = (band_freqs >= (2 * f0 - delta_f)) & (band_freqs <= (2 * f0 + delta_f))
    sig_mask = fund_mask | harm_mask

    P_sig = float(np.sum(band_power[sig_mask]))
    N_sig = max(1, int(np.sum(sig_mask)))

    noise_mask = ~sig_mask
    P_noise = float(np.sum(band_power[noise_mask]))
    N_noise = max(1, int(np.sum(noise_mask)))

    # Compute average spectral energy density per bin
    sig_density = P_sig / N_sig
    noise_density = P_noise / N_noise

    # In-band SNR (dB)
    snr_db = 10.0 * np.log10(max(sig_density, 1e-10) / max(noise_density, 1e-10))

    # Prominence relative to median in-band noise floor
    median_noise = float(np.median(band_power[noise_mask])) if np.sum(noise_mask) > 0 else 1e-10
    prominence = peak_power / max(median_noise, 1e-10)

    # Biological pulse criteria:
    # 1. In-band SNR >= beta threshold (default 3.0 dB)
    # 2. Spectral peak prominence >= 6.0 (sharp pulse vs flat/diffuse video noise)
    # 3. Heart rate within physiological human range [45, 195] BPM
    is_live = bool(
        (snr_db >= snr_threshold_db) and
        (prominence >= 6.0) and
        (45.0 <= heart_rate_bpm <= 195.0)
    )

    return is_live, round(float(snr_db), 2), round(float(heart_rate_bpm), 1)


class RPPGAnalyzer:
    """
    Stateful rPPG analyzer that accumulates RGB samples over 5-second windows
    and produces liveness decisions with exponential moving average (EMA) smoothing.
    """

    def __init__(self, fs: float = 10.0, window_seconds: float = 5.0,
                 snr_threshold_db: float = 3.0):
        self.fs = fs
        self.window_size = int(fs * window_seconds)  # 50 frames at 10fps
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

        # Need at least 32 samples for filter padlen stability
        if len(self.rgb_buffer) < min(32, self.window_size):
            return None

        # Use sliding window (last window_size samples)
        window = self.rgb_buffer[-self.window_size:]
        h_filtered = compute_pos_signal(window, self.fs)

        if len(h_filtered) == 0:
            return None

        is_live, snr_db, heart_rate_bpm = detect_liveness(
            h_filtered, self.fs, self.snr_threshold_db
        )

        # Smooth output with Exponential Moving Average (alpha = 0.25)
        if self.last_result is not None:
            prev_snr = self.last_result.get("snr_db", snr_db)
            prev_hr = self.last_result.get("heart_rate_bpm", heart_rate_bpm)
            smooth_snr = 0.75 * prev_snr + 0.25 * snr_db
            smooth_hr = 0.8 * prev_hr + 0.2 * heart_rate_bpm
        else:
            smooth_snr = snr_db
            smooth_hr = heart_rate_bpm

        self.last_result = {
            "is_live": is_live,
            "snr_db": round(float(smooth_snr), 2),
            "heart_rate_bpm": round(float(smooth_hr), 1),
            "samples_in_buffer": len(self.rgb_buffer),
        }

        # Keep buffer manageable (retain last 2 windows for overlap)
        max_buffer = self.window_size * 3
        if len(self.rgb_buffer) > max_buffer:
            self.rgb_buffer = self.rgb_buffer[-self.window_size * 2:]

        return self.last_result
