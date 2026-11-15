# DeepVerify — Defect & Observation Log

Findings from the 2026-11-15 test cycle. All 60 tests pass; these are behaviours worth a decision. DL-11 … DL-21 come from the executed manual test cases ([MANUAL_TEST_REPORT.md](MANUAL_TEST_REPORT.md)). Reproduce DL-01 … DL-05 with:

```bash
cd backend && python -m qa_tests.repro_observations      # output stored in logs/repro_observations.log
```

Severity: **High** = fix before public deployment · **Medium** = confirm intended behaviour · **Low** = housekeeping.

| ID | Severity | Area | Observation | Evidence |
|---|---|---|---|---|
| DL-01 | Medium | Scoring (AXIOM) | A foreign-sensor stream (PRNU mismatch, 0 PRNU points) with a *weak but non-negative* pulse (SNR +1 dB) scores **62 — "Caution" with no alerts**. Only SNR below −1 dB raises the CRITICAL rPPG alert (score 40). | `[DL-01]` lines in repro log |
| DL-02 | Medium | rPPG | With no usable signal `detect_liveness` returns the sentinel `(False, 0.0, 0.0)`; AXIOM treats SNR 0 as a partial penalty (rPPG 18 / 30) and raises no alert. | `[DL-02]` |
| DL-03 | Low | Scoring (AXIOM) | Calling the fusion engine with only `pce` (no `prnu_match` / `prnu_state`) leaves ≈ 19.6 / 30 PRNU points even at PCE 0; a hard 0 needs the caller to pass both. Confirm every live route does. | `[DL-03]` |
| DL-04 | **High** | API security | `POST /api/sessions` and `POST /api/compiler/run` succeed with **no authentication token** (HTTP 201 / 200). | `[DL-04]` |
| DL-05 | **High** | Compiler | Submitted code runs via `subprocess` as the server's own user (6 s timeout only; no file, network or memory limits). The endpoint's docstring says "sandboxed". Demonstrated: code can read the server's working folder. Combined with DL-04 this is remote code execution for anyone who can reach the API. | `[DL-05]` |
| DL-06 | Medium | Frontend quality | `eslint .` reports 124 errors and 2 warnings (mostly `no-explicit-any`, one `@ts-ignore`). `tsc -b` and `vite build` pass; main bundle > 500 kB. | `logs/frontend_eslint.log` |
| DL-07 | Low | Performance | First PRNU analysis after start-up took ≈ 0.9 s (lazy initialisation); steady state ≈ 9 ms. | observed during cold-start run |
| DL-08 | Low | ML | Server log: calibration model was "trained on 'unknown' data — using heuristic fallback". | start-up output |
| DL-09 | Low | Maintenance | `datetime.utcnow()` is deprecated (used in `axiom.py`, `auth/security.py`, routes). | test warnings |
| DL-10 | Low | Repository tests | `backend/test_system_suite.py` (14 tests) imports no project code; the two `test_prnu*.py` scripts always exit 0 and one hard-codes a Windows path. Left untouched. | `TEST_REPORT.md` §7 |
| DL-11 | Medium | Frontend / validation | Server validation errors (HTTP 422) are shown as **`[object Object],[object Object]`**. Seen on recruiter sign-up with a 1-character company/role. | MT-04, `manual_evidence/MT-04_validation_bug.png` |
| DL-12 | Medium | System check | The rPPG baseline step is **simulated in the frontend** (`enrollRppg`: BPM = 68 + 4·sin(t), always succeeds) and the Gaze step is a stub (`enrollGaze`: waits 2 s, always succeeds). With the camera covered the same BPM sequence appears. The voice says "Biological pulse baseline established". | MT-13, `MT-13_step4.png`, `MT-13_covered.png`, `useSystemCheck.ts` |
| DL-13 | Low | System check | Network step text says "STUN/TURN latencies" but it makes one request to `/api/ping`; the RTT is hidden because the step auto-advances. | MT-11 |
| DL-14 | Medium | Face verification | Without AWS keys the local fallback returns a **fixed 94.8 % match for any single detectable face** (never compares with the reference photo), yet the UI says "Face Verified" / "Validated via Rekognition". Safe only if AWS is always configured in production. | `face_verifier.py` `_fallback_compare_faces`, MT-16 |
| DL-15 | Medium | Recruiter dashboard | The **Flag Session** button has no click handler; the backend `FLAG_SESSION` command is never sent, so sessions can never be flagged from the UI. | MT-26 |
| DL-16 | Medium | Session end | Ending a session does not notify the candidate: the confirm dialog says the candidate "will be disconnected", but the candidate page has no handler for `END_SESSION` and stays in the interview view. | MT-27 |
| DL-17 | Low | Recruiter dashboard | The "ID Pending / Unverified" badge does not update when the candidate verifies; it corrects itself only after a page reload. | MT-28 |
| DL-18 | Low | Layout | At 320 px width the demo page scrolls sideways (33 px; chip row cut off). | MT-32, `mobile_sheet.png` |
| DL-19 | **High** | Secrets | `frontend/src/hooks/useTTS.ts` contains a hard-coded fallback API key for the Sarvam TTS service (`sk_0l2l…`, redacted here), which ships in the browser bundle and sits in the repository history. Rotate it and move the call to the backend. | `useTTS.ts` line 11 |
| DL-20 | Low | Scoring | A CRITICAL "multiple faces" alert barely lowers the trust score (84 → 79 over 25 s). Confirm this weighting is intended. | MT-22 |
| DL-21 | Medium | Slide claim | Injected pre-recorded video was detected (PRNU 0/30, HIGH alert) but settled at about 63 (Caution), not "57 with Critical Alert". | MT-30, `MT-30_demo_score_panel.png` |

## Recommended order of work
0. DL-19 — rotate the exposed API key and remove it from the source.
1. DL-04 and DL-05 — require authentication on session creation and code execution; run user code in an isolated container with resource limits.
2. DL-01 / DL-02 — decide whether a PRNU mismatch with a weak pulse should alert or lower the verdict; add a test once decided.
3. DL-06 — clean the lint errors (or relax the rule deliberately).
4. DL-15, DL-16, DL-12, DL-14 — make the Flag button, session end, system-check steps and no-AWS mode behave as the UI claims; DL-11 readable errors.
5. DL-03, DL-07 … DL-10 — housekeeping.
