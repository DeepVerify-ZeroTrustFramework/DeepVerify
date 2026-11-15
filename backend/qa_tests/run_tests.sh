#!/usr/bin/env bash
# One-command test run (Linux / macOS / Git Bash).  Usage:  bash backend/qa_tests/run_tests.sh
set -e
cd "$(dirname "$0")/.."            # -> backend/
PY="${PYTHON:-python}"
echo "== DeepVerify QA suite =="
"$PY" -m qa_tests.run_suite
echo
echo "== Latency benchmark =="
"$PY" -m qa_tests.bench_latency
