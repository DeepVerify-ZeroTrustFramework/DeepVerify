@echo off
REM One-command test run for Windows.  Double-click it, or run:  backend\qa_tests\run_tests.bat
cd /d "%~dp0.."
echo == DeepVerify QA suite ==
python -m qa_tests.run_suite
if errorlevel 1 (
  echo.
  echo SOME TESTS FAILED - see the messages above.
  pause
  exit /b 1
)
echo.
echo == Latency benchmark ==
python -m qa_tests.bench_latency
pause
