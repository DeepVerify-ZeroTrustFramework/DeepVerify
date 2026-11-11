"""
PRNU Hardware Fingerprinting Module (v2).

Sensor-level camera fingerprinting using Photo Response Non-Uniformity (PRNU),
after Lukas, Fridrich & Goljan (2006) and Chen et al. (2008).

What changed in v2 (and why):
  * Noise residual is now  W = I - F(I), with F = wavelet *shrinkage* denoising
    (detail coefficients soft-thresholded, approximation kept). v1 zeroed the
    approximation band instead, so its "residual" was the low-frequency picture
    itself (0.94 correlation with the image) — PCE then measured scene
    similarity, not the sensor.
  * Rows/columns of W are zero-meaned to remove linear patterns (demosaicing,
    JPEG/codec grids) that every camera shares.
  * PRNU frames must be NATIVE-resolution crops (no resampling). Downscaling
    averages neighbouring sensor pixels and erases the fingerprint. The browser
    sends a 320x240 centre crop of the raw camera frame for this (see
    CandidateSession.tsx / useSystemCheck.ts), tagged with the camera resolution.
  * PCE is evaluated at zero spatial shift (live video is not re-registered),
    and several test frames are aggregated before deciding.

Measured on the project's data (320x240 crops): frames from a *different*
source (21 other webcams, phone videos, AI-generated videos) scored PCE <= 41
in ~1,500 tests — so the standard decision threshold of 60 holds.
"""
from typing import List, Optional, Tuple
import numpy as np
import pywt
import cv2

PRNU_VERSION = 2
CROP_W, CROP_H = 320, 240

PCE_MATCH = 60.0      # >= : same camera (Lukas et al. threshold; impostor max seen: 41)
PCE_MISMATCH = 25.0   # <= (aggregated, after enough frames): different camera / source
AGG_FRAMES = 5        # test frames combined per decision


# ── Residual extraction ───────────────────────────────────────────────────────
def _residual_gray(gray: np.ndarray) -> np.ndarray:
    """W = I - wavelet-shrinkage-denoised(I), rows/cols zero-meaned. gray in [0,1]."""
    coeffs = pywt.wavedec2(gray, 'db8', level=3)
    sigma = np.median(np.abs(coeffs[-1][2])) / 0.6745          # noise level from finest HH band
    thr = sigma * np.sqrt(2.0 * np.log(gray.size))               # universal threshold
    den = [coeffs[0]] + [tuple(pywt.threshold(d, thr, 'soft') for d in lvl) for lvl in coeffs[1:]]
    rec = pywt.waverec2(den, 'db8')[:gray.shape[0], :gray.shape[1]]
    w = gray - rec
    w = w - w.mean(axis=1, keepdims=True)
    w = w - w.mean(axis=0, keepdims=True)
    return w


def _green(frame_bgr: np.ndarray) -> np.ndarray:
    # Green: highest PRNU SNR (2x green sites in the Bayer pattern)
    return frame_bgr[:, :, 1].astype(np.float64) / 255.0


def extract_noise_residual(frame_bgr: np.ndarray) -> np.ndarray:
    """
    PRNU noise residual of a frame. Returns float32 (H, W, 3) for backward
    compatibility; all three planes hold the green-channel residual.
    """
    w = _residual_gray(_green(frame_bgr)).astype(np.float32)
    return np.stack([w, w, w], axis=2)


def estimate_prnu_reference(frames_list: List[np.ndarray]) -> np.ndarray:
    """
    MLE fingerprint  K = Σ(W_n·I_n) / Σ(I_n²)  over N frames (same size, ideally
    native-resolution crops). Returns float32 (H, W, 3), zero-mean.
    """
    h, w = frames_list[0].shape[:2]
    num = np.zeros((h, w)); den = np.zeros((h, w))
    for f in frames_list:
        if f.shape[:2] != (h, w):
            continue
        I = _green(f)
        num += _residual_gray(I) * I
        den += I * I
    K = np.where(den > 1e-8, num / den, 0.0)
    K = K - K.mean()
    K = K - K.mean(axis=1, keepdims=True)
    K = K - K.mean(axis=0, keepdims=True)
    K = K.astype(np.float32)
    return np.stack([K, K, K], axis=2)


# ── Matching ─────────────────────────────────────────────────────────────────
def _pce_zero_shift(a: np.ndarray, b: np.ndarray) -> float:
    """Signed PCE of the cross-correlation peak near zero shift."""
    a = a - a.mean(); b = b - b.mean()
    xc = np.real(np.fft.ifft2(np.fft.fft2(a) * np.conj(np.fft.fft2(b))))
    near = np.zeros_like(xc, dtype=bool)
    near[:2, :2] = near[:2, -1:] = near[-1:, :2] = near[-1:, -1:] = True   # ±1 px
    peak = float(xc[near].max())
    excl = np.zeros_like(xc, dtype=bool)
    excl[:6, :6] = excl[:6, -5:] = excl[-5:, :6] = excl[-5:, -5:] = True  # 11x11 around origin
    energy = float(np.mean(xc[~excl] ** 2)) + 1e-30
    return float(np.sign(peak) * peak * peak / energy)


def compute_pce(W_test: np.ndarray, K_hat: np.ndarray, source: str = 'webrtc',
                I: Optional[np.ndarray] = None) -> float:
    """
    PCE between a test residual and the fingerprint (zero shift).
    Pass I (the test frame's green channel in [0,1]) for the proper I·K weighting.
    """
    w = W_test[:, :, 1] if W_test.ndim == 3 else W_test
    k = K_hat[:, :, 1] if K_hat.ndim == 3 else K_hat
    h = min(w.shape[0], k.shape[0]); ww = min(w.shape[1], k.shape[1])
    w = w[:h, :ww].astype(np.float64); k = k[:h, :ww].astype(np.float64)
    if I is not None:
        k = k * I[:h, :ww]
    return _pce_zero_shift(w, k)


def match_score(pce: float) -> float:
    """
    Points share for the trust score: 1.0 = same camera, 0.5 = undecided
    (neutral — weak frames, motion, low light), 0.0 = different camera.
    """
    if pce >= PCE_MATCH:
        return 1.0
    if pce <= PCE_MISMATCH:
        return 0.0
    return 0.5


def analyze_frame_prnu(frame_bgr: np.ndarray, K_hat: np.ndarray, source: str = 'webrtc') -> dict:
    """Single-frame analysis (kept for scripts/tests). Use PRNUTracker for live sessions."""
    pce = compute_pce(extract_noise_residual(frame_bgr), K_hat, source, I=_green(frame_bgr))
    return {"pce": pce, "is_authentic": pce >= PCE_MATCH, "confidence": match_score(pce),
            "threshold": PCE_MATCH}


# ── Live session tracker ─────────────────────────────────────────────────────
class PRNUTracker:
    """
    Per-session PRNU state, fed with native-resolution crops (~3/s).

    Two fingerprints:
      * K_sess — built from this interview's first SELF_ENROLL crops. Every later
        crop is checked against it: "is it still the same camera?" (catches a
        mid-interview switch to another device or injected video).
      * K_enr  — from the system-check enrollment, used only when the camera
        resolution matches: "is it the camera that was verified?"

    Quality gate: some cameras/drivers denoise so hard that their sensor pattern
    is not measurable. After K_sess is built, the next QUALITY_CROPS crops (taken
    a few seconds later) must match K_sess; if they don't, the tracker reports
    'low_signal' — neutral, no accusations — instead of flagging a genuine
    candidate. States:
      waiting → enrolling → checking → match | uncertain | mismatch | low_signal
    """
    SELF_ENROLL = 30
    QUALITY_SKIP = 10      # ignore crops right after enrollment (same scene → optimistic)
    QUALITY_CROPS = 15     # ~4.5 s window; every check in it must pass (worst case, not median)

    def __init__(self, enrolled: Optional[dict] = None):
        self.enrolled = enrolled            # {'K': 2-D array, 'width': int, 'height': int}
        self.K_sess: Optional[np.ndarray] = None
        self.K_enr: Optional[np.ndarray] = None
        # Running MLE sums: crops confirmed as the same camera keep refining K_sess,
        # so it gets stronger and less tied to the first scene as the interview goes on.
        self._num: Optional[np.ndarray] = None
        self._den: Optional[np.ndarray] = None
        self._enroll_buf: List[np.ndarray] = []
        self._agg: List[Tuple[np.ndarray, np.ndarray]] = []
        self._quality_pces: List[float] = []
        self._post_enroll = 0
        self.quality_ok: Optional[bool] = None
        self.state = 'waiting'
        self.reference = 'none'
        self.pce = 0.0              # the PCE that drives the decision (min of the checks)
        self.pce_session = 0.0
        self.pce_enrollment: Optional[float] = None
        self.match: Optional[float] = None
        self.crops_seen = 0
        self.camera_res: Optional[Tuple[int, int]] = None
        self.res_changed = False

    @property
    def K(self):  # backward-compatible accessor
        return self.K_sess

    def _refresh_k(self):
        K = np.where(self._den > 1e-8, self._num / self._den, 0.0)
        K = K - K.mean(); K = K - K.mean(axis=1, keepdims=True); K = K - K.mean(axis=0, keepdims=True)
        self.K_sess = K

    def _early_enrollment_check(self, W, I) -> Optional[dict]:
        if self.K_enr is None:
            return None
        buf = getattr(self, '_early_agg', [])
        buf.append((W, I))
        self._early_agg = buf[-AGG_FRAMES:]
        if len(self._early_agg) < 3:
            return None
        pce = _pce_zero_shift(sum(w for w, _ in self._early_agg), self.K_enr * sum(i for _, i in self._early_agg))
        self._early_hits = getattr(self, '_early_hits', 0) + 1 if pce >= PCE_MATCH else 0
        if self._early_hits < 3:
            return None
        self.pce = self.pce_enrollment = float(pce)
        self.match, self.reference = 1.0, 'enrollment'
        return {'pce': self.pce, 'match': 1.0, 'state': 'match', 'reference': 'enrollment',
                'quality_ok': None, 'pce_session': None, 'pce_enrollment': self.pce}

    def add_crop(self, crop_bgr: np.ndarray, cam_w: int, cam_h: int) -> Optional[dict]:
        """Feed one native crop. Returns a dict when a new decision is available."""
        if crop_bgr.shape[:2] != (CROP_H, CROP_W):
            crop_bgr = cv2.resize(crop_bgr, (CROP_W, CROP_H))  # only if the camera is tiny
        self.crops_seen += 1
        if self.camera_res is None:
            self.camera_res = (cam_w, cam_h)
            en = self.enrolled
            if en is not None and (int(en.get('width', 0)), int(en.get('height', 0))) == (cam_w, cam_h):
                self.K_enr = np.asarray(en['K'], dtype=np.float64)
        elif self.camera_res != (cam_w, cam_h):
            self.res_changed = True        # different capture mode or a different device
            self.camera_res = (cam_w, cam_h)

        I = _green(crop_bgr)
        W = _residual_gray(I)

        # Fast start: while the session fingerprint is still being built (~15 s),
        # compare against the fingerprint stored at the system check. Three
        # confirmed matches in a row report 'match' right away. Never accuses:
        # a weak or mismatching early reading just waits for the normal path.
        early = None
        if self.K_sess is None or self.quality_ok is None:
            early = self._early_enrollment_check(W, I)

        if self.K_sess is None:
            self._enroll_buf.append(crop_bgr)
            self.state = 'enrolling'
            if len(self._enroll_buf) >= self.SELF_ENROLL:
                self._num = np.zeros((CROP_H, CROP_W)); self._den = np.zeros((CROP_H, CROP_W))
                for f in self._enroll_buf:
                    Ii = _green(f); self._num += _residual_gray(Ii) * Ii; self._den += Ii * Ii
                self._refresh_k()
                self._enroll_buf = []
                self.state = 'checking'
            return early

        self._agg.append((W, I))
        self._agg = self._agg[-AGG_FRAMES:]
        if len(self._agg) < 3:
            return None
        Wsum = sum(w for w, _ in self._agg)
        Isum = sum(i for _, i in self._agg)
        self.pce_session = _pce_zero_shift(Wsum, self.K_sess * Isum)

        # Quality gate (once): is this camera's sensor pattern measurable at all?
        if self.quality_ok is None:
            self._post_enroll += 1
            if self._post_enroll <= self.QUALITY_SKIP:
                return early
            self._quality_pces.append(self.pce_session)
            if len(self._quality_pces) < self.QUALITY_CROPS:
                return early
            # Worst-case of the window: a camera whose pattern only *sometimes*
            # shows up is not reliable enough to accuse anyone with.
            self.quality_ok = float(np.percentile(self._quality_pces, 10)) >= PCE_MATCH
            self._agg = []
            if not self.quality_ok:
                self.state, self.match, self.reference = 'low_signal', None, 'none'
                return {'pce': self.pce_session, 'match': None, 'state': self.state,
                        'reference': self.reference, 'quality_ok': False}
            return None

        if not self.quality_ok:
            self.pce = self.pce_session
            return None   # stays 'low_signal' — no decisions, no accusations

        checks = [self.pce_session]
        self.reference = 'session'
        if self.K_enr is not None:
            self.pce_enrollment = _pce_zero_shift(Wsum, self.K_enr * Isum)
            checks.append(self.pce_enrollment)
            self.reference = 'enrollment'
        self.pce = float(min(checks))
        self.match = match_score(self.pce)
        self.state = ('match' if self.pce >= PCE_MATCH else
                      'mismatch' if self.pce <= PCE_MISMATCH else 'uncertain')
        if self.state == 'match' and self.pce_session >= PCE_MATCH:
            # Confirmed same camera: fold this crop into the session fingerprint
            self._num += W * I; self._den += I * I
            self._since_refresh = getattr(self, '_since_refresh', 0) + 1
            if self._since_refresh >= 10:
                self._refresh_k(); self._since_refresh = 0
        # Which check failed tells the dashboard *what* changed
        culprit = 'enrollment' if (self.pce_enrollment is not None and
                                   self.pce_enrollment < self.pce_session) else 'session'
        return {'pce': self.pce, 'match': self.match, 'state': self.state,
                'reference': culprit, 'quality_ok': True,
                'pce_session': self.pce_session, 'pce_enrollment': self.pce_enrollment}


# ── Frame transport helpers (browser → server) ────────────────────────────────
PRNU_MAGIC = b'DVPR'


def parse_prnu_packet(data: bytes) -> Optional[Tuple[np.ndarray, int, int]]:
    """
    Binary frame tagged as a PRNU crop: b'DVPR' + uint16 camW + uint16 camH (big-endian)
    + JPEG bytes of a native-resolution 320x240 centre crop. Returns (crop, camW, camH).
    """
    if len(data) < 9 or data[:4] != PRNU_MAGIC:
        return None
    cam_w = int.from_bytes(data[4:6], 'big'); cam_h = int.from_bytes(data[6:8], 'big')
    img = cv2.imdecode(np.frombuffer(data[8:], np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    return img, cam_w, cam_h
