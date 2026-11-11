"""
Label forensic_logs sessions as real / fake for calibration training.

Every frame-fusion result is logged to MongoDB `forensic_logs` with label=null
(see modules/forensic_logger.py). Use this tool to see which sessions exist and
mark whole sessions as "real" (team member, live camera) or "fake"
(deepfake / OBS virtual camera / pre-recorded replay).

Usage (from backend/):
    python -m scripts.label_sessions list
    python -m scripts.label_sessions list --unlabeled
    python -m scripts.label_sessions set real DV-2025-2247 DV-2025-5373
    python -m scripts.label_sessions set fake DV-2025-6612 --note "FF++ face swap via OBS"
    python -m scripts.label_sessions clear DV-2025-6612
    python -m scripts.label_sessions export labeled_logs.csv

Then retrain:
    python -m scripts.train_calibration
"""
import os
import sys
import csv
import argparse
import asyncio
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.train_calibration import _mongo_settings  # noqa: E402

EXPORT_FIELDS = [
    'session_id', 'timestamp', 'label', 'source', 'pce', 'snr_db', 'hr_bpm',
    'amplitude', 'scr', 'spectral_flatness', 'cv_jitter', 'behavioral_score',
    'frame_pixels', 'trust_score', 'calibrated_prob',
]


def _collection():
    from motor.motor_asyncio import AsyncIOMotorClient
    url, db_name = _mongo_settings()
    client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=5000)
    return client, client[db_name]['forensic_logs']


async def cmd_list(unlabeled_only: bool):
    client, col = _collection()
    pipeline = [
        {"$group": {
            "_id": "$session_id",
            "rows": {"$sum": 1},
            "labels": {"$addToSet": "$label"},
            "source": {"$first": "$source"},
            "first": {"$min": "$timestamp"},
            "last": {"$max": "$timestamp"},
            "mean_pce": {"$avg": "$pce"},
            "mean_snr": {"$avg": "$snr_db"},
            "mean_trust": {"$avg": "$trust_score"},
        }},
        {"$sort": {"first": -1}},
    ]
    rows = await col.aggregate(pipeline).to_list(length=10000)
    client.close()

    if unlabeled_only:
        rows = [r for r in rows if r['labels'] in ([None], [])]

    if not rows:
        print("No sessions found in forensic_logs.")
        return

    print(f"{'session_id':<18} {'rows':>5} {'label':<8} {'source':<7} "
          f"{'PCE':>6} {'SNR':>6} {'trust':>6}  first seen")
    print('-' * 86)
    counts = {'real': 0, 'fake': 0, 'none': 0}
    for r in rows:
        labels = [l for l in r['labels'] if l]
        label = ','.join(labels) if labels else '-'
        counts['real' if labels == ['real'] else 'fake' if labels == ['fake'] else 'none'] += 1
        first = r['first'].strftime('%Y-%m-%d %H:%M') if isinstance(r['first'], datetime) else ''
        print(f"{str(r['_id']):<18} {r['rows']:>5} {label:<8} {str(r['source']):<7} "
              f"{(r['mean_pce'] or 0):>6.1f} {(r['mean_snr'] or 0):>6.1f} "
              f"{(r['mean_trust'] or 0):>6.1f}  {first}")
    print('-' * 86)
    print(f"Sessions: {len(rows)}  |  real: {counts['real']}  fake: {counts['fake']}  "
          f"unlabeled: {counts['none']}")


async def cmd_set(label, session_ids, note):
    client, col = _collection()
    update = {"$set": {"label": label, "labeled_at": datetime.utcnow()}}
    if note:
        update["$set"]["label_note"] = note
    for sid in session_ids:
        res = await col.update_many({"session_id": sid}, update)
        print(f"  {sid}: {res.modified_count} rows → {label}"
              + ("" if res.matched_count else "   (no rows found — check the ID)"))
    client.close()


async def cmd_clear(session_ids):
    client, col = _collection()
    for sid in session_ids:
        res = await col.update_many({"session_id": sid},
                                    {"$set": {"label": None},
                                     "$unset": {"labeled_at": "", "label_note": ""}})
        print(f"  {sid}: {res.modified_count} rows cleared")
    client.close()


async def cmd_export(path):
    client, col = _collection()
    docs = await col.find({"label": {"$in": ["real", "fake"]}}).to_list(length=200000)
    client.close()
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=EXPORT_FIELDS + ['group'], extrasaction='ignore')
        w.writeheader()
        for d in docs:
            d['group'] = d.get('session_id')
            w.writerow(d)
    print(f"Exported {len(docs)} labeled rows to {path}")


def main(argv=None):
    p = argparse.ArgumentParser(description="Label forensic_logs sessions for calibration training.")
    sub = p.add_subparsers(dest='cmd', required=True)

    pl = sub.add_parser('list', help="List sessions with row counts and labels")
    pl.add_argument('--unlabeled', action='store_true', help="Only show unlabeled sessions")

    ps = sub.add_parser('set', help="Label all rows of the given sessions")
    ps.add_argument('label', choices=['real', 'fake'])
    ps.add_argument('session_ids', nargs='+')
    ps.add_argument('--note', default='', help="e.g. 'FF++ face swap via OBS, 480p'")

    pc = sub.add_parser('clear', help="Remove labels from the given sessions")
    pc.add_argument('session_ids', nargs='+')

    pe = sub.add_parser('export', help="Export labeled rows to CSV (for the paper / backup)")
    pe.add_argument('path')

    a = p.parse_args(argv)
    if a.cmd == 'list':
        asyncio.run(cmd_list(a.unlabeled))
    elif a.cmd == 'set':
        asyncio.run(cmd_set(a.label, a.session_ids, a.note))
    elif a.cmd == 'clear':
        asyncio.run(cmd_clear(a.session_ids))
    elif a.cmd == 'export':
        asyncio.run(cmd_export(a.path))


if __name__ == '__main__':
    main()
