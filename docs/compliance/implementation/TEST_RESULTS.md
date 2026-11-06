# Test Results — updated by orchestrator

## 2026-11-07 Wave 3 (so far)
- Trust domain suites (isolated PG DBs, serial): privacy 24/24, security 7/7, governance 11/11, incidents 26/26, legal/age 4/4 — all green.
- Frontend: tsc 0 errors; eslint 0 warnings (E scope); vitest 315/315; prod build green.
- Trust e2e (live dev backend + prod frontend): trust-legal 6/6, trust-center + trust-privacy 11/11 → 17/17 green (re-run 2026-11-07: 16 passed).
- alembic check: green (migration 44e09f1438c5 applied; check reports no operations).
- OpenAPI: 231 paths, 32 trust endpoints, no duplicates; security headers verified live (nosniff/DENY/no-referrer/permissions + CSP on /api).
- Full backend suite: clean re-run in progress (tollms_test_fullclean). Prior run 1139 passed / 88 failed EXPLAINED: overlapped parallel pytest runs sharing Valkey DB 15 (conftest pins 15 for all runs) — sessions flushed cross-run. Not code. Re-run has no overlapping runners.
- test_model_repository.py deselected from the clean run (slow live-sync); runs separately after.
- Known pre-existing flakes (not Trust): test_session_hardening transient 401 under parallel runs (C report); Turbopack dev panic (E report, env-only).
