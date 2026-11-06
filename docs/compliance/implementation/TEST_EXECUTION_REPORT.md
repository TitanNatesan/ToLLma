# Test Execution Report

- Full backend: 1227 passed, EXIT=0 (serial, TOLLMS_TEST_DB=tollms_test_final, `-p no:randomly`; log /tmp/opencode/pytest-final.log). Includes test_model_repository.
- Trust domains: privacy 24 + security 7 + governance 11 + incidents 26 + legal/age 4 = 72/72.
- Audit: 48/48 post-remediation (+12 account-deletion in same 60/60 run).
- Neighbors of purge change: prompt_logging/* + guardrail_activation + exports + guardrails_notify_repeat 69/69.
- Frontend: vitest 315/315 (4 new trust contract tests); tsc 0 errors; eslint clean (touched scope); `npm run build` green.
- E2E (live dev backend + prod frontend): trust-legal 6/6, trust-center + trust-privacy 11/11, trust-security 9/9.
- Migration: upgrade head + downgrade -1 + re-upgrade on dev; `alembic check` green.
- Pre-existing flakes noted (not Trust): session-hardening transient 401 under parallel pytest; full-suite Valkey-15 overlap (self-inflicted once, documented, clean re-run has no overlap).
- Not run: trust-security.yml first CI run (needs CI enablement); quarterly backup drill (procedure only).
