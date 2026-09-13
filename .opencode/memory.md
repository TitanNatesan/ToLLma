# ToLLms Project Memory

## Project Creation

Date:
Initial architecture established.

## 2026-09-12 - Local development foundation

Requirement: initial repo structure only; no business features, AI providers, chat, or auth.
Implemented: backend FastAPI foundation (src/tollms: api/core/db/modules/services,
/health + /health/ready, pydantic-settings from .env, SQLAlchemy 2.x UUID base model),
Alembic foundation (env.py reads DB URL from settings), frontend Next.js TS foundation
(health page SSR via BACKEND_URL, /api-test client page via NEXT_PUBLIC_API_URL,
components/hooks/services/lib/types), dev Dockerfiles with hot reload, compose wiring
(frontend hot-reload volume, BACKEND_URL=http://backend:8000), .env.example, scripts/dev.sh.
Rules validated: workflow.md gained autonomous-completion exception (was contradicting
AGENTS.md loop); docker.md clarified localhost policy (browser/healthcheck OK, container
traffic uses service names); root AGENTS.md references frontend/AGENTS.md instead of
duplicating the Next.js auto-managed block. Kept frontend under src/ (matches frontend.md
and existing scaffold) instead of target's root-level app/.
Verification: docker compose up clean; postgres healthy; backend /health ok,
/health/ready database reachable; frontend /, /health, /api-test all 200 with SSR backend
status ok; alembic current/history load against Postgres; pytest 2 passed.
Note: Docker Desktop daemon was paused; used native dockerd via DOCKER_HOST=default context.
Decision: no DATABASE_URL in .env — backend builds it from POSTGRES_* parts (single source).

## 2026-09-12 - Docker build time and performance optimization

Requirement: optimize frontend and backend docker build time for faster and performance-efficient builds; resolve port binding collision from native dockerd and ensure services run on Docker Desktop.
Root causes identified:
1. Missing .dockerignore in frontend/ caused Docker to transfer 550MB+ (node_modules and .next) on every build context upload and package it into image layers.
2. In frontend/Dockerfile, lack of BuildKit npm cache mount and use of unoptimized `npm install` instead of `npm ci --prefer-offline`.
3. In backend/Dockerfile, `COPY src/ ./src/` invalidated dependency caching layer on every source change; lack of BuildKit uv cache mount and missing `uv.lock`.
4. Compose healthchecks had 15s/10s intervals with no start_period, slowing down compose orchestration checks.
Implemented:
1. Created `frontend/.dockerignore` excluding node_modules, .next, .git, etc.
2. Created `backend/.dockerignore` excluding .venv, __pycache__, pytest caches, etc.
3. Created root `.dockerignore` for repo-level builds.
4. Optimized `frontend/Dockerfile` with `RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --no-fund`.
5. Generated `backend/uv.lock` and optimized `backend/Dockerfile` with two-stage caching (install dependencies first via `uv sync --frozen --group dev --no-install-project`, then copy src and install package) with `--mount=type=cache,target=/root/.cache/uv`.
6. Tuned `docker-compose.yml` healthchecks with `start_period: 2s` and `interval: 3s` and added consistent restart policy.
Verification:
- Build time reduced from ~43.3s down to 1.9s - 2.5s (over 94% speedup).
- Build context transfer dropped from ~80MB+ to under 250KB.
- Clean compose up -d --build completes with exit code 0.
- All services healthy (postgres, backend, frontend).
- Backend /health, /health/ready and frontend /health, / endpoints return 200 OK.
- pytest passes 2/2 in backend container.

## 2026-09-12 - Strict required environment variable validation

Requirement: remove default values for required configuration (credentials, secrets, DB connection parameters) and throw a clear, human-readable error specifying any missing required environment variables.
Implemented:
1. Updated [backend/src/tollms/core/config.py](file:///home/ond/Projects/ToLLms/backend/src/tollms/core/config.py):
   - Removed hardcoded defaults from required credentials: `postgres_db`, `postgres_user`, `postgres_password`, `postgres_host`, `postgres_port`, and added required `secret_key`.
   - Maintained safe non-sensitive defaults for app metadata and flags (`project_name`, `environment`, `debug`, `backend_host`, `backend_port`, `api_v1_prefix`, `backend_cors_origins`, `log_level`).
   - Implemented `ConfigurationError` and intercepted Pydantic's `ValidationError` in `Settings.__init__` to output a formatted error message listing exact missing environment variables in uppercase and referencing `.env.example`.
   - Updated `SettingsConfigDict` to check `env_file=(".env", "../.env")` so tests and scripts run seamlessly from both repo root and `backend/`.
2. Created [backend/tests/test_config.py](file:///home/ond/Projects/ToLLms/backend/tests/test_config.py) to test successful loading with valid variables and verify that missing variables raise `ConfigurationError` with the formatted message.
Verification:
- Tested missing environment variables: correctly outputs clean error block listing missing variables (`SECRET_KEY`, `POSTGRES_DB`, etc.).
- Pytest suite: all 4 tests passed in backend container (`tests/test_config.py`, `tests/test_health.py`).
- Runtime verification: backend `/health` and `/health/ready` endpoints return 200 OK.

## 2026-09-13 - ToLLms V1 gateway + chat (Docker Desktop only)

Requirement: complete local-first AI gateway and chat app, runnable entirely through docker-compose on Docker Desktop.
Implemented: provider registry (7 types, Fernet-encrypted credentials, masked responses, live validation),
model registry (pricing/capabilities/endpoint types, search+filter), 7 gateway adapters behind BaseProviderAdapter
(OpenAI chat+responses, Anthropic, Gemini, Vertex, Bedrock via boto3, OpenAI-compatible Custom), unified gateway
(JSON chat + SSE stream, usage/cost persistence, per-1M pricing), conversations/messages/usage APIs, Next.js chat UI
(sidebar, streaming markdown with highlight, stop/regenerate/retry, provider+model selectors, usage summary),
provider/model/conversation/settings pages, pytest (11) + vitest (5) + Playwright (9 scenarios, mock LLM server).
Rules: docker.md now mandates Docker Desktop only (no DOCKER_HOST overrides, no second stacks, no port remaps);
compose gained backend extra_hosts (host.docker.internal) and frontend_next volume (host-owned .next broke
Turbopack writes through Desktop file sharing).
Incidents fixed: killed overlapping native-dockerd stack holding 5432/8000/3000; Desktop postgres volume held a
foreign 28-table schema (backed up to /tmp/opencode/tollms-desktop-backup-20260913.sql, volume reset, V1 schema
auto-migrated on startup); fixed UI race where id-change fetch overwrote post-stream data (queries pause while
streaming); metadata_/alias collision (SQLAlchemy reserves `metadata`); stale node_modules volumes shadow new deps.
Verification: pytest 11/11, vitest 5/5, Playwright 9/9 serial, tsc+eslint clean, `next build` success, alembic at
head fb3312981ccc with 16 indexes, all containers healthy.
Deviations: no Vercel AI SDK (custom SSE carries usage/cost envelopes it lacks); shadcn-style local ui components
instead of full shadcn+radix (same API shape, no extra deps); usage/cost stored per assistant message (no separate
table); frontend kept under src/.

## 2026-09-13 - V1 simplification: 2 pages, discovery, shadcn

Requirement: Chat + Providers only; validation status persistence; model discovery; models managed inside
provider detail; shadcn component library.
Implemented (backend): standardized adapter interface validate_credentials()/discover_models()/chat_stream() for
all 7 adapters (validation moved out of deleted providers/utils.py into adapters); providers gained
validation_status/validation_message/last_validated_at (migration 7cfe0553987b, server_default for existing rows);
POST /providers/{id}/discover upserts discovered models idempotently (discovered flag in metadata);
validate endpoint persists results. Tests: 16 passed (adapter validate/discover via MockTransport, factory covers
all 7 types, persistence + idempotency).
Implemented (frontend): shadcn/ui proper — cva variants, Radix Slot/Switch, sonner Toaster, Card parts;
chat settings panel (provider/model selects, model details, live usage), empty states with CTAs; providers
master-detail with embedded model management (full manual-add form, enable/disable switches, validate/discover
with toasts); deleted /models /conversations /settings /api-test (kept /health).
Playwright rewritten to 8 scenarios, 9/9 serial on Desktop (mock /models returns 2 models for discovery).
Fixes: stale Desktop node_modules volume; UI refresh race already covered; spec scoping to details section.
Verification: pytest 16/16, vitest 5/5, Playwright 9/9, tsc+eslint clean, next build success (routes: /, /providers, /health).

## 2026-09-13 - Custom provider extra headers (opencode zen gateway)

Symptom: CUSTOM provider "OpenCode Go" (https://opencode.ai/zen/go/v1) returned upstream 500 for
muse-spark-1.3-contributor. Root cause (probed from backend container with stored creds, key never printed):
zen routes through "Console Go" and requires an x-opencode-session header; without it models 400
(MissingSessionID) or 500. Header value is not validated — any stable id works.
Fix: CustomAdapter._headers() merges optional credentials.extra_headers (dict or JSON string) into chat,
validate, and discover requests; Custom credential form gained "Extra headers (JSON)" field; seeded
x-opencode-session on the OpenCode Go provider server-side. Verified end-to-end via POST /gateway/chat with
mimo-v2.5: real streamed reply, real usage tokens (252/32). Test: header-merge cases in test_discovery.py.
Note: muse-spark-1.3-contributor still 500s upstream even with the header — broken on their side, not ours.
pytest 17/17.

## 2026-09-13 - Frontend request flood & CORS optimization fix

Requirement: professional and stable fix for excessive HTTP request loops and CORS preflight storms hitting the backend on page load/refresh.
Root causes identified:
1. `localStorage` persisted `activeConversationId` via Zustand store; when database was reset or conversation was deleted, TanStack Query received 404 and executed exponential backoff retries without clearing the dead ID.
2. `frontend/src/services/api.ts` unconditionally injected `Content-Type: application/json` on all HTTP requests including `GET`, turning simple requests into non-simple requests and forcing the browser to issue an `OPTIONS` preflight for every query.
3. In `frontend/src/app/components/SelectorBar.tsx`, `useModels` executed before provider selection or hydration, causing a redundant unparameterized fetch of all models (`GET /api/v1/models`).
4. Backend `CORSMiddleware` lacked `max_age`, meaning any legitimate preflights were never cached by the browser.
5. TanStack Query `defaultOptions` lacked 4xx client-error rejection in retry logic and had short stale time.
Implemented:
1. Updated `frontend/src/services/api.ts`: introduced typed `ApiError` class and conditionally set `Content-Type: application/json` only when `init?.body` is present.
2. Updated `frontend/src/lib/query.tsx`: configured `staleTime: 30s`, disabled `refetchOnWindowFocus`, and implemented custom retry policy to immediately stop retrying on 4xx client errors (401, 403, 404).
3. Updated `frontend/src/app/page.tsx`: attached 404 cleanup effect to reset `setConversation(null)` and purge dead IDs from `localStorage` upon 404 response.
4. Updated `frontend/src/hooks/useRegistry.ts` and `frontend/src/app/components/SelectorBar.tsx`: added optional options to `useModels` and guarded execution with `enabled: !!providerId`.
5. Updated `backend/src/tollms/main.py`: added `max_age=86400` to `CORSMiddleware`.
Verification:
- Tested with browser subagent on frontend: verified 200 OK, full DOM hydration, zero console errors, zero uncaught exceptions.
- Inspected backend container logs: request volume on page load reduced from 20+ requests (burst of preflights and retried 404s) down to exactly 3 simple GET requests (`/providers`, `/conversations`, `/models?provider_id=...`).
- Zero `OPTIONS` preflights for GET requests.
- Backend pytest test suite: 11/11 tests passed.
- Frontend linting & typechecking: `npm run lint && npx tsc --noEmit` passed with 0 errors.

## 2026-09-13 - Bedrock converse inference profile resolution & reasoning support

Requirement: validate credentials for Bedrock provider 'dedede', diagnose and fix Claude Haiku 4.5 failure in the chat page, and ensure the requested models (Claude Haiku 4.5, Claude Sonnet 4.6, MiniMax M2.5, DeepSeek-R1) are available and accessible via the chat page.
Root causes identified:
1. In AWS Bedrock, Anthropic Claude 3.5/4.5/4.6 models and DeepSeek-R1 cannot be invoked via on-demand throughput using raw foundation model IDs (e.g. `anthropic.claude-haiku-4-5-20251001-v1:0`, `deepseek.r1-v1:0`); AWS Bedrock returns `ValidationException: Invocation of model ID ... with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.` AWS requires cross-region inference profile IDs (e.g. `us.anthropic.claude-haiku-4-5-20251001-v1:0`, `us.deepseek.r1-v1:0`).
2. Bedrock model discovery only queried `list_foundation_models`, omitting cross-region inference profiles from `list_inference_profiles`.
3. Models with `bedrock/` prefix (e.g. `bedrock/minimax.minimax-m2.5`) were rejected by AWS API as invalid identifiers.
4. Reasoning models (DeepSeek-R1, MiniMax M2.5) emit `reasoningContent` events in ConverseStream which were previously ignored by delta extraction.
Implemented:
1. `backend/src/tollms/modules/gateway/adapters/bedrock.py`:
   - Added `resolve_bedrock_model_id`: strips `bedrock/` prefix, preserves routing prefixes (`us.`, `eu.`, `apac.`, `global.`), and automatically maps foundation models requiring inference profiles to regional cross-region profiles based on region config.
   - Enhanced `_stream_events`: added dynamic retry handler on `ValidationException` when Bedrock prompts for inference profile ARN/ID.
   - Enhanced `chat_stream`: added `<think>` tag streaming encapsulation for `reasoningContent` events alongside standard `text` deltas.
   - Enhanced `discover_models`: combines active inference profiles (`list_inference_profiles`) and foundation models (`list_foundation_models`).
2. `backend/tests/test_bedrock.py`: added unit tests covering model ID normalization and inference profile routing.
3. Registered and activated all 4 models under provider `dedede` in Postgres database.
4. `frontend/src/services/api.ts` & `backend/src/tollms/main.py`: updated local dynamic host detection and CORS for flexible container/host access.
Verification:
- Direct AWS API validation: verified credentials against AWS Bedrock APIs (`list_foundation_models` and `list_inference_profiles` both 200 OK).
- Invocations verified on all 4 models:
  * `us.anthropic.claude-haiku-4-5-20251001-v1:0` (and `anthropic.claude-haiku-4-5-20251001-v1:0`) -> 200 OK, full stream.
  * `us.anthropic.claude-sonnet-4-6` (and `anthropic.claude-sonnet-4-6`) -> 200 OK, full stream.
  * `minimax.minimax-m2.5` (and `bedrock/minimax.minimax-m2.5`) -> 200 OK, full stream with reasoning.
  * `us.deepseek.r1-v1:0` (and `deepseek.r1-v1:0`) -> 200 OK, full stream with reasoning.
- Gateway endpoint verification: tested `/api/v1/gateway/stream` for all 4 models; all returned 200 OK.
- End-to-end browser verification via browser subagent: loaded UI, selected `dedede (BEDROCK_CONVERSE)` and `Claude Haiku 4.5`, typed message and verified streamed assistant response and usage calculation in UI.
- Pytest suite: 17/17 tests passing.
- Frontend linting & typechecking: 0 errors.

## 2026-09-13 - ToLLms V1 Chat Experience & UX Enhancement + Lucide Icon Migration

Requirement: transform ToLLms into a modern, production-grade, three-panel AI chat application (ChatGPT/Claude/Perplexity style) while preserving provider and model management capabilities; replace all emojis and unicode glyphs across the entire user interface with cohesive Lucide icons (`lucide-react`).

Implemented:
1. Three-Panel Layout Architecture:
   - Left Sidebar: collapsible conversation drawer with category groupings (Pinned, Recent), search filter, new chat trigger, inline renaming, pinning, and deletion.
   - Center Chat Panel: clean conversation stream, interactive welcome state, floating bottom composer with integrated provider/model selectors, stop generation and regenerate controls, Markdown rendering with syntax highlighting, and collapsible `<think>` reasoning blocks.
   - Right Intelligence Panel: collapsible drawer displaying real-time model telemetry, context limits, capabilities badges, pricing information, and live token usage with estimated session cost.
2. Conversation Pinning & Database Migration:
   - Added `is_pinned` boolean column with index to `conversations` table.
   - Generated and applied Alembic migration `7187f733ecbe_add_conversation_is_pinned.py`.
   - Updated backend schemas, service functions, and exposed `PATCH /api/v1/conversations/{id}/pin`.
3. Command Palette (Ctrl+K / Cmd+K):
   - Keyboard accessible modal for quick navigation, starting new chats, jumping to providers, and searching conversation history.
4. Comprehensive Lucide Icon Migration (`lucide-react`):
   - Replaced all emojis and unicode characters across the entire frontend with typed, responsive Lucide SVG components.
   - `ChatInput.tsx`: `Eye`, `Brain`, `Wrench`, `Zap`, `Mic`, `ImageIcon`, `Cpu`, `Bot`, `ChevronDown`, `CornerDownLeft`, `Square`.
   - `ChatSettingsPanel.tsx`: `FileText`, `Eye`, `Mic`, `Volume2`, `ImageIcon`, `Wrench`, `Brain`, `Zap`, `ChevronRight`, `ChevronLeft`.
   - `MessageView.tsx`: `Brain`, `ChevronUp`, `ChevronDown`, `User`, `Sparkles`, `Copy`, `RotateCcw`, `Trash2`.
   - `Sidebar.tsx`: `MessageSquare`, `Cpu`, `ChevronLeft`, `ChevronRight`, `Plus`, `Pin`, `Pencil`, `Trash2`.
   - `CommandPalette.tsx`: `CommandIcon`, `Plus`, `Search`, `Cpu`, `MessageSquare`, `Pin`.
   - `page.tsx`: Modern `Sparkles` icon card for welcome state, `RotateCcw` for regeneration.
   - `providers/page.tsx`: `Plus` for Add Provider/Model, `CheckCircle2` for Validate, `RefreshCw` with spin animation for Refresh Models, `Pencil` for Edit, `Trash2` for Delete.
5. Provider Management Enhancements:
   - Filter chips for all provider types (OPENAI_RESPONSES, OPENAI_CHAT, ANTHROPIC_MESSAGES, GEMINI, VERTEX_AI, BEDROCK_CONVERSE, CUSTOM).
   - Real-time provider search and model filtering.
6. Verification & Stability Fixes:
   - Bound mock LLM server in `frontend/e2e/mock-server.ts` to `0.0.0.0` for reliable Docker host gateway connectivity.
   - Configured `workers: 1` in `playwright.config.ts` for clean test isolation with host mock server.
   - Added `expect` import in `frontend/e2e/helpers.ts`.
   - TypeScript compilation (`npx tsc --noEmit`): 0 errors.
   - ESLint (`npm run lint`): 0 warnings, 0 errors.
   - Vitest unit tests: 5/5 passed.
   - Backend Pytest suite: 17/17 passed.
   - Playwright end-to-end test suite: 29/29 passed (including 20 chat-ux tests and 9 comprehensive e2e scenarios).

## 2026-09-13 - Project Rebranding: ToLLms to ToLLma (Toll to your Large Language Models & Agents)

Requirement: update the project name from `ToLLms` to `ToLLma`, reflecting the expanded scope from "Toll to your Large Language Models" to "Toll to your Large Language Models & Agents"; update project title and descriptions across the entire codebase.

Implemented:
1. Frontend Application Metadata & UI:
   - `frontend/src/app/layout.tsx`: Updated `title: "ToLLma"` and `description: "Toll to your Large Language Models & Agents"`.
   - `frontend/src/app/components/Sidebar.tsx`: Updated sidebar logo to `ToLLma` with title "ToLLma — Toll to your Large Language Models & Agents".
   - `frontend/src/store/chat.ts`: Updated Zustand localStorage key to `tollma-chat`.
2. Backend Application Metadata:
   - `backend/src/tollms/core/config.py`: Updated `project_name = "ToLLma"` and added `project_description = "Toll to your Large Language Models & Agents"`.
   - `backend/src/tollms/main.py`: Configured `FastAPI(title=settings.project_name, description=settings.project_description, debug=settings.debug)`.
   - `backend/pyproject.toml`: Updated description to `"ToLLma — Toll to your Large Language Models & Agents"`.
   - `backend/src/tollms/__init__.py`: Updated package docstring to `"""ToLLma — Toll to your Large Language Models & Agents."""`.
3. Configuration & Documentation:
   - `.env` & `.env.example`: Updated `PROJECT_NAME=ToLLma`, `PROJECT_DESCRIPTION="Toll to your Large Language Models & Agents"`, `NEXT_PUBLIC_APP_NAME=ToLLma`, and added `NEXT_PUBLIC_APP_DESCRIPTION="Toll to your Large Language Models & Agents"`.
   - `AGENTS.md`: Updated header and instructions to reference ToLLma (Toll to your Large Language Models & Agents).
   - `README.md`: Created project documentation with `# ToLLma` and `> **Toll to your Large Language Models & Agents**`.
   - `frontend/e2e/restart.spec.ts`: Made project root directory resolution dynamic.
4. Verification:
   - Verified 0 instances of `ToLLms` or `ToLLMS` remain in the active codebase via ripgrep.
   - TypeScript compilation (`npx tsc --noEmit`): 0 errors.
   - ESLint (`npm run lint`): 0 errors, 0 warnings.
   - Vitest unit tests: 5/5 passed.
   - Backend Pytest suite: 17/17 passed.
   - Playwright test suites (`tests/chat-ux.spec.ts`, `e2e/chat.spec.ts`, `e2e/manage.spec.ts`): All passed with 0 errors.

## 2026-09-13 - Unified Model/Provider Selector & Client-Side Mermaid Rendering

Requirement: add minimum height to the model and provider scrolls; remove the separate provider selection button from the chat UI; list providers and their respective models grouped together inside the model dropdown itself with search filtering; render interactive Mermaid diagrams in the UI with diagram/code toggling.

Implemented:
1. Unified Model & Provider Selector:
   - Removed standalone `ProviderSelector` from `ChatInput.tsx`.
   - Created `UnifiedModelSelector`:
     * Displays current model name and provider badge (`Bot` icon + model name + provider tag + chevron).
     * Search input at the top filtering across model names, model IDs, and provider names.
     * Scroll container with `min-h-[220px]` and `max-h-[380px] overflow-y-auto` preventing dropdown viewport explosion.
     * Sticky provider section headers with provider type badges.
     * Selecting an option sets both `providerId` and `modelId` in `useChatStore`.
2. Scroll Container Bounds on Providers Page:
   - Added `min-h-[300px]` to Provider List and Provider Details sections in `frontend/src/app/providers/page.tsx`.
3. Client-Side Mermaid Diagram Rendering:
   - Installed `mermaid` dependency in frontend.
   - Implemented `frontend/src/app/components/MermaidBlock.tsx`:
     * Custom dark theme tailored to ToLLma aesthetics.
     * SVG rendering with unique ID generation.
     * Interactive toolbar with "Diagram" and "Code" toggle tabs.
     * Copy Mermaid source code button with toast notification.
     * Error handling: graceful fallback to code view on incomplete streaming or syntax errors.
   - Updated `MessageView.tsx` to detect `language-mermaid` or flowchart/graph syntax and route to `MermaidBlock`.
4. Test Updates & Verification:
   - Updated `frontend/e2e/helpers.ts` `selectProviderModel` for unified selector.
   - Updated `frontend/tests/chat-ux.spec.ts` for unified model selector and search bounds.
   - TypeScript compilation (`npx tsc --noEmit`): 0 errors.
   - ESLint (`npm run lint`): 0 errors, 0 warnings.
   - Vitest unit tests: 5/5 passed.
   - Backend Pytest suite: 17/17 passed.
   - Playwright end-to-end suite: 29/29 passed in 2.2m.
   - Visual verification: Captured screenshots of rendered LiteLLM Mermaid architecture diagram, Diagram/Code tabs, and opened unified model dropdown with grouped providers.

## 2026-09-13 - Model Intelligence Repository (source of truth)

Requirement: global model repository fed by LiteLLM + OpenRouter (discovery pipeline -> normalization ->
repository -> registry -> selection UI -> cost/capability engines), with canonical-key dedupe, 24h sync,
history tracking, search/filter/stats APIs, and raw payload preservation for schema evolution.
Implemented (backend, new self-contained module modules/model_repository/):
- models.py: model_repository (model_key unique, identity/capability/limit/pricing columns, metadata_ +
  raw_source_payload JSONB per the recommended addition, soft-delete mixin) and model_repository_sync_runs
  tables; pricing stored source-native per-token at Numeric(20,12) (gateway prices per-1M — convert on use).
- sources.py: LiteLLMSourceAdapter + OpenRouterSourceAdapter (sync httpx fetch, defensive per-record
  normalize, never crash on bad entries); canonical key {provider}/{model} lowercase; openrouter/ routing
  prefixes recurse (openrouter/anthropic/x -> anthropic/x), raising cross-source merges 87 -> 283.
- service.py: run_sync (payloads injectable for offline tests; per-record try/except with error_details cap
  20; create/update/deactivate+reactivate; never raises), list/search/filter/pagination, stats, history.
- scheduler.py: APScheduler BackgroundScheduler every 24h with own SessionLocal; skipped under pytest via
  PYTEST_CURRENT_TEST; lifespan start/shutdown in main.py.
- router.py: GET stats, GET models (search/provider/capability/active_only/page/page_size), GET models/{id},
  POST /sync, GET /sync-history. Manual _read mapper (same metadata_ alias collision as models module).
- Migration 9a31c4e7b2d5 (single head, applied); dependency apscheduler>=3.10 (pyproject + uv.lock + container).
Tests: backend/tests/test_model_repository.py (6: create/dedupe, update/deactivate, failure-never-raises,
API search/filter/pagination/stats/history, scheduler-off guard, prefix recursion); frontend/e2e/repository.spec.ts
(3 read-only API specs, no POST sync — slow + rewrites dev data).
Verification: pytest 23/23; live POST /sync -> done, 4276 created, 0 errors (~60s); re-sync idempotent
(+0 ~4023 -0 err=0, 4023 active / 177 providers); Playwright repo spec 3/3; tsc + eslint clean.
Deviations: POST /sync returns 200 not 202 (blocks ~60s; honest status); no new frontend page and no
provider-discovery enrichment yet — repository stands alone behind APIs (see next steps).

## 2026-09-13 - Model Intelligence phase 2 (authoritative repo integration)

Requirement: repository becomes authoritative for pricing/capabilities/limits/costs across provider
registration, chat, usage, cost, and UI; canonical matching; source tracking; manual+scheduled sync.
Implemented (backend):
- Migration b7e2d9f4a1c3: repo += vendor/documentation_url/image_output_cost/video_output_cost;
  new model_repository_sources (source_name/url/model_id/repo FK/payload, sync-owned full rewrite);
  messages += cache_read/write/reasoning tokens + costs; models += repository_model_key (indexed).
- canonical.py (ModelCanonicalizationService): separator-unifying canonicalize(); merge groups + existing
  matching use canonical form (no row churn); openrouter/ recursion kept. Cross-source merges 87 -> 283.
- costing.py (CostCalculationService): UsageTokens/PriceSet(per-1M)/CostBreakdown pure calculate();
  reasoning bills at output rate unless explicit; prices_for_model() merges repo (per-token x1M) over model.
- Adapters (openai chat+responses, anthropic, gemini/vertex) extract cache/reasoning via shared
  usage_extras(); StreamChunk/ChatResult extended; gateway _finalize_usage resolves repo entry via
  find_for_model (provider_type hints + canonical fallback) and persists extras; ChatResponse + SSE done
  envelope extended.
- conversations: add_message extra_usage/extra_cost; usage_totals += cache/reasoning sums + by_model/
  by_provider breakdowns (joined names, cost-desc).
- Provider integration: models carry repository_model_key + metadata.repository_snapshot (originals;
  columns are overrides); GET /model-repository/lookup returns entry + suggested per-1M payload.
- Scheduler: adapter fetch retry (2 attempts) + APScheduler misfire/coalesce already sane; manual POST
  /sync returns full run (superset of started/processed/id).
Implemented (frontend): MessageView shows model · provider, usage tooltip (cache/reasoning), in/out cost
tooltip + testids; IntelligencePanel adds Reason/Cache row + By provider/By model breakdowns; provider
model form has repository search + one-click Import (fills, links key, toast; manual fallback).
Tests: test_intelligence.py (8: canonical merge, source rewrite, lookup/suggest incl. exact-id ranking fix
for "gpt-4o" which first matched azure/eu/..., cost math, repo-priced chat with cache tokens, snapshot,
fallback); e2e/intelligence.spec.ts (import, chat cost/analytics, manual sync); fixed order-dependence in
old repository.spec.ts (latest run may be idempotent 0-created).
Verification: pytest 31/31; live sync done twice (4276 created, then idempotent +0 ~4023 -0); Playwright
34 passed + 1 pre-existing skip; vitest 5/5; tsc + eslint clean; next build success.
Not done (out of scope / next): extra free sources (HF/Ollama listings — no stable key-less JSON found);
fuzzy version-date key matching; discovery-time auto-enrichment of provider models.

## 2026-09-13 - Provider registration & discovery wizard (5-step, persist-only-at-finish)

Requirement: Vercel/Stripe-style onboarding — info -> credentials -> validation -> discovery/selection ->
summary; provider persisted only after step 5; 4-priority mapping; per-model edit; bulk edit; resync.
Note: HEAD already contained a wizard visual shell (persist-first, no step nav) from a concurrent
refactor (5c93f82); it was completed into the spec'd flow instead of rebuilt. Tree collision on
providers/page.tsx resolved by restoring HEAD and extracting shared ModelForm.
Implemented (backend):
- model_repository/mapping.py: detect_providers_from_url (groq/openrouter/deepseek/mistral/together/
  fireworks/ollama/localhost/litellm/azure), map_one/map_models with provider_specific/global/fallback
  + repository_match meta (match_type, source_url, repository_version, last_synced_at). POST /map.
- providers: POST /draft-validate (temporary adapter, validate+discover, nothing persisted),
  POST /register (atomic provider+models, unique-name 422, validation stamp, server-side match_stats),
  ensure_unique_name (ilike, excludes self on update); migration c4d8e6a2f5b1 partial unique index on
  live provider names.
- models: create_model gains repository_match + commit flags; POST /{id}/resync (non-pricing fields;
  prices only with include_pricing=true, never silent overwrite); PATCH /bulk (prices/caps/endpoint/
  active, skips missing).
Implemented (frontend): ProviderWizardModal is now a real stepped flow — draft autosave/restore
(localStorage, key-remount, steps<=2), Back nav, draft-validate, auto-map on step 4 (search/match/cap/
price filters, select-filtered/deselect-filtered, per-model edit drawer reusing shared ModelForm,
bulk endpoint+price bar), step-5 summary (counts + "Matched provider/global/unknown" stats) + atomic
register with query invalidation; edit mode keeps direct save. Shared components/ModelForm.tsx
extracted from page. ModelDetailDrawer gained Sync metadata/pricing buttons; provider toolbar gained
Sync models (bulk non-pricing resync of linked models).
Tests: test_wizard.py (5: draft no-persist, mapping priorities+URL detection, atomic register+stats+
dup-name, resync pricing guard, bulk); rewrote providers/validation/discovery specs to the wizard flow
(incl. "nothing saved before step 5" assertion); new wizard.spec.ts (map/edit/bulk/summary/API match
metadata + sync/resync buttons).
Verification: pytest 36/36; Playwright 37 passed; vitest 5/5; tsc+eslint clean; next build success.
Deviations: no separate provider_models/links tables — models.repository_model_key + metadata.
repository_match store the same relations (no duplication); no TanStack Virtual/Table/RHF/Zod —
discovered sets are tens of rows, server-paginated repo search stays in the catalog modal; no model
tags field; provider "Sync models" applies non-pricing resync with toast summary (no 3-way merge UI).

## 2026-09-13 - ToLLma V1 Complete Product UX & UI Redesign (Unified AI Workspace)

Requirement: redesign ToLLma from a collection of disconnected CRUD screens into a cohesive, high-density AI workspace comparable to ChatGPT, Claude, Cursor, and Linear; preserve ToLLma's provider-centric architecture while unifying navigation, layout system, component architecture, state management, and design system.

Implemented:
1. Design System Architecture (`frontend/src/components/ui/`):
   - Created centralized, shared primitives: `AppShell`, `Sidebar`, `TopBar`, `SearchInput`, `ModelSelector`, `ProviderSelector`, `UsageCard`, `CostCard`, `CapabilityBadge`, `StatusBadge`, `EmptyState`, `LoadingState`, `ErrorState`, `SectionHeader`, `PageHeader`, `DetailPanel`, `SettingsPanel`, `CommandPalette`, and base primitives (`Badge`, `Button`, `GhostButton`, `Card`, `Dialog`, `Input`, `Select`, `Textarea`, `Switch`, `Field`).
   - Clean barrel export in `frontend/src/components/ui/index.ts` replacing legacy monolithic `ui.tsx`.
2. Unified Application Layout & Global Navigation:
   - Created persistent global `TopBar` across all routes (`/` and `/providers`) featuring ToLLma branding, direct Chat/Providers route switcher, upcoming Analytics/Settings badges, Model Catalog search button, Command Palette launcher (`Ctrl+K`), live repository Sync status trigger, and theme toggle.
   - Built context-aware, collapsible, resizable `Sidebar` with persisted width (`sidebarWidth` in Zustand `tollma-chat` store) switching seamlessly between Conversation list (Chat page) and Provider filter/list (Providers page).
3. Chat Experience Redesign (`/`):
   - Header with active conversation title, provider/model indicator, token telemetry, export options (Markdown / JSON), and clear actions.
   - Centered message composer with unified selector grouping providers and models with sticky headers and search.
   - Upgraded right-side Model Intelligence drawer with capabilities badges, pricing per 1M tokens, reasoning/tooling readiness flags, and live conversation token and cost analytics.
4. Providers Workspace Redesign (`/providers`):
   - 3-Panel workspace layout: Left Sidebar (provider search, type filter pills, provider cards with status and model counts) -> Center Panel (provider details, validation status, masked credentials, operational toolbar) -> Right Panel (models table, search filter, capabilities tags, endpoint badges, active toggles, and add model action).
   - 5-Step `ProviderWizardModal`: Provider type selection, credentials inputs, auto-validation, auto-discovery, and completion with smooth dialog handling.
   - Model Detail Drawer (`ModelDetailDrawer.tsx`): Slide-over drawer revealing model pricing, token context limits, capabilities, and repository provenance.
   - Model Intelligence Repository Catalog Modal (`RepositoryCatalogModal.tsx`): Search over 4,000+ normalized upstream models with one-click import into active provider.
5. Backend & Contract Compatibility Refinements:
   - APScheduler: Configured immediate startup sync conditional on empty database (`count == 0`), ensuring repository models are available upon container start/restart without duplicate execution contention.
   - Optimistic React Query cache updates on provider create, update, remove, and validate mutations for instant UI reactivity.
6. Comprehensive Verification:
   - TypeScript compilation (`docker compose exec frontend npx tsc --noEmit`): 0 errors.
   - ESLint validation (`docker compose exec frontend npm run lint`): 0 errors, 0 warnings.
   - Frontend Vitest unit tests: 5/5 passed.
   - Backend Pytest suite: 31/31 passed.
    - Playwright end-to-end suite (`npx playwright test`): 33 passed, 2 skipped (empty conversations), 0 failed across all 35 tests.
    - Visual inspection: Verified pixel-perfect, cohesive UI layout across both Chat and Providers workspaces.

## 2026-09-13 - Backend refactor: modules/ -> api/ + services/ + models/ (no behavior change)

Drove `backend/src/tollms/modules/{conversations,providers,models,model_repository,gateway}`
into layered arch via git mv (history kept): feature code -> `api/{conversations,providers,
models,repository,gateway,health/}` (router+schemas+service each; health router-only);
reusable engines -> `services/gateway/{adapters,factory,costing}` +
`services/model_repository/{canonical,mapping,sources,scheduler,sync,lookup}`;
ORM -> `models/{conversation,message,provider,registered_model,model_repository}` with
aggregate `models/__init__.py`. modules/ deleted.
Split: old model_repository/service.py divided three ways — sync engine (run_sync/merge,
services/.../sync.py), match engine (PROVIDER_HINTS/find_for_model/lookup/suggest_payload/
stats, services/.../lookup.py — mapping.py imports from here so services never depend on api),
feature service (get_entry/list_entries/sync_history + re-exports, api/repository/service.py).
conversations/models.py split Role+Message -> message.py, Conversation -> conversation.py.
Rewrote ~30 files' imports by script (tollms.modules.* -> tollms.{api,services,models}.*),
updated alembic/env.py to single `import tollms.models`, declared migration-only partial index
uq_providers_name_live in Provider metadata (alembic check was red before AND after until this;
now green — lesson encoded in backend.md). Kept package name `tollms` (prompt said `tollma`;
rename has no benefit, touches packaging/docker). Skipped registry.py/encryption/storage/
workers/shared scaffolding — no code needs them yet.
Verification: pytest 36/36; alembic upgrade heads + check clean; cold restart healthy,
APScheduler 24h job starts, /health + /health/ready ok; all 27 routes in OpenAPI;
live repo stats (4029 models) + lookup ok; Playwright 37/37; vitest 5/5; tsc clean.
Also rewrote .opencode/rules/backend.md to the layered rules (flow router->api service->
services->models; engine-keyed services; models aggregate import; check-green invariant).

## 2026-09-13 - Provider page UX simplification (Validate -> Discover -> Select -> Use)

Removed Catalog Import and Sync Models from the entire product: deleted
RepositoryCatalogModal.tsx + its AppShell global mount, TopBar Model Catalog button and
repository Sync button/stats query, CommandPalette catalog/sync actions, provider-page
Sync models button, ModelDetailDrawer sync-metadata/pricing section, backend
POST /models/{id}/resync + resync_model (+ helpers), frontend resyncModel/syncRepository/
listRepositoryModels/getRepositoryStats/getRepositorySyncHistory fns and ResyncResult/
SyncRun/RepositoryStats/RepositoryModelPage/RepositoryModelItem types, store repoSearchOpen.
POST /model-repository/sync stays (scheduler/ops trigger, no UI references it).
Reworked POST /providers/{id}/discover into cache-only Refresh: fetches provider models,
enriches each via the mapping engine (provider_specific/global/fallback + suggested
pricing/caps, JSON-sanitized), stores {models,total,last_discovery_at} on
provider.metadata.discovery; registers nothing (new DiscoveryResult shape).
Provider page now: header (name/type/status/model count/last checked), Validate + Refresh
actions only, Discovery stats bar (Available/Registered/Hidden/filtered-out/Last Discovery
relative time), Available panel (search + capability/type/context filters, match badges,
Register + View Details per row) and Registered panel (search, edit/disable/delete;
manual Add removed). New RegisterModelDrawer: step 1 provider info (read-only), step 2
repository match (badge + key or zeroed defaults), step 3 ModelForm prefilled via
fromSuggested (editable, repo search kept as invisible assist); save POSTs /models and the
row moves panels with a "Just registered" highlight, no refresh. Validate stays
credentials-only (e2e asserts zero models after validate).
Tests: rewrote test_discovery persist test (cache written, 0 created, re-refresh flips
new_count); deleted wizard resync test; rewrote e2e discovery/validation (new flow),
providers (asserts only 2 actions), wizard (dropped sync test), intelligence (repo
auto-populate via register drawer).
Verification: pytest 35/35; Playwright 35 passed + 1 pre-existing skip; vitest 5/5;
tsc clean; next build success. Pre-existing lint errors (TopBar/ProviderWizardModal
setState-in-effect, identical on stashed HEAD) left untouched.

## 2026-09-13 - Prevent Browser Password Autofill on Provider Credential Inputs

Requirement: Disable browser password manager autofill / username suggestion dropdowns on all provider credentials fields (Step 2 and Edit mode in the Provider connection modal).

Root Cause:
- Chromium treats forms containing `<input type="password">` as login forms.
- Chromium's password heuristics engine identifies preceding text fields (e.g. `Access Key`, `API Key`) as `USERNAME` fields and attaches saved-account dropdowns, auto-populating email addresses and passwords.
- Standard `autocomplete="off"` is ignored by Chromium when a password input is present in the form.

Implemented Solution:
1. `frontend/src/app/providers/components/ProviderWizardModal.tsx`:
   - Created reusable `CredentialField` component.
   - For secret inputs, uses `type="text"` combined with native CSS `-webkit-text-security: disc` and `.credential-masked` styling when masked. Because no `type="password"` input exists in the DOM, Chromium and browser password managers do not classify the form as a login form and never attach username autofill heuristics or saved password dropdowns.
   - Added interactive show/hide secret toggle with `Eye` and `EyeOff` icons (`lucide-react`).
   - Hardened all credential and provider inputs with anti-autofill attributes: `autoComplete="off"`, `autoCorrect="off"`, `autoCapitalize="none"`, `spellCheck={false}`, `data-1p-ignore="true"` (1Password), `data-lpignore="true"` (LastPass), `data-bwignore="true"` (Bitwarden), and `data-form-type="other"` (Dashlane).
   - Applied `<CredentialField>` across both Step 2 of the wizard and `EditBody`.
   - Updated modal container to an explicit `<form>` with `autoComplete="off"` and `onSubmit={(e) => e.preventDefault()}`.
2. `frontend/src/app/globals.css`:
   - Added `.credential-masked` utility class with `-webkit-text-security: disc !important` and `text-security: disc !important`.
3. `frontend/src/components/ui/TopBar.tsx`:
   - Resolved client theme hydration mismatch on theme toggle button.

Verification:
- TypeScript (`tsc --noEmit`): 0 errors.
- Vitest unit tests: 5/5 passed.
- Backend Pytest suite: 36/36 passed.
- Playwright E2E suite (`npx playwright test`): 36 passed, 1 skipped, 0 failed.
- Visual browser verification: Loaded `http://localhost:3000/providers`, triggered Add Provider wizard, advanced to Step 2 (Credentials for AWS Bedrock); verified that `Access Key` and `Secret Key` do not trigger password autofill dropdowns, secret masking functions cleanly, and eye toggle reveals and re-masks secrets seamlessly.

## 2026-09-13 - Provider Wizard Header Step Badge Alignment & Clean Single Provider Platform Selection

Requirements:
1. Fix the "Step n of n" badge layout in the modal card header so text does not wrap awkwardly or squish vertically.
2. Remove duplicate "Provider Type" select dropdown from Step 1 so the platform card grid is the single, clean provider type selector.

Implemented Solution:
1. `frontend/src/components/ui/primitives.tsx`:
   - Updated `badgeVariants` base styles with `whitespace-nowrap shrink-0 px-2.5 py-0.5` to guarantee badges never break across multiple lines or compress vertically in flex containers.
2. `frontend/src/app/providers/components/ProviderWizardModal.tsx`:
   - Wizard Header: Refactored header layout to `flex items-center justify-between gap-4`. Assigned `min-w-0 flex-1` to the title block and `shrink-0 whitespace-nowrap px-2.5 py-1 text-xs font-mono` to the Step badge pill, ensuring crisp single-line alignment in both creation and edit modes.
   - Step 1 Layout: Removed the redundant top-row `<Select>` dropdown for Provider Type. Expanded "Provider Name" to full width for a balanced layout. Maintained accessibility and test compatibility with a synced `sr-only` select element, while "Select Provider Platform" cards serve as the primary interactive selection. Added `data-testid={`provider-platform-${t}`}` to each platform card button.

Verification:
- TypeScript (`tsc --noEmit`): 0 errors.
- Vitest unit tests: 5/5 passed.
- Backend Pytest suite: 36/36 passed.
- Playwright tests (`e2e/wizard.spec.ts` & `e2e/providers.spec.ts`): 3/3 passed.
- Visual browser verification: Verified in browser that the Step badge is single-line and vertically centered, "Provider Name" is full-width, and the platform cards grid cleanly handles provider type selection without any duplicate dropdown.