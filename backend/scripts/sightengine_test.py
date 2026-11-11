"""
One-off evaluation of the Sightengine AI face check on our real and fake frames.

Run inside the backend container (it has internet access and the .env keys):
    docker compose exec backend python scripts/sightengine_test.py
Frames: uploads/se_test/real/*.jpg and uploads/se_test/fake/*.jpg
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from modules.ai_face_check import check_face_image, enabled  # noqa: E402

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'uploads', 'se_test')


def main():
    if not enabled():
        print('SIGHTENGINE_USER / SIGHTENGINE_SECRET are not set in the container environment.')
        print('Check backend/.env, then: docker compose up -d --force-recreate backend')
        return
    rows, ops = [], 0
    for label in ('real', 'fake'):
        for p in sorted(glob.glob(os.path.join(BASE, label, '*.jpg'))):
            with open(p, 'rb') as f:
                r = check_face_image(f.read())
            name = os.path.basename(p)[:-4]
            if not r['ok']:
                print(f'{label:4} {name:26} ERROR {r["error"]}')
                if 'cap' in str(r['error']):
                    break
                continue
            ops += r['operations'] or 0
            df, ai = r['deepfake'], r['ai_generated']
            print(f'{label:4} {name:26} deepfake={df if df is None else round(df, 3)!s:6}  '
                  f'ai_generated={ai if ai is None else round(ai, 3)!s:6}  ops={r["operations"]}')
            rows.append({'label': label, 'name': name, 'deepfake': df, 'ai_generated': ai})
    with open(os.path.join(BASE, 'results.json'), 'w') as f:
        json.dump(rows, f, indent=1)
    print(f'\n{len(rows)} frames checked, {ops} operations used. Results saved to uploads/se_test/results.json')


if __name__ == '__main__':
    main()
