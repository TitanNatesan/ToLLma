# Blockers

- None yet. External deps that would block (KMS/Managed key service, SMTP for notifications, S3-compatible backup target) to be recorded here with CONTINUE-WITH-LOCAL-FALLBACK note, not as stop conditions.
- Legal counsel review: all drafts ship as REQUIRES_LEGAL_REVIEW; absence of counsel does not block technical implementation.

## 2026-11-07 - RESOLVED: dev-DB pre-existing migration block (orchestrator)
Symptom: backend crash-loop, `alembic upgrade head` aborted at e4f5a6b7c8d9 (32 ownerless pre-auth provider rows, 0 users; dev volume at fb3312981ccc initial schema). Every Wave 2 agent hit this. Fix (migration's own prescribed path, dev data only — no production/customer data involved): pg_dump backup to /tmp/tollms-dev-pretrust-backup.dump; upgraded to d3e4f5a6b7c8; inserted local dev-owner user (dev-owner@tollma.local, NULL password, verified); backfilled user_id on 32 providers + 30 conversations + 54 messages; `alembic upgrade head` green at q6r7s8t9u0v1; backend healthy. Isolated test-DB convention (TOLLMS_TEST_DB) retained for parallel test runs.
