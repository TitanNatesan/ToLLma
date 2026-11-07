# Observability ERD (orchestrator, Phase 2)

Existing tables reused verbatim; `+` = Phase 3 additions (one migration). No `traces`, `spans`, `sessions`, `datasets`, `experiments`, `observability_settings` tables (deferred with gates — see gap analysis).

```text
users 1───* prompt_logging_settings (XOR user_id/org_id, live-UQ per scope)
organizations 1───* prompt_logging_settings
prompt_logging_settings 1───* prompt_logging_key_targets (setting_id, api_key_id UQ)
prompt_logging_settings 1───* prompt_logging_key_overrides (setting_id, api_key_id UQ)

conversations 1───* messages (generation IS the message row)
messages 1───* prompt_logs  [generation_id: LOGICAL link, no FK —
                                   internal = messages.id; public = deterministic
                                   per-request UUID (uuid5). FK dropped: public
                                   rows reference no message row.]

prompt_logs (append-only, no soft-delete)  — correlation + completeness columns:
  + trace_id TEXT NULL, idx            internal: str(conversation_id) | str(generation_id)
                                       public: request_id (uuid4 hex per request)
  + session_key TEXT NULL, idx         user-settable cross-plane grouping (public: client-supplied)
  + usage_estimated BOOL NULL          NULL = pre-migration (unknown); new rows non-null
  + total_tokens / cache_read_tokens / cache_write_tokens / reasoning_tokens INT NULL
  + input_cost / output_cost / total_cost NUMERIC(12,8) NULL   (NULL = unpriced, never $0-lie)
  + currency TEXT NULL ('USD' convention, models.dev source)
  + pricing_version TEXT NULL          repo sync identity (price valid-as-of)
  + finish_reason TEXT NULL
  + model_params JSONB NULL            request settings (temperature, max_tokens, …)
  + level TEXT NULL                    (debug/info/warning/error — derived from status)
  + status_message TEXT NULL           scrubbed human-readable error (never secrets)
  + generation FK + request_logs? no — request_logs/api_request_logs untouched this wave

+ scores (NEW, append-only, no soft-delete; XOR user_id/org_id like settings):
  id UUID PK, created_at/updated_at, user_id/org_id FK (CASCADE),
  name TEXT, data_type TEXT (numeric|categorical|boolean),
  value_num NUMERIC NULL, value_text TEXT NULL,
  trace_id TEXT NULL idx, prompt_log_id UUID NULL FK→prompt_logs.id ON DELETE SET NULL,
  session_key TEXT NULL, experiment_id TEXT NULL (no FK — future harness),
  source TEXT (human|api|judge|system), config_name TEXT NULL,
  comment TEXT NULL (2000), environment TEXT NULL,
  indexes: (org_id,created_at), (user_id,created_at), (name,created_at), (trace_id)

guardrail_triggers + request_id btree idx   (trigger→log join)
request_logs: 3 redundant single-col indexes dropped (covered by composites)
```

Joins: trace view = prompt_logs WHERE trace_id=X ORDER BY created_at (+ messages via generation_id + guardrail_triggers via request_id). Session view = same by session_key. Cost analytics = SUM over scoped prompt_logs (provider/model/key dimensions already indexed).
