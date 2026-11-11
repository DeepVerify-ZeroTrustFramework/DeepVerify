"""
Calibration Model Training Script — Adaptive Axiom Engine (Phase 3).

Trains the meta-classifier that sits on top of the physics modules
(PRNU, rPPG, Jitter, Behavioral) and learns P(authentic) across compression
conditions. Saves to backend/models/calibration_model.pkl, which
modules/calibration.py loads at runtime.

Data sources (combined):
    1. MongoDB `forensic_logs` rows labeled "real"/"fake"
       (label them with: python -m scripts.label_sessions)
    2. CSV files from scripts/extract_dataset_features.py   (--csv path ...)
    3. Synthetic rows — ONLY used if real data is insufficient, or with
       --synthetic. The saved model records what it was trained on.

Models:
    --model logreg   Logistic regression (default; best for < ~300 rows)
    --model mlp      Small MLP 9→32→16→1 (sklearn, no PyTorch needed)

Evaluation uses session-grouped cross-validation: every row from one session
or participant stays in the same fold. Frames from one session are highly
correlated, so ordinary k-fold would report inflated accuracy.

Usage (from backend/):
    python -m scripts.train_calibration
    python -m scripts.train_calibration --model mlp --csv dataset_features.csv
    python -m scripts.train_calibration --no-synthetic --csv dataset_features.csv
"""
import os
import sys
import csv
import argparse
from datetime import datetime, timezone
import numpy as np
import asyncio

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


FEATURE_NAMES = [
    'pce', 'snr_db', 'hr_bpm', 'amplitude', 'scr',
    'spectral_flatness', 'cv_jitter', 'behavioral_score', 'log_pixels'
]

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models')
MODEL_PATH = os.path.join(MODEL_DIR, 'calibration_model.pkl')

MIN_PER_CLASS = 5          # labeled rows per class
MIN_GROUPS_PER_CLASS = 3   # distinct sessions/participants per class — rows within
                           # one session are near-duplicates, so rows alone mislead


def _mongo_settings():
    """Same env vars as db/mongo.py (MONGODB_URL / MONGODB_DB), loaded from backend/.env."""
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))
    except ImportError:
        pass
    url = os.getenv('MONGODB_URL') or os.getenv('MONGO_URL') or 'mongodb://localhost:27017'
    db = os.getenv('MONGODB_DB') or os.getenv('MONGO_DB') or 'deepverify'
    return url, db


def _row_to_features(doc: dict) -> list:
    """Map a log document / CSV row to the 9-D feature vector (same order as calibration.py)."""
    def g(key, default):
        v = doc.get(key, default)
        try:
            return float(v) if v not in (None, '') else float(default)
        except (TypeError, ValueError):
            return float(default)

    return [
        g('pce', 0.0),
        g('snr_db', 0.0),
        g('hr_bpm', 72.0),
        g('amplitude', 0.1),
        g('scr', 0.5),
        g('spectral_flatness', 0.3),
        g('cv_jitter', 0.05),
        g('behavioral_score', 1.0),
        float(np.log(max(g('frame_pixels', 76800), 1))),
    ]


async def fetch_labeled_data():
    """
    Fetch labeled forensic logs from MongoDB.

    Returns (X, y, groups) lists. Group = session_id.
    """
    from motor.motor_asyncio import AsyncIOMotorClient

    mongo_url, db_name = _mongo_settings()
    client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=3000)
    collection = client[db_name]['forensic_logs']

    cursor = collection.find({"label": {"$in": ["real", "fake"]}})
    docs = await cursor.to_list(length=100000)
    client.close()

    X, y, groups = [], [], []
    for doc in docs:
        X.append(_row_to_features(doc))
        y.append(1 if doc['label'] == 'real' else 0)
        groups.append(f"mongo:{doc.get('session_id', 'unknown')}")
    return X, y, groups


def load_csv_data(paths):
    """
    Load rows produced by scripts/extract_dataset_features.py (or any CSV with
    the same columns plus `label` and `group`).
    """
    X, y, groups = [], [], []
    for path in paths:
        with open(path, newline='', encoding='utf-8') as f:
            for row in csv.DictReader(f):
                label = (row.get('label') or '').strip().lower()
                if label not in ('real', 'fake'):
                    continue
                X.append(_row_to_features(row))
                y.append(1 if label == 'real' else 0)
                groups.append(f"csv:{row.get('group') or os.path.basename(path)}")
    return X, y, groups


def generate_synthetic_training_data():
    """
    Generate synthetic training data when no labeled MongoDB data is available.

    Based on observed distributions from real DeepVerify deployments:
    - Real WebRTC sessions: PCE 8-20, SNR 2-8, HR 55-95, amplitude 0.05-1.5
    - Fake/deepfake sessions: PCE 1-6, SNR -3 to 1, HR 0 or random, amplitude 0.001-0.01 or >3.0
    """
    np.random.seed(42)
    n_real = 100
    n_fake = 80

    # Real candidate sessions (WebRTC compressed)
    real_samples = []
    for _ in range(n_real):
        pce = np.random.uniform(8, 25) + np.random.normal(0, 3)
        snr = np.random.uniform(2, 8) + np.random.normal(0, 1)
        hr = np.random.uniform(55, 95)
        amp = np.random.uniform(0.05, 1.5)
        scr = np.random.uniform(0.35, 0.75)
        flatness = np.random.uniform(0.15, 0.55)
        cv = np.random.uniform(0.02, 0.12)
        behav = np.random.uniform(0.7, 1.0)
        pixels = np.random.choice([76800, 230400, 307200, 921600])  # 320x240, 480x480, 640x480, 1280x720
        real_samples.append([pce, snr, hr, amp, scr, flatness, cv, behav, np.log(pixels)])

    # Fake / deepfake sessions
    fake_samples = []
    for _ in range(n_fake):
        # Type 1: Virtual camera / OBS injection (low PCE, variable SNR)
        if np.random.random() < 0.4:
            pce = np.random.uniform(0.5, 6)
            snr = np.random.uniform(-3, 2)
            hr = np.random.choice([0.0, np.random.uniform(40, 200)])
            amp = np.random.uniform(0.001, 0.02)
            scr = np.random.uniform(0.1, 0.35)
            flatness = np.random.uniform(0.5, 0.9)
            cv = np.random.uniform(0.15, 0.45)
            behav = np.random.uniform(0.3, 0.9)
        # Type 2: Deepfake video (moderate PCE, bad rPPG)
        elif np.random.random() < 0.5:
            pce = np.random.uniform(3, 12)
            snr = np.random.uniform(-4, 0.5)
            hr = np.random.uniform(40, 200)
            amp = np.random.uniform(0.0005, 0.01)
            scr = np.random.uniform(0.05, 0.25)
            flatness = np.random.uniform(0.6, 0.95)
            cv = np.random.uniform(0.1, 0.35)
            behav = np.random.uniform(0.5, 1.0)
        # Type 3: Pre-recorded video replay (OK PCE but high jitter)
        else:
            pce = np.random.uniform(5, 15)
            snr = np.random.uniform(-1, 3)
            hr = np.random.uniform(60, 85)
            amp = np.random.uniform(3.0, 8.0)  # Unnaturally high amplitude
            scr = np.random.uniform(0.2, 0.5)
            flatness = np.random.uniform(0.35, 0.7)
            cv = np.random.uniform(0.2, 0.6)
            behav = np.random.uniform(0.6, 1.0)

        pixels = np.random.choice([76800, 230400, 307200])
        fake_samples.append([pce, snr, hr, amp, scr, flatness, cv, behav, np.log(pixels)])

    return real_samples, fake_samples


def _make_classifier(model_type: str, n_samples: int):
    """Build the classifier. Both expose predict_proba, so calibration.py works unchanged."""
    if model_type == 'mlp':
        from sklearn.neural_network import MLPClassifier
        # Approach B: 9 → 32 → 16 → 1. L2 (alpha) + early stopping replace the
        # BatchNorm/Dropout of the PyTorch sketch, which are unstable on tiny datasets.
        return MLPClassifier(
            hidden_layer_sizes=(32, 16),
            activation='relu',
            alpha=1e-2 if n_samples < 500 else 1e-3,
            learning_rate_init=1e-3,
            max_iter=2000,
            early_stopping=n_samples >= 100,
            validation_fraction=0.15,
            n_iter_no_change=30,
            random_state=42,
        )

    from sklearn.linear_model import LogisticRegression
    # Strong regularization for small datasets
    C = 0.1 if n_samples < 200 else 1.0
    return LogisticRegression(C=C, max_iter=1000, class_weight='balanced')


def _balance(X, y, seed=42):
    """
    Oversample the minority class (MLPClassifier has no class_weight).
    Only used for the MLP; logistic regression uses class_weight='balanced'.
    """
    rng = np.random.default_rng(seed)
    idx_pos = np.where(y == 1)[0]
    idx_neg = np.where(y == 0)[0]
    if len(idx_pos) == 0 or len(idx_neg) == 0 or len(idx_pos) == len(idx_neg):
        return X, y
    minority, majority = (idx_pos, idx_neg) if len(idx_pos) < len(idx_neg) else (idx_neg, idx_pos)
    extra = rng.choice(minority, size=len(majority) - len(minority), replace=True)
    keep = np.concatenate([majority, minority, extra])
    return X[keep], y[keep]


def _grouped_cv(model_type, X, y, groups):
    """Session-grouped cross-validation. Returns (accuracy_mean, accuracy_std, auc_mean, n_folds)."""
    from sklearn.model_selection import StratifiedGroupKFold
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import accuracy_score, roc_auc_score

    groups = np.asarray(groups)
    # Folds must have both classes; limit by number of groups per class
    groups_pos = len(set(groups[y == 1]))
    groups_neg = len(set(groups[y == 0]))
    n_folds = min(5, groups_pos, groups_neg)
    if n_folds < 2:
        return None

    cv = StratifiedGroupKFold(n_splits=n_folds, shuffle=True, random_state=42)
    accs, aucs = [], []
    for train_idx, test_idx in cv.split(X, y, groups):
        if len(set(y[test_idx])) < 2 or len(set(y[train_idx])) < 2:
            continue
        scaler = StandardScaler().fit(X[train_idx])
        Xtr, ytr = scaler.transform(X[train_idx]), y[train_idx]
        if model_type == 'mlp':
            Xtr, ytr = _balance(Xtr, ytr)
        clf = _make_classifier(model_type, len(Xtr)).fit(Xtr, ytr)
        Xte = scaler.transform(X[test_idx])
        p = clf.predict_proba(Xte)[:, 1]
        accs.append(accuracy_score(y[test_idx], (p >= 0.5).astype(int)))
        aucs.append(roc_auc_score(y[test_idx], p))

    if not accs:
        return None
    return float(np.mean(accs)), float(np.std(accs)), float(np.mean(aucs)), len(accs)


def train_model(X, y, groups, model_type='logreg', trained_on='unknown'):
    """Train the calibration model and save it with metadata."""
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import classification_report, confusion_matrix
    import joblib

    X = np.asarray(X, dtype=np.float64)
    y = np.asarray(y, dtype=int)
    n_real, n_fake = int((y == 1).sum()), int((y == 0).sum())
    n_groups = len(set(groups))

    print(f"\n{'='*60}")
    print(f"  CALIBRATION MODEL TRAINING  [{model_type.upper()}]")
    print(f"{'='*60}")
    print(f"  Trained on:   {trained_on}")
    print(f"  Real samples: {n_real}")
    print(f"  Fake samples: {n_fake}")
    print(f"  Sessions / groups: {n_groups}")
    print(f"  Features: {len(FEATURE_NAMES)}")
    print()

    # Grouped cross-validation (honest generalization estimate)
    cv_result = _grouped_cv(model_type, X, y, groups)
    cv_acc = cv_auc = None
    if cv_result:
        cv_acc, cv_std, cv_auc, folds = cv_result
        print(f"  Session-grouped cross-validation ({folds}-fold):")
        print(f"    Accuracy: {cv_acc:.3f} ± {cv_std:.3f}")
        print(f"    ROC AUC:  {cv_auc:.3f}")
        if trained_on == 'synthetic':
            print("    (synthetic data — these numbers say nothing about real-world accuracy)")
        print()
    else:
        print("  Not enough distinct sessions per class for grouped cross-validation.\n")

    # Fit final model on everything
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    X_fit, y_fit = (_balance(X_scaled, y) if model_type == 'mlp' else (X_scaled, y))
    clf = _make_classifier(model_type, len(X_fit))
    clf.fit(X_fit, y_fit)

    # Training-set metrics (optimistic — for sanity only)
    y_pred = clf.predict(X_scaled)
    print("  Training-set report (optimistic, sanity check only):")
    print(classification_report(y, y_pred, target_names=['Fake', 'Real'], zero_division=0))

    print("  Confusion Matrix (training set):")
    cm = confusion_matrix(y, y_pred, labels=[0, 1])
    print(f"    {'':>10} Pred Fake  Pred Real")
    print(f"    {'True Fake':>10}  {cm[0][0]:>6}     {cm[0][1]:>6}")
    print(f"    {'True Real':>10}  {cm[1][0]:>6}     {cm[1][1]:>6}")
    print()

    if model_type == 'logreg':
        print("  Feature Importances (|coefficient|):")
        coefs = np.abs(clf.coef_[0])
        for idx in np.argsort(-coefs):
            bar = '█' * int(coefs[idx] / max(coefs.max(), 1e-12) * 20)
            print(f"    {FEATURE_NAMES[idx]:>20}: {coefs[idx]:.4f} {bar}")
        print()

    # Save model (same keys calibration.py expects, plus metadata)
    os.makedirs(MODEL_DIR, exist_ok=True)
    model_bundle = {
        'scaler': scaler,
        'clf': clf,
        'feature_names': FEATURE_NAMES,
        'meta': {
            'model_type': model_type,
            'trained_on': trained_on,
            'n_real': n_real,
            'n_fake': n_fake,
            'n_groups': n_groups,
            'cv_accuracy': cv_acc,
            'cv_auc': cv_auc,
            'trained_at': datetime.now(timezone.utc).isoformat(),
        },
    }
    joblib.dump(model_bundle, MODEL_PATH)
    print(f"  ✓ Model saved to: {MODEL_PATH}")
    print(f"{'='*60}\n")

    return model_bundle


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Train the DeepVerify calibration layer.")
    p.add_argument('--model', choices=['logreg', 'mlp'], default='logreg',
                   help="logreg (default, small data) or mlp (Approach B)")
    p.add_argument('--csv', nargs='*', default=[],
                   help="Feature CSV(s) from scripts/extract_dataset_features.py")
    p.add_argument('--no-mongo', action='store_true', help="Skip MongoDB forensic_logs")
    g = p.add_mutually_exclusive_group()
    g.add_argument('--synthetic', action='store_true',
                   help="Always add synthetic rows (marks the model as mixed/synthetic)")
    g.add_argument('--no-synthetic', action='store_true',
                   help="Never use synthetic rows; fail if real data is insufficient")
    return p.parse_args(argv)


async def main(argv=None):
    """Main training pipeline."""
    args = parse_args(argv)
    X, y, groups = [], [], []

    print("\n[1/3] Collecting labeled data...")
    if not args.no_mongo:
        try:
            mx, my, mg = await fetch_labeled_data()
            print(f"      MongoDB: {sum(my)} real + {len(my) - sum(my)} fake rows "
                  f"from {len(set(mg))} sessions")
            X += mx; y += my; groups += mg
        except Exception as e:
            print(f"      MongoDB not available: {e}")

    if args.csv:
        cx, cy, cg = load_csv_data(args.csv)
        print(f"      CSV: {sum(cy)} real + {len(cy) - sum(cy)} fake rows "
              f"from {len(set(cg))} groups")
        X += cx; y += cy; groups += cg

    n_real, n_fake = sum(y), len(y) - sum(y)
    g_real = len({g for g, lab in zip(groups, y) if lab == 1})
    g_fake = len({g for g, lab in zip(groups, y) if lab == 0})
    has_real_data = len(y) > 0
    insufficient = (n_real < MIN_PER_CLASS or n_fake < MIN_PER_CLASS or
                    g_real < MIN_GROUPS_PER_CLASS or g_fake < MIN_GROUPS_PER_CLASS)
    if has_real_data:
        print(f"      Total: {n_real} real rows / {g_real} sessions, "
              f"{n_fake} fake rows / {g_fake} sessions")

    if args.synthetic or (insufficient and not args.no_synthetic):
        if insufficient:
            print(f"\n[2/3] Insufficient labeled data (need ≥{MIN_PER_CLASS} rows and "
                  f"≥{MIN_GROUPS_PER_CLASS} sessions per class) — adding synthetic training set.")
        else:
            print("\n[2/3] --synthetic given — adding synthetic training set.")
        print("      The saved model is a PLACEHOLDER until trained on real labeled data.")
        syn_real, syn_fake = generate_synthetic_training_data()
        X += syn_real + syn_fake
        y += [1] * len(syn_real) + [0] * len(syn_fake)
        # Each synthetic row is its own group
        groups += [f"syn:{i}" for i in range(len(syn_real) + len(syn_fake))]
        trained_on = 'mixed' if has_real_data else 'synthetic'
    elif insufficient:
        print(f"\n✗ Only {g_real} real / {g_fake} fake sessions ({n_real} / {n_fake} rows); "
              f"need ≥{MIN_GROUPS_PER_CLASS} sessions and ≥{MIN_PER_CLASS} rows per class, "
              f"and --no-synthetic was given. Label more sessions first.")
        sys.exit(1)
    else:
        print("\n[2/3] Using real labeled data only")
        trained_on = 'real'

    print(f"\n[3/3] Training calibration model...")
    model = train_model(X, y, groups, model_type=args.model, trained_on=trained_on)

    # Quick sanity check
    print("\n  Sanity Check — Sample Predictions:")
    test_cases = [
        ("Real WebRTC (good)", [15.0, 5.0, 72.0, 0.3, 0.55, 0.30, 0.06, 0.95, np.log(76800)]),
        ("Real WebRTC (weak)", [9.0, 2.0, 68.0, 0.8, 0.40, 0.45, 0.10, 0.80, np.log(76800)]),
        ("Deepfake (OBS)", [3.0, -2.0, 0.0, 0.005, 0.15, 0.80, 0.25, 0.90, np.log(76800)]),
        ("Pre-recorded", [8.0, 1.0, 72.0, 5.0, 0.30, 0.60, 0.30, 0.85, np.log(230400)]),
    ]
    for name, features in test_cases:
        f_scaled = model['scaler'].transform([features])
        prob = model['clf'].predict_proba(f_scaled)[0][1]
        verdict = "✓ AUTHENTIC" if prob > 0.5 else "✗ SUSPECT"
        print(f"    {name:>25}: P(real)={prob:.3f}  {verdict}")

    print()


if __name__ == '__main__':
    asyncio.run(main())
