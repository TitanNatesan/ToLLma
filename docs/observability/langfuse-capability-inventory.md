# Langfuse Capability Inventory (Agent 1 — Research)

- **Access date for all sources:** 2026-11-06
- **Canonical docs host:** `https://langfuse.com/docs` (verified; `docs.langfuse.com` does not resolve to docs — treat `langfuse.com/docs/*` as canonical)
- **Product repo:** `https://github.com/langfuse/langfuse` (open source, MIT; verified via websearch 2026-11-06)
- **Docs repo:** `https://github.com/langfuse/langfuse-docs`
- **Method:** read-only review of current Langfuse docs + API reference pages. No code written, no backend inspected.
- **Langfuse version context:** docs describe **Langfuse v4** as current (v4 data model, Observations API v2, Metrics API v2, Scores API v3). Self-hosted v3 still exists with legacy (v1) APIs. Where behavior differs by version it is noted.

## 1. Core data model

Three levels (source: `/docs/observability/data-model`):

| Concept | What it is | ID format |
|---|---|---|
| **Observation** | One step of the app: LLM call, tool call, retrieval, custom logic. Nestable. Langfuse calls spans "observations"; `span` is also one observation type | 16-char lowercase hex (8 bytes, W3C trace context) |
| **Trace** | One request/operation (e.g. one chatbot turn). Logical grouping of observations sharing a `trace_id` | 32-char lowercase hex (16 bytes, W3C). Deterministic IDs generatable from a seed (`create_trace_id(seed)`) |
| **Session** | Optional grouping of traces (e.g. one conversation = many traces) | Arbitrary US-ASCII string, < 200 chars; longer values dropped |

Key v4 fact: Langfuse stores **one observations table**; each row holds observation-level data **plus a copy of the trace-level attributes**. Trace-level attrs (`user_id`, `session_id`, `tags`, `metadata`, `environment`, `release`, `version`) are propagated by SDKs to every observation automatically (`propagate_attributes` / `propagateAttributes`). For raw OTel users this propagation must be done manually (baggage or per-span attributes) or filtering/aggregation breaks.

## 2. Trace-level attributes

(Source: OTel attribute-mapping table at `/integrations/native/opentelemetry`, trace-level section; SDK instrumentation page `/docs/observability/sdk/instrumentation`.)

| Field | Type | Purpose | Set by | Searchable | Read API | Mutable | Aggregatable |
|---|---|---|---|---|---|---|---|
| `name` (`traceName`) | string | Human label for the whole request | SDK root-observation name; OTel `langfuse.trace.name` or root span name | yes (exact `traceName`) | Observations v2 `trace_context` group; Metrics dims | no (immutable observations) | yes (dimension) |
| `userId` | string | End-user identity (any unique id) | SDK `propagate_attributes(user_id=…)`; auto by some integrations | yes | `basic` group; fixed `userId` param | no | yes (Users view, Metrics) |
| `sessionId` | string | Groups traces into a session | SDK `propagate_attributes(session_id=…)` | yes | `basic` group; fixed `sessionId` param | no | yes |
| `tags` | string[] (each ≤ 200 chars) | Categorize by feature/endpoint/workflow | SDK at creation; union of all observations' tags aggregated onto trace | yes (`tags:(a AND b)`) | `trace_context` group; `arrayOptions` filter | **no — immutable, cannot be added/edited in UI after creation** | yes (dashboards, Metrics) |
| `metadata` | object (top-level keys filterable; nested objects → dotted paths on v4.59+/SDK v5/v6) | Flexible key-value context | SDK propagated or per-observation | yes, by top-level key (`metadata.<key>`) | `metadata` field group | no | limited (filter/group; values stored as strings — numeric/boolean comparisons not supported) |
| `environment` | string, regex `^(?!langfuse)[a-z0-9-_]+$`, ≤ 40 chars | Separate production/staging/dev | `LANGFUSE_TRACING_ENVIRONMENT` env var (recommended) or client init; request-scoped via `propagate_attributes(environment=…)`; OTel `langfuse.environment` / `deployment.environment.name` | yes (global env filter + `environment:`) | `basic` group; repeatable fixed param | no | yes |
| `release` | string (typ. semver / git sha) | Whole-app version; A/B deploys | SDK init, `LANGFUSE_RELEASE` env, or auto-detected on Vercel/Heroku/Netlify | yes | `trace_context` group | no | yes |
| `version` | string | Per-component version for a named observation | SDK per-observation or propagated | yes (exact `version`) | `basic` group; fixed param | no | yes |
| `public` | boolean | Share trace via public URL | SDK/OTel `langfuse.trace.public` | UNVERIFIED | UNVERIFIED (not in v2 field groups) | via UI share action | no |
| `bookmarked` | boolean | Pin trace in UI | UI action | UNVERIFIED | `basic` group | yes (UI) | no |
| `input` / `output` (trace-level) | any | **DEPRECATED in v4** — retained for legacy trace-level evaluators only. Trace IO now mirrors the **root observation's** input/output | root observation `update(input/output)` | via observation IO full-text | `io` group on the root observation row | no | no (compared across experiment runs, not aggregated) |

## 3. Observation model (span / generation / event + extended types)

(Source: `/docs/observability/features/observation-types`. Requires Python SDK ≥ 3.3.1, TS SDK ≥ 4.0.0 for extended types.)

| Type | Purpose | Carries usage/cost |
|---|---|---|
| `event` | Discrete point-in-time occurrence (no duration semantics) | no |
| `span` | Generic unit of work with duration; default type when nothing else applies | no |
| `generation` | One AI-model call: prompt + response + model + usage + cost | **yes** |
| `embedding` | Call to generate embeddings | **yes** |
| `agent` | Agentic workflow step that decides flow / uses tools | no |
| `tool` | Single action: function/API call | no |
| `chain` | Link between steps (e.g. retriever → LLM) | no |
| `retriever` | Read-only lookup (vector DB, search) | no |
| `evaluator` | Relevance/correctness/helpfulness check step | no |
| `guardrail` | Safety / jailbreak / policy check | no |

Type selection: framework integrations set it automatically (`@tool` in LangChain → `tool`); manual via `as_type`/`asType`. Ingest fallback order: recognized `langfuse.observation.type` wins → GenAI conventions (`gen_ai.operation.name`) → model attribute present infers `generation` → else `span`. Unrecognized explicit type strings (e.g. `llm`) are **not rejected**, they fall through. Missing timestamps are filled (zero-duration or ingest time) — request succeeds.

## 4. Observation-level fields (identification, timing, IO, execution)

| Field | Type | Purpose | Set by | Searchable | Read API (v2 field group) | Mutable |
|---|---|---|---|---|---|---|
| `id` | string (16-hex, server-assigned; custom IDs not allowed) | Row identity | auto | yes (`id` filter) | `core` (always) | no |
| `traceId` | string | Parent trace | auto (context) / `trace_context` param | yes (fixed param) | `core` | no |
| `parentObservationId` | string \| null | Physical parent in tree | auto (nesting) | yes (fixed param; empty = roots) | `core` | no |
| `isRootObservation` | boolean | **Logical** app root (no physical parent OR explicitly marked app root) | SDK-marked or derived | yes (fixed param + boolean filter; also Metrics dimension) | `basic` | no |
| `type` | enum (10 values above) | Step kind | auto (integrations) or SDK | yes (fixed param) | `core` | no |
| `name` | string | Operation name — **treat as API**: evaluators, dashboards, saved views reference it; keep stable, low-cardinality, verb-first (`retrieve-context`, not `process-order-8945`) | SDK / integration | yes (exact + wildcard `name:*checkout*`) | `basic` | no |
| `startTime` / `endTime` | ISO 8601 datetime | Timing; latency derived | auto (context open/close); manual observations must call `.end()` or row is incomplete | yes (`startTime:>…`, `latency:>2`) | `core` | no |
| `completionStartTime` | ISO 8601 datetime | First-token timestamp (streaming) | **SDK only** (integrations or manual `update`) | via `ttft` alias | `time` group | no |
| `input` / `output` | any (stored as raw strings in v2; parse JSON client-side) | Step payload; generation IO should be OpenAI-style `[{role, content}]` for rich rendering + tool-call cards | SDK `update`; `@observe` captures fn args/returns (disablable via `capture_input/output=false`) | yes (full-text `input:`/`output:` scopes; word-based, case-insensitive; `=` or `matches` operators only) | `io` group | no |
| `level` | enum `DEBUG \| DEFAULT \| WARNING \| ERROR` (no numeric encoding; unset → `DEFAULT`) | Verbosity + error flagging | SDK param/`update`; integrations map provider errors; OTel: `langfuse.observation.level` (case-insensitive aliases, e.g. `WARN`→WARNING, `FATAL`→ERROR) else OTEL status ERROR→ERROR else DEFAULT | yes (fixed param, `level:ERROR`) | `basic` | no |
| `statusMessage` | string | Error/warning detail | SDK; OTel `langfuse.observation.status_message` else span status message | yes (`status` alias; `statusMessage` column) | `basic` | no |
| `modelParameters` | object (JSON) | Invocation settings (temperature, max_tokens, …) | SDK / OTel `langfuse.observation.model.parameters` / `gen_ai.request.*` / `llm.invocation_parameters.*` | UNVERIFIED as filter column (not in documented filter columns) | `model` group | no |
| `promptId` / `promptName` / `promptVersion` | string / string / int | Link to managed prompt (see §9) | SDK `prompt=` param or integration metadata | yes (`prompt` alias → prompt name) | `prompt` group | no |
| `latency` | seconds (float, derived) | Step duration | auto-derived | yes (`latency:>2`) | `metrics` group | n/a derived |
| `timeToFirstToken` (alias `ttft`) | seconds (float, derived) | Streaming responsiveness | derived when `completionStartTime` present | yes (`ttft:`) | `metrics` group | n/a derived |
| `tokensPerSecond` (alias `tps`) | float, derived | Generation throughput | derived | yes (`tps:`) | filterable column | n/a derived |
| `createdAt` / `updatedAt` | datetime | Ingest bookkeeping | auto | UNVERIFIED | `time` group | no |
| internal `modelId`, `inputPrice/outputPrice/totalPrice` | strings (decimal-precision) | Resolved pricing reference | auto (model match) | UNVERIFIED | present only when `model` group selected; absent otherwise | no |

**Derived-field formulas (INFERRED — not stated verbatim in docs, consistent with all examples):** `latency = endTime − startTime`; `timeToFirstToken = completionStartTime − startTime`. Flagged INFERRED, not UNVERIFIED-unknown.

**Timings/errors auto-vs-SDK:** start/end captured automatically by context managers/decorators; `level`/`statusMessage` auto-set by OpenAI + LangChain integrations on provider errors, manual otherwise. Unfinished manual observations (missing `.end()`) produce incomplete rows — must `flush()`/`shutdown()` (Python) or `forceFlush()` (JS) in short-lived processes or data is lost.

## 5. Generation params: token usage dimensions + cost details

(Source: `/docs/observability/features/token-and-cost-tracking`. Only `generation` and `embedding` observations carry usage/cost.)

- **Two parallel maps per observation:** `usage_details` (units consumed per usage type) and `cost_details` (USD per usage type). `total` in each = sum of buckets.
- **Bucket contract (critical): usage keys are mutually exclusive.** `input` excludes `input_*` detail keys; `output` excludes `output_*`. Provider-inclusive counts (e.g. OpenAI `prompt_tokens` including cached) **must be converted to exclusive buckets** before storage or cost double-counts. Integrations normalize automatically; raw OTel `gen_ai.usage.*` cache keys are auto-subtracted from `input`; flat verbatim `usage_details` are stored unchanged (caller must pre-normalize).
- **OpenAI-style schema accepted:** `prompt_tokens/completion_tokens/total_tokens` (+ `prompt_tokens_details.*` → `input_*`, `completion_tokens_details.*` → `output_*`) with inclusive→exclusive subtraction — but **only when the object contains exactly the OpenAI fields**; extra keys (e.g. a gateway-added `cost`) void recognition and it is stored flat.
- **Cost resolution:** ingested `cost_details` win; else inferred as `usage × model-definition price` matched by `model` against `match_pattern` regex. Custom definitions via UI (Project Settings > Models) or Models API (`GET/POST/DELETE /api/public/models`). Default prices ship per release (audited daily against provider docs via public GitHub workflow); apply to generations ingested after update only — stored cost never recalculated.
- **Pricing tiers:** per-model conditional tiers (priority-ordered; first match wins, else default). Conditions on usage-detail thresholds, top-level model-parameter keys, or top-level metadata keys.
- **No estimation:** text-based token estimation removed (changelog 2026-11-06). No usage + no cost ingested → no cost. Nothing is inferred from IO text.

| Item | Purpose | Auto-vs-SDK | Searchable | Read API | Mutable | Aggregatable |
|---|---|---|---|---|---|---|
| `usage_details` (+ derived `inputUsage/outputUsage/totalUsage`) | Token/unit counts per bucket | auto via integrations; manual via `update(usage_details=…)` | yes (`tokens:`, `inputTokens/outputTokens/totalTokens`) | `usage` group | no | yes (sum) |
| `cost_details` (+ derived `inputCost/outputCost/totalCost`) | USD per bucket | ingested or inferred | yes (`cost:`, `inputCost/outputCost/totalCost`) | `usage` group | no | yes (sum) |
| `usagePricingTierName` | Which tier priced the row | auto | UNVERIFIED | `usage` group | no | as dimension (UNVERIFIED) |
| model `model` | Price-table lookup key + display | auto (integrations) or SDK | yes (`model:` alias) | `model` group | no | yes (dimension `providedModelName`) |

## 6. Session & user tracking

| Capability | Fields/types | Purpose | Auto-vs-SDK | Searchable | Read API | Mutable | Aggregatable |
|---|---|---|---|---|---|---|---|
| **Sessions** (`/docs/observability/features/sessions`) | `sessionId` string; session view = replay of all traces' root IO in order | Multi-turn conversation / multi-agent-run grouping; bookmarkable, shareable via public link; session-level scores annotatable | SDK `propagate_attributes(session_id=…)`; Flowise maps chatId automatically | yes (`session:` alias; session table) | `basic` group; `sessionId` fixed param | no | per-session traces view; Metrics `sessionId` dim (top-N only) |
| **Users** (`/docs/observability/features/users`) | `userId` string (email/username/any id) | Per-user cost/volume/quality; Users list + per-user detail (traces, tokens, cost, scores) | SDK `propagate_attributes(user_id=…)` | yes (`user` alias) | `basic` group; fixed param; deep-link `/project/{id}/users/{userId}` | no | yes (Users view, Metrics top-N) |
| Session-view quality requirement | generations' inputs as role-labeled messages incl. history; tool calls matched to results by unique ID | Readable replay; judges/evals read these | app code must write history into each generation input | n/a | n/a | no | n/a |

## 7. Scores & evaluations

### 7a. Scores — CORE

(Source: `/docs/evaluation/scores/overview`, `/docs/evaluation/evaluation-methods/scores-via-sdk`. The universal quality-judgment object.)

| Score type | Value type | Use | Notes |
|---|---|---|---|
| `NUMERIC` | float | accuracy, relevance, similarity | min/max range optionally enforced by score config |
| `CATEGORICAL` | string from predefined categories | discrete labels | validated against config categories when `configId` given |
| `BOOLEAN` | `0`/`1` (read back as boolean via Scores v3) | pass/fail, thumbs up/down | `dataType: BOOLEAN` **required** (bare 0/1 infers NUMERIC) |
| `TEXT` | free string 1–500 chars | reviewer notes, open coding | **excluded** from experiments, LLM-as-judge, score analytics (not aggregatable) |

- **Attachment levels:** trace (`traceId` required), observation (`traceId` + `observationId`), session (`sessionId` only), dataset-run item (`experimentId`-scoped, via experiment runners). Score may be ingested before its trace exists (linked on arrival).
- **Fields:** `id` (optional idempotency key), `name`, `value`, `dataType` (inferred if omitted, except boolean), `comment` (reasoning/notes), `configId` (validate against Score Config), `timestamp`, `source` (API/UI/judge/code/queue), `environment`, `metadata` (details group), `authorUserId` + `queueId` (annotation group).
- **Five creation paths:** LLM-as-a-judge, code evaluators, UI manual scoring (requires score config), annotation queues, API/SDK (`create_score` / `score.create` / `POST /api/public/scores` batch array; browser `@langfuse/browser` for in-app user feedback with scores-only keys).
- **Update semantics (immutable model):** rewrite only when `id` + `name` + calendar-date(`timestamp`) all match; anything else creates a duplicate. No partial-merge updates. Multiple same-name scores allowed by default (tracks evolution / multiple raters).
- **Scores vs tags rule:** knowable at trace time → tag; judged later → score. Tags immutable; scores addable any time.
- **Searchable:** `scores.<name>` filters (`scores.accuracy:>0.8`, boolean/categorical supported; quote spaced names). **API:** Scores API v3 (`GET /api/public/v3/scores`, typed `value` by `dataType`, `subject` discriminated union `trace|observation|session|experiment`, multi-value OR filters, cursor pagination, lean core + opt-in `details/subject/annotation` groups). **Aggregation:** score analytics (trends, human-vs-AI agreement incl. Cohen's Kappa + confusion matrix), custom dashboards, Metrics API `scores-numeric/categorical/boolean` views (boolean avg = true rate).

### 7b. Evaluation methods — OPTIONAL (beyond core scores ingest)

| Method | What it is | Core or optional |
|---|---|---|
| **LLM-as-a-Judge** (worker-executed; prompt + `{{variables}}` mapped from observation input/output/metadata/tool-calls; numeric/categorical/boolean output; sampling rules; batch backfill; debug traces under `langfuse-llm-as-a-judge` env) | Automated online scoring | OPTIONAL — managed feature; ToLLma needs only the score objects it writes |
| **Trace-level evaluators** | Old trace-centric judges | **DEPRECATED** — Cloud cutover 2026-11-16, then stop producing results; self-hosted v4 `events_only` same. Observation-level is the replacement |
| **Code evaluators** (Python/TS run in Langfuse sandbox, separate worker queue) | Deterministic checks | OPTIONAL |
| **Decision-model evaluators** | Typed verdict models | OPTIONAL |
| **Annotation queues** | Human review workflows over trace batches | OPTIONAL |
| **Score configs** | Named schemas (type, categories, min/max) enforced via `configId`; required for UI manual scoring | OPTIONAL (needed only if ToLLma validates scores or offers UI annotation) |
| **Datasets** (`name` unique/project; items: `input`, `expectedOutput`, `metadata`, `sourceTraceId/sourceObservationId`, `status ACTIVE|ARCHIVED`, JSON-schema enforcement, versioning by timestamp, folders via `/` names, CSV import, batch-add from observations table) | Reusable test cases incl. production-trace capture | OPTIONAL — eval-harness concern, not live observability |
| **Experiments/DatasetRuns** (`DatasetRun` + `DatasetRunItem` → exactly one `Trace` (+optional `Observation`) per item — no repetitions, [#5855]; local-data runs without hosted dataset) | Offline prompt/model/code comparison | OPTIONAL — same reason; read via Experiments API (`GET /api/public/experiments`, `/api/public/experiment-items`) |
| **User feedback** (thumbs/star via browser SDK → boolean/numeric scores) | End-user quality signal | CORE-adjacent — score ingest path ToLLma should support |

## 8. Metadata vs tags (quick reference)

Both propagate to all observations via `propagate_attributes`; both filterable. Differences: tags = flat strings, immutable, set-at-creation, aggregated across trace; metadata = key-value (values string-compared; nesting → dotted paths on new SDKs), per-observation or propagated, unmapped OTel attrs land under `metadata.attributes` (not directly filterable — must use `langfuse.*.metadata.*` prefix). Size caps: tag ≤ 200 chars; propagated metadata value ≤ 200 chars JSON (longer dropped with warning); top-level null dropped.

## 9. Errors & diagnostics

- `level` + `statusMessage` on any observation (§4): `DEBUG/DEFAULT/WARNING/ERROR`, no numeric encoding; OTel status-ERROR ⇒ `ERROR`.
- Integrations auto-set on provider failures (OpenAI, LangChain); `@observe` captures wrapped-function exceptions as ERROR (timings + IO still recorded).
- Trace-tree UI: min-level filter, hidden-DEBUG notice. Filter bar: `level:ERROR`, `-level:DEBUG`.
- Judge/eval execution statuses (Completed/Error/Delayed/Pending) are evaluator-run states, not observation diagnostics — do not conflate.
- Reserved OTel key segments `__proto__/constructor/prototype` silently dropped (prototype-pollution guard) — missing-attribute diagnostic hint.

## 10. Prompt-management relation (CORE link, OPTIONAL authoring)

(Source: `/docs/prompt-management/overview`, `/docs/prompt-management/features/link-to-traces`.)

- Managed prompts: versioned, labeled (production/dev labels), cached client-side (no latency), compiled with variables (`prompt.compile(movie="Dune 2")`).
- **Trace link:** pass `prompt` object into generation (`prompt=` kwarg / `update({prompt})` / `propagate_attributes(prompt=)` for multi-generation contexts / `langfuse_prompt` metadata in LangChain/OpenAI/Vercel integrations). Fallback-prompt usage creates **no link**. Only `generation` observations link (explicit per-generation prompt wins over propagated).
- **Effect:** generation header shows `promptName – vN`; prompt detail has Linked-Generations tab + per-version metrics: median latency, median in/out tokens, median cost, generation count, median score, first/last timestamps.
- For ToLLma: prompt **authoring/versioning UI is OPTIONAL**; storing the used prompt's name+version on generations (the link fields) is CORE-compatible and required for version-segmented analysis.

## 11. Search / filter

(Source: `/docs/observability/features/filter-search-bar` — v4 only; Cloud requires v4 preview.)

- Single query bar ≡ sidebar filters ≡ URL-serialized (shareable, saved views compatible). Implicit AND; `-` negation; `OR`/`AND` within one field (`level:(ERROR OR WARNING)`, `tags:(billing AND urgent)`); `> >= < <=` on numeric/datetime (`latency:>2`, `cost:>=0.01`, `startTime:>2026-06-01`); `*` wildcards on text (`name:*checkout*`); `=` exact; `has:endTime` null checks; bare words = full-text over ids/names/IO; `input:`/`output:` scoping; backtick/quote keys with spaces.
- **Aliases:** `env, user, session, model, prompt, cost (total), tokens (total), tags (trace tags), status (statusMessage), ttft, tps, dataset, experiment`.
- Facet counts recompute against active filters. "Ask AI" natural-language→filter builder exists (beta, off by default, admin-enabled).
- **API parity:** Observations v2 fixed params (traceId, name, type, level, userId, sessionId, environment, version, parentObservationId, isRootObservation, time bounds) + `filter` JSON array (`string/stringOptions/arrayOptions/number/datetime/boolean/stringObject/null` typed conditions; full-text on IO needs `=`/`matches` and ≥1 such condition per request). `filter` overrides fixed params when both present.

## 12. Aggregation

| Surface | Purpose | Notes |
|---|---|---|
| Custom dashboards | Cost/latency/volume/quality charts segmented by model, tag, user, version, prompt | UI-built; segment by trace-level attrs |
| Metrics API v2 (`GET /api/public/v2/metrics`) | Programmatic aggregates for billing/rate-limiting/reporting | Views: `observations`, `scores-numeric`, `scores-categorical`, `scores-boolean`; dims incl. `providedModelName`, `isRootObservation`, `userId/sessionId/traceId` (high-cardinality: top-N only — explicit `row_limit` + desc `orderBy` on metric, no time dim); default row_limit 100, max 1000; order by `{aggregation}_{measure}` |
| Score analytics | Score trends, human-vs-AI agreement | numeric/categorical/boolean only |
| Users / Sessions views | Per-user tokens/cost/traces; session replay | built-in |
| Alerts | Threshold notifications on metrics | mentioned as feature; config surface UNVERIFIED in this pass |
| Prompt Metrics tab | Per-version medians (§10) | built-in |

## 13. Retrieval & export (read paths)

| Path | Returns | Notes |
|---|---|---|
| Observations API v2 `GET /api/public/v2/observations` | Observation rows (not full trace objects; group by `traceId` client-side); no get-by-id (filter `id =`) | `fields=` groups (`core` always + `basic/time/io/metadata/model/usage/prompt/metrics/trace_context`); `expandMetadata` untruncates keys (default cut 200 chars); cursor pagination, limit ≤ 1000; **bounded time range required**; IO returned as raw strings; `parseIoAsJson=true` rejected (400) |
| Scores API v3 `GET /api/public/v3/scores` | Typed scores + `subject` union | cursor pagination (default 50, max 100); `value`/`valueMin+valueMax` (numeric only); `traceId/sessionId/experimentId` mutually exclusive; `observationId` needs `traceId` |
| Experiments API | Runs, items, IO, scores | read-only; legacy `POST dataset-run-items` deprecated — runs created via SDK/OTel/UI only |
| Query SDKs (`langfuse.api.*`, typed; Python `api.observations`/`api.metrics`/`api.scores.get_many`) | Same endpoints | Python v5 / JS v6: legacy namespace removed; `api.scores` = v3 |
| Scheduled blob-storage export | Recurring full exports to warehouse | for bulk pipelines instead of API paging |
| UI export | Manual batch export | ad-hoc |
| CLI (`npx @langfuse/cli api …`), MCP server | Terminal / agent access to same API | ops ergonomics |

## 14. Ingestion paths (write paths — for gap-matrix context)

| Path | Status |
|---|---|
| OTLP/HTTP `POST /api/public/otel` (+ `/v1/traces`), Basic auth, `x-langfuse-ingestion-version: 4` header for real-time v4 | **CURRENT standard** |
| Python / JS-TS SDKs (OTel-native, async batching, non-blocking) | **CURRENT standard**; 100+ framework integrations (OpenAI, LangChain, Vercel AI, LiteLLM, CrewAI, …) auto-capture prompts/usage/errors |
| Legacy Ingestion API `POST /api/public/ingestion` | **DEPRECATED — Cloud sunset 2026-11-16; unavailable on self-hosted v4 in default `events_only` write mode** |
| Scores `POST /api/public/scores` (batch array) | CURRENT (score-create events remain supported past cutover) |
| Deprecated reads (traces/observations/sessions v1, scores v2, metrics v1/daily) | DEPRECATED → v2/v3 equivalents; migration guide at `/faq/all/deprecated-api-migration` |

## 15. Current vs deprecated — summary

| Capability | Status |
|---|---|
| Observations table / trace→observations→sessions model | CURRENT (v4) |
| 10 observation types | CURRENT |
| `usage_details`/`cost_details` bucket contract + pricing tiers | CURRENT |
| Token estimation from IO text | **RETIRED 2026-11-06** |
| Trace-level `input`/`output` as primary fields | **DEPRECATED** (root-observation IO is source) |
| Trace-level LLM-as-judge evaluators | **DEPRECATED** (stop 2026-11-16 Cloud) |
| Legacy ingestion endpoint | **DEPRECATED** (sunset 2026-11-16 Cloud) |
| Observations/Metrics v1, Scores v2 reads | **DEPRECATED** → v2/v3 |
| Datasets / experiments / annotation queues / score configs / LLM-as-judge / code evaluators | CURRENT but **OPTIONAL** for live-observability parity (eval-harness layer) |

## 16. Could not verify (UNVERIFIED — do not use for gap-matrix decisions without follow-up)

1. Exact latency/TTFT/TPS formulas (inferred as end−start / completionStart−start; undocumented verbatim).
2. `public` and `bookmarked` fields' API writability/filterability (only `bookmarked` appears in v2 `basic` group; no documented write path in this pass).
3. Alerts configuration surface (feature exists; no config schema reviewed).
4. `modelParameters` filterability (readable via `model` group; no documented filter column).
5. `usagePricingTierName` as Metrics dimension (readable; aggregation use unconfirmed).
6. Score `environment`/`metadata` write paths beyond API `details` group (assumed symmetric with observations; not explicitly reviewed).
7. UI export formats and blob-export schedule granularity (existence confirmed, schemas not reviewed).
8. Self-hosted v3 vs v4 exact field parity (v3 uses legacy APIs; field-level diffs not reviewed).
9. Datasets `remoteExperimentUrl` trigger mechanics (out of scope; noted for completeness).

## 17. Sources (all accessed 2026-11-06)

- Core model: `https://langfuse.com/docs/observability/data-model`
- Overview: `https://langfuse.com/docs/observability/overview`
- Best practices (naming, IO, attrs): `https://langfuse.com/docs/observability/best-practices`
- Observation types: `https://langfuse.com/docs/observability/features/observation-types`
- Token & cost tracking: `https://langfuse.com/docs/observability/features/token-and-cost-tracking`
- Sessions: `https://langfuse.com/docs/observability/features/sessions`
- Users: `https://langfuse.com/docs/observability/features/users`
- Metadata: `https://langfuse.com/docs/observability/features/metadata`
- Tags: `https://langfuse.com/docs/observability/features/tags`
- Environments: `https://langfuse.com/docs/observability/features/environments`
- Releases & versioning: `https://langfuse.com/docs/observability/features/releases-and-versioning`
- Log levels: `https://langfuse.com/docs/observability/features/log-levels`
- Filter search bar: `https://langfuse.com/docs/observability/features/filter-search-bar`
- Scores overview: `https://langfuse.com/docs/evaluation/scores/overview`
- Scores via API/SDK: `https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk`
- LLM-as-a-Judge (incl. trace-evaluator deprecation): `https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge`
- Datasets: `https://langfuse.com/docs/evaluation/experiments/datasets`
- Experiments data model: `https://langfuse.com/docs/evaluation/experiments/data-model`
- Evaluation overview: `https://langfuse.com/docs/evaluation/overview`
- Prompt management overview: `https://langfuse.com/docs/prompt-management/overview`
- Prompt↔trace linking: `https://langfuse.com/docs/prompt-management/features/link-to-traces`
- Public API (ingest deprecation, v2/v3 reads, field groups): `https://langfuse.com/docs/api-and-data-platform/features/public-api`
- Metrics API v2: `https://langfuse.com/docs/metrics/features/metrics-api`
- SDK instrumentation (nesting, attrs, IDs, flush): `https://langfuse.com/docs/observability/sdk/instrumentation`
- OTel endpoint + full attribute-mapping tables: `https://langfuse.com/integrations/native/opentelemetry`
- API reference (cited, not field-verified): `https://api.reference.langfuse.com`
- Repo verification: `https://github.com/langfuse/langfuse` (websearch); `https://github.com/langfuse/langfuse-docs`
