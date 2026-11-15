# Running the DeepVerify tests (beginner guide)

You need **Python 3.10 or newer** and **Git**. All commands are typed in a terminal (Windows: Command Prompt).

## 1. Get the code
```
git clone https://github.com/DeepVerify-ZeroTrustFramework/DeepVerify
cd DeepVerify
git checkout qa/system-testing-60
```

## 2. Install the packages (once)
```
cd backend
pip install -r requirements.txt -r qa_tests\requirements-test.txt
```
(macOS / Linux: use `qa_tests/requirements-test.txt`.) If a line in `requirements.txt` fails on your Python version, install that package without the version number, e.g. `pip install numpy`.

## 3. Run
| What | Command (from `backend/`) |
|---|---|
| Everything, with a summary table | `python -m qa_tests.run_suite` |
| Everything, plain `unittest` output | `python -m unittest discover -s qa_tests -t . -p "test_*.py" -v` |
| Only one level | `python -m unittest qa_tests.test_01_unit -v` (also `test_03_e2e`, `test_04_boundary`) |
| Latency benchmark | `python -m qa_tests.bench_latency` |
| Reproduce the findings in the defect log | `python -m qa_tests.repro_observations` |
| One-click (Windows) | double-click `backend\qa_tests\run_tests.bat` |
| One command (Linux/macOS/Git Bash) | `bash qa_tests/run_tests.sh` |

## 4. What a good result looks like
```
Testing level              Slide   Run  Passed  Failed  Skipped  Time(s)
Unit Testing                  14    14      14       0        0
Integration Testing           24    24      24       0        0
System / E2E Testing          10    10      10       0        0
Boundary & Error Tests        12    12      12       0        0
TOTAL                         60    60      60       0        0
```
The run takes about 20 seconds. No Docker, database or internet connection is needed.

## 5. If something goes wrong
| Message | Meaning / fix |
|---|---|
| `ModuleNotFoundError: No module named 'X'` | Install it: `pip install X` |
| `No module named 'qa_tests'` | You are not in the `backend` folder. `cd backend` first. |
| A test shows `FAIL` | Copy the text under `FAIL:` and send it to the team — it is a real difference in behaviour. |
| Many `Warning` lines | Harmless deprecation warnings from libraries. |

## 6. Refresh the generated catalog
After adding or renaming tests: `python -m qa_tests.tools.generate_catalog` rewrites `docs/testing/TEST_CASES.md`.
