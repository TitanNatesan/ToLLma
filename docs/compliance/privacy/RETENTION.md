# Retention Precedence + Zero-Retention (Agent B, F9)

## Precedence rule (binding, F9)

1. **Org policy wins over personal for org-scoped traffic** (`org_id` non-NULL rows).
2. **Most-restrictive TTL wins on conflict** (`min(retention_days)` across
   applicable policies; `NULL` = keep forever, never wins over a number).
3. **`zero_retention=true` at any applicable scope short-circuits to no-capture.**

Rationale: the controller (org, per Agent A's DPA roles) sets the floor; a
user cannot opt out of controller retention, only narrow personal scope.
REQUIRES_LEGAL_REVIEW (A's DPA text is normative here).

Implemented in `api/privacy/service.py::resolve_retention`. Org-scope writes
require active membership (strangers get 404, no oracle); Wave 3 tightens
this to a manage-permission code once the orchestrator assigns one.

## Policy shape

`retention_policies`: exactly one of (user_id, org_id) — same XOR check
constraint as `prompt_logging_settings`. One live row per (scope,
data_category). Categories: conversations, messages, attachments,
prompt_logs, request_logs, guardrail_triggers, api_request_logs.

## Zero-retention enforcement points (orchestrator integration, Wave 3)

`is_zero_retention(db, user_id, org_id, data_category="prompt_logs")` in
`api/privacy/service.py` is the choke-point helper. It must be consulted at:

1. **Gateway capture** — `services/prompt_logging/capture.py::build_row_kwargs`
   (`allow_store=False` when zero applies). Choke point per F9: extend
   `services/prompt_logging/resolution.py`, no parallel resolver.
2. **Generation Valkey active-state** — `services/generation.py::_cache_write_state`
   must skip `current_content` persistence under zero-retention.
3. **Gateway request logs** — `services/gateway/api_logs.py` + `request_logs.py`
   row writes (rows are attributable even though payload-free).
4. **Search index** — `services/search.py` entry writes (derived content copy).
5. **Guardrail trigger excerpts** — null `input_excerpt`/`output_excerpt`,
   keep the metadata row.
6. **Valkey analytics/search caches** — skip `analytics:{user}` /
   `search:{user}` payload caching.

NOT suppressed: `ExportEvent` rows (metadata-only legitimate-interest audit —
documented, not captured content). Consent withdrawal of `prompt_logging`
should additionally flip effective capture — wire `consent_withdrawn()` into
the same resolution path in Wave 3.

Helper failure mode is fail-open `False` (preserves today's capture
behavior) with a loud log — the capture pipeline is fail-open by design.
