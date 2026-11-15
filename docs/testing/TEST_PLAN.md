# DeepVerify — Test Plan

| | |
|---|---|
| Document owner | Akilan1805 (testing) |
| Applies to | DeepVerify backend (`backend/`) at commit `a1705a3` |
| Status | Executed — results in [TEST_REPORT.md](TEST_REPORT.md) |

## 1. Purpose
Verify that DeepVerify's four forensic layers (PRNU camera fingerprint, rPPG pulse, network jitter, behavioural telemetry), the AXIOM trust-score fusion, authentication, session handling, real-time alerting and reporting behave as described in Section 5 of the project deck, and produce repeatable evidence.

## 2. Scope
**In scope** — everything reachable through the Python backend: scoring and forensic modules, REST API, WebSocket endpoints (`/ws/frames`, `/ws/candidate`, `/ws/dashboard`), Redis Pub/Sub alerting, MongoDB session persistence, AWS Rekognition integration, compiler endpoint, PDF report generation.

**Out of scope for this cycle** — browser-side behaviour (React UI, MediaPipe in the browser, camera capture, copy-paste blocking), WebRTC media and `/ws/signaling`, TTS, Sightengine, Cloudinary, Docker orchestration, load testing. These are listed in the report as *not executed*.

## 3. Test levels (from the deck)
| Level | Planned | Focus |
|---|---:|---|
| Unit | 14 | PRNU wavelet extraction, rPPG peak detection, Axiom score weighting, JWT generation |
| Integration | 24 | WebSocket frame ingestion, Redis Pub/Sub, MongoDB session persistence, AWS Rekognition, REST + auth |
| System / E2E | 10 | Onboarding, live-interview alerting, compiler sync, PDF audit, lifecycle, genuine and deepfake pipelines |
| Boundary & error | 12 | Camera disable, missing pulse, tab switching, copy-paste, injected deepfakes, bad input |
| **Total** | **60** | |

## 4. Approach
* Framework: Python standard `unittest` (as stated in the deck); FastAPI `TestClient` for HTTP and WebSockets.
* Application code is exercised for real. Only external services are substituted: MongoDB → `mongomock-motor`, Redis → `fakeredis`, AWS → botocore `Stubber`.
* Tests are independent: each creates its own session ids; no test depends on another's data.
* Safety: the harness removes real AWS / Cloudinary / database settings so a test can never reach a live service.
* Existing repository files are never modified; all test assets are new files under `backend/qa_tests/` and `docs/testing/`.

## 5. Environment
See [ENVIRONMENT.md](ENVIRONMENT.md). Python 3.13, latest compatible libraries, Linux.

## 6. Entry and exit criteria
| | Criteria |
|---|---|
| Entry | Repository clones cleanly; dependencies install; backend modules import. |
| Exit | All planned tests executed; 100 % pass on three consecutive runs; failures, if any, logged in the defect log with reproduction steps; evidence stored in `docs/testing/logs/`. |

## 7. Deliverables
| Deliverable | File |
|---|---|
| Test code | `backend/qa_tests/` |
| Test case catalog | [TEST_CASES.md](TEST_CASES.md) |
| Requirement → test traceability | [TRACEABILITY_MATRIX.md](TRACEABILITY_MATRIX.md) |
| Results report | [TEST_REPORT.md](TEST_REPORT.md) |
| Defect / observation log | [DEFECT_LOG.md](DEFECT_LOG.md) |
| Run evidence | `logs/` |

## 8. Risks
| Risk | Mitigation |
|---|---|
| In-memory fakes differ from real MongoDB / Redis / AWS | Fakes implement the same client APIs; a final run against Docker Compose is listed as a follow-up. |
| Library versions differ from `requirements.txt` pins | Exact versions recorded in ENVIRONMENT.md; re-run inside the project's Docker image. |
| Browser-only behaviour is untested | Explicitly listed as out of scope; recommend Playwright run. |
| Timing-based tests (compiler timeout ≈ 6 s) | Generous assertion limit (< 15 s). |

## 9. Schedule
Single cycle on 2026-11-15: plan → build suite → execute (3 repeat runs) → report → publish branch.
