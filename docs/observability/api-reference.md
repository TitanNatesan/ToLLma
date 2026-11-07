# Observability API Reference (orchestrator)

Base: `GET /api/v1/prompt-logs/logs` (existing cursor pattern, `X-Next-Cursor`).

## New list filters
`trace_id`, `session_key` (opaque strings, exact match), `level` (debug|info|warning|error; other → 422), `min_cost`/`max_cost` (on total_cost), `min_tokens`/`max_tokens` (on total_tokens). All AND-composed with existing scope/user/key/provider/model/status/date/q filters. Workspace-pinned 404-oracle unchanged.

## New row fields (LogMeta/LogDetail)
`usage_estimated` (bool|null — null = pre-migration, unknown), `total_tokens`, `cache_read/write/reasoning_tokens`, `input/output/total_cost` (Decimal, null = unpriced — never `$0.00`; UI shows "unpriced"), `currency` (`USD` convention, models.dev source), `pricing_version` (`models.dev:<repo updated_at>` | `registered-model` | `media-rate-card` | null), `trace_id`, `session_key`, `finish_reason`, `model_params` (public-gateway request params only: temperature/max_tokens/top_p/stop; internal is null — not recorded in-app), `level`, `status_message` (secret-scrubbed, 500 chars).

## Ledger export — `GET /api/v1/prompt-logs/logs/export?format=csv|jsonl`
Same filters as list. Cursor pages ≤1000 rows; `X-Next-Cursor` when truncated. `Content-Disposition: attachment; filename=tollma-prompt-logs-<stamp>.csv|jsonl`. Metadata only — bodies never exported. Writes `ExportEvent(dataset='prompt_logs')`. Personal: owner. Org: `PromptLogs.Read` **and** `Analytics.Export`.

## Scores — `/api/v1/scores`
- `POST ?org_id=` — {name≤128, data_type numeric|categorical|boolean, value_num|value_text (≥1; boolean ∈ 0/1/true/false), trace_id?, prompt_log_id?, session_key?, experiment_id?, source=human, config_name?, comment≤2000?, environment?}. Requires ≥1 subject of (trace_id, prompt_log_id); subjects must resolve in-scope else 404. Same-(name, trace_id+prompt_log_id, UTC-day) rewrites value/comment instead of duplicating. Personal: owner. Org: any member with `PromptLogs.Read`.
- `GET ?org_id=&trace_id=&prompt_log_id=&session_key=&name=` — newest-first keyset cursor.
- `DELETE /{id}?org_id=` — personal owner; org `PromptLogs.Manage`. 204.

## Auditing (new, automatic)
Org content views write `prompt_logs.content_viewed` org AuditLog rows (row id only, never bodies). Exports write `ExportEvent`. Retention-policy obs-category writes require `PromptLogs.Manage` (list hides obs rows from non-`Read` members).

## Documented non-guarantees
Aggregates are not content-gated (ViewUsage/ViewCost see tokens/costs without ViewContent). Metadata rows persist forever (bodies expire). Export is a bearer download (no signed URLs). `session_key` is client-opaque (public plane `X-Tollma-Session-Key` header ≤128 chars; internal always null — conversations group instead).
