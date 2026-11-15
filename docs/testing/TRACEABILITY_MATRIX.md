# DeepVerify — Traceability Matrix

Maps each item in the project deck's *System Testing & Quality Verification* table to the automated test cases that verify it. IDs refer to [TEST_CASES.md](TEST_CASES.md).

## Unit testing (deck: 14 automated tests)
| Deck item | Test cases | Result |
|---|---|---|
| PRNU wavelet extraction | UT-01, UT-02, UT-03 | Pass |
| rPPG peak detection | UT-04, UT-05, UT-06 | Pass |
| Axiom score weighting | UT-07, UT-08, UT-09, UT-10 | Pass |
| JWT generation | UT-11, UT-12, UT-13, UT-14 | Pass |

## Integration testing (deck: 24 API / pipeline scenarios)
| Deck item | Test cases | Result |
|---|---|---|
| WebSocket frame ingestion | IT-14 … IT-20 | Pass |
| Redis Pub/Sub | IT-09 … IT-13 | Pass |
| MongoDB session persistence | IT-04 … IT-08 | Pass |
| AWS Rekognition | IT-21 … IT-24 | Pass (stubbed client) |
| REST API and authentication | IT-01 … IT-03 | Pass |

## System / E2E testing (deck: 10 complete workflows)
| Deck item | Test cases | Result |
|---|---|---|
| Full candidate onboarding | ST-01, ST-02 | Pass |
| Live interview (alerts to recruiter) | ST-03, ST-04, ST-08 | Pass — telemetry/alert path only; WebRTC media not tested |
| Monaco compiler sync | ST-05 | Pass |
| PDF audit | ST-06, ST-07 | Pass |
| Genuine and deepfake pipelines | ST-09, ST-10 | Pass |

## Boundary & error tests (deck: 12 edge-case scenarios)
| Deck item | Test cases | Result |
|---|---|---|
| Camera disable | BT-01 | Pass |
| Missing pulse | BT-02 | Pass |
| Tab switching | BT-03 | Pass (backend escalation; browser event capture not tested) |
| Copy-paste block | BT-04 | Pass (backend reporting; browser blocking not tested) |
| Injected deepfakes | BT-05 | Pass |
| Input validation and clamping | BT-06, BT-07, BT-08 | Pass |
| Compiler limits | BT-09, BT-10 | Pass |
| Stream robustness | BT-11 | Pass |
| Cloud-service failure handling | BT-12 | Pass |

## System stability & performance summary (deck)
| Deck statement | Evidence | Status |
|---|---|---|
| All 4 testing levels verified | `logs/suite_summary_by_level.log` (60/60) | Verified for the backend |
| Verified "across Docker and cloud" | — | **Not verified** (no Docker / cloud in the test environment) |
| Latency ≈ 275–350 ms (< 1.0 s) | `logs/latency_benchmark.log` (in-process: alert path ≈ 2 ms, compute ≈ 9 ms) | NFR < 1 s met in-process; end-to-end figure not reproducible here |
| Injected video → Trust Score 57, Critical | `logs/repro_observations.log` (DL-01: 40, Critical) | Critical band confirmed; value 57 not reproduced |
