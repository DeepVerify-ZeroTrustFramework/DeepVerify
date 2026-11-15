"""Runs the whole QA suite and prints the level-by-level table used in the testing report.

    python -m qa_tests.run_suite            (from backend/)
Exit code is 0 only if every test passes.
"""
import sys
import time
import unittest

from qa_tests import _bootstrap  # noqa: F401

LEVELS = [
    ("Unit Testing",              ["qa_tests.test_01_unit"],                                       14),
    ("Integration Testing",       ["qa_tests.test_02a_integration_api", "qa_tests.test_02b_integration_mongodb",
                                   "qa_tests.test_02c_integration_redis", "qa_tests.test_02d_integration_websocket",
                                   "qa_tests.test_02e_integration_rekognition"],                   24),
    ("System / E2E Testing",      ["qa_tests.test_03_e2e"],                                        10),
    ("Boundary & Error Tests",    ["qa_tests.test_04_boundary"],                                   12),
]


def main():
    rows, bad = [], 0
    for name, modules, expected in LEVELS:
        suite = unittest.defaultTestLoader.loadTestsFromNames(modules)
        t = time.time()
        res = unittest.TextTestRunner(stream=open("/dev/null", "w"), verbosity=0).run(suite)
        failed = len(res.failures) + len(res.errors)
        bad += failed
        rows.append((name, expected, res.testsRun, res.testsRun - failed - len(res.skipped), failed,
                     len(res.skipped), time.time() - t))
        for t_, tb in res.failures + res.errors:
            print(f"\n--- {t_} ---\n{tb}")
    print(f"\n{'Testing level':<26}{'Slide':>6}{'Run':>6}{'Passed':>8}{'Failed':>8}{'Skipped':>9}{'Time(s)':>9}")
    for r in rows:
        print(f"{r[0]:<26}{r[1]:>6}{r[2]:>6}{r[3]:>8}{r[4]:>8}{r[5]:>9}{r[6]:>9.1f}")
    tot = [sum(r[i] for r in rows) for i in range(1, 6)]
    print(f"{'TOTAL':<26}{tot[0]:>6}{tot[1]:>6}{tot[2]:>8}{tot[3]:>8}{tot[4]:>9}")
    return 1 if bad or tot[1] != tot[0] else 0


if __name__ == "__main__":
    sys.exit(main())
