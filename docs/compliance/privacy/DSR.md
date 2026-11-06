# DSR State Machine + SLA (Agent B, F5)

## Request types

`access | correction | erasure | portability | grievance`

`grievance` is the complaint/appeal channel (REQUIREMENTS P0). Review queue
ownership is shared with Agent F (incidents) — handoff interface agreed
Wave 2: F reads via `GET /api/v1/privacy/dsr?type=grievance&status=`.

## States and transitions

```text
submitted → under_review → in_progress → fulfilled | partially_fulfilled | rejected
submitted → rejected (fast-path, reason_code required)
under_review → rejected (reason_code required)
in_progress → rejected (reason_code required)
```

Terminal states (`fulfilled | partially_fulfilled | rejected`) are
**immutable**: any transition out is a 422. Every transition appends a
`dsr_events` row (from_status, to_status, actor, note) — append-only, no
UPDATE path. `rejected` requires `reason_code` (422 otherwise).

Enforced in `api/privacy/service.py::transition_dsr` via the `DSR_TRANSITIONS`
map; terminal set `DSR_TERMINAL`. Owner-scoped reads/writes: strangers get
404 (no oracle).

## SLA

`due_at` = `submitted_at + 30 days` (server-stamped, `DSR_SLA_DAYS`).
`fulfilled_at` + `decided_by` stamped on terminal transition. SLA-breach
surfacing (notifications/escalation) is Wave 3 (needs C's audit envelope +
F's review queue).

## Fulfillment wiring (Wave 3, orchestrator)

- **access / portability** → `GET /api/v1/privacy/export` (full-account JSON
  bundle; reuses the exports engine, ciphers never leave the server).
- **erasure** → `POST /api/v1/privacy/erasure` schedules the existing 15-day
  grace via the settings deletion service (no duplicated purge logic); the
  daily job extends `_purge_user_data` scope per the checklist below.
- **correction** → profile/message edit paths (frontend E; no new API in Wave 2).

## Deletion propagation checklist (extends verified `_purge_user_data`)

PG (dependency order): conversations (CASCADEs messages → versions/runs,
linked attachments, shares, search index) → stray attachments →
registered models → providers → api_keys (+policies/IP/model perms CASCADE)
→ password_reset_tokens (CASCADE on user delete) → **prompt_logs: hard-delete
or anonymize** (today SET NULL keeps attributable content) →
**guardrail_triggers: null excerpts + attribution** →
**request_logs/api_request_logs: null user/key refs + IP/UA/geo** →
shares, memberships/invitations/notifications/audit rows → user row →
`PurgeAuditLog` ok/failed row (retained as controller audit record —
lawful basis needs Agent A text).

Object storage: all `attachments.storage_path` (linked + stray) via
`delete_bytes`, plus a list-vs-PG verification sweep in Wave 2.

Valkey: `session:{sid}` × N + `sessions:{user_id}` (already revoked) +
`conversation:*`, `messages:*`, `usage:{user}:*`, `generation:*`,
`analytics:{user}:*`, `search:{user}:*`, `share:*` for the user's
conversations, `verify_email:*`/`oauth_state:*`. Best-effort with PG as
truth; log misses, never fail the purge on Valkey outage. Dropped:
pending `prompt_logging/queue.py` items for the user.

Qdrant/ARQ: N/A (not in codebase). Backup lifecycle: PG backups (PITR) retain
purged rows until backup expiry — backup retention window + procedure is P1
and still missing; no KEK rotation exists (flag to C/orchestrator).

## Open integration items

- Credential rotation/revocation API ownership (B vs C).
- Org-member erasure vs org data retention semantics (needs A legal +
  orchestrator decision).
- `purge_audit_log.deleted_user_id` retained forever — lawful basis needs A text.
- DSR transition audit vs C's `security_audit` envelope: DSR keeps its own
  `dsr_events` (domain audit); C envelope adoption is Wave 3.
