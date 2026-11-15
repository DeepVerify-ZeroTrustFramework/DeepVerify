# DeepVerify — Test Environment

| Item | Value |
|---|---|
| Date | 2026-11-15 |
| OS | Linux 6.x (x86-64 sandbox) |
| Python | 3.13.18 |
| Node.js | 22.23.4 (frontend type-check / build / lint only) |
| Tested commit | `a1705a3` |
| Test runner | Python `unittest` |

## Services
| Service | Used in tests | Real in production |
|---|---|---|
| MongoDB | `mongomock-motor` 0.0.36 (in-memory) | `mongo:7` |
| Redis | `fakeredis` 2.40.0 (in-process) | `redis:7` |
| AWS Rekognition | botocore `Stubber` on a real boto3 client | live AWS |
| Browser / WebRTC | not used | React + MediaPipe |

## Package versions
Exact versions used are in [`logs/pip_freeze_test_environment.txt`](logs/pip_freeze_test_environment.txt).

These are the **latest compatible** releases at test time, not the pins in `backend/requirements.txt` (for example numpy 1.26.2, opencv 4.8.1.78, mediapipe 0.10.8), which were not installed on Python 3.13. Results with the pinned versions should be confirmed inside the project's Docker image.

## Safety settings applied by the harness
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are set to dummy values; Cloudinary, MongoDB, Redis and Sightengine settings are removed. The face-verifier's Rekognition client is cleared as soon as the app harness starts (the Rekognition tests then install a stubbed client), so no test can contact a live service.

## Reproduce this environment
```bash
python -m venv venv
venv\Scripts\activate            # Windows   (Linux/macOS: source venv/bin/activate)
pip install -r backend/requirements.txt -r backend/qa_tests/requirements-test.txt
```
If a pinned version fails to install on your Python, install the unpinned package of the same name instead.
