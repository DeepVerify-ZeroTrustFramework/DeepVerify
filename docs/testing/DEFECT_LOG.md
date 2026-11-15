# DeepVerify — Defect & Observation Log

Findings from the 2026-11-15 test cycle. All 60 tests pass; these are behaviours worth a decision. Reproduce all of DL-01 … DL-05 with:

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

## Recommended order of work
1. DL-04 and DL-05 — require authentication on session creation and code execution; run user code in an isolated container with resource limits.
2. DL-01 / DL-02 — decide whether a PRNU mismatch with a weak pulse should alert or lower the verdict; add a test once decided.
3. DL-06 — clean the lint errors (or relax the rule deliberately).
4. DL-03, DL-07 … DL-10 — housekeeping.
