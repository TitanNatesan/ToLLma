# Implementation Plan (orchestrator, Phase 2 — binding)

## Target architecture
Flat ledgers + correlation columns (no generic observations table, no traces table). Trace = `trace_id` string shared by rows of one logical operation; generation = `messages` row (internal) or deterministic `generation_id` (public). Scores attach by `(trace_id, prompt_log_id)`.

## Configuration precedence (unchanged semantics, hardened)
Platform defaults → workspace setting (`prompt_logging_settings` XOR scope) → zero-retention veto (privacy policy; now fail-closed on DB error) → key legs (global/keys + overrides) → effective row kwargs. Org `RetentionPolicy` writes for `prompt_logs/request_logs/api_request_logs` now require `PromptLogs.Manage` (read: `PromptLogs.Read`) — fixes F-R1. No team config (ban upheld). New knobs reuse the settings table; no `observability_settings` table.

## Permission matrix (new surfaces)
| Surface | Personal | Org |
|---|---|---|
| Scores create/list | owner | `PromptLogs.Read` |
| Scores delete | owner | `PromptLogs.Manage` |
| Ledger export | owner (own rows) | `Analytics.Export` (+ `PromptLogs.Read` implied) |
| Retention write (obs categories) | owner | `PromptLogs.Manage` (was: any member) |
| Content view | owner | `PromptLogs.ViewContent` + org AuditLog row written |

## API contracts
- `GET /prompt-logs` += `trace_id`, `session_key`, `status`, `level`, `min_cost`, `max_cost`, `min_tokens`, `max_tokens` filters; response rows gain the new columns (decrypted text unchanged).
- `GET /prompt-logs/export?format=csv|jsonl&cursor=` — cursor-paged server-side; writes `ExportEvent(dataset=prompt_logs)`; org gate above.
- `POST /scores {name, data_type, value_num|value_text, trace_id?, prompt_log_id?, session_key?, comment?, source?}` — subject must resolve in caller's workspace (404-oracle); `GET /scores?trace_id=&prompt_log_id=`; `DELETE /scores/{id}` (Manage).
- Public gateway accepts `X-Tollma-Session-Key` header (<=128 chars, opaque) → `session_key`; internal leaves NULL (conversation groups).
- Content-view audit: `prompt_logs.content_viewed` org AuditLog rows (who/when/row id, never body).

## Migration plan (single head, orchestrator-owned)
M: prompt_logs += 15 columns (all NULL, no backfill — NULL=unknown) + generation_id FK + 2 indexes (trace_id, session_key); NEW scores table; guardrail_triggers.request_id index; drop 3 redundant request_logs indexes. Upgrade + downgrade tested on isolated DB; `alembic check` green; historical rows readable (new fields NULL, UI shows "unknown").

## Ownership
| Area | Owner |
|---|---|
| Migration + models + privacy fix + resolution/queue/capture + gateway wiring | Orchestrator |
| `api/scores/` trio + export endpoint + record/score tests | backend agent |
| Prompt-logs UI (cost, estimated badge, trace/session filters, export button, scores panel) | frontend agent |
| Isolation/negative + lifecycle tests | tester agent |
| Final review | reviewer agent |

## Test plan
Agent 7's `test-acceptance-plan.md` scoped to this wave: A (IDOR on trace/score/export), B (precedence incl. Manage-gated retention), C (streaming/tool/failure/partial/missing-usage lifecycle), D (token/cost correctness incl. NULL semantics), E (redaction/encryption/access/export/purge), F (overhead benchmark — report numbers), G (frontend). Full backend suite + vitest + trust e2e must stay green.

## Rollout
Default-off preserved (no behavior change unless workspace enables logging). New columns NULL-safe. Scores API additive. Export additive. Retention-gate fix is a hardening (may 403 previously-allowed member writes — intended).
