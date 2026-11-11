"""
Offline feature extraction for calibration training.

Replays videos through the SAME PRNU + rPPG code the live server uses
(modules/prnu.py, modules/rppg.py), mimicking the live pipeline in
api/routes/frames.py:
    - frames re-encoded as JPEG (what the browser sends), resized to 320x240
    - sampled at 10 fps (RPPGAnalyzer fs=10, 4 s window)
    - PRNU fingerprint from the first 20 frames, PCE every 10th frame with EMA
    - one feature row every 3 s (the fusion cadence)

Real rows:  <dataset-dir>/participant_*/module2_rppg/genuine_live/*.avi
Fake rows:  any videos in --fake-dir (e.g. FaceForensics++ manipulated clips,
            OBS virtual-camera recordings, replayed videos)

PRNU for fake videos (--fake-prnu):
    cross (default)  fingerprint comes from a REAL participant's camera —
                     simulates a candidate who enrolled on their webcam and
                     then injected a fake stream (identity / injection fraud)
    self             fingerprint from the fake video's own first frames —
                     simulates a fake stream used from the very start

Jitter and behavioral cannot be measured from a file, so those columns are
set to neutral values (cv_jitter=0.05, behavioral_score=1.0) for every row and
carry no information; live labeled sessions supply them.

Usage (from backend/):
    python -m scripts.extract_dataset_features \
        --dataset-dir "../dataset/Dataset-deepverify/deepverify_dataset" \
        --fake-dir "path/to/ffpp_fakes" \
        --out dataset_features.csv

    python -m scripts.train_calibration --csv dataset_features.csv
"""
import os
import sys
import csv
import glob
import argparse
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules.prnu import extract_noise_residual, compute_pce, estimate_prnu_reference  # noqa: E402
from modules.rppg import RPPGAnalyzer  # noqa: E402

VIDEO_EXTS = ('.avi', '.mp4', '.mov', '.mkv', '.webm')
TARGET_FPS = 10.0
ENROLL_FRAMES = 20
PRNU_EVERY = 10
ROW_EVERY = 30          # 3 s at 10 fps — same as fusion cadence
NEUTRAL_CV = 0.05
NEUTRAL_BEHAVIORAL = 1.0

FIELDS = ['group', 'label', 'video', 't_sec', 'source', 'pce', 'snr_db', 'hr_bpm',
          'amplitude', 'scr', 'spectral_flatness', 'cv_jitter', 'behavioral_score',
          'frame_pixels', 'is_live', 'offline']


def true_fps(path, wall_seconds=None):
    """
    Frame rate to use for timing. The kit's VideoWriter always stamps 30 fps in
    the header, but webcams deliver fewer; for kit videos the true rate is
    frame_count / wall-clock recording length (RPPG_DURATION_SEC = 30).
    """
    cap = cv2.VideoCapture(path)
    header = cap.get(cv2.CAP_PROP_FPS) or 30.0
    count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    cap.release()
    if header <= 0 or header > 240:
        header = 30.0
    if wall_seconds and count > 0:
        return count / wall_seconds
    return header


def iter_frames(path, jpeg_quality, max_seconds=None, fps=None):
    """Yield (t_sec, frame_320x240, original_pixels) at ~10 fps."""
    fps = fps or true_fps(path)
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        print(f"  ! cannot open {path}")
        return
    step = fps / TARGET_FPS
    next_pick, idx = 0.0, 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx >= next_pick:
            next_pick += step
            t = idx / fps
            if max_seconds and t > max_seconds:
                break
            orig_px = frame.shape[0] * frame.shape[1]
            if jpeg_quality:
                ok_enc, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
                if ok_enc:
                    frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            yield t, cv2.resize(frame, (320, 240)), orig_px
        idx += 1
    cap.release()


def enroll_fingerprint(path, jpeg_quality, fps=None):
    frames = []
    for _, f, _ in iter_frames(path, jpeg_quality, fps=fps):
        frames.append(f)
        if len(frames) >= ENROLL_FRAMES:
            break
    if len(frames) < ENROLL_FRAMES:
        return None
    return estimate_prnu_reference(frames)


def process_video(path, label, group, source, jpeg_quality, k_hat=None, max_seconds=None, fps=None):
    """
    Run one video through the live pipeline. If k_hat is None the first 20
    frames enroll the fingerprint (like demo-mode enrollment in frames.py).
    """
    rppg = RPPGAnalyzer(fs=TARGET_FPS, window_seconds=4.0, snr_threshold_db=3.0, source=source)
    enroll = []
    last = {'pce': 0.0, 'snr': 0.0, 'hr': 72.0, 'amp': 0.1, 'scr': 0.5, 'flat': 0.3, 'live': False}
    rows, n = [], 0

    for t, frame, orig_px in iter_frames(path, jpeg_quality, max_seconds, fps=fps):
        n += 1
        if k_hat is None:
            enroll.append(frame)
            if len(enroll) >= ENROLL_FRAMES:
                k_hat = estimate_prnu_reference(enroll)
                enroll = []

        if n % PRNU_EVERY == 0 and k_hat is not None:
            pce = compute_pce(extract_noise_residual(frame), k_hat, source=source)
            last['pce'] = 0.7 * last['pce'] + 0.3 * pce if last['pce'] > 0 else pce

        r = rppg.add_sample(frame, [])
        if r:
            last['snr'] = r['snr_db']
            if r['heart_rate_bpm'] > 0:
                last['hr'] = r['heart_rate_bpm']
            last['amp'] = r.get('amplitude', last['amp'])
            last['scr'] = r.get('scr', last['scr'])
            last['flat'] = r.get('spectral_flatness', last['flat'])
            last['live'] = r['is_live']

        if n % ROW_EVERY == 0 and last['pce'] > 0 and rppg.last_result is not None:
            rows.append({
                'group': group, 'label': label, 'video': os.path.basename(path),
                't_sec': round(t, 1), 'source': source,
                'pce': round(last['pce'], 4), 'snr_db': last['snr'], 'hr_bpm': last['hr'],
                'amplitude': round(last['amp'], 6), 'scr': round(last['scr'], 4),
                'spectral_flatness': round(last['flat'], 4),
                'cv_jitter': NEUTRAL_CV, 'behavioral_score': NEUTRAL_BEHAVIORAL,
                'frame_pixels': orig_px, 'is_live': int(bool(last['live'])), 'offline': 1,
            })
    return rows


def find_real_videos(dataset_dir):
    out = []
    for pdir in sorted(glob.glob(os.path.join(dataset_dir, 'participant_*'))):
        pid = os.path.basename(pdir).replace('participant_', '')
        for ext in VIDEO_EXTS:
            for v in glob.glob(os.path.join(pdir, 'module2_rppg', 'genuine_live', '*' + ext)):
                out.append((pid, v))
    return out


def find_fake_videos(fake_dir):
    out = []
    for root, _, files in os.walk(fake_dir):
        for fn in sorted(files):
            if fn.lower().endswith(VIDEO_EXTS):
                out.append((os.path.splitext(fn)[0], os.path.join(root, fn)))
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description="Extract calibration features from dataset videos.")
    p.add_argument('--dataset-dir', help="deepverify_dataset folder with participant_* subfolders")
    p.add_argument('--fake-dir', help="Folder of fake/deepfake/replay videos (searched recursively)")
    p.add_argument('--out', default='dataset_features.csv')
    p.add_argument('--source', default='webrtc', choices=['webrtc', 'upload', 'static'])
    p.add_argument('--jpeg-quality', type=int, default=70,
                   help="Re-encode frames as JPEG at this quality to mimic the browser (0 = off)")
    p.add_argument('--fake-prnu', choices=['cross', 'self'], default='cross')
    p.add_argument('--max-seconds', type=float, default=None, help="Limit per video (for quick tests)")
    p.add_argument('--real-duration', type=float, default=30.0,
                   help="Wall-clock length of kit rPPG recordings in seconds (collect_dataset.py "
                        "RPPG_DURATION_SEC); used to recover the true fps. 0 = trust the header")
    a = p.parse_args(argv)

    if not a.dataset_dir and not a.fake_dir:
        p.error("give --dataset-dir and/or --fake-dir")

    rows = []
    real_fps = []  # real fingerprints for cross-camera fake PRNU

    if a.dataset_dir:
        reals = find_real_videos(a.dataset_dir)
        print(f"Real videos: {len(reals)}")
        for i, (pid, v) in enumerate(reals, 1):
            fps = true_fps(v, a.real_duration or None)
            r = process_video(v, 'real', f'participant:{pid}', a.source, a.jpeg_quality,
                              max_seconds=a.max_seconds, fps=fps)
            print(f"  [{i}/{len(reals)}] {pid}: {len(r)} rows  (fps={fps:.1f})")
            rows += r
            if a.fake_prnu == 'cross':
                k = enroll_fingerprint(v, a.jpeg_quality, fps=fps)
                if k is not None:
                    real_fps.append(k)

    if a.fake_dir:
        fakes = find_fake_videos(a.fake_dir)
        print(f"Fake videos: {len(fakes)}")
        if a.fake_prnu == 'cross' and not real_fps:
            print("  ! --fake-prnu cross needs --dataset-dir for real fingerprints; using self")
        for i, (name, v) in enumerate(fakes, 1):
            k = real_fps[i % len(real_fps)] if (a.fake_prnu == 'cross' and real_fps) else None
            r = process_video(v, 'fake', f'fake:{name}', a.source, a.jpeg_quality,
                              k_hat=k, max_seconds=a.max_seconds)
            print(f"  [{i}/{len(fakes)}] {name}: {len(r)} rows")
            rows += r

    with open(a.out, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)

    n_real = sum(1 for r in rows if r['label'] == 'real')
    print(f"\nWrote {len(rows)} rows ({n_real} real, {len(rows) - n_real} fake) → {a.out}")
    if rows:
        for lab in ('real', 'fake'):
            sub = [r for r in rows if r['label'] == lab]
            if sub:
                print(f"  {lab:>4}: PCE median={np.median([r['pce'] for r in sub]):.1f}  "
                      f"SNR median={np.median([r['snr_db'] for r in sub]):.2f}  "
                      f"rPPG live rate={np.mean([r['is_live'] for r in sub]):.0%}")


if __name__ == '__main__':
    main()
