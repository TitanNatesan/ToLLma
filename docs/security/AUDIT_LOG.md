# Security Audit Log (Agent C, Wave 2 — F6 implementation)

## Table

`security_audit` (`backend/src/tollms/models/security_audit.py`), PK
`event_id` per F6 (not the usual `id`). `created_at`/`updated_at` +
soft-delete columns match repo conventions. CHECK constraints bind
`actor_type`/`event_type`/`severity`/`outcome` to the frozen F6 enums
(TEXT+CHECK, guardrail.Severity convention — no PG ENUM type).

Indexes: `(occurred_at desc, event_id desc)` paging ·
`(actor_user_id, occurred_at)` · `(target_type, target_id)`.

## Field contract (frozen, Agent F consumes)

`event_id, occurred_at, actor_type{user|api_key|system|anonymous},
actor_user_id?, actor_key_id? (row id, never secret), actor_org_id?,
session_id? (sid prefix-8 only), event_type (16 values, see F6),
severity{info|warn|critical}, outcome{allowed|denied|error}, ip_hash?
(sha256+salt, never raw), user_agent_hash?, target_type?, target_id?,
reason? (machine code), request_id?, metadata (jsonb, ids/codes only)`.

## Writer

`api/security/service.py::record_event(db, ...)` — append-only, scrubs
secret-marked metadata keys (same marker list as the `emit()` backstop),
truncates values to 256 chars, fail-open (log + rollback, never raise).
Other packages call it; it also dual-emits the JSON-line event.

## Readers

`GET /api/v1/security/audit` — `platform_admin_required`; filters
`event_type/severity/actor/outcome` + `limit` (clamped 1..500) + `cursor`
(offset int or anchor event UUID; unknown → 422). Org-scoped reads stay on
`api/orgs/audit`; Agent F joins on `target_*`/`request_id`.

## Retention

Hot 400d, then aggregate-or-purge per Agent B retention rules. Purge is the
only deleter; no API UPDATE/DELETE path.

## Orchestrator wiring outstanding

`models/__init__.py` import + Alembic migration (additive) + `main.py`
`include_router(security_router)` — all shared files, proposed in Wave 3.
