"""
PRNU Hardware Fingerprinting Module.

Implements sensor-level camera fingerprinting using Photo Response Non-Uniformity (PRNU).
Based on Lukas, Fridrich & Goljan — wavelet-based noise residual extraction + MLE estimator.

Key operations:
- extract_noise_residual(frame) — Daubechies-8 wavelet, 4-level decomposition
- estimate_prnu_reference(frames) — MLE: K̂ = Σ(Wn·In) / Σ(In²)
- compute_pce(W_test, K_hat) — Peak-to-Correlation Energy via FFT
- Decision: PCE > 60 → AUTHENTIC (threshold adjusted for video compression)
"""
import numpy as np
import pywt
from typing import List, Tuple


def extract_noise_residual(frame_bgr: np.ndarray) -> np.ndarray:
    """
    Apply wavelet denoising to extract PRNU noise residual W = I - F(I).

    Uses Daubechies-8 wavelet with 4-level decomposition (Lukas et al. standard).
    Zeroes out approximation (low-frequency) coefficients and keeps only detail
    (noise) sub-bands. The residual is the difference between original and denoised.

    Args:
        frame_bgr: BGR image as numpy array (uint8 or float32)

    Returns:
        Noise residual W as float32 array with shape (H, W, 3)
    """
    frame_float = frame_bgr.astype(np.float32) / 255.0
    residuals = []

    for c in range(3):  # Process each color channel (B, G, R)
        channel = frame_float[:, :, c]

        # Daubechies-8 wavelet, 3-level decomposition (faster than 4-level, still effective)
        coeffs = pywt.wavedec2(channel, 'db8', level=3)

        # Zero out approximation (low-freq) coefficients — keep only detail (noise)
        coeffs_thresh = list(coeffs)
        coeffs_thresh[0] = np.zeros_like(coeffs[0])

        # Reconstruct denoised image from detail coefficients only
        denoised = pywt.waverec2(coeffs_thresh, 'db8')

        # Trim to original dimensions (wavelet reconstruction may add padding)
        denoised = denoised[:channel.shape[0], :channel.shape[1]]

        # Residual = Original - Denoised = noise component
        residuals.append(channel - denoised)

    return np.stack(residuals, axis=2)  # W — shape (H, W, 3)


def estimate_prnu_reference(frames_list: List[np.ndarray]) -> np.ndarray:
    """
    MLE estimator for PRNU reference fingerprint K̂ from N enrollment frames.

    Formula: K̂ = Σ(Wn · In) / Σ(In²)

    Where:
    - Wn is the noise residual of frame n
    - In is the normalized intensity of frame n

    The result is zero-mean normalized to remove fixed pattern noise.

    Args:
        frames_list: List of BGR images (uint8 numpy arrays), all same dimensions

    Returns:
        PRNU reference fingerprint K̂ as float64 array
    """
    # Get target shape from first frame
    target_h, target_w = frames_list[0].shape[:2]

    numerator = np.zeros((target_h, target_w, 3), dtype=np.float64)
    denominator = np.zeros((target_h, target_w, 3), dtype=np.float64)

    for frame in frames_list:
        I = frame.astype(np.float64) / 255.0
        W = extract_noise_residual(frame).astype(np.float64)

        numerator += W * I
        denominator += I ** 2

    # MLE: K̂ = Σ(W·I) / Σ(I²), with epsilon to avoid division by zero
    K_hat = np.where(denominator > 1e-8, numerator / denominator, 0)

    # Zero-mean normalization (removes fixed pattern noise)
    K_hat -= K_hat.mean()

    return K_hat


def compute_pce(W_test: np.ndarray, K_hat: np.ndarray) -> float:
    """
    Compute Peak-to-Correlation Energy (PCE) via cross-correlation in frequency domain.

    Uses the green channel (index 1) which has the highest PRNU SNR due to
    Bayer filter pattern having 2x green pixels.

    PCE = peak² / mean(all_other_values²)

    High PCE (> 60) indicates the test frame came from the same camera as the reference.

    Args:
        W_test: Noise residual of test frame, shape (H, W, 3)
        K_hat: PRNU reference fingerprint, shape (H, W, 3)

    Returns:
        PCE value as float. Higher = more likely authentic.
    """
    # Use green channel — highest PRNU SNR due to Bayer filter
    w = W_test[:, :, 1].astype(np.float64)
    k = K_hat[:, :, 1].astype(np.float64)

    # Ensure matching 2D dimensions
    h = min(w.shape[0], k.shape[0])
    w_width = min(w.shape[1], k.shape[1])
    w = w[:h, :w_width]
    k = k[:h, :w_width]

    # Zero-mean normalize both before correlation for maximum SNR
    w = w - np.mean(w)
    k = k - np.mean(k)

    # 2D cross-correlation via 2D FFT (preserves 2D sensor pixel geometry)
    F_w = np.fft.fft2(w)
    F_k = np.fft.fft2(k)
    cross_corr = np.fft.ifft2(F_w * np.conj(F_k)).real

    # PCE = peak² / mean(energy outside 11x11 peak neighborhood)
    corr_sq = cross_corr ** 2
    peak_idx = np.unravel_index(np.argmax(corr_sq), corr_sq.shape)
    peak = float(corr_sq[peak_idx])

    # Standard Lukas & Fridrich PCE: zero out 11x11 neighborhood around peak
    r, c = peak_idx
    mask = corr_sq.copy()
    r_min, r_max = max(0, r - 5), min(h, r + 6)
    c_min, c_max = max(0, c - 5), min(w_width, c + 6)
    mask[r_min:r_max, c_min:c_max] = 0.0

    valid_energy = mask[mask > 0]
    energy_rest = float(np.mean(valid_energy)) if len(valid_energy) > 0 else 1e-10

    pce = peak / (energy_rest + 1e-10)
    return float(pce)


def analyze_frame_prnu(frame_bgr: np.ndarray, K_hat: np.ndarray, threshold: float = 60.0) -> dict:
    """
    Full PRNU analysis pipeline for a single test frame.

    Args:
        frame_bgr: Test frame (BGR, uint8)
        K_hat: PRNU reference fingerprint from enrollment
        threshold: PCE threshold (default 60, from Lukas et al., adjusted for video)

    Returns:
        Dict with pce value, is_authentic flag, and confidence score
    """
    # Extract noise residual from test frame
    W_test = extract_noise_residual(frame_bgr)

    # Compute PCE
    pce = compute_pce(W_test, K_hat)

    # Decision
    is_authentic = pce > threshold

    # Confidence: normalized PCE relative to threshold
    confidence = min(1.0, pce / (2 * threshold)) if is_authentic else max(0.0, pce / threshold)

    return {
        "pce": pce,
        "is_authentic": is_authentic,
        "confidence": confidence,
        "threshold": threshold,
    }
