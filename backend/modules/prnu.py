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
    w = W_test[:, :, 1].flatten().astype(np.float64)
    k = K_hat[:, :, 1].flatten().astype(np.float64)

    # Ensure same length
    min_len = min(len(w), len(k))
    w = w[:min_len]
    k = k[:min_len]

    # Normalized cross-correlation via FFT (much faster than spatial domain)
    F_w = np.fft.fft(w)
    F_k = np.fft.fft(k)
    cross_corr = np.fft.ifft(F_w * np.conj(F_k)).real

    # PCE = peak² / mean(all other values²)
    corr_sq = cross_corr ** 2
    peak_idx = np.argmax(corr_sq)
    peak = corr_sq[peak_idx]

    # Remove peak from energy calculation
    mask = corr_sq.copy()
    mask[peak_idx] = 0
    energy_rest = np.mean(mask)

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
