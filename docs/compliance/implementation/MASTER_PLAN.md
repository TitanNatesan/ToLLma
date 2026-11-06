# ToLLma Trust — Master Plan

## Architecture assessment (2026-11-07, orchestrator)

Existing capabilities reused, not rebuilt:

- Auth: `api/auth` (signup/verify/login/Google OAuth, JWT access 15m / refresh 30d, Valkey `session:{sid}` sessions, `get_current_user` Bearer-or-cookie). Passwords argon2, MFA absent.
- Credential protection: `core/crypto.py` Fernet from SECRET_KEY, masked responses, per `(user_id,name)` uniqueness. No envelope/KEK versioning, no rotation API.
- Abuse protection: `core/rate_limit.py` Valkey fixed-window auth limiter, fail-closed, login lockout. No gateway-level distributed limits, no spend caps.
- Guardrails: `services/guardrails/` (deterministic, LLM, moderation, JEV, enforcement, notify) + `api/guardrails`. No provider-policy registry, no abuse-report flow.
- Data lifecycle: `api/exports` exists, `test_account_deletion.py` exists, `models/purge_audit.py` exists, prompt-logging retention triggers exist. No consent records, no retention settings UI, no DSR workflow.
- Audit: orgs audit (`api/orgs/audit`), request logs (`api/request_logs`). No centralized security audit log.
- Admin: `api/admin` exists. No compliance/incident/legal-request management.
- Frontend: `app/legal` absent, `app/settings` + `app/admin` exist, `app/trust` absent.
- Legal: LICENSE is Apache-2.0, NOTICE exists, SECURITY.md empty, no legal docs, no acceptance tracking.
- CI: only `deploy-pages.yml`. No secret/SAST/dependency/container/license scanning.

## Requirement domains and owners

| Domain | Owner | New backend path | New model module | Tests | Docs |
|---|---|---|---|---|---|
| Legal docs + acceptance | A (docs) + orchestrator (API) | `api/legal/` | `models/legal.py` | `test_legal*.py` | `docs/legal/` |
| Privacy (consent, retention, DSR, export/delete) | B | `api/privacy/` | `models/privacy.py` | `test_privacy*.py` | `docs/compliance/privacy/` |
| Security (authz hardening, audit log, SSRF, headers) | C | `api/security/` + `core/` edits via orchestrator | `models/security_audit.py` | `test_security*.py` | `docs/security/` |
| AI governance (provider registry, abuse) | D | `api/governance/` | `models/governance.py` | `test_governance*.py` | `docs/compliance/ai/` |
| Trust Center + privacy/security frontend | E | — | — | e2e `trust-*.spec.ts` | — |
| Incidents + legal requests + vendors | F | `api/incidents/` | `models/incidents.py` | `test_incidents*.py` | `docs/compliance/operations/` |
| OSS + DevSecOps | G | — | — | — | `docs/opensource/`, `docs/security/devsecops/` |
| Independent audit | H | `backend/tests/test_audit_*.py`, `frontend/e2e/trust-security/` | — | — | `docs/security/audit/` |

## Layering (backend.md, binding)

- New feature packages follow `api/<pkg>/{router.py,schemas.py,service.py}` trio. No `tollms.modules.*` anywhere.
- Routers: endpoints only, `get_current_user` on everything except public legal reads. Services own CRUD. Engines only if 3+ callers.
- Models: one module per table group, UUID PKs, `created_at/updated_at`, business tables get `is_deleted/deleted_at/deleted_by`.
- Migrations: additive only, orchestrator generates. `alembic check` must stay green.
- Tenant isolation: every user/org-owned row filtered by owner; cross-owner access returns 404 (no oracle).

## Waves

- Wave 1 (now): A–G analysis in parallel, read-only + inventory reports. No code.
- Wave 2: implementation per file-ownership registry, shared files via orchestrator only.
- Wave 3: orchestrator integrates routers/models/migrations/middleware/config/nav/CI.
- Wave 4: tests (backend pytest, frontend vitest, Playwright trust e2e, migration upgrade/downgrade).
- Wave 5: H independent audit, fix P0/P1, re-verify, release report.
