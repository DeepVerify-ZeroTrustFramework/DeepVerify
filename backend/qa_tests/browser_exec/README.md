# Browser test scripts (reference)

These are the exact Playwright scripts used for the manual-test execution in `docs/testing/MANUAL_TEST_REPORT.md`. They drive the **real** frontend and backend in Google Chrome.

| Piece | What it is |
|---|---|
| `../tools/run_local_server.py` | Real FastAPI backend with in-memory MongoDB/Redis (use when Docker is unavailable) |
| `cam_fixture.py` | Synthetic webcam (test fixture): fixed sensor-noise pattern, 72 bpm pulse, modes `genuine` / `injected` / covered / two faces; also serves MediaPipe and Monaco from local files because the sandbox blocks the CDN |
| `exec_*.py` | One script per group of manual cases (A accounts, C system check, D/E live interview, F demo, G small window) |

Run order: start backend (`QA_HAAR_DIR=<folder with haarcascade_frontalface_default.xml> python -m qa_tests.tools.run_local_server`), start the frontend (`npx vite --port 5173`), `python make_test_images.py`, then run a script. Paths at the top of the scripts (`/path/to/work`, `/tmp/...`) must be adjusted for your machine. Requires `pip install playwright requests pillow` and Chrome.

Limits: the camera is synthetic, not a physical webcam; tab switching is a simulated `visibilitychange` event; Firefox/Edge were not available.
