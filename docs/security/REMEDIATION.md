# Remediation List (Agent C, Wave 2 — 2026-11-06)

## P0 — Wave 2 DONE (this session)

- [x] T4 centralized audit log: `models/security_audit.py` (F6-exact) +
  `api/security/` trio (`GET /audit`, `POST /sessions/revoke-all`,
  `GET /kek/status`) + `test_security_audit.py` (7 tests green).
- [x] T1/T2/T5/T6/T7 fixes specified as exact
  `docs/security/proposed-diffs/{a,b,c,d}-*.md` for orchestrator apply
  (shared files `core/*`, `main.py`, `config.py` are not Agent C-owned).

## P0 — deferred to orchestrator (Wave 3, diffs proposed)

- [ ] Apply `proposed-diffs/a-egress.md` (SSRF destination validation).
- [ ] Apply `proposed-diffs/b-kek-versioning.md` (`kek_version` column +
  KEK_CURRENT/KEK_PREVIOUS, re-encrypt batches, then flip
  `kek/status.rotation_supported=true`).
- [ ] Apply `proposed-diffs/c-main-headers.md` (headers middleware +
  pre-auth `/v1/*` limiter) + confirm `.env` template location (F10 note:
  `.env.example` absent from tree).
- [ ] Apply `proposed-diffs/d-config-jwt.md` (required `JWT_SECRET`).
- [ ] Close fail-open budget hole (T3): deny when spend counters unreadable
  AND postgres fallback shows spend near cap; emit `gateway.degraded`.
- [ ] Wire `security_router` in `main.py`, `models/__init__.py` import,
  Alembic migration (additive; `alembic check` green).

## P1

- [ ] T8 MFA (TOTP opt-in; extend `require_fresh_confirmation` to
  credential writes/key rotation) — needs models + UX, Wave 4+.
- [ ] T9 frontend same-origin API route (Agent E / orchestrator).
- [ ] T10 negative auth tests per org route (Agent H audit item).

## Regression risk from this session

Low: only additive files under Agent C ownership. Full-suite re-verify is
Wave 4 (H). Known pre-existing failures, reproduced WITHOUT this session's
files: `test_session_hardening` cap/lifetime flakes (2 failed standalone),
backend entrypoint `alembic upgrade` blocked on ownerless provider rows in
the dev DB (`e4f5a6b7c8d9` migration), stale image missing `fpdf2` (rebuilt
during this session).
