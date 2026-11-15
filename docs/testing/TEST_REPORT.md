# DeepVerify — System Testing & Quality Verification Report

| | |
|---|---|
| **Project** | DeepVerify – Zero-Trust Interview Integrity Platform |
| **Tested commit** | `a1705a3` |
| **Report date** | 2026-11-15 |
| **Tester** | Akilan1805 |
| **Scope** | Section 5 of the project deck — *System Testing & Quality Verification* |
| **Method** | Cloned the repository and wrote a new test suite (`backend/qa_tests/`) that matches the deck's table exactly: **14 + 24 + 10 + 12 = 60 tests**. Every test calls the real DeepVerify code. **No existing file was modified** — all 20+ files in this contribution are new. |

> Every figure below comes from a run logged under `docs/testing/logs/`. Items that could not be reproduced in the test environment are listed in §6 rather than marked as passed.

---

## 1. Result at a glance

| Testing level | Deck | Executed | Passed | Failed | Status |
|---|---:|---:|---:|---:|---|
| Unit Testing | 14 | 14 | 14 | 0 | **100 % Passed** |
| Integration Testing | 24 | 24 | 24 | 0 | **100 % Passed** |
| System / E2E Testing | 10 | 10 | 10 | 0 | **100 % Passed** |
| Boundary & Error Tests | 12 | 12 | 12 | 0 | **100 % Passed** |
| **Total** | **60** | **60** | **60** | **0** | **100 % Passed** |

The full suite ran three times in a row with identical results (60 / 60, ≈ 16 s each), so it is not flaky.
Frontend: `tsc -b` passes, `vite build` passes, `eslint` reports 126 problems (see §7).

**Run it** (from `backend/`):

```bash
pip install -r requirements.txt -r qa_tests/requirements-test.txt
python -m qa_tests.run_suite                                   # level-by-level table, exit code 0 = all pass
python -m unittest discover -s qa_tests -t . -p "test_*.py" -v # plain unittest, as the deck states
python -m qa_tests.bench_latency                               # latency benchmark
```

---

## 2. What is real and what is substituted

The application code is **not mocked**: routes, authentication, AXIOM, PRNU, rPPG, jitter, behavioural scoring, the compiler endpoint and the PDF builder all run for real. Only the external services behind them are replaced so the suite runs on any machine without Docker or cloud keys:

| Service | In the project | In these tests |
|---|---|---|
| MongoDB | `mongo:7` + Motor | `mongomock-motor` (in-memory, Motor-compatible) |
| Redis | `redis:7` + redis-py asyncio | `fakeredis` (real redis-py API, in-process server) |
| AWS Rekognition | boto3 client | real boto3 client with botocore `Stubber` (requests are validated, no network) |
| Browser / WebRTC media | React + MediaPipe | **not exercised** (§6) |

A safety net in the test harness removes real AWS/Cloudinary settings, so the tests can never call a live cloud service.

---

## 3. Results by testing level

### 3.1 Unit testing — 14 / 14 (`test_01_unit.py`)

| Subsystem (deck) | Tests |
|---|---|
| PRNU wavelet extraction | 01 noise residual keeps input shape · 02 reference fingerprint finite and full-size · 03 PCE match-score bands |
| rPPG peak detection | 04 recovers a synthetic **72 BPM** pulse (SNR 13 dB) · 05 pulse-free noise is not live · 06 POS projection length / too-short input |
| Axiom score weighting | 07 layer caps 30 / 30 / 15 / 25 = 100 · 08 genuine candidate verified, no alerts · 09 zero-trust: PRNU + rPPG failure cannot pass · 10 verdict bands and colours |
| JWT generation | 11 round-trip keeps claims · 12 expired token → 401 · 13 tampered / foreign-signed token rejected · 14 session token scoped to session and role |

### 3.2 Integration testing — 24 / 24

| Subsystem (deck) | File | Tests |
|---|---|---:|
| REST + authentication | `test_02a_integration_api.py` | 3 |
| MongoDB session persistence | `test_02b_integration_mongodb.py` | 5 |
| Redis Pub/Sub | `test_02c_integration_redis.py` | 5 |
| WebSocket frame ingestion | `test_02d_integration_websocket.py` | 7 |
| AWS Rekognition | `test_02e_integration_rekognition.py` | 4 |

Highlights: JPEG I-frames sent over `/ws/frames` are decoded and counted; a native-resolution PRNU crop packet reaches the PRNU tracker; candidate events are stored in MongoDB **and** published on Redis; unknown sessions are closed with code 4004; Rekognition one-face, two-face, match and mismatch responses are parsed correctly.

### 3.3 System / end-to-end testing — 10 / 10 (`test_03_e2e.py`)

| # | Workflow |
|---|---|
| 01 | Full candidate onboarding: register → login → profile → session → consent → network → system check → status |
| 02 | Recruiter issues a session; candidate and interviewer tokens open the right views |
| 03 | Live interview: candidate **tab switch** travels candidate socket → Redis → **recruiter dashboard socket** |
| 04 | Live interview: second person in frame → CRITICAL alert on the dashboard and in the database |
| 05 | Monaco compiler sync: code run → `CODE_RUNNING` then `CODE_OUTPUT` (`10`) reach the recruiter |
| 06 | PDF forensic audit: generated PDF is valid (`%PDF` … `%%EOF`, attachment header) |
| 07 | Report summary matches the recorded telemetry (final 54, average 79.3, 1 alert) |
| 08 | Session lifecycle PENDING → ACTIVE → FLAGGED with review flag |
| 09 | Genuine candidate pipeline (PRNU → AXIOM) → *Session Verified*, no alerts |
| 10 | Injected-deepfake pipeline (foreign sensor, no pulse) → Critical, PRNU = 0 |

### 3.4 Boundary & error tests — 12 / 12 (`test_04_boundary.py`)

| # | Edge case |
|---|---|
| 01 | Camera disabled → trust 0, CRITICAL alert |
| 02 | Missing pulse → not live; strongly negative SNR → CRITICAL, rPPG 0 |
| 03 | Repeated tab switching → MEDIUM, MEDIUM, **HIGH**; unique alert ids |
| 04 | Copy-paste attempts (`CLIPBOARD_VIOLATION`, `LARGE_PASTE`) reported and stored |
| 05 | Injected video from another source fails the PRNU identity check |
| 06 | Extreme inputs clamp to [0, 100] |
| 07 | Garbage JWT → 401; unknown session / report ids → 404 |
| 08 | Wrong consent text → 400; invalid body → 422 |
| 09 | Runaway code (`while True`) killed by the 6 s timeout → `TIMEOUT` |
| 10 | Empty code → ERROR; broken code → non-zero exit with `SyntaxError` |
| 11 | Malformed / unknown WebSocket messages do not kill the stream |
| 12 | AWS Rekognition error handled (returned, not raised); too-small image rejected |

---

## 4. System stability & performance summary

| Deck statement | Result |
|---|---|
| *All 4 testing levels verified with zero defects* | All 60 tests pass on three consecutive runs. "Zero defects" is not something this report can state — see §7. |
| *Latency ≈ 275–350 ms (< 1.0 s NFR)* | Measured **in-process** (real app, in-memory Redis/Mongo): candidate event → backend → Redis → dashboard socket **median 2.2 ms, max 4.0 ms**; frame → PRNU → AXIOM compute **median 8.7 ms, p95 14.9 ms**. Both are far under 1 s. The deck's 275–350 ms includes the real network, browser capture and rendering, which this environment cannot measure (§6). |
| *Injected video drops Trust Score to 57 with Critical Alert* | In the pipeline tests an injected (foreign-sensor, no-pulse) stream scores **40 — "Integrity Alert", CRITICAL rPPG alert**, below the 60 Critical threshold. The specific value **57** depends on live demo inputs and was not reproduced. See observation 1 in §7 for the weak-pulse case. |

---

## 5. Deck claims → coverage

| Deck item | Covered by |
|---|---|
| PRNU wavelet extraction, rPPG peak detection, Axiom score weighting, JWT generation | Unit 01–14 |
| WebSocket frame ingestion, Redis Pub/Sub, MongoDB session persistence, AWS Rekognition | Integration (7 + 5 + 5 + 4 tests) |
| Full candidate onboarding, Monaco compiler sync, PDF audit | E2E 01, 05, 06, 07 |
| Live WebRTC interview | E2E 03–04 cover the telemetry/alert path over WebSockets and Redis; **WebRTC media and signalling were not tested** |
| Camera disable, missing pulse, tab switching, copy-paste block, injected deepfakes | Boundary 01–05 (backend behaviour; the browser-side blocking itself is frontend) |

---

## 6. Not executed (and why)

| Item | Reason | What is needed |
|---|---|---|
| Docker Compose bring-up / "verified across Docker and cloud" | Docker unavailable in the test sandbox | `docker compose up --build`, then run the same commands in the backend container |
| Real MongoDB / Redis / AWS Rekognition | Replaced by in-memory fakes and a stubbed client (§2) | Real services and credentials |
| WebRTC media, MediaPipe in a real browser, camera capture, frontend copy-paste blocking | Need a browser and camera | Playwright / manual run |
| 275–350 ms end-to-end latency, Trust Score 57 | Need the live stack and an injected video file | Live demo run |
| `/ws/signaling`, TTS, Sightengine, Cloudinary | Out of the deck's listed scope / no credentials | — |

---

## 7. Observations and recommendations

1. **Weak-pulse deepfake gets only "Caution".** With a foreign-sensor stream (PRNU mismatch, 0 points) and a weak but non-negative pulse (SNR 1 dB), AXIOM returned **62 — Caution with no alerts**. Only a strongly negative SNR (< −1 dB) produces the CRITICAL rPPG alert. Also, `detect_liveness` returns `(False, 0.0, 0.0)` when it has no usable signal, which AXIOM treats as a partial penalty rather than a failure. Please confirm this is intended.
2. **Several endpoints need no authentication.** The tests created sessions (`POST /api/sessions`) and executed code (`POST /api/compiler/run`) without any token.
3. **Code execution is not isolated.** The compiler endpoint runs submitted code with `subprocess` as the server's own user (6 s timeout only; no file, network or memory limits), although its docstring calls it a sandbox. Combined with item 2 this deserves attention before any public deployment.
4. **Raw `pce` alone does not zero the PRNU layer.** A hard 0 / 30 needs `prnu_match` and `prnu_state='mismatch'` from the caller; with only `pce=0` the layer still returns ≈ 19.6 / 30.
5. **Frontend lint is not clean:** 124 errors, 2 warnings (mostly `no-explicit-any`). Type-check and production build pass; main bundle > 500 kB.
6. **Cold start.** The first PRNU call after start-up took ≈ 0.9 s in an earlier run (lazy initialisation); steady state is ≈ 9 ms.
7. **The calibration model is ignored** at start-up ("trained on 'unknown' data — using heuristic fallback"). Retrain with `scripts/train_calibration.py`.
8. **Environment.** Tests ran on Python 3.13 with the latest compatible libraries, not the exact pins in `requirements.txt`; re-run inside the project's Docker image to confirm. `datetime.utcnow()` is deprecated in `axiom.py`, `auth/security.py` and others.
9. **Repository's own tests.** The 14 tests in `backend/test_system_suite.py` pass but only repeat arithmetic inline and import no project code; they were left untouched and are not counted above. The two PRNU scripts also run (one hard-codes a Windows path).

---

## 8. Conclusion

All **60 tests (14 + 24 + 10 + 12) pass** against the real application code, matching the deck's table, and the suite is repeatable. Latency inside the backend is comfortably within the 1 s requirement. What remains to be shown on a full stack is the Docker/cloud run, browser and WebRTC workflows, the end-to-end 275–350 ms figure and the "57" score; the security and scoring observations in §7 are worth resolving before the next report.

## 9. Evidence files (`docs/testing/logs/`)

`suite_summary_by_level.log` · `qa_tests_per_test_results.log` · `latency_benchmark.log` · `frontend_tsc.log` · `frontend_vite_build.log` · `frontend_eslint.log`

Test code: `backend/qa_tests/` — `_bootstrap.py`, `_harness.py`, `test_01_unit.py`, `test_02a…e_integration_*.py`, `test_03_e2e.py`, `test_04_boundary.py`, `run_suite.py`, `bench_latency.py`, `requirements-test.txt`.
