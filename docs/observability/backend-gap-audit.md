# ToLLma Backend Gap Audit — Prompt Logging / Observability (Agent 2, Phase 1 READ-ONLY)

- **Scope:** what ToLLma's backend ACTUALLY does today, end-to-end (capture → storage → API → permissions), mapped against the Langfuse capability areas in Agent 1's `langfuse-capability-inventory.md` (reference — not duplicated here).
- **Method:** code reading only. No backend/frontend/model/migration edits. No git writes. (`git status --short` pre-check: only untracked `docs/observability/` drafts.)
- **Gap scale:** P0 = correctness/data-loss or join-key breakage (must fix before parity claims) · P1 = missing capability with no workaround · P2 = partial/degraded path that works but loses fidelity · P3 = nice-to-have / eval-harness layer.
- **Default-off warning (global):** prompt logging is OPT-IN. `PromptLoggingSetting.enabled` defaults `False`, `capture_input/output` default `False` (`models/prompt_logging.py:63-66`), and `resolve_setting` returns no-capture when the setting is absent/disabled (`services/prompt_logging/resolution.py:262-264`). The ledger is empty unless a workspace explicitly enables it.

## 1. Trace — NO trace entity (P0)

**What exists:** no `traces` table, no `trace_id` column anywhere. The closest grouping keys are per-plane and incompatible:
- Internal chat: `conversations.id` groups messages; `PromptLog.conversation_id` links the ledger row (`models/prompt_logging.py:182-184`).
- Public gateway: one `request_id` (uuid4 hex) per request (`api/public_gateway/service.py:99-106`), stored on `ApiRequestLog.request_id` (`models/api_key.py:237`) and `PromptLog.request_id` (`models/prompt_logging.py:96`).
- Internal generation reuses the key-policy `request_id` as `spec.key_request_id` (`services/generation.py:92`), passed as `PromptLog.request_id` (`services/generation.py:554`) — but keyless in-app generations have `request_id=None`.

**Verdict:** there is no cross-plane trace join key. A public request writes `ApiRequestLog` + `PromptLog(generation_id=None)`; an internal generation writes `Message` + `RequestLog` + `PromptLog(generation_id=message.id)`. Correlating the three ledgers for one logical operation requires ad-hoc per-plane queries. **P0:** define one trace/request identity written by both planes (or document that the ledgers are intentionally unjoinable).

## 2. Span / parent-child hierarchy — NONE (P1)

**What exists:** no `parent_observation_id`, no observation tree. The only nesting in the system is conversation branching (`Conversation.parent_conversation_id`, `branch_from_message_id` — `models/conversation.py:37-45`), which is a UX fork, not an execution tree. Tool calls are accumulated into `ChatResult.tool_calls` (`services/gateway/adapters/base.py:248-267`) and forwarded, but never persisted as child rows — no tool/retriever/chain rows exist. `GenerationRun` (`models/message_history.py:35-75`) is a per-attempt linear history (`message_id` + `generation_number` unique), not a hierarchy.

**Verdict:** single-level rows only. Multi-step agent/tool runs are invisible beyond the flattened assistant text. **P1** (no workaround: hierarchy cannot be reconstructed from flat text + tool-call JSON arguably embedded in message content — unverified whether tool calls persist in `Message.content`).

## 3. Generation — NO dedicated generation row; the Message IS the generation (P1/P2)

**What exists:** `Message` docstring states it explicitly: "The generation IS the assistant message row: generation_id == message id" (`models/message.py:26-32`). Per-generation fields live on `Message`: `prompt_tokens/completion_tokens/total_tokens`, `cache_read/write/reasoning_tokens`, six cost columns, `latency_ms`, `ttfb_ms`, `thinking_ms`, `usage_estimated`, `error/error_code`, `status` lifecycle (`QUEUED→RUNNING→COMPLETED/CANCELLED/FAILED`, `models/message.py:93-119,121-133`). `PromptLog` mirrors a subset per capture (see §8). `RequestLog`/`ApiRequestLog` mirror usage+cost per plane.

**Missing vs Langfuse generation:** no `modelParameters` column (request settings not stored — temperature/max_tokens/reasoning level vanish after the call); no `promptId/promptName/promptVersion` link fields (no managed prompts at all); no `completionStartTime` on ledger rows (`ttfb_ms` exists only on `Message`, not on `RequestLog`/`PromptLog`); no `finish_reason` persistence (in-memory `ChatOutcome.finish_reason`, `api/public_gateway/service.py:131`, dropped after response serialization).

**Verdict:** usage/cost/timing per generation: PRESENT (P2 gaps: params, prompt link, finish reason not persisted). Cross-reference §8 for the PromptLog subset problem.

## 4. Event — fixed-schema server-side only, no generic ingest (P1)

**What exists:** three append-only, fixed-schema event-ish tables plus fire-and-forget telemetry:
- `GuardrailTrigger` — immutable audit row per policy evaluation (`models/guardrail.py:218-276`): `policy_id/version`, `stage`, `category/severity/confidence`, `action`, `reason`, `input/output_excerpt`, `latency_ms`, `request_id/generation_id`, `failure_kind`. Closest analog to a Langfuse guardrail/evaluator observation, but schema is guardrail-specific.
- `ExportEvent` — export audit (`models/request_log.py:87-100`).
- `PurgeAuditLog` — one row per hard-purged account (`models/purge_audit.py:18-30`).
- `services/observability/events.py:67-106` — `emit()` (JSON to `tollms.events` logger, secret-field backstop list) + `incr_counter()` (Valkey counters, 90-day TTL, fail-open). Used for `gateway.promptlog[.enqueued|.duplicate|.dropped]`, `gateway.request`, `gateway.denied`, `gateway.provider_error`, `account.purged`.

**Missing:** no user-defined event ingest (no `POST` event API, no `level` taxonomy on events, no event→trace linkage beyond `request_id`). Application code cannot log a custom observation.

**Verdict:** operational telemetry exists; product-level event capture does not. **P1** if agent/tool-step visibility is in scope (overlaps §2); P2 if only ops dashboards matter.

## 5. Scores & evaluations — NONE (P0 for quality, P3 for harness)

**What exists:** nothing. `grep -ri "class Score|score_|ScoreConfig|dataset_|experiment" backend/src/tollms` → zero matches. `GuardrailTrigger.confidence` (Float, `models/guardrail.py:261`) is a policy-engine score, not a queryable quality judgment (no name/value/datatype/config, no API). No scores table, no scores API, no annotation queue, no datasets/experiments, no LLM-as-judge.

**Verdict:** quality is unobservable. Tokens/cost/latency without scores = cost tracking with no value axis. **P0** for any quality/cost-per-quality story; P3 for the eval-harness half (datasets, experiments, judges — correctly out of scope for live observability).

## 6. Session — two partial mechanisms, neither is a Langfuse session (P1)

**What exists:**
- `Conversation` groups internal turns (multi-turn replay unit) with branching (`models/conversation.py`), exposed via conversation APIs. Public gateway requests never create conversations (`api/public_gateway/service.py:1-8` docstring).
- `Message.session_id` stores the auth JWT `sid` (`models/message.py:109`, spec `session_id` in `services/generation.py:78`) for per-login-session usage/activity UI — an auth session, not a conversation session.

**Missing:** no user-settable `sessionId` grouping traces across planes; no session replay view spanning gateway + chat; no session-level scores/annotations.

**Verdict:** internal chat has conversation grouping; gateway traffic is session-less. **P1** for unified session analytics; workable today only within one plane.

## 7. Metadata / tags — NONE on observability rows (P1)

**What exists:** fixed columns only. `PromptLog` carries `endpoint/source/status/error_code/match_source/key_provenance` (`models/prompt_logging.py:166-209`) — useful, but closed schema, no key-value extension, no tag array. `Message.metadata_` JSONB exists but is documented for "generation details for media messages" (`models/message.py:103`), not a general attribute bag. Search on prompt logs is `request_id` LIKE + `endpoint` LIKE only (`api/prompt_logging/records.py:227-229`; groups search same in `api/search/groups.py:116-120`).

**Missing vs Langfuse:** no `tags` (immutable, aggregatable), no `metadata` object with top-level-key filtering, no `environment/release/version` dimensions, no attribute propagation.

**Verdict:** filtering = fixed enums + two LIKE fields. Any new dimension needs a migration. **P1** (blocks environment/version segmentation entirely).

## 8. Usage (token accounting) — provider-reported with `len//4` fallback, flagged (P0 on PromptLog subset)

**Capture (verified per adapter):** terminal-chunk usage flows into `StreamChunk` (`base.py:40-54`) and is accumulated by `BaseProviderAdapter.chat()` (`base.py:223-235`):
- OpenAI chat: `prompt_tokens/completion_tokens/total_tokens` + `usage_extras` (`adapters/openai.py:373-382`); Responses shape: `input_tokens/output_tokens` (`openai.py:520-522`); image usage stashed on `last_media_usage` (`openai.py:570`).
- Anthropic: `input_tokens` from message-start event, `output_tokens` from delta event (`adapters/anthropic.py:201-206,258-262`).
- Gemini: `promptTokenCount` (`adapters/gemini.py:224-226,374-376`); Bedrock: `inputTokens` (`adapters/bedrock.py:501-503`).
- Normalization: `usage_extras()` maps OpenAI/Anthropic/Gemini cache+reasoning shapes (`base.py:328-352`); `costing.calculate()` subtracts cache lines from inclusive provider totals (`services/gateway/costing.py:59-68`).

**Fallback:** both planes estimate `max(1, len(text)//4)` when the provider is silent — public (`api/public_gateway/service.py:265-267,304-326`), internal (`services/generation.py:155-156,466-470`) — and set `usage_estimated=True` on `Message` (`generation.py:502`), `RequestLog` (`request_log.py:69`; `generation.py:663`), `ApiRequestLog` (`api_key.py:275`; `api_logs.py:240`).

**PromptLog gap (P0):** `PromptLog` stores ONLY `prompt_tokens/completion_tokens` (`models/prompt_logging.py:203-204`) — no `total/cache_read/cache_write/reasoning` columns and NO `usage_estimated` flag. An estimated row is indistinguishable from a provider-reported row in the ledger, and cache/reasoning breakdowns are lost. `capture.build_row_kwargs` only forwards `prompt/completion` (`services/prompt_logging/capture.py:105-106`).

**Verdict:** usage pipeline is sound and honestly flagged on 3 of 4 tables. **P0:** PromptLog token subset + missing estimated flag.

## 9. Cost — repo + model prices, no tiers, no version pin, NOT on PromptLog (P0/P2)

**Pricing chain (verified):** `prices_for_model(model, repo_entry)` — repository (models.dev) wins per-field, registered-model prices fill gaps, zeros when unpriced, never raises (`services/gateway/costing.py:76-103`). Repository = models.dev sole catalog source (`sources.py:21-23`, `MODELS_DEV_URL`; backend rule: models.dev is the ONLY catalog source). Media: hardcoded OpenAI rate card in `services/cost_estimator.py:40-89` (`official_media_prices`, `media_rate_card`), `actual_image_cost` preferred when provider reports image usage (`api/public_gateway/service.py:1082-1092`; same pattern internal via `generation.py:160-170`).

**Missing vs Langfuse:** no conditional pricing tiers; no per-row price-version stamp (`AIModel.repository_model_key` + `metadata_["repository_snapshot"]` exist — `models/registered_model.py:136-140` — but ledger rows store only computed Decimals, so a later price change silently re-prices history comparisons); unpriced models bill $0 with no `unpriced` signal (zeros are silent).

**PromptLog gap (P0):** `PromptLog` has NO cost columns at all. Cost observability lives in `Message`/`RequestLog`/`ApiRequestLog`; the prompt ledger (the workspace-facing observability surface) cannot answer "what did this cost."

**Verdict:** **P0:** no cost on PromptLog. **P2:** no price-version pin per row, no tier support, silent $0 unpriced.

## 10. Errors & diagnostics — codes everywhere, no levels/messages (P2)

**What exists:** `classify_provider_failure()` taxonomy threaded through both planes (public `_execute_chat/_execute_media` catch → `_provider_error_event` + `error_code` on log rows, `api/public_gateway/service.py:925-951,1037-1063`; internal driver equivalent). `status` enums per table (`RequestStatus`, `MessageStatus`, PromptLog `STATUSES = completed/cancelled/failed/partial`, `models/prompt_logging.py:22`). `latency_ms` on all rows; `ttfb_ms` + `thinking_ms` on `Message` only (`models/message.py:111-119`); `GuardrailTrigger.failure_kind` (`models/guardrail.py:269`).

**Missing:** no severity levels (no DEBUG/DEFAULT/WARNING/ERROR); `error_code` only, no `statusMessage` text (only code persisted — driver `error` text lives on `Message.error`/`GenerationRun.error`, not on ledger rows); cancelled-stream partial output handling differs by plane (public stream maps disconnect to failed/cancelled in `_stream_chat` paths; internal maps cancelled-with-text → `partial`, `services/generation.py:680-691`).

**Verdict:** adequate for error-rate dashboards; insufficient for debugging (no message, no level filter). **P2.**

## 11. Retention / purge — per-row expiry for bodies only, metadata immortal (P2, one P1 audit note)

**What exists:** `PromptLoggingSetting.retention_days` (default 90, NULL = keep forever — `api/prompt_logging/settings.py:207-237`); per-row `expires_at` set at capture (`services/prompt_logging/capture.py:111-112`); daily `promptlog-cleanup` job NULLs ciphers, keeps metadata (`services/jobs/scheduler.py:381-396`; `services/prompt_logging/retention.py:23-46`); user-invoked `purge_logs` same NULL-cipher semantics + org audit row (`api/prompt_logging/records.py:332-364`); single-row `delete_log` hard-deletes (`records.py:307-329`); zero-retention policy short-circuits capture at both applicable scopes (`services/prompt_logging/resolution.py:53-89,257`); `RetentionPolicy` categories cover `prompt_logs/request_logs/api_request_logs` (`models/privacy.py:82-90`); account purge hard-deletes all observability rows (`services/jobs/scheduler.py:216-250`).

**Gaps:** metadata rows are NEVER deleted by retention (by design — "metadata rows are never deleted", `retention.py:1-10`); the daily job writes no per-org audit ledger rows (accepted gap M3, documented in-file `retention.py:8-10`) — **P1** only if compliance needs per-org proof of job runs; `expires_at` is set from the CURRENT setting at capture time, so a later retention change does not re-stamp existing rows (only the daily sweep + explicit purge apply); queue drops (below) bypass the ledger silently.

**Verdict:** body lifecycle is solid; metadata-forever + no job audit is a documented choice. **P2** (P1 for regulated deployments needing retention proof).

## 12. Export — conversation files only, no ledger export (P1)

**What exists:** conversation export md/json/pdf capped at 200 conversations (`api/exports/service.py:21,63-117`) with `ExportEvent` audit rows; analytics read APIs aggregate server-side (`services/analytics/*` on `api_request_logs` + `request_logs`); `Audit.Export` / `Analytics.Export` permissions exist (`api/orgs/common/guards.py:90-99`).

**Missing:** no export path for `prompt_logs`, `request_logs`, or `api_request_logs` rows (no CSV/JSONL dump, no blob-scheduled export); no Langfuse-equivalent "full export to warehouse." `ExportEvent.dataset` values observed: `conversations_all/conversations_selected` only.

**Verdict:** humans can export conversations; machines cannot bulk-read the ledgers except paged APIs. **P1** for any warehouse/pipeline story.

## 13. Search / filter — fixed filters + LIKE, no IO search by design (P1/P2)

**What exists:** prompt-log listing filters AND-composed: workspace scope, `user_id` (ACTIVE-membership-gated), `key_id`, `provider_id`, `model_id`, `status` enum, `from/to` time, `q` = `request_id` LIKE (escaped, ≤128 chars), cursor pagination `(created_at, id)` + `X-Next-Cursor` header (`api/prompt_logging/router.py:48-72`; `records.py:187-255`). Cross-type `?types=` search includes `prompt_logs` by `request_id/endpoint` LIKE, perm-gated (`api/search/groups.py:110-121`); personal workspace excludes prompt_logs entirely (`groups.py:135-153`). Request-log listing: conversation/status/error_code/regenerations + offset paging (`api/request_logs/router.py:18-38`).

**Missing:** no full-text over IO (impossible without decrypt-scan — bodies are Fernet ciphertext, `core/crypto.py:17-18` — correctly unsearchable); no numeric filters (tokens/cost/latency ranges); no tag/metadata filters (no such columns); no saved views / URL-serialized filter bar.

**Verdict:** metadata search is functional but shallow. **P1** for analytics-grade filtering (range filters need columns+indexes); P2 for saved views (frontend concern).

## 14. Authorization — workspace-pinned, least-privilege, 404-oracle (strength; one asymmetry note)

**What exists:** personal rows owner-only; org rows require ACTIVE membership + per-endpoint `PromptLogs.*` codes (`api/prompt_logging/settings.py:1-6`; `records.py:34-53`). Four codes: `Read` (metadata), `ViewContent` (bodies; personal always true, org needs grant or root — `records.py:258-266`), `Manage` (settings), `Delete` (delete+purge; exempt from the read-prerequisite ladder so custodial erase works without read visibility — `api/orgs/common/guards.py:127-134`). Cross-workspace access returns 404, never 403 (`settings.py:139-167`; `records.py:45-86`). Key/provenance resolution is server-side from the `ApiKey` row; hints never override the key row (`services/prompt_logging/resolution.py:175-198`).

**Note (not a gap, verify in security audit):** `DELETE /logs/{id}` and `POST /logs/purge` share the `Delete` code — no separate "erase content" vs "delete row" permission; purge NULLs ciphers (recoverable only by deletion absence) while single-delete hard-deletes the row. Confirm the intended distinction survives.

## 15. Capture pipeline integrity — fail-open everywhere, bounded queue (P2)

**Path (both planes → one queue):** `enqueue_post` resolves policy + truncates (512K chars, `models/prompt_logging.py:28`) + encrypts synchronously, worker persists (`services/prompt_logging/queue.py:218-265`); idempotency via partial unique `(request_id, generation_id)` (`models/prompt_logging.py:154-160`); worker down → inline sync fallback (`queue.py:232-234`); queue full (1000) → drop + counter + warning (`queue.py:36,236-250`); 1 retry then drop + `_last_error` (exception class only) surfaced in `GET /retention` (`queue.py:71-127`; `records.py:367-389`); started on app lifespan, skipped under pytest (`main.py:62-64`, `queue.py:145-147`).

**Gaps (P2):** drops are counted, not recoverable — sustained >1000-deep bursts lose ledger rows silently from the user's perspective (counter exists but no alerting surface); `generation_id=None` on all public-plane rows weakens the idempotency key to `request_id`-only per row (unique since request_ids are uuid4 — safe, but redelivered same-request rows with NULL generation_id are exempt from dedup only when request_id IS NULL, legacy rows).

## Summary gap table

| # | Area | ToLLma today | Gap |
|---|---|---|---|
| 1 | Trace | No trace entity; per-plane keys (`conversation_id` vs `request_id`) | **P0** — no cross-plane join key |
| 2 | Span | No hierarchy; tool calls in-memory only | **P1** |
| 3 | Generation | Message IS the generation; no params/prompt-link/finish_reason persisted | **P2** (params/link P1 for version-segmented analysis) |
| 4 | Event | Fixed-schema triggers + ops telemetry; no custom ingest | **P1** |
| 5 | Scores | None at all | **P0** (quality axis); P3 harness |
| 6 | Session | Conversation (internal) + auth sid; no cross-plane session | **P1** |
| 7 | Metadata/tags | None; closed schema + 2 LIKE fields | **P1** |
| 8 | Usage | Provider-reported + flagged estimates; PromptLog subset, no estimated flag | **P0** (PromptLog only) |
| 9 | Cost | Repo+model pricing, media card; no tiers/pin; absent on PromptLog | **P0** (absent on PromptLog); P2 rest |
| 10 | Errors | Codes + statuses; no levels/messages | **P2** |
| 11 | Retention | Body expiry + purge + zero-retention; metadata immortal; no job audit | **P2** (P1 job-audit for regulated) |
| 12 | Export | Conversation files; no ledger bulk export | **P1** |
| 13 | Search | Fixed filters + LIKE; no ranges; bodies unsearchable by design | **P1** ranges; P2 views |
| 14 | AuthZ | Pinned, least-privilege, 404-oracle | Strength; confirm Delete-code scope split |
| 15 | Pipeline | Fail-open queue, dedup, fallback; drops counted-not-alerted | **P2** |

## Handoff notes for Orchestrator / Agents 3–5

- Agent 3 (workspace config): settings model + resolution semantics fully described in `services/prompt_logging/resolution.py:1-30` and `api/prompt_logging/settings.py` — normative in-code contract, reuse verbatim.
- Agent 5 (data architecture): join-key decision (§1), PromptLog column additions (§8–§9: `total/cache/reasoning` tokens, `usage_estimated`, cost columns), and whether spans/scores/tags are new tables vs columns. Every model change needs an Alembic migration (`alembic check` must stay green — backend rule).
- Do NOT duplicate Agent 1's Langfuse inventory; this doc covers ToLLma-side evidence only.
