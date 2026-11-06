# Implementation Status — updated by orchestrator only

Wave 1 (analysis): VERIFIED 2026-11-07 — all 7 reports in. Interface freeze F1–F10 issued.
Wave 2 (foundation): VERIFIED 2026-11-07 — A (23 legal drafts + applicability + review register), B (privacy domain, 24 tests green), C (audit log + 4 proposed diffs, 7 tests green), D (governance, 11 tests green), E (trust/legal pages, backend-tolerant), F (incidents, 26 tests green), G (CI workflow + notices + devsecops docs). All merged to working tree uncommitted.
Wave 3 (integration): IN_PROGRESS — orchestrator:
- DONE: dev-DB pre-existing migration block repaired (backup + backfill, head=q6r7s8t9u0v1).
- DONE: core/egress.py SSRF choke point + 4 provider hooks + adapter follow_redirects=False + transcribe safe_join.
- DONE: security-headers middleware + required JWT_SECRET (.env.example updated).
- DONE: models/__init__ + main.py wiring (privacy/security/governance/incidents/legal).
- DONE: models/legal.py + api/legal (F1/F2) + seed script (20 drafts seeded on dev).
- DONE: age gate F3 (users.age_confirmed_at, signup 422, confirm-age, require_active_user 403, UserRead.age_confirmed). Deviation from A: session-withholding for Google replaced by server-side feature gate — enforcement equal, no pending-session token machinery.
- DONE: zero-retention hook in prompt-logging resolution (F9 mirror) + legal-hold gate in purge scheduler.
- DONE: migration 44e09f1438c5 (14 tables + age columns, CHECKs + partial indexes preserved); alembic check green.
- DONE: signup test compat (conftest setdefault + direct-signup patches + e2e helpers); legal/age tests (4 green).
- DONE: reaccept-required 500 fixed (column-select set bug).
- DONE: full backend suite 1227 green (serial clean run; earlier 88-failure run was overlapping-Valkey overlap, environmental).
Wave 4 (testing): VERIFIED — trust 72/72; neighbors 69/69; vitest 315/315; e2e trust 17/17 + trust-security 9/9; migration downgrade/upgrade verified; alembic check green; auth.spec checkbox fixed.
Wave 5 (audit H): VERIFIED — independent audit complete (no Critical; H1+M1 fixed + 60/60 re-verified; M2/L1-L4 accepted).
