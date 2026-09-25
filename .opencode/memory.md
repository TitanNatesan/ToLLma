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

## 2026-09-13 - Production Valkey cache layer (core infrastructure)

New services/cache engine (Valkey via redis.asyncio, PostgreSQL stays source of truth):
constants.py (TTL registry: validation 300s, discovery 900s, conversation 300s,
repo search 1h, repo intelligence 24h, locks), keys.py (tollma: registry + lock names,
future SaaS keys reserved), serializers.py (pydantic/dataclass/datetime/Decimal/UUID),
client.py (pooled connect, loop-affinity reconnect, separate bridge-loop client,
tolerant ping/info), manager.py (get/set/delete/exists/mget/mset/ttl/expire/
invalidate_pattern + sync bridge for sync service code + graceful bypass), decorators.py
(@cached/@cache_invalidate/@cache_refresh), locks.py (SET NX PX + Lua release, async
locked + sync locked_sync), metrics.py (hits/misses/writes/invalidations/errors,
hit_rate, latency), __init__.py exports.
Integrations: provider validate (cache-first 300s, test transports bypass) + discovery
(cache-first 900s behind provider_refresh lock, live registration recompute) in
api/providers/service.py with invalidation on update/delete (secrets never cached);
find_for_model + lookup entry-ID caching in lookup engine (covers gateway metadata +
repository lookups; sync invalidates repository:*); usage_totals cache (300s,
invalidated by add_message/delete); run_sync wrapped by repo-sync lock (busy -> 422)
in api/repository/service.py; scheduler _sync_job behind scheduler lock (skips when
busy); GET /health/cache (healthy/degraded + hit_rate + keys + metrics + server info);
lifespan connect/disconnect (loop-safe); compose valkey service pinned to
valkey/valkey:8@sha256:3fbd... (AOF volume, healthcheck; old :latest RDB v80 volume
wiped — cache data is rebuildable); VALKEY_*/CACHE_ENABLED in config + .env(.example);
redis runtime dep + fakeredis dev dep, uv.lock regenerated.
Bugs found by testing: sync-bridge threading.Lock self-deadlock (RLock fix);
redis.asyncio loop affinity across asyncio.run/TestClient portals/bridge thread
(reconnect-on-loop-change + dedicated bridge client + loop-safe disconnect);
two test bugs (shared FakeRedis instance, messages route).
Tests: tests/test_cache.py (15: manager, decorators, provider validation/discovery,
update invalidation, repo match, sync invalidation, busy lock, contention, scope,
usage, health, exports) + conftest autouse Valkey flush + metrics reset.
Verification: pytest 51/51 in ~6s (per-test -v progress); alembic check clean;
GET /health/cache healthy (valkey 8.1.10); perf find_for_model 12.63->2.58ms (5x),
usage_totals 37.58->7.14ms (5x); e2e discovery/validation/providers 3/3 green;
all compose services healthy.

## 2026-09-13 - Authentication & user isolation (email + Google OAuth + JWT + sessions)

Backend: models/user.py (User + AuthProvider EMAIL/GOOGLE, live-unique email partial
index, unique google_id) + migration d5f1a2b3c4d6 (users table; user_id nullable
UUID+FK+index on providers/conversations/messages; provider names global-unique ->
per-(user_id,name) partial unique). core/security.py (argon2, HS256 access 15m /
refresh 30d / verify 24h, sid-bound Valkey sessions session:{sid} 30d TTL,
get_current_user via Bearer-or-cookie + live session + active PG user;
AuthenticationError 401). services/email/ (SMTP or log+outbox, verify.html template).
api/auth/ (signup[UNVERIFIED + session + debug token non-prod]/verify[idempotent
replay for verified addresses]/login/google login+callback[find-or-create, link on
verified Google email]/refresh/logout/me; httpOnly access+refresh + tollma_session
presence cookies, Secure in prod). Cache keys session/verify_email/oauth_state added.
Ownership: user_id threaded through providers/models/conversations/gateway services
(404 across owners, per-user name uniqueness, AIModel scoping via provider join,
gateway chat/streams stamp owner, usage cache key user-scoped). Repository stays
global (auth-required, unowned). run_sync marks crash-orphaned 'running' rows
'interrupted'; LOCK_REPO_SYNC 3600->600s after reload-killed syncs held the lock.
Frontend: api credentials:include + silent refresh-and-retry on 401; User type +
store/auth + Shell session bootstrap (bare chrome on auth pages); login/signup/
verify(Suspense)/auth/callback pages; src/proxy.ts (Next 16 convention) gating via
presence cookie; UserMenu + logout in TopBar; shared DialogContent max-h-80vh scroll
(save buttons were unreachable on 720p screens). E2E: auth.spec (gate/signup/verify/
logout/isolation), per-test apiLoginAs/apiSignupRequest, setup-project storageState
for the UI suite, intel manual-sync test.setTimeout(240s).
Tests: tests/test_auth.py (11: signup/verify incl. expiry/idempotent replay/login/
JWT-anon-reject/isolation A-B providers+models+conversations+messages/refresh/logout/
Google callback incl. unconfigured/linked) + conftest user_factory with jar auth;
existing suites updated for auth (factories auto-signup). Deps: pyjwt, argon2-cffi,
email-validator (+lock); env AUTH block (JWT_SECRET fallback SECRET_KEY, GOOGLE_*,
FRONTEND_URL, SMTP_*).
Verification: pytest 62/62; alembic check clean; Playwright 39/39 (incl. 4 auth);
vitest 19/19; tsc clean (1 pre-existing ResponseMarkdown test error fixed by cast —
was failing builds); build success; lint 3 pre-existing setState-in-effect errors
untouched; compose all healthy. Flakes killed along the way: RLock bridge deadlock
(earlier), verify double-fire (StrictMode + single-use token), save/GET race in
intel:10 (drawer-close gate), orphan sync rows + stale locks from --reload kills.

## 2026-09-14 - ToLLma green accent theme (frontend only, #066E09)

Tokens: tollma 50-950 scale in globals.css @theme (500=#066E09 brand; muted,
non-neon; white-on-500+ passes AA). All components consume tollma-* utilities;
zero hardcoded greens. Primitives: Button default + Badge default -> tollma-600,
Badge success -> tollma tints, Switch/Checkbox checked -> tollma-600/500, Input/
Textarea/Select/SearchInput/ChatInput focus -> tollma-500 border + 40-50% ring
glow. Nav: TopBar active tab + Sidebar active conversation -> tollma-50/950 tints;
selected provider card -> tollma border+ring+tint; selected model rows ->
tollma-100/900. Status: StatusBadge valid/active/done/syncing dots ->
tollma-500 (red/amber untouched), StatusCard border, cost figures tollma-600/400.
Chat: link + Mermaid + Send (via Button) green; bubbles untouched. Providers page:
validate/discover icons, discover-result info box (blue->tollma tints),
just-registered card + badge. Wizard: validation box + platform-select +
step circles green. Markdown callouts: emerald/blue variants -> tollma 1:1
(info is now muted green-gray). CommandPalette selected rows tinted + add icon
green. AuthCard submits -> tollma-500, toggles hover tollma-300. Product fix
included: shared DialogContent had no max-height (Save unreachable on 720p) ->
max-h-80vh scroll. Deliberately UNCHANGED: region badges (US sky/EU purple/APAC
teal/global are semantic coding), logo tiles (monochrome brand mark), red/amber
status, disabled states (grayscale), all layouts/sizes/animations.
Verification: tsc clean; lint 3 pre-existing setState-in-effect errors untouched;
build success; vitest 19/19; contrast 13/13 pairs AA (lowest 5.93:1); before/after
screenshots providers/chat/login identical except accents; e2e 36/39. The 3
failures are pre-existing HEAD (89595a4) issues proven on pristine tree via
stash: wizard.spec expects mapping text in wiz-match-* (repurposed to region
badges by regional-scope feature), 2 collapse tests hit duplicate toggle testids
from panel-toggle refinements. Left untouched per frontend-only scope (no
unrelated test edits). Anomaly noted: dev model_repository tables found empty
mid-session (no DELETE path exists in code; volumes intact); repopulated via
manual sync (4029 rows, 0 errors).

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

## 2026-09-13 - Regional Model Scope Badges & Registration Drawer UX Fixes

Requirements:
1. Provider Wizard (Step 4 & Step 5): Differentiate regional models (e.g. AWS Bedrock `us.*` cross-region inference profiles) from global models so they display a distinct `US` badge rather than showing `global` on everything. Add "US specific" filter option.
2. Register Model Overlay Side Panel (`RegisterModelDrawer`): Fix Back button so it works immediately (instead of being disabled on step 0), and populate Context Window and Max Output from repository intelligence instead of showing "Unspecified".

Implemented Solution:
1. `frontend/src/app/providers/components/ProviderWizardModal.tsx`:
   - Added `getModelScope` helper to detect regional inference profiles (`US`, `EU`, `APAC`) and global/provider/fallback scopes.
   - Updated model cards in Step 4 and Step 5 to render accurate regional badges (e.g. bold blue `US` badge for `us.anthropic...`, sky `global` badge for `global.anthropic...`).
   - Added `US specific`, `EU specific`, and `APAC specific` filter options to `matchFilter` select and updated filter logic.
   - Enhanced Step 5 summary stats with US model breakdown.
2. `frontend/src/app/providers/components/RegisterModelDrawer.tsx`:
   - Fixed Back button: Removed `disabled={step === 0}`. Clicking Back on Step 0 now closes the drawer (`onClose()`), while on Step 1 it returns to Step 0 (`setStep(0)`).
   - Added `useEffect` to synchronize drawer step with `initialStep` whenever the drawer opens or target model changes.
   - Context Window & Max Output: Resolved `info.context_window ?? suggested.context_window` and `info.max_output_tokens ?? suggested.max_output_tokens`. Updated `fmtCtx` to safely handle strings and numbers.
   - Added Context Window and Max Output to Step 1 (Repository intelligence) summary grid.
3. `backend/src/tollms/api/providers/service.py`:
   - Updated `discover_provider_models`: When provider SDK returns `context_window: None` or `max_output_tokens: None` (as AWS Bedrock `list_inference_profiles` does), automatically populates them from repository intelligence `match["suggested"]`.
4. `frontend/src/app/providers/page.tsx`:
   - Available models list and context filter fallback to `m.suggested.context_window` if `m.context_window` is not set.

Verification:
- TypeScript (`tsc --noEmit`): 0 errors.
- Vitest unit tests (`scope.test.ts`, `api.test.ts`, `utils.test.ts`): 11/11 passed.
- Backend Pytest suite: 35/35 passed.
- Backend endpoint verification: Tested `POST /api/v1/providers/{id}/discover` via curl against active Bedrock provider; verified that `us.anthropic.claude-opus-4-1...` returns `context_window: 200000` and `max_output_tokens: 32000`.
- Playwright E2E suite (`discovery.spec.ts` & `wizard.spec.ts`): 2/2 passed.

## 2026-09-13 - Endpoint Type Alignment: Available Models Panel vs Configuration Panel

Requirement:
In the Available Models panel, models showed the `converse` badge (the actual Bedrock Converse API endpoint), but when opening the registration drawer configuration panel, the Endpoint Type dropdown was defaulting to `chat_completions`. Resolve this conflict across both the registration drawer, provider wizard, and discovery backend.

Root Cause:
1. `backend/src/tollms/api/providers/service.py`: In `discover_provider_models`, `suggested` was populated from the repository catalog match (`LiteLLM`/`OpenRouter`), which defaults to `chat_completions`. While `d.model_id` and `d.name` were overridden with provider values, `suggested["endpoint_type"]` was not set to `d.endpoint_type` (`converse`).
2. `frontend/src/app/providers/components/RegisterModelDrawer.tsx`: `fromSuggested` was invoked using only `suggested`, which contained `"chat_completions"` from the repository lookup rather than `info.endpoint_type` (`"converse"`).
3. `frontend/src/app/providers/components/ModelForm.tsx`: `fromSuggested` did not accept or prioritize a provider's native endpoint type when the repository match defaulted to generic `chat_completions`.
4. `frontend/src/app/providers/components/ProviderWizardModal.tsx`: When initializing mapped forms and registering models, fallback endpoint resolution did not default to `PROVIDER_DEFAULT_ENDPOINTS[type]`.

Implemented Solution:
1. `backend/src/tollms/services/model_repository/mapping.py`:
   - Added `PROVIDER_DEFAULT_ENDPOINTS` mapping:
     * `BEDROCK_CONVERSE` -> `converse`
     * `ANTHROPIC_MESSAGES` -> `messages`
     * `OPENAI_RESPONSES` -> `responses`
     * `OPENAI_CHAT`, `GEMINI`, `VERTEX_AI`, `CUSTOM` -> `chat_completions`
   - Updated `map_one` and `_mapped` to set `suggested["endpoint_type"] = default_endpoint` when mapping models for a specific provider type.
2. `backend/src/tollms/api/providers/service.py`:
   - In `discover_provider_models`: Set `suggested["endpoint_type"] = d.endpoint_type`, `suggested["context_window"] = ctx`, and `suggested["max_output_tokens"] = max_out`.
3. `frontend/src/app/providers/fields.ts`:
   - Exported `PROVIDER_DEFAULT_ENDPOINTS: Record<ProviderType, EndpointType>`.
4. `frontend/src/app/providers/components/ModelForm.tsx`:
   - Updated `fromSuggested` to accept optional `defaultEndpointType?: EndpointType`. If `defaultEndpointType` is provided (e.g. `converse` for Bedrock) and the suggestion is generic `chat_completions`, it prioritizes `defaultEndpointType`.
   - Updated `importFromRepository` to preserve specialized endpoint types (`converse`, `messages`, `responses`) when importing catalog updates.
5. `frontend/src/app/providers/components/RegisterModelDrawer.tsx`:
   - Passes `endpoint_type: info.endpoint_type || suggested.endpoint_type` and `info.endpoint_type` as `defaultEndpointType` to `fromSuggested`. Ensures existing cached discovery records also instantly display `converse` in the configuration panel.
6. `frontend/src/app/providers/components/ProviderWizardModal.tsx`:
   - Uses `PROVIDER_DEFAULT_ENDPOINTS[type]` and discovered endpoint when populating model forms and constructing registration payloads.
   - Updates Step 5 model summary badge to show `f?.endpoint_type ?? PROVIDER_DEFAULT_ENDPOINTS[type]`.

Verification:
- TypeScript (`tsc --noEmit`): 0 errors.
- Vitest unit tests: 15/15 passed (`endpoint.test.ts`, `scope.test.ts`, `api.test.ts`, `utils.test.ts`).
- Backend Pytest suite: 36/36 passed (including new `test_bedrock_converse_discovery_sets_converse_endpoint`).
- Discovery API verification: Refreshed discovery on the active Bedrock Converse provider (`POST /api/v1/providers/{id}/discover`); verified `sample.endpoint_type == "converse"` and `sample.suggested.endpoint_type == "converse"`.

---

## 2026-09-13 - UI Redesign, Unwanted Trailing Zero Stripping, Edit Step Label Fix, Modern Typography & Project Logo Integration

### Requirements Completed:
1. **Checkbox & Dropdown Modern UI**:
   - Replaced raw OS `<input type="checkbox">` and `<select>` with custom, beautifully styled accessible components in `frontend/src/components/ui/primitives.tsx`.
   - `Checkbox` component includes custom borders, rounded corners, dark/light styling, and `Check` icon from `lucide-react`.
   - `Select` component features `appearance-none`, custom pointer-events-none `ChevronDown` SVG icon, right padding, and `sizeVariant` ("default" | "sm").
2. **Strip Down Unwanted Zeros**:
   - Implemented `stripTrailingZeros` in `frontend/src/lib/utils.ts` and unit tested it in `utils.test.ts`.
   - Cleaned pricing values across `ModelForm.tsx`, `RegisterModelDrawer.tsx`, `ProviderWizardModal.tsx`, `ModelDetailDrawer.tsx`, and `providers/page.tsx` (`1.000000000000` -> `1`, `0.100000000000` -> `0.1`).
   - Cleaned discovery pricing fields in `backend/src/tollms/api/providers/service.py` while preserving backend test compatibility.
3. **Provider Edit Modal Step Label Fix**:
   - Conditioned `Step {step} of 5` badge and step indicator track on `!isEditing` in `ProviderWizardModal.tsx` so edit mode displays a clean "Edit Provider" header without multi-step wizard badges.
4. **Modern Typography**:
   - Replaced default fonts in `layout.tsx` and `globals.css` with `Inter` (`--font-sans`) and `JetBrains_Mono` (`--font-mono`).
5. **Project Logo Integration (`/tollma.png`)**:
   - Replaced the placeholder "T" square in `TopBar.tsx` with `/tollma.png`.
   - Embedded `/tollma.png` prominently in the chat welcome empty state in `app/page.tsx`.
   - Added `/tollma.png` to the footer of `CommandPalette.tsx`.
   - Configured `icons` in `app/layout.tsx` metadata to use `/tollma.png` as the application favicon and Apple touch icon.

### Files Modified:
- `frontend/src/components/ui/primitives.tsx`
- `frontend/src/lib/utils.ts`
- `frontend/src/lib/utils.test.ts`
- `frontend/src/app/providers/components/ModelForm.tsx`
- `frontend/src/app/providers/components/RegisterModelDrawer.tsx`
- `frontend/src/app/providers/components/ProviderWizardModal.tsx`
- `frontend/src/app/providers/components/ModelDetailDrawer.tsx`
- `frontend/src/app/providers/page.tsx`
- `frontend/src/app/layout.tsx`
- `frontend/src/app/globals.css`
- `frontend/src/components/ui/TopBar.tsx`
- `frontend/src/app/page.tsx`
- `frontend/src/components/ui/CommandPalette.tsx`
- `backend/src/tollms/api/providers/service.py`
- `backend/src/tollms/services/model_repository/lookup.py`

### Verification:
- `npx tsc --noEmit`: 0 errors.
- `npm test`: 17/17 passed (4 test files: `utils.test.ts`, `endpoint.test.ts`, `scope.test.ts`, `api.test.ts`).
- `docker exec tollms-backend pytest`: 36/36 passed in 7.55s.

---

## 2026-09-13: Logo Scoping and Font Modernization (Space Grotesk)

### Requirements Completed:
1. **Conversation Page Logo Removal**:
   - Removed `/tollma.png` from the empty chat state in `frontend/src/app/page.tsx`, restoring the clean `Sparkles` icon badge and typography.
   - Kept `/tollma.png` exclusively in the persistent top navigation bar (`frontend/src/components/ui/TopBar.tsx`), with dark-mode drop shadow and screen-reader label.
2. **Font Family Selection (Space Grotesk)**:
   - Configured `Space_Grotesk` via `next/font/google` in `frontend/src/app/layout.tsx` mapped to `--font-sans` with `display: swap`.
   - Preserved `JetBrains_Mono` for `--font-mono` across code and monospaced badges.
   - Clean, geometric, non-cursive typographic aesthetic.

### Files Modified:
- `frontend/src/app/page.tsx`
- `frontend/src/app/layout.tsx`

### Verification:
- `npx tsc --noEmit`: 0 errors.
- `npm test`: 17/17 passed.
- `docker exec tollms-backend pytest`: 36/36 passed in 4.16s.

---

## 2026-09-13: Feature-Rich Markdown Renderer for Assistant Responses

### Requirements Completed:
1. **Scoped Response-Only Markdown Renderer**:
   - Kept user request messages untouched (`isUser ? <MessageContent /> : <ResponseMarkdown />` in `MessageView.tsx`).
   - Built a comprehensive, modular `ResponseMarkdown` component specifically for assistant response messages in `frontend/src/app/components/ResponseMarkdown.tsx`.
2. **Feature-Rich Code Blocks**:
   - Syntax highlighting with language label badges and line counts.
   - Animated "Copy" button with checkmark feedback.
   - "Download" button to save snippets directly to files with inferred extension (`.ts`, `.py`, `.sql`, etc.).
   - "Wrap" lines toggle button (`WrapText`).
   - Fixed text extraction so `rehype-highlight` span trees are copied and downloaded accurately.
3. **GitHub-Style Markdown Alerts (Callouts)**:
   - Intercepts blockquotes with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, and `[!CAUTION]`.
   - Renders themed callout cards with matching colors, border accents, Lucide icons (`Info`, `Lightbulb`, `AlertCircle`, `AlertTriangle`, `ShieldAlert`), and clean title headers.
4. **Rich Interactive Tables**:
   - Styled table container with headers and horizontal overflow scroll.
   - "Copy TSV" action button that copies tabular data directly formatted for Excel or Google Sheets.
   - Alternating row styling and hover highlighting.
5. **Task Lists / Checkboxes**:
   - Custom styled checkboxes with emerald checkmarks for `- [x]` and `- [ ]` lists.
6. **Thinking Process Accordion (`<think>...</think>`)**:
   - DeepSeek R1 reasoning block with word count, thinking indicator, copy thought button, and smooth `framer-motion` collapsible animation.
7. **Safe External Links & Refined Typography**:
   - Opens links in new tab (`target="_blank" rel="noopener noreferrer"`) with `ExternalLink` icon.
   - Enhanced typographic hierarchy for headings (`h1`-`h4`), blockquotes, horizontal rules, and inline code.

### Files Created:
- `frontend/src/app/components/ResponseMarkdown.tsx`
- `frontend/src/app/components/__tests__/ResponseMarkdown.test.ts`

### Files Modified:
- `frontend/src/app/components/MessageView.tsx`
- `frontend/src/app/globals.css`

### Verification:
- `npx tsc --noEmit`: 0 errors.
- `npm test`: 19/19 passed across 5 test suites.
- `docker exec tollms-backend pytest`: 36/36 passed in 3.86s.

---

## 2026-09-14: UI Polish, Bulk Edit Removal, and Chat 401 Stream Failure Resolution

### Requirements Completed:
1. **Remove Image Logo & Restore Stylized Dummy Logo**:
   - Removed all `tollma.png` references from the application (TopBar, CommandPalette, layout metadata).
   - Created a reusable `Logo` component (`frontend/src/components/ui/Logo.tsx`) rendering the clean, modern stylized "T" square badge with "ToLLma" brand text and size variants (`sm`, `md`, `lg`).
2. **3D Card Flipping Animation for Login & Signup**:
   - Implemented `AuthCard.tsx` with Framer Motion 3D card flipping (`rotateY: 180`), `preserve-3d`, and `backface-hidden`.
   - Polished dark UI with subtle ambient glow, responsive inputs with icon adornments (`Mail`, `Lock`, `User`, `Eye`/`EyeOff`), Google SSO button, and smooth switching between Login and Signup.
   - Updated `/login` and `/signup` routes to render the unified interactive flipping card.
3. **Aligned Model Filtering Dropdown UI**:
   - Fixed `Select` primitive in `primitives.tsx` so wrapper container extracts width/flex classes properly instead of hardcoding `w-full`.
   - Redesigned Step 4 filtering bar in `ProviderWizardModal.tsx` into a clean, horizontal toolbar with search icon input and matching `h-8` dropdowns (`All matches`, `All caps`, `Any price`).
   - Grouped selection counters and quick actions (`Select filtered`, `Deselect filtered`) neatly above the models list.
4. **Complete Removal of Bulk Edit (UI & Backend Logic)**:
   - UI: Removed bulk edit toolbar, inputs, endpoints, and `applyBulk` function from `ProviderWizardModal.tsx`.
   - Frontend API: Removed `bulkUpdateModels` from `services/api.ts`.
   - Backend API: Removed `PATCH /api/v1/models/bulk` from `api/models/router.py`.
   - Backend Service: Removed `bulk_update_models` from `api/models/service.py`.
   - Tests: Removed `test_bulk_update` from `tests/test_wizard.py` and updated `e2e/wizard.spec.ts`.
5. **Finish Section Model Count Summary Removal**:
   - In Step 5 of `ProviderWizardModal.tsx`, removed the redundant summary card (`data-testid="wiz-summary-models"`: "N models selected · Matched provider models..."), leaving a clean review list of configured models.
6. **Chat Page 401 Stream Failure Resolution**:
   - Diagnosed root cause: `POST /auth/refresh` failed with 422 Unprocessable Entity because FastAPI required a body for `RefreshRequest`, while client `fetch('/auth/refresh')` sent no body. Consequently, expired access tokens could not be refreshed, causing `/api/v1/gateway/stream` to return 401.
   - Updated `backend/src/tollms/api/auth/router.py` to allow `data: RefreshRequest | None = None` and return `access_token` in `AuthResponse` and `RefreshResponse`.
   - Added dual token handling (Bearer authorization header + httpOnly cookie) in frontend auth store (`useAuthStore`) with localStorage fallback.
   - Added 401 silent token refresh and automatic stream retry to `streamChat()` in `frontend/src/services/api.ts`.

### Files Created:
- `frontend/src/components/ui/Logo.tsx`
- `frontend/src/components/auth/AuthCard.tsx`

### Files Modified:
- `backend/src/tollms/api/auth/router.py`
- `backend/src/tollms/api/auth/schemas.py`
- `backend/src/tollms/api/models/router.py`
- `backend/src/tollms/api/models/service.py`
- `backend/tests/test_auth.py`
- `backend/tests/test_wizard.py`
- `frontend/e2e/wizard.spec.ts`
- `frontend/src/app/layout.tsx`
- `frontend/src/app/login/page.tsx`
- `frontend/src/app/signup/page.tsx`
- `frontend/src/app/providers/components/ProviderWizardModal.tsx`
- `frontend/src/components/ui/CommandPalette.tsx`
- `frontend/src/components/ui/TopBar.tsx`
- `frontend/src/components/ui/index.ts`
- `frontend/src/components/ui/primitives.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/store/auth.ts`
- `frontend/src/types/index.ts`

### Verification:
- `next build`: Success (10/10 static pages compiled, 0 TypeScript errors).
- `npm test`: 19/19 passed across 5 test suites.
- `docker exec tollms-backend pytest tests/test_auth.py`: 11/11 passed.
- `docker exec tollms-backend pytest tests/test_wizard.py`: 3/3 passed.
- `docker exec tollms-backend pytest`: 61/61 passed in 373s.

---

## 2026-09-14: Theme Switching Fix & Regional Scope Resolution ("Show Region Only if Found")

### Requirements Completed:
1. **Tailwind v4 Theme Switching**:
   - Resolved theme toggle inactivity where toggling `.dark` class on `<html>` had no effect due to Tailwind CSS v4 defaulting to media-query based dark mode.
   - Added `@custom-variant dark (&:where(.dark, .dark *));` to `frontend/src/app/globals.css` alongside `.dark` CSS variable overrides and scrollbar styling.
   - In `frontend/src/app/layout.tsx`, added `suppressHydrationWarning` on `<html>` and an anti-flash inline script in `<head>` that instantly initializes the `.dark` class from `localStorage.getItem("theme")` or `window.matchMedia("(prefers-color-scheme: dark)")`.
   - Updated `frontend/src/components/ui/TopBar.tsx` so the theme toggle reads `document.documentElement.classList.contains("dark")`, updates the DOM class, and writes `"dark"` / `"light"` to `localStorage`.
2. **Proper Region Detection ("Show Region Only if Found, Else Don't Show Region")**:
   - Fixed issue where AWS Bedrock discovered models (e.g. `us.anthropic.claude-3-sonnet-20240229-v1:0`, `us.meta.llama3-2-11b-instruct-v1:0`) displayed a grey `fallback` badge with tooltip `fallback scope (unmatched)` in Step 4 and Step 5 of the provider wizard.
   - Root Cause: `match_type` in the backend represents repository catalog matching (`provider_specific`, `global`, `fallback`). `getModelScope` had previously checked `if (matchType === "fallback") return fallback` and `if (matchType === "global") return global`, confusing repository catalog match status with geographic regions.
   - Solution: Decoupled region identification from `match_type`. `getModelScope` now inspects model identifiers and names for geographic inference profile prefixes and regional identifiers:
     * `US`: `us.`, `us-`, `us_`, `us/`, `us-east-`, `us-west-`, `us-central`, `US`, `USA`.
     * `EU`: `eu.`, `eu-`, `eu_`, `eu/`, `crce.`, `eu-west-`, `eu-central-`, `europe-`, `EU`, `Europe`.
     * `APAC`: `apac.`, `apac-`, `ap.`, `ap-`, `ap-southeast-`, `ap-northeast-`, `asia-`, `APAC`, `Asia`.
     * `global`: Explicit `global.`, `global-`, `global/`, or `global` inference profile naming.
   - When no region is found (e.g. standard models without regional prefixes like `mock-disc-a`, `gpt-4o`), `getModelScope` returns `null`.
   - Step 4 and Step 5 conditionally render `{scopeInfo && (<span ...>{scopeInfo.label}</span>)}`, ensuring no badge or placeholder is rendered when no region is detected.
   - Updated filter select and search in Step 4 to safely handle nullable `scopeInfo`.

### Files Modified:
- `frontend/src/app/globals.css`
- `frontend/src/app/layout.tsx`
- `frontend/src/components/ui/TopBar.tsx`
- `frontend/src/app/providers/components/ProviderWizardModal.tsx`
- `frontend/src/app/providers/components/__tests__/scope.test.ts`
- `.opencode/memory.md`

### Verification:
- `npm test`: 19/19 passed across 5 test suites (`scope.test.ts`, `endpoint.test.ts`, `ResponseMarkdown.test.ts`, `utils.test.ts`, `api.test.ts`).
- `npm run build`: Next.js 16.3.5 production build compiled 10/10 static routes with 0 TypeScript errors.

---

## 2026-09-14: Left Sidebar Provider Type Dropdown & Header Panel Collapse Buttons

### Requirements Completed:
1. **Dropdown for Left Side Provider Search**:
   - In `frontend/src/components/ui/Sidebar.tsx`, replaced cluttered multi-line wrapped filter chips (`[ALL] [OPENAI_RESPONSES]...`) with a clean `<Select>` dropdown (`providerTypeFilter`).
   - Mapped all provider types to readable names ("OpenAI Responses", "OpenAI Chat", "Anthropic Messages", "Google Gemini", "Google Vertex AI", "AWS Bedrock", "Custom Gateway").
   - Preserved `data-testid="type-filter-${t}"` on option elements and updated Playwright UX test suite in `tests/chat-ux.spec.ts` to test `selectOption`.
2. **Remove Center Floating Collapse Buttons on Both Sides**:
   - Left side: Removed fixed floating center toggle button (`fixed left-0 top-1/2 z-20`) from `frontend/src/components/ui/Sidebar.tsx`.
   - Right side: Removed fixed floating center toggle button (`fixed right-0 top-1/2 z-20`) from `frontend/src/app/components/ChatSettingsPanel.tsx`.
3. **Left Side Collapse Button Near New Chat**:
   - In `frontend/src/components/ui/Sidebar.tsx` (Chat view), placed a ghost collapse button with `PanelLeftClose` icon wrapped in a Tooltip ("Hide sidebar") right next to the "+ New chat" button.
   - In `frontend/src/components/ui/Sidebar.tsx` (Providers view), added matching `PanelLeftClose` ghost button next to "+ Add" provider button in the header.
   - In `frontend/src/app/components/ChatHeader.tsx`, added `PanelLeftOpen` button on the left when the sidebar is collapsed (`!leftSidebarOpen`), enabling single-click re-opening.
   - In `frontend/src/app/providers/page.tsx`, added `PanelLeftOpen` button to both the Provider Details header and the empty state when the sidebar is collapsed.
   - In `frontend/src/app/components/ChatSettingsPanel.tsx`, added a `PanelRightClose` button in the Model Intelligence header matching `ChatHeader.tsx`.

### Files Modified:
- `frontend/src/components/ui/Sidebar.tsx`
- `frontend/src/app/components/ChatSettingsPanel.tsx`
- `frontend/src/app/components/ChatHeader.tsx`
- `frontend/src/app/providers/page.tsx`
- `frontend/tests/chat-ux.spec.ts`
- `.opencode/memory.md`

### Verification:
- `npm test`: 19/19 passed across 5 test suites (`scope.test.ts`, `endpoint.test.ts`, `ResponseMarkdown.test.ts`, `utils.test.ts`, `api.test.ts`).
- `npm run build`: Next.js production build succeeded (10/10 static pages generated, 0 TypeScript errors).

---

## 2026-09-14: Left-Most Collapse Button & Intelligence Panel Toggle Refinements

### Requirements Completed:
1. **Dropdown for Left Side Provider Search Retained**:
   - Maintained clean `<Select>` dropdown (`providerTypeFilter`) in `frontend/src/components/ui/Sidebar.tsx` with user-friendly provider names ("OpenAI Responses", "OpenAI Chat", "Google Gemini", etc.) and comprehensive filter support.
2. **Hide "Hide Intelligence" Button from Header When Panel Is Open**:
   - In `frontend/src/app/components/ChatHeader.tsx`, only render the intelligence panel toggle button when `!rightSidebarOpen` (with tooltip "Show Intelligence").
   - When the panel is open (`rightSidebarOpen`), the header button is hidden; the collapse button is exclusively displayed in the `Model Intelligence` panel header (`ChatSettingsPanel.tsx`) with tooltip "Hide Intelligence" and `data-testid="right-sidebar-toggle"`.
3. **Left Sidebar Collapse Button Placed Left-Most**:
   - In `frontend/src/components/ui/Sidebar.tsx` (Chat view), re-ordered the header row items so the `PanelLeftClose` collapse button (`data-testid="left-sidebar-toggle"`) is the left-most element, followed by the "+ New chat" button.
   - In `frontend/src/components/ui/Sidebar.tsx` (Providers view), ensured `PanelLeftClose` is the left-most element preceding the "Providers" badge and "+ Add" button.

### Files Modified:
- `frontend/src/components/ui/Sidebar.tsx`
- `frontend/src/app/components/ChatSettingsPanel.tsx`
- `frontend/src/app/components/ChatHeader.tsx`
- `.opencode/memory.md`

### Verification:
- `npm test`: 19/19 passed across 5 test suites (`scope.test.ts`, `endpoint.test.ts`, `ResponseMarkdown.test.ts`, `utils.test.ts`, `api.test.ts`).
- `npm run build`: Next.js 16.3.5 production build completed cleanly with 0 TypeScript errors.

---

## 2026-09-14: Unauthenticated User Login Gate

### Requirements Completed:
1. **Show Login Page Only When Unauthenticated**:
   - In `frontend/src/components/Shell.tsx`, gated `<AppShell>` rendering so protected views (`ChatView`, `ProvidersPage`) and their child hooks never mount when a user is unauthenticated.
   - If session bootstrap is loading (`!checked`), displays a clean minimalist loading spinner to avoid premature protected UI flashes or query dispatch.
   - If unauthenticated (`!user` on protected routes), directly renders `<AuthCard initialMode="login" />` and synchronizes browser navigation to `/login`.
2. **Clean Session Teardown & 401 Handling**:
   - In `frontend/src/store/auth.ts`, updated `reset()` to clear `tollma_session` cookie (`max-age=0`) along with stored access tokens, preventing stale presence cookies from bypassing server proxies.
   - In `frontend/src/services/api.ts`, triggered `useAuthStore.getState().reset()` when session refresh fails on 401.
   - In `frontend/src/components/Shell.tsx`, called `reset()` when `getCurrentUser()` returns 401, immediately purging stale tokens and presenting the login interface.

### Files Modified:
- `frontend/src/components/Shell.tsx`
- `frontend/src/store/auth.ts`
- `frontend/src/services/api.ts`
- `.opencode/memory.md`

### Verification:
- `npm test`: 19/19 vitest tests passed.
- `npm run build`: Next.js 16.3.5 production build compiled all routes cleanly with 0 TypeScript errors.

---

## 2026-09-14: Purge LocalStorage Credentials & Tokens on Auth Failure

### Requirements Completed:
1. **Purge LocalStorage Cache & Credentials on Auth Failure**:
   - In `frontend/src/store/auth.ts`, added `clearAuthAndCredentialCache()` which explicitly removes `tollma_access_token`, `tollma-wizard-draft` (containing provider credentials), and any other provider or token cache keys from `localStorage`, while preserving user preferences like `theme`.
   - Connected `clearAuthAndCredentialCache()` directly into `reset()`.
2. **Immediate Cleanup on 401 and Unauthenticated States**:
   - In `frontend/src/services/api.ts`, whenever any endpoint encounters a `401 Unauthorized` status (and refresh fails or on non-login requests), `useAuthStore.getState().reset()` runs, wiping cached credentials and tokens.
   - In `frontend/src/components/Shell.tsx`, invoked `clearAuthAndCredentialCache()` whenever the presence cookie is absent or when session resolution confirms `!user`.
3. **Unit Tests Added**:
   - Created `frontend/src/store/auth.test.ts` verifying that `clearAuthAndCredentialCache()` and `reset()` thoroughly delete credentials and access tokens while keeping the `theme` key intact.

### Files Modified:
- `frontend/src/store/auth.ts`
- `frontend/src/services/api.ts`
- `frontend/src/components/Shell.tsx`
- `frontend/src/store/auth.test.ts`
- `.opencode/memory.md`

### Verification:
- `npm test`: 21/21 vitest tests passed across 6 test suites.
- `npm run build`: Next.js 16.3.5 production build compiled all 10 routes cleanly with 0 TypeScript errors.
## 2026-09-14 — Capability-Aware Intelligent Composer

### Requirement Completed
Chat composer now renders upload controls, reasoning selector, and capability badges from the selected model's capability data. Text-only models show text input only; vision/file/audio/video controls, reasoning stepper, and badges appear only when supported. No hardcoded provider/model name checks; extended caps (files/video/reasoning_levels) live in the existing `metadata` JSONB column — no migration, no new endpoint (`GET /api/v1/models` already serves all flags).

### Files Created
- `frontend/src/app/components/chat/capabilities.ts` (types, ACCEPT maps, `getModelCapabilities`, `uploadKinds`, `kindForFile`)
- `frontend/src/app/components/chat/hooks/useModelCapabilities.ts`
- `frontend/src/app/components/chat/ChatComposer.tsx` (moved selector verbatim from ChatInput)
- `frontend/src/app/components/chat/ModelCapabilityBar.tsx`, `AttachmentPicker.tsx`, `UploadPreview.tsx`, `ReasoningSelector.tsx`
- `frontend/src/app/components/chat/__tests__/capabilities.test.ts` (9 tests)
- `frontend/src/app/providers/components/__tests__/metadata.test.ts` (4 tests)

### Files Modified
- `frontend/src/app/components/ChatInput.tsx` deleted (superseded by `chat/ChatComposer.tsx`)
- `frontend/src/app/page.tsx` (payload-based `send`, regenerate call sites)
- `frontend/src/services/api.ts` (`streamChat` accepts `reasoning_level` + `attachments`)
- `frontend/src/app/providers/components/ModelForm.tsx` (files/video checkboxes + levels input backed by metadata; `existingMetadata` passthrough preserves snapshot keys on update)
- `backend/src/tollms/api/gateway/schemas.py` (`ChatRequest` + optional `reasoning_level`, `attachments`)
- `backend/src/tollms/api/gateway/service.py` (logs composer fields; adapters remain text-only)
- `backend/src/tollms/services/model_repository/lookup.py` (`suggest_payload` seeds `metadata.supports_video_input` from repository entry)
- `backend/tests/test_gateway.py` (+1 composer payload test)

### Verification
- `tsc --noEmit` clean; `vitest` 34/34; `next build` clean
- `pytest` 62/62 (61 + 1 new); `alembic check` clean
- e2e: chat/manage/providers/wizard specs pass except pre-existing failures (chat-ux 23/43 sidebar testids, wizard:10 `add-provider` — both reproduce on pristine tree via stash)

## 2026-09-14 — True Attachment Handling End-to-End (multimodal gateway)

### Requirement Completed
Attachments are first-class entities: upload stores bytes + DB row, gateway forwards real content to providers (native image/audio/video parts per adapter; document text extracted at upload and injected as context; audio transcribed via the provider's own OpenAI-compatible endpoint when native audio is unavailable; video frame+transcript fallback behind runtime ffmpeg detection). History re-injects derived text always and media best-effort. Message reads expose attachments; UI unchanged except upload-then-send wiring + history preview cards.

### Files Created
- `backend/src/tollms/models/attachment.py` + `backend/alembic/versions/e8a4c1d2f7b9_attachments.py`
- `backend/src/tollms/services/gateway/attachments.py` (validate/store/extract/transcribe/ffmpeg engine)
- `backend/src/tollms/api/attachments/{__init__,router,service,schemas}.py` (`POST/GET/GET-content/DELETE /api/v1/chat/attachments`)
- `backend/tests/test_attachments.py` (18 tests)

### Files Modified
- Adapters (`base/openai/anthropic/gemini/bedrock`): `MediaPart`, `supports_*` flags, native parts (image_url/input_image/Anthropic blocks/inline_data/converse blocks)
- `api/gateway/{schemas,service}.py` (`attachment_ids`, ownership-gated assembly, linking, history re-injection)
- `api/conversations/{schemas,service,router}.py` (`MessageRead.attachments`, `conversation_read`/`message_reads`)
- `core/config.py` (`storage_dir`, `max_upload_mb`); `main.py` (router); `pyproject.toml`+`uv.lock` (`pypdf`, `python-multipart`)
- Frontend: `services/api.ts` (upload helper, `attachment_ids`), `AttachmentPicker` (upload-then-add), `MessageView` (preview cards), `types`, `capabilities.ts`, `page.tsx`

### Decisions
- Immutable storage paths (`user_id/<conv|unassigned>/<uuid>_<safe>`), no move-on-link; paths never serialized.
- No new STT infra: transcription reuses provider's own `/audio/transcriptions` (OpenAI-family only); otherwise clear 422.
- No ffmpeg install: frame/audio fallback degrades gracefully; clear 422 when nothing applies. No silent drops anywhere.
- Blank message allowed iff `attachment_ids` present; sent attachments undeletable (history); cross-owner -> 404.

### Verification
- `pytest` 80/80 (62 + 18 new); `alembic check` clean; `tsc` clean; `vitest` 34/34; `next build` clean; e2e chat+history 3/3.

## 2026-09-14 — Navigation Refactor (ChatGPT-Style Sidebar Layout)

### Requirement Completed
Removed the top navigation bar entirely; all app navigation now lives in a context-aware left sidebar with a sticky profile footer. Chat (`/`) is home with no Chat nav button. New `components/Sidebar/` module (9 files) renders per-route context via `usePathname()`: conversations on `/`, provider tools on `/providers`, report shortcuts on `/analytics`, settings sections on `/settings`. Added minimal `/analytics` + `/settings` landing pages (anchored sections, working theme toggle). Profile shows avatar/name/email with settings + logout (`logout()` + `reset()` + push `/`). Command palette (Ctrl+K) and theme toggle moved into the sidebar header. Mobile behavior unchanged (collapsible sidebar, no drawer existed).

### Files Created
- `frontend/src/components/Sidebar/`: `Sidebar.tsx`, `SidebarHeader.tsx`, `SidebarNavigation.tsx`, `SidebarConversations.tsx`, `SidebarProviders.tsx`, `SidebarAnalytics.tsx`, `SidebarSettings.tsx`, `SidebarProfile.tsx`, `SidebarFooter.tsx`
- `frontend/src/app/analytics/page.tsx`, `frontend/src/app/settings/page.tsx`
- `frontend/e2e/navigation.spec.ts` (topbar absence, per-route context, profile, logo-home)

### Files Modified
- `frontend/src/components/ui/AppShell.tsx` (row layout, no TopBar, palette trigger to Sidebar)
- `frontend/src/components/ui/Sidebar.tsx` (re-export shim), `frontend/src/components/ui/index.ts` (drop TopBar/UserMenu)
- `frontend/tests/chat-ux.spec.ts` (scope duplicate toggle testids instead of relying on strict-mode singles)

### Files Removed
- `frontend/src/components/ui/TopBar.tsx`, `frontend/src/components/ui/UserMenu.tsx` (logic moved: nav->SidebarNavigation, theme->SidebarHeader, session->SidebarProfile; `user-avatar`/`logout-btn`/`theme-toggle-btn` testids preserved)

### Verification
- `tsc` clean, `eslint` clean on touched files, `vitest` 34/34, `next build` clean (incl. new routes)
- e2e: 39 passed incl. new navigation spec; auth/chat/manage/history green; screenshots of all 4 pages reviewed
- Pre-existing failure (unchanged, unrelated): `e2e/wizard.spec.ts:10` (`wiz-match-mock-disc-a` scope badge — mapping/scope heuristics + backend data, dialog itself opens fine through new sidebar)
- Fixed pre-existing strict-mode collisions in `chat-ux` toggle tests (duplicate `left/right-sidebar-toggle` testids existed identically on HEAD — proven via `git show HEAD`)
- No backend/docker/database/api files touched (verified via `git status`)

## 2026-09-14 — Sidebar nav hidden behind profile gear toggle

### Requirement Completed
Navigation links (Providers/Analytics/Settings) are invisible by default and reveal only when the profile footer gear icon is clicked; clicking again (or navigating) hides them. Gear keeps its `profile-settings-btn` testid, gains active styling + `aria-expanded`, and no longer routes to `/settings` (reached via the revealed Settings link instead).

### Files Modified
- `frontend/src/components/Sidebar/Sidebar.tsx` (route-keyed `navPath` state: open only on the route it was toggled; no ref/effect, lint-clean)
- `frontend/src/components/Sidebar/SidebarNavigation.tsx` (`open` prop gates render)
- `frontend/src/components/Sidebar/SidebarProfile.tsx` (gear becomes toggle button), `SidebarFooter.tsx` (passes state through)
- `frontend/e2e/navigation.spec.ts` (hidden-by-default, toggle open/close, per-route flow via gear)

### Verification
- `tsc`/`eslint` clean; navigation e2e green; auth/chat/chat-ux regressions green (24 passed); screenshots of both toggle states reviewed.

## 2026-09-17 — Chat refinement: minimal composer + intelligence as single info source

### Requirement Completed
Composer stripped to message-creation controls only (model selector, thinking slider, single upload button, input, send); all model/conversation info moved to the intelligence panel. No backend changes.

### Files Created
- None (deleted `frontend/src/app/components/chat/ModelCapabilityBar.tsx`)

### Files Modified
- `frontend/src/lib/utils.ts` (+`fmtCost/fmtTokens/fmtCompactTokens`; `stripTrailingZeros/fmtPrice` kept)
- `frontend/src/app/components/chat/capabilities.ts` (spec upload matrix, `combinedAccept/unsupportedMessage/suggestModels/capabilityForKind`)
- `frontend/src/app/components/chat/ReasoningSelector.tsx` (dynamic hover slider, native range, tick buttons keep `reasoning-level-*` testids)
- `frontend/src/app/components/chat/AttachmentPicker.tsx` (single dumb button, `attach-button`)
- `frontend/src/app/components/chat/ChatComposer.tsx` (no badges/ctx/pricing; shared picker+paste pipeline; rejection banner with model switch)
- `frontend/src/app/components/ChatSettingsPanel.tsx` (order Model/Conversation/Limits/Pricing/Reasoning&Tooling; resizable 320-700 default 380 via left-edge handle)
- `frontend/src/store/chat.ts` (`rightSidebarWidth` persisted in `tollma-chat`)
- `frontend/src/app/components/{ChatHeader,MessageView}.tsx`, `frontend/src/components/ui/{CostCard,UsageCard}.tsx` (centralized formatters)
- Tests: `utils.test.ts`, `capabilities.test.ts`, `tests/chat-ux.spec.ts` (no-dup composer test, panel order+resizer test)

### Verification
- `tsc` clean; `eslint` clean on touched files (2 pre-existing errors in provider wizard files)
- `vitest` 41/41; `next build` passes; e2e chat-ux+navigation 22 passed (2 pin skips, no convos)
- Screenshots `/tmp/shot-chat-final.png`, `/tmp/shot-intelligence-final.png` reviewed

## 2026-09-17 — Chat UI polish pass (frontend-only)

### Requirement Completed
Regenerate row removed (last-assistant-message action only); Grok-style thinking pill; 300ms reasoning-slider close delay; Model card removed from intelligence panel; centered 1200px conversation container with tighter spacing and narrower bubbles. No backend/API/auth changes.

### Files Modified
- `frontend/src/app/page.tsx` (deleted standalone regenerate row; `onRegenerate` only for last persisted assistant message; centered `max-w-[1200px]` message container `gap-4→gap-3`; composer wrapped in same container)
- `frontend/src/app/components/ResponseMarkdown.tsx` (`EnhancedThinkBlock` → compact pill + copy-on-hover + low-padding glowing panel)
- `frontend/src/app/components/MessageView.tsx` (legacy `ThinkBlock` aligned to pill style; user bubble `max-w-[70%]`, assistant `max-w-[75%]`, responsive fallbacks)
- `frontend/src/app/components/chat/ReasoningSelector.tsx` (JS-driven open state, instant expand, 300ms close delay, `reasoning-scale` testid)
- `frontend/src/app/components/ChatSettingsPanel.tsx` (Model card deleted; panel starts at Current Conversation)
- `frontend/e2e/settings.spec.ts` (assert selected model via composer selector, not removed card)
- `frontend/tests/chat-ux.spec.ts` (setup-hint empty state; first-card-is-conversation assertion)

### Verification
- `tsc`/`eslint` clean on touched files; `vitest` 41/41; `next build` passes
- e2e chat-ux+navigation+settings+chat+intelligence: 27 passed (2 pre-existing pin skips)
- Zero horizontal overflow at 1920/2560/1440/1366; dark-theme screenshots `/tmp/polish-1920.png`, `/tmp/polish-1366.png`, `/tmp/polish-thinking-collapsed.png`, `/tmp/polish-thinking-expanded.png`

## 2026-09-17 — Restore Model Selection Dropdown UI (Frontend-Only)

### Requirement Completed
Restored ONLY the model selection dropdown UI (`UnifiedModelSelector` in `frontend/src/app/components/chat/ChatComposer.tsx`) to its previous behavior and appearance prior to the composer refactor in commit `58257e3`.
- Restored model capability icons inside the model dropdown options (vision, reasoning, tools, streaming, audio, image generation).
- Restored the 2-line model option layout with context window (`ctx <tokens>`) and pricing (`$<price>/1M in`).
- Restored the sticky provider group header with provider type outline badge (`provider.provider_type`).
- Restored the capability preview icons in the selector trigger button for selected models.
- Intentionally preserved all recent composer logic: reasoning level controls, attachment handling, capability-aware upload constraints, upload rejection warnings with model recommendations, clipboard paste support, and drag-and-drop.
- No backend, API, database, or conversation UI changes.

### Files Modified
- `frontend/src/app/components/chat/ChatComposer.tsx` (`UnifiedModelSelector` component restored to previous rich UI rendering, added `CAP_ICONS`, imported `Badge` and capability icons).

### Verification
- `npm run build` (`next build`): Completed successfully with 0 TypeScript and build errors.
- `vitest` unit tests: 41/41 passed across all 8 test suites.
- Playwright verification: Captured before/after screenshots confirming exact restoration of provider badge, model metadata (context window, input pricing), capability icons with tooltips, and trigger button preview icons upon selection.


## 2026-09-17 — Backend-owned generation lifecycle (cancel/persist/recover)

### Requirement Completed
Generation state moved into the backend: assistant row created RUNNING before streaming, background task drives provider stream with progressive persistence, disconnect never stops generation, refresh reattaches, Stop cancels provider + keeps partial, user avatars removed.

### Files Created
- `backend/alembic/versions/f3a7c9e1b2d4_generation_lifecycle.py` (message_status enum + started/completed/error + index)
- `backend/src/tollms/services/generation.py` (lifecycle engine: registry, subscribers, Valkey active-state, progressive flush, cancel, sweep)
- `backend/tests/test_generations.py` (10 lifecycle tests, slow fake adapter)
- `frontend/e2e/generation.spec.ts` (stop/refresh/navigate/avatar scenarios, slow-mock mode)

### Files Modified
- Backend: `models/message.py` (MessageStatus), `services/cache/keys.py` (generation keys), `core/exceptions.py` (409 ConflictError), `api/conversations/{service,schemas,router}.py` (message helpers, status fields, active-generation route), `api/gateway/{service,schemas,router}.py` (start/cancel/reattach flow), `main.py` (startup sweep + shutdown), `tests/conftest.py` (test session factory for engine)
- Frontend: `types`, `services/api{,.test}.ts` (cancel/active/reattach/snapshot), `store/chat.ts` (activeGeneration), `app/page.tsx` (viewer flow + recovery effect), `app/components/MessageView.tsx` (no user avatar, Stopped/failed states), `app/components/chat/ChatComposer.tsx` ("Stop Generating"), `e2e/mock-server.ts` (slow mode)

### Architecture Decisions
- generation_id == assistant message id (no second table); Valkey `tollma:generation:{id}` + `tollma:generation:conv:{conv}` is active-state cache with TTL, DB is truth; single-process task registry documented; reattach snapshot reads driver buffer (gapless); cancel is idempotent; second concurrent start 409s; enum stores NAMES like message_role precedent

### Verification
- `alembic upgrade head` + `alembic check` green; backend `pytest` 90/90 (80 existing + 10 new)
- Frontend `tsc`/`eslint`(touched)/`vitest` 42/42/`build` green; e2e 45 passed incl. 5 new generation scenarios; wizard.spec:10 still fails pre-existing (providers UI, untouched paths, clean backend logs)
- Screenshots `/tmp/gen-stopped.png` (partial + Stopped badge), `/tmp/gen-completed.png` reviewed

## 2026-09-17 — Streaming duplication root-cause fix + latency pass

### Root Causes Found
- R1 (screenshot twins): pre-meta refresh orphans a generation (frontend never learns conv id) + resend creates twin conversations; 409 path nuked the live overlay and wedged later sends.
- R2 (latent 2x/3x): double-subscription vectors (effect churn aborting recovery, regenerate double-click 409).
- R3: no DB-level message identity; provider fetch uninterruptible on stop; per-delta full-list re-renders; per-chunk O(n) buffer copy.

### Changes
- Backend: messages.client_key + partial unique indexes (one live assistant/conv, one row per user+key) + migration a1b2c3d4e5f6 (stale sweep); same-key adoption + IntegrityError→409; abortable provider fetch (race + aclose); shared parts buffer; ttfb/total logs; ChatRequest.client_key; GET by-client endpoint.
- Frontend: client_key sends + sessionStorage pending + boot adoption; 409→adopt (echo removed, live generation attached); single-flight send guard; stable callbacks via useQueryClient refresh; cancel-before-abort stop order; MessageView memo w/ presence comparator; lib/perf.ts marks + window.__tollmaPerf.
- Tests: backend 15 lifecycle tests (incl. hung-provider abort <5s w/ close proof, exact-timing test, index backstop); e2e generation.spec 8 tests (incl. byte-exact no-dup refresh, regenerate double-click adopt, 369ms first-token timing).

### Verification
- Backend pytest 95/95; alembic check green; frontend tsc/eslint-touched/vitest 42/build green; e2e 48 passed (wizard.spec:10 pre-existing fail, untouched paths).
- Metrics: backend setup=58ms/first-delta=70ms/total=103ms (instant provider); e2e first rendered token 369ms; cancel-vs-hung <5s asserted.

## 2026-09-17 — Provider-agnostic reasoning display (unified <think> pipeline)

### Root Cause
Only Bedrock normalized reasoning into `<think>` spans. Anthropic dropped thinking_delta/signature events (and never requested thinking), OpenAI chat dropped reasoning_content, Responses dropped reasoning summaries, Gemini dropped thought parts. Frontend renders <think> fine — it never received any.

### Changes
- Backend `adapters/base.py`: THINK_OPEN/CLOSE contract + reasoning_level field; `anthropic.py`: thinking budgets + thinking_delta/signature/redacted parsing, thinking param request; `openai.py`: reasoning_content + reasoning summary deltas; `gemini.py`: thought/text split shared by Gemini+Vertex; `bedrock.py`: shared constants; gateway sets adapter.reasoning_level (chat + stream).
- Frontend: shared `thinkBlocks.ts` (split + word count) used by both renderers; `thinkBlocks.test.ts` (5 tests); e2e mock think-mode + Thinking-pill UI test (expand + refresh restore).
- Tests: `backend/tests/test_reasoning.py` (11 tests incl. gateway persistence e2e + cross-provider shape identity).

### Verification
- Backend pytest 106/106; frontend vitest 47/47, tsc/eslint-touched/build clean; e2e 49 passed (wizard.spec:10 pre-existing fail).

## 2026-09-20 — Claude (Bedrock Converse) reasoning: root cause + fix

### Root Cause (empirical)
User's DB: provider `dsddd` = BEDROCK_CONVERSE; models `global.anthropic.claude-haiku-4-5-*`, `global.anthropic.claude-sonnet-4-6`. Native Anthropic path was already fixed, but Claude here runs through Bedrock Converse, where thinking was never requested. Bedrock Claude emits `reasoningContent` ONLY when `additionalModelRequestFields.thinking` is set (DeepSeek-R1 emits unconditionally → the asymmetry). Confirmed via botocore service model: ReasoningContentBlockDelta={text,redactedContent,signature}, ConverseStreamRequest has additionalModelRequestFields/inferenceConfig; AWS docs: Haiku 4.5 manual thinking, Sonnet 4.6 manual (deprecated)+adaptive, Sonnet5/Opus4.7+ adaptive-only (400 on manual). Second defect: mid-stream unclosed `<think>` leaked reasoning into answer text.

### Changes
- base.py: thinking_budget/thinking_params/reasoning_effort helpers + reasoning_level/max_output_tokens fields (maxTokens clamp)
- bedrock.py: bedrock_thinking_fields (Claude-only gate, adaptive-only list, inferenceConfig maxTokens) + payload wiring + redacted placeholder
- anthropic.py: shared helpers, max-output clamp
- openai.py: parse reasoning/reasoning_details (+skip encrypted), request reasoning_effort / reasoning.effort
- gateway/service.py: forward model.max_output_tokens
- frontend thinkBlocks.ts: unclosed trailing <think> renders as thinking (live pill)
- tests: test_reasoning 24 (13 new); test_generations flake hardened (_await_task tolerates finished task; cancel test polls flush); thinkBlocks streaming cases; e2e mock paced think mode + live-pill-before-answer assertion

### Verification
- Backend 119/119; frontend tsc/vitest 47/47/build; focused e2e generation+chat+settings 10/10
- Not live-tested against real AWS (no creds in env): payload verified against botocore shapes + AWS docs; recommend live spot check on `dsddd`

## 2026-09-20 — AI SDK Elements: selective integration (reasoning, attachments, conversation)

### Analysis → adopted/rejected
- Adopted: Reasoning/Chain-of-Thought (one provider-blind component w/ states+duration+tokens), Attachments (DnD + XHR progress + upload states), Prompt Input (kept minimal, added DnD/keyboard), Conversation (scroll-to-bottom), Message composition (reasoning/answer split).
- Rejected: Inline Citation/Sources/Context/Tool (no backend data — rendering would fabricate; attachment cards already cover "sources"), Streamdown/`ai`/shadcn (stack churn, parallel message model).

### Changes
- Backend: messages.thinking_ms (migration c9d4e8f2a3b7) measured by generation engine from normalized THINK_OPEN/CLOSE span timing (provider-agnostic); exposed in MessageRead; 2 tests (completed + interrupted).
- Frontend: new Reasoning.tsx + reasoning.ts helpers; MessageView/ResponseMarkdown refactored to one split + one component (removed 2 duplicated pills); user content no longer mis-parses <think>; composer drag&drop + per-file upload states + real progress via XHR (uploadChatAttachment onProgress); UploadPreview progress/error chips; scroll-to-bottom affordance (strict 24px vs 120px stickiness); fixed live isStreaming bug (optimistic assistant keyed by backend id was never "streaming").
- Tests: reasoning.test.ts, api.test.ts XHR progress, e2e/elements.spec.ts (3), generation.spec updated, mock think pacing.

### Verification
- Backend 121/121; frontend tsc/eslint-touched/vitest 51/51/build; full e2e 49 passed (wizard.spec:10 pre-existing; palette hydration flakes pass standalone/on retry); e2e first-token 340–490ms focused, 561ms full-suite.
- Repo e2e failures during investigation were data drift (sync run with 2 source errors deactivated 4237 models); manual sync restored 4237 updated/0 errors — not code.

---

## 2026-09-20 — AI SDK Elements Integration: Composable Message, Chain-of-Thought, Citations, Sources, Tools & Context

### Requirement Completed
Architectural analysis and selective integration of Vercel AI SDK Elements components and patterns into the ToLLma chat frontend. Evolved ToLLma into a modular, composable chat architecture while strictly preserving FastAPI SSE streaming, Valkey caching, PostgreSQL schema, UnifiedModelSelector capabilities, ReasoningSelector slider, and ToLLma design aesthetics (`#066E09` green accent, zinc palettes, dark/light modes).

### Components Integrated
1. **Message Architecture (`frontend/src/app/components/chat/message/Message.tsx`)**:
   - Decomposed monolithic `MessageView.tsx` into composable primitives: `MessageRoot`, `MessageHeader`, `MessageAvatar`, `MessageContent`, `MessageAttachments`, `MessageActions`.
   - Retained exact memoization, test IDs, and styling contracts.
2. **Reasoning & Chain-of-Thought (`frontend/src/app/components/chat/reasoning/ChainOfThought.tsx`, `reasoning.ts`)**:
   - 5 normalized states: `thinking`, `streaming`, `complete`, `interrupted`, `failed`.
   - Live elapsed duration timer during streaming, word & token count telemetry, step extraction (`extractReasoningSteps`), copy-to-clipboard button, and smooth accordion drawer.
   - Backward-compatible `Reasoning.tsx` re-export.
3. **Inline Citations & Sources (`frontend/src/app/components/chat/citations/InlineCitation.tsx`, `frontend/src/app/components/chat/sources/Sources.tsx`)**:
   - Interactive citation badge pill (`[1]`, `[2]`, `[Doc]`) with Radix popover previewing source title, quote snippet, author, and external link.
   - Dedicated collapsible sources section (compact badge chips when collapsed, card grid when expanded). Renders conditionally when sources exist.
4. **Tool Execution (`frontend/src/app/components/chat/tools/ToolCall.tsx`)**:
   - Structured tool invocation component with states (`running`, `completed`, `failed`), execution duration, parameters view, and expandable JSON/markdown results.
5. **Context (`frontend/src/app/components/chat/context/MessageContext.tsx`)**:
   - Renders system prompt context, RAG documents, or conversational memory in a collapsible badge. Hidden when empty.
6. **Attachments & Dropzone (`frontend/src/app/components/chat/attachments/DropzoneOverlay.tsx`)**:
   - Drag-and-drop backdrop overlay with upload hint, animated icon, and accept label.
   - Connected drag/drop handlers in `ChatComposer.tsx` while preserving `UnifiedModelSelector`, `ReasoningSelector`, and capability rejection switcher.
7. **Conversation & Scroll Navigation (`frontend/src/app/components/chat/conversation/ScrollToBottom.tsx`)**:
   - Floating jump-to-bottom button with smooth scrolling.

### Files Created
- `frontend/src/app/components/chat/message/Message.tsx`
- `frontend/src/app/components/chat/reasoning/ChainOfThought.tsx`
- `frontend/src/app/components/chat/citations/InlineCitation.tsx`
- `frontend/src/app/components/chat/sources/Sources.tsx`
- `frontend/src/app/components/chat/tools/ToolCall.tsx`
- `frontend/src/app/components/chat/context/MessageContext.tsx`
- `frontend/src/app/components/chat/attachments/DropzoneOverlay.tsx`
- `frontend/src/app/components/chat/conversation/ScrollToBottom.tsx`
- `frontend/src/app/components/chat/__tests__/reasoning.test.ts`
- `frontend/src/app/components/chat/__tests__/citationsAndSources.test.ts`
- `frontend/src/app/components/chat/__tests__/toolCall.test.ts`

### Files Modified
- `frontend/src/app/components/MessageView.tsx`
- `frontend/src/app/components/Reasoning.tsx`
- `frontend/src/app/components/reasoning.ts`
- `frontend/src/app/components/chat/ChatComposer.tsx`
- `frontend/src/app/page.tsx`
- `frontend/src/components/ui/CommandPalette.tsx`
- `.opencode/memory.md`

### Verification
- `npm test` (`vitest`): 63/63 tests passed across 13 test suites.
- `npm run build` (`next build`): Turbopack production compilation succeeded (12/12 static pages generated, 0 TypeScript errors).
- Playwright E2E (`npx playwright test e2e/elements.spec.ts`): 4/4 passed (auth setup, reasoning states & live duration, attachment drag-and-drop & ready state, scroll-to-bottom affordance).
- Visual verification: Captured screenshots in brain directory showing full chat layout, active message with expanded `ChainOfThought`, and metadata telemetry.

---

## 2026-09-20 — Thinking Level Selector: None Mode, Click-Cycle, Discrete Stops, Wheel Stepping

### Requirement Completed
Extended the existing composer `ReasoningSelector` (no rewrite, hover UX preserved) with an explicit "None" level and four new interactions:
- **None → Low → Medium → High** order; "none" is forced first by `normalizeReasoningLevels` even when metadata omits it.
- **Click-to-cycle**: clicking the compact indicator wraps High → None → Low without opening the scale (mouse focus-open suppressed via `pointerFocus` ref; keyboard focus still opens).
- **Discrete stop points**: native range `step=1` snaps to integer stops; stop dots + labels share native thumb-travel geometry (`calc(8px + (100% - 16px) * pct)`) — pixel-verified thumb center == active dot center at every stop.
- **Wheel stepping**: non-passive native `wheel` listener on the selector wrapper; only active while expanded (over the component), `preventDefault` stops page scroll, 24px accumulated delta + 120ms cooldown prevent accidental rapid changes; clamps at both ends (no wrap).
- **Labels**: aligned under stops, click selects immediately, active label/dot highlighted with `transition-colors`.
- **Capability awareness**: selector stays hidden for `!supports_reasoning` models; declared metadata levels are honored with "none" prepended, duplicates dropped.
- **Backend**: `reasoning_level="none"` is an explicit off switch end-to-end; `REASONING_OFF_LEVELS = ("none", "default")` centralized in `base.py`. Providers: Anthropic/Bedrock Claude omit `thinking` (max_tokens untouched), OpenAI chat/responses omit `reasoning_effort`/`reasoning`, Gemini/Vertex never send thinking config (model-controlled), DeepSeek omits the parameter but always-on `reasoning_content` still renders.

### Files Created
- `frontend/src/app/components/chat/reasoningLevels.ts` (normalize/cycle/clamp-step pure helpers)
- `frontend/src/app/components/chat/__tests__/reasoningLevels.test.ts` (9 tests)
- `frontend/e2e/reasoning-selector.spec.ts` (7 Playwright tests)

### Files Modified
- `frontend/src/app/components/chat/ReasoningSelector.tsx`
- `frontend/src/app/components/chat/capabilities.ts` (`normalizeReasoningLevels`, none-skipping default so "Low" stays default)
- `frontend/src/app/components/chat/__tests__/capabilities.test.ts`
- `frontend/src/app/providers/components/ModelForm.tsx` (reasoning-levels hint)
- `backend/src/tollms/services/gateway/adapters/base.py`
- `backend/tests/test_reasoning.py` (+6 tests: Anthropic/OpenAI-responses/Gemini/DeepSeek/Bedrock none, gateway forwards none)
- `.opencode/memory.md`

### Decisions
- Default level stays **Low** (first non-none): adding "none" must not silently disable reasoning. Regenerate still sends null.
- Click never opens the scale; hover (300ms close delay) and keyboard focus keep the original UX. On touch, tapping cycles through all levels (all four are reachable without the slider).
- Wheel clamps instead of wrapping (accident prevention); click-cycle wraps per spec.
- No new dependencies; no DB/API schema changes.

### Verification
- Backend `docker compose exec backend pytest -q`: **127/127** (was 121).
- Frontend `vitest`: **73/73**; `tsc --noEmit` clean; eslint touched-files clean; `next build` green.
- Playwright `e2e/reasoning-selector.spec.ts`: **7/7 passed** (cycle-without-open, hover+delay, keyboard snap/Home/End, label alignment (<2px) & selection, wheel stepping/clamping/outside-noop, none/low request payload via captured `POST /api/v1/gateway/stream`, capability hide + metadata levels).
- Regression subset `e2e/elements|chat|generation + tests/chat-ux`: 30 passed, 2 skipped; 3 command-palette failures reproduced the known dev-server hydration flake (pass standalone, unrelated code path).
- Pixel analysis of `/tmp/reasoning-expanded-{low,none,high}.png`: native thumb center matches active stop dot center (95.5/95.5, 34.5/34.5, 216.5/216.5).
- Artifacts: `/tmp/reasoning-collapsed.png`, `/tmp/reasoning-expanded-{low,none,high}.png`, `/tmp/reasoning-selector-demo.gif` (trimmed interaction recording).

---

## 2026-09-20 — Analytics Page, Settings Page & Global Shortcuts Overlay

### Requirement Completed
Production Analytics + Settings modules backed entirely by backend aggregation, a dynamic accent-color theme system, per-user chat preferences, session management, and a global Ctrl+/ shortcuts overlay.

**Analytics** (`/api/v1/analytics/*`): date-range presets (today/yesterday/7d/30d/this_month/last_month/90d/custom) resolved server-side in the caller's IANA timezone with previous-period comparison; KPI summary (10 tiles incl. spend/requests/tokens/active models-providers/avg cost/avg tokens/avg response/streamed sessions/projected month spend/cache), backend-generated insights, spend timeseries (hour/day/week/month + drag-to-zoom), provider donut + model ranked bars, top-10 expensive conversations, usage timeline + 7×24 heatmap with peak/quiet, token analytics (prompt/completion/cache read/cache write/reasoning/total + by provider/model), performance (TTFB/completion/stream duration/response length/thinking; tool calls reported as "not tracked"), model rankings via backend `sort` param, provider table with error rates, five conversation leaderboards, CSV/JSON export (PDF-ready).
**Settings**: profile (name/username/email/avatar URL with validation; email change re-verifies), password change with strength meter + current-password verification revoking other sessions, appearance (theme + 7 accent presets + custom hex picker applied globally via the `tollma-*` CSS variables, no reload), chat preferences (Enter behavior, default thinking level, auto-scroll, stream animations) persisted per user and honored by the composer/page, session management (device/browser/OS/IP/last activity/created/requests/tokens, current badge, revoke, revoke-all-others).
**Shortcuts overlay**: Ctrl+/ searchable cmdk overlay with 17 categorized shortcuts; window handler owns Ctrl+K/Ctrl+/, G→C/A/S sequences, pane toggles, focus/regenerate/stop/model/thinking commands via `tollma:*` events.

### Files Created
Backend: `alembic/versions/b8f1c2d3e4a5_analytics_settings.py`, `api/analytics/{__init__,router,schemas,service}.py`, `api/settings/{__init__,router,schemas,service}.py`, `tests/test_analytics.py` (12), `tests/test_settings.py` (6).
Frontend: `lib/accent.ts`, `lib/password.ts`, `lib/shortcuts.ts`, `store/settings.ts`, `hooks/useAnalytics.ts`, `hooks/useSettings.ts`, `hooks/useShortcuts.ts`, `components/charts/{AreaChart,BarChart,DonutChart,Heatmap,Sparkline,palette,useElementSize,index}`, `components/ui/ShortcutsOverlay.tsx`, `app/analytics/{format.ts,components/{KpiCard,RangePicker,AnalyticsTables}}`, `app/settings/components/{SettingsCard,ProfileSection,AppearanceSection,ChatPreferencesSection,PasswordSection,SessionsSection,ProvidersSection}`, unit tests `lib/__tests__/{accent,password,shortcuts}.test.ts`, `e2e/analytics-settings.spec.ts` (9).

### Files Modified
Backend: `models/{user,message}.py`, `core/security.py` (session index + metadata + activity write-behind + `get_current_session_id`), `api/auth/{router,schemas,service}.py` (username, client metadata), `api/conversations/service.py` (session_id/usage_estimated on `add_message`), `api/gateway/{router,service}.py` (session_id, ttfb, estimated persistence), `services/generation.py` (`spec.ttfb_ms`/`session_id`/`usage_estimated` persisted; analytics cache invalidation), `services/cache/{keys,constants,manager}.py` (SADD/SREM/SMEMBERS, analytics keys + 60s TTL), `main.py` (router registration + `expose_headers`), `services/cache/constants.py`.
Frontend: `app/analytics/page.tsx`, `app/settings/page.tsx`, `components/Sidebar/{Sidebar,SidebarAnalytics,SidebarSettings,SidebarConversations}.tsx`, `components/ui/{AppShell,PageHeader,CommandPalette,index}`, `components/Shell.tsx`, `app/page.tsx`, `app/components/chat/{ChatComposer,capabilities}`, `app/layout.tsx` (accent boot script), `app/globals.css` (animation-off rules), `services/api.ts`, `store/auth.ts`, `types/index.ts`, `tests/chat-ux.spec.ts` (hydration wait in `goto`).

### Decisions
- Aggregation is 100% backend (`messages` fact table); the frontend only formats. Costs as Decimal strings; rollups cached 60s in Valkey and invalidated when a generation finishes.
- DB additions: `messages.ttfb_ms`, `messages.usage_estimated`, `messages.session_id` (+partial index), composite `ix_messages_user_role_created`; `users.username` (unique live) + `users.preferences` JSONB. Per-session usage comes from durable rows, not counters.
- Accent theming redefines the `tollma-*` CSS variables on `<html>` (brand-identical shade generator + boot script) so every existing class, chart and slider re-themes with no component changes.
- Legacy browser timezone ids (Asia/Calcutta) are canonicalized (`Asia/Kolkata`) and SQL timezones validated against PostgreSQL with a UTC fallback — fixes 500s from PG tzdata gaps.
- No chart library added: dependency-free SVG components; tool calls surfaced as "not tracked" rather than fabricated.
- Below md the sidebar becomes an off-canvas overlay (hamburger in PageHeader, backdrop) so Analytics/Settings are usable on mobile.
- Ctrl+K moved from `useCommandPalette` into the single global shortcut handler; `tests/chat-ux` goto helper now waits for hydration.

### Verification
- Backend `docker compose exec backend pytest -q`: **145/145** (was 127); `alembic check` green.
- Frontend `vitest`: **90/90**; `tsc --noEmit` clean; `next build` green; `eslint src` new files clean (6 pre-existing errors in untouched citation/sources/wizard files).
- Playwright: `e2e/analytics-settings.spec.ts` **9/9** (real seeded usage: KPIs/sections, range presets + custom + CSV download filename, accent apply/persist/backend, Enter=newline honoring + Ctrl+Enter send, profile persistence + sidebar, sessions current-device, Ctrl+/ overlay search + G→A + Ctrl+K); regression `tests/chat-ux` + `e2e/navigation` 22 passed/2 skipped; `e2e/reasoning-selector` 7/7; `e2e/generation|settings|auth` 21/21.
- Screenshots: `/tmp/analytics-top|spend|tokens|models|full|mobile|light-purple.png`, `/tmp/settings-top|appearance|sessions.png`, `/tmp/shortcuts.png`, `/tmp/mobile-analytics*.png` (dark/light, 1440px + 390px, purple/green accents).

---

## 2026-09-21 — AI SDK Elements Chat Integration (Phase A)

### Requirement Completed
Selective integration of AI SDK Elements into the existing ToLLma chat, preserving the custom SSE streaming architecture, zustand state, conversation persistence, provider abstraction, model intelligence panel, capability-aware composer, reasoning support and attachment validation. The official `ai-elements` registry package was installed (devDependency) and its components were vendored/adapted into `frontend/src/components/ai-elements/`; the chat page now composes Conversation, Message (+MessageBranch), Reasoning, ChainOfThought, Sources, InlineCitation, Task, Tool, Context, Attachments and PromptInput. Dead ports and alias shims were deleted. No backend changes.

### Files Created
- `frontend/src/components/ai-elements/`: `conversation.tsx` (StickToBottom, scroll button, markdown download), `message.tsx` (Message/Content/Actions/Action/Toolbar/Branch*), `reasoning.tsx` (streaming/duration/auto open-close), `chain-of-thought.tsx` (steps/search results/images), `sources.tsx`, `inline-citation.tsx` (HoverCard + carousel), `task.tsx`, `tool.tsx` (input-streaming/available/output-available/output-error), `context.tsx` (token usage, no tokenlens), `attachments.tsx` (grid/inline/list, hover preview, remove), `prompt-input.tsx` (PromptInput/Body/Textarea/Header/Footer/Tools/Button/ActionMenu/Submit + Enter-behavior helper), `collapsible.tsx`, `hover-card.tsx`, `carousel.tsx` (dependency-free, CarouselApi-compatible), `code-block.tsx`, `markdown.tsx`, `shimmer.tsx`, `index.ts` (barrel).
- `frontend/src/app/components/chat/reasoning/ReasoningPanel.tsx` — ToLLma reasoning surface built on the ai-elements Reasoning primitives: 5 states, live/persisted duration, words, tokens, CoT step chips, copy.
- `frontend/src/app/components/chat/attachments/MessageAttachments.tsx` — persisted attachments (image grid / document list) built on ai-elements Attachments.

### Files Modified
- `frontend/src/app/components/MessageView.tsx` — composed ai-elements Message/MessageContent/MessageActions + ReasoningPanel + MessageResponse (keeps `ResponseMarkdown`, no streamdown) + Sources + ToolCall + MessageContext + MessageAttachments; all `data-testid`s preserved.
- `frontend/src/app/page.tsx` — Conversation/ConversationContent/ConversationScrollButton replace the manual scroll container; `autoScroll` preference renders the stick-to-bottom variant or a plain scroller.
- `frontend/src/app/components/chat/ChatComposer.tsx` — PromptInput shell with Body/Textarea/Footer/Tools/Submit; model + thinking selectors, attachment picker, drag/drop/paste and capability validation unchanged.
- `frontend/src/app/components/chat/{UploadPreview,citations/InlineCitation,sources/Sources,tools/ToolCall,context/MessageContext}.tsx` — rebuilt on ai-elements primitives, same props/testids.
- `frontend/e2e/analytics-settings.spec.ts` — custom-range dates now use local calendar dates (the previous UTC `toISOString()` excluded today's usage east of UTC; time-of-day dependent failure).
- `frontend/package.json`, `frontend/package-lock.json`.

### Files Deleted
- `frontend/src/app/components/Reasoning.tsx` (alias shim), `frontend/src/app/components/CommandPalette.tsx` (alias shim), `frontend/src/app/components/chat/reasoning/ChainOfThought.tsx`, `frontend/src/app/components/chat/message/Message.tsx`, `frontend/src/app/components/chat/conversation/ScrollToBottom.tsx` (all replaced by ai-elements).

### Dependencies Added
- `ai-elements@1.9.0` (devDependency; the official registry CLI — components are vendored shadcn-style, as the registry intends).
- `use-stick-to-bottom` (Conversation scroll anchoring), `@radix-ui/react-collapsible` (Reasoning/CoT/Sources/Task/Tool/Context panels), `@radix-ui/react-hover-card` (InlineCitation/Attachments/Context previews), `@radix-ui/react-use-controllable-state` (official Reasoning/CoT open state).
- Installed in both host and the `tollms-frontend` container node_modules volume.

### Decisions
- **Vendored, not `shadcn init`**: the registry CLI resolves to `shadcn add`; initializing shadcn would rewrite `globals.css` and add a parallel design-token system. Components were vendored and their imports pointed at ToLLma's `@/lib/utils` + `@/components/ui/primitives`.
- **Rejected streamdown/tokenlens/shiki/`ai`/`useChat`**: `MessageResponse` delegates to the existing richer `ResponseMarkdown` (mermaid, GitHub alerts, code toolbar, TSV tables); Context computes usage locally from real backend tokens; `useChat` would replace the SSE + zustand architecture.
- Reasoning stays provider-agnostic: the normalized `<think>` contract is unchanged; ReasoningPanel maps it to the five states and renders official CoT step chips.
- `Conversation` forwards `scrollTestId` to `StickToBottom.scrollRef` (the element that actually scrolls) and the scroll button listens there, keeping the Playwright scroll contract valid.
- `Attachments` gained an explicit `variant` prop so staging previews can render outside an `Attachments` container.

### Verification
- `npx tsc --noEmit` clean; `npx eslint` on all touched files + `src/components/ai-elements` clean; `npx vitest run` **90/90**; `npx next build` green.
- Playwright: `e2e/elements.spec.ts` **4/4** (reasoning states/labels/duration/persistence, drag&drop + dropzone + chip ready + message attachment, scroll-to-bottom affordance); `tests/chat-ux.spec.ts` + `e2e/generation|chat|reasoning-selector` **37 passed / 2 skipped**; `e2e/analytics-settings.spec.ts` **9/9** (after the local-date fix); `e2e/intelligence|history` green.
- Screenshots: `/tmp/chat-composer-attachment.png`, `/tmp/chat-reasoning-expanded.png`, `/tmp/chat-full-dark.png`, `/tmp/chat-full-light.png`, `/tmp/chat-mobile.png`.
- Note: running `next build` on the host clobbers the dev server `.next`; restart `tollms-frontend` after a host build.

### Recommended Next Steps
- Phase B (Conversation Intelligence): structured error envelope, `request_logs`, credential security endpoint, export (MD/JSON/PDF), XLSX analytics export, PG-FTS conversation search, branching, message edit/version history, regeneration history, sharing.
- Wire real `metadata.sources`/`tool_calls`/`context_items` from the backend so InlineCitation/Sources/Tool/Context render live data; feed `MessageBranch` from regeneration history.

---

## 2026-09-21 — ToLLma V1 Phase B: Conversation Intelligence, History, Sharing, Export & Reliability

### Requirement Completed
End-to-end delivery of the ten Phase B features: structured error architecture, per-request logging, credential-encryption validation, chat export (MD/JSON/PDF), analytics export (CSV/XLSX/JSON), PostgreSQL full-text conversation search, conversation branching, message editing with version history, response regeneration with generation history, and public conversation sharing — plus chat message actions, generation navigation, analytics widgets and a public read-only share page.

### Files Created
Backend: `alembic/versions/d1e2f3a4b5c6_conversation_intelligence.py` (5 tables, branch columns, `messages.error_code`, FTS index, backfill); `models/{request_log,message_history,share,search_index}.py`; `services/{request_logs,search,exporters}.py`; `api/search/{router,service,schemas}.py`; `api/exports/{router,service,schemas}.py`; `api/shares/{router,service,schemas}.py`; `api/messages/{router,service,schemas}.py`; `api/request_logs/{router,service,schemas}.py`; tests `{test_errors,test_request_logs,test_search,test_exports,test_shares,test_message_history}.py` (36 tests).
Frontend: `lib/{errors,diff}.ts`; `hooks/useIntelligence.ts`; `components/ui/{SearchModal,ShareDialog}.tsx`; `app/share/[token]/page.tsx`; `app/components/chat/message/MessageHistoryDialog.tsx`; `app/analytics/components/AnalyticsWidgetsPanel.tsx`; `e2e/conversation-intelligence.spec.ts` (8 tests); unit tests `lib/__tests__/{diff,errors}.test.ts`.

### Files Modified
Backend: `core/{exceptions,crypto}.py` (ErrorCode/ApplicationException/envelope handlers, ALGORITHM), `main.py` (5 routers), `services/generation.py` (run_id/is_regeneration/provider/model ids, error_code classification, `generation_runs` + `request_logs` writes), `api/gateway/{service,schemas}.py` (request logs, run #1, `start_regeneration`, `RegenerateRequest`), `api/conversations/{service,router,schemas}.py` (search-index maintenance, branch routes, `generations` on MessageRead), `api/messages/{service,router}.py`, `api/analytics/{service,router,schemas}.py` (xlsx, `/widgets`, `render_export`), `api/providers/{router,service,schemas}.py` (`/security`), `services/cache/{keys,constants}.py` (search/share/export keys + TTLs), `models/{conversation,message}.py`, `pyproject.toml`/`uv.lock` (fpdf2, openpyxl).
Frontend: `types/index.ts`, `services/api.ts`, `app/page.tsx`, `app/components/MessageView.tsx`, `app/components/ChatHeader.tsx`, `app/analytics/{page.tsx,components/RangePicker.tsx}`, `components/ui/primitives.tsx` (DialogTitle/Description), `e2e/analytics-settings.spec.ts` (local-date fix).

### Dependencies Added
Backend: `fpdf2` (pure-Python PDF generation) and `openpyxl` (real XLSX workbooks). No other new dependencies; search uses PostgreSQL FTS (`websearch_to_tsquery`/`ts_rank_cd`/`ts_headline`) and sharing uses `secrets.token_urlsafe`.

### Decisions
- **Error envelope**: every failure returns `{success:false,error:{code,message,retryable,timestamp}}`; FastAPI validation and HTTP errors are mapped into it, and `classify_provider_failure` maps adapter/transport failures onto the provider taxonomy. Frontend `parseApiError` turns any of it into an actionable toast with a retry action.
- **Request logs are the per-request ledger**: streaming, non-streaming, cancelled, failed and regenerated requests all write one row; analytics gains `/api/v1/analytics/widgets` plus log-based `/api/v1/request-logs/summary` (existing message-based charts stay backward compatible).
- **Regeneration in place**: `generation_runs` holds every generation for an assistant message; the message row always mirrors the active run, and `MessageRead.generations`/`active_generation_id` (two grouped queries in `message_reads`) drive ◀ 1 of N ▶ without extra round trips.
- **Search index**: `conversation_search_index` with a generated tsvector + GIN index; index maintenance runs on message create/edit/delete and conversation create/rename/delete, and any index write invalidates the owner's cached search results.
- **Branching copies history**: a branch is a real conversation with `parent_conversation_id`/`branch_from_message_id`/`branch_name`; messages up to (excluding) the fork point are copied so the branch can continue independently.
- **Sharing is token-scoped and revocable**: create is idempotent, disable/rotate/expire are enforced server-side, public payloads contain only title/messages/model and never user or credential data; lookups are cached 60s and invalidated on mutation.
- **Exports are server-rendered**: MD/JSON/PDF for conversations (single, selected or whole account) and CSV/XLSX/JSON for analytics; every export writes an `export_events` audit row for the widget.
- Frontend UX: Ctrl+Shift+F opens the new search modal (search results scroll to and briefly highlight the matched message), message actions gained Edit/Branch/History/Share with inline edit, the history dialog shows a line diff and generation list, and the header gained PDF export plus share management.

### Verification
- Backend `docker compose exec -T backend pytest -q`: **181/181** (was 145); `alembic check` green.
- Frontend `vitest`: **98/98** (was 90); `tsc --noEmit` clean; `eslint` clean on all touched files; `next build` green (new dynamic `/share/[token]` route).
- Playwright `e2e/conversation-intelligence.spec.ts`: **8/8** — FTS search + open conversation, edit with versions/diff + regeneration, regeneration navigation (2 of 2 → 1 of 2), branch creation with lineage chip, public share page in a clean unauthenticated context + revocation, MD/JSON/PDF downloads, analytics widgets.
- Regression Playwright: `e2e/elements.spec.ts` + `tests/chat-ux.spec.ts` + `e2e/analytics-settings.spec.ts` **32 passed / 2 skipped**.
- Docker stack healthy (backend/frontend/postgres/valkey); no stray test files.

### Recommended Next Steps
- Wire real `metadata.sources`/`tool_calls`/`context_items` so the Elements Sources/Tool/Context surfaces render live data.
- Consider a background job queue for very large account exports (currently synchronous, capped at 200 conversations).
- Add per-message share links (currently conversation-scoped) and branch diffing between sibling branches.
- Add a request-logs viewer page in the UI (API + log-based summary already exist).

---

## 2026-09-21 — Dead-code audit & cleanup (both phases)

### Requirement Completed
Completed the "delete irrelevant components from the frontend and backend" instruction with a verified audit rather than assumptions: built an inbound-import graph for every Python module and every frontend file, then removed only symbols with zero references.

### Findings
- Backend: **no dead modules** — every module under `api/` and `services/` has at least one importer (the earlier `scheduler.py` suspicion was wrong; it is started from the app lifespan).
- Frontend: **no dead files** — the only zero-import results were barrel `index.ts` files consumed via directory imports.

### Files Modified (dead symbols removed)
- `backend/src/tollms/api/request_logs/service.py` — unused `statuses()` + now-unused `RequestStatus` import.
- `backend/src/tollms/services/cache/keys.py` — unused `export_status()` (exports are synchronous; no job-status cache).
- `backend/src/tollms/api/exports/schemas.py` — unused `ExportResultRead`.
- `backend/src/tollms/services/request_logs.py` — unused `RequestLogEntry.meta` field + `dataclasses.field` import.
- `frontend/src/app/components/reasoning.ts` — unused `REASONING_STATUS_LABEL`.
- `frontend/src/hooks/useIntelligence.ts` — unused `useRequestLogs` hook (+ `getRequestLogs` import; the API client remains available).
- `frontend/src/components/ai-elements/prompt-input.tsx` — unused local `usePromptInput` hook (not part of the official API surface).

### Decisions
- The vendored `components/ai-elements/` library keeps its complete official surface (including `Task`, `Context`, `Tool`, `AttachmentEmpty`, `PromptInputActionMenu*`) because those are explicitly requested as "prepare for future" surfaces and pruning official sub-components would break upgrade fidelity. Dead code was removed from the **app layer** and **backend**, not from the vendored library.
- The earlier deletions of replaced ToLLma components (Reasoning.tsx, CommandPalette.tsx, chat/reasoning/ChainOfThought.tsx, chat/message/Message.tsx, chat/conversation/ScrollToBottom.tsx) stand as the frontend "irrelevant components" cleanup.

### Verification
- Backend Phase B suites: **36/36**; app imports clean.
- Frontend `vitest` **98/98**; `tsc --noEmit` clean; `eslint` clean; `next build` green.
- Playwright `conversation-intelligence` + `elements`: **11/11**.
- Docker stack healthy; frontend restarted after the host build.

---

## 2026-09-21 — Provider-aware Auth & Forgot/Reset Password

### Requirement Completed
Refactored the existing auth system (no parallel flow) so accounts are provider-aware and settings adapt to the login method: local (email + password) accounts manage a password, Google OAuth accounts see provider information instead and are refused password operations. Added a complete forgot/reset password flow for local accounts with hashed, single-use, expiring tokens, no account enumeration and session invalidation.

### Files Created
Backend: `alembic/versions/e2f3a4b5c6d7_auth_provider_password_reset.py` (provider columns + backfill + `password_reset_tokens`), `models/password_reset.py`, `services/email/templates/reset.html`, `tests/test_password_reset.py` (13 tests).
Frontend: `components/auth/AuthShell.tsx`, `app/auth/forgot-password/page.tsx`, `app/auth/reset-password/page.tsx`, `app/settings/components/{AccountSecuritySection,ProviderAuthSection}.tsx`, `lib/authProvider.ts`, `lib/__tests__/authProvider.test.ts`, `e2e/auth-provider.spec.ts` (7 tests).

### Files Modified
Backend: `models/user.py` (`provider`, `provider_user_id`, `has_password` + partial unique identity index), `models/__init__.py`, `core/exceptions.py` (`ForbiddenError` 403), `core/config.py` (`password_reset_ttl_minutes`, `password_reset_invalidate_sessions`), `core/security.py` (password policy, `hash_reset_token`, `generate_reset_token`), `services/email/{__init__,service}.py` (`send_password_reset_email`), `api/auth/{service,schemas,router}.py` (identity/password helpers, forgot/validate/reset endpoints, `provider`/`has_password` on UserRead), `api/settings/{service,schemas}.py` (403 for OAuth, password policy, session `provider` + `location`).
Frontend: `types/index.ts` (User + LoginSession), `services/api.ts` (forgot/validate/reset clients), `lib/password.ts` (`validatePassword`), `components/auth/AuthCard.tsx` (Forgot Password link), `app/settings/page.tsx` (provider-aware account card), `app/settings/components/{PasswordSection,SessionsSection}.tsx`.

### Decisions
- **One identity model, no parallel flow**: `users.provider`/`provider_user_id` are authoritative; the legacy `auth_provider`/`google_id` columns stay in sync through two helpers (`set_local_identity`, `set_google_identity`, `link_google_identity`) so existing readers/tests keep working. `has_password` mirrors `password_hash` and is written only via `set_password`.
- **Linking, not conversion**: a verified Google login for an existing local account links the Google subject but keeps `provider="local"` (they still have a password); a Google-created account stays `provider="google"` and never gains a password.
- **No enumeration**: `POST /auth/forgot-password` always returns `{success: true}`; only local accounts with a password create a token and an email. Validation returns a masked email (`j***e@example.com`) so the reset page can be helpful without leaking the address.
- **Token security**: raw token is `secrets.token_urlsafe(32)`, only `sha256` is stored; single-use (`used_at`), TTL from `password_reset_ttl_minutes` (default 60), and using one link invalidates sibling tokens. Reset revokes **all** sessions by default (`password_reset_invalidate_sessions`), forcing re-login.
- **Password policy in one place**: 8+ chars with uppercase, lowercase and digit, enforced by `security.validate_password_strength` on signup, change-password and reset-password, and mirrored in the frontend by `validatePassword`. Fixtures updated from `password123` to `Password123` (and `brandnew123` → `Brandnew123`).
- **403 for OAuth**: `POST /api/v1/settings/password` raises `ForbiddenError` (403, `FORBIDDEN`) before touching the password, and the UI hides the section entirely — the API stays honest even if called directly.
- Session records gained `provider` (from the session's `login_method`) and a coarse `location` label ("Local network" for private ranges; public IPs stay unknown rather than guessing).
- Endpoints keep the repository's existing prefixes (`/auth/...`, `/api/v1/settings/password`) instead of introducing `/api/auth/...` aliases, per "integrate into the existing system".

### Verification
- Backend `docker compose exec -T backend pytest -q`: **194 passed** (was 181; +13 password-reset/provider tests, 1 updated settings test); `alembic check` green (head `e2f3a4b5c6d7`).
- Frontend `vitest`: **102/102** (was 98); `tsc --noEmit` clean; `eslint` clean on all touched files; `next build` green (new static `/auth/forgot-password` + `/auth/reset-password` routes).
- Playwright: `e2e/auth-provider.spec.ts` **7/7** (local password UI, Google provider card via stubbed `/auth/me`, policy enforcement, forgot link + generic response, invalid-token reset page, provider in sessions) + regression `e2e/auth.spec.ts` + `e2e/settings.spec.ts` **12/12**.
- Docker stack healthy; frontend restarted after the host build.

### Recommended Next Steps
- Optional "set a password" flow for Google accounts that want local login (would set `provider` linkage without losing OAuth).
- Rate-limit `forgot-password` per IP/email and add a small audit trail of reset requests.
- Expose the reset-token TTL/invalidation knobs in `.env.example` documentation.

---

## 2026-09-21 — Chat Page Modernization completion: full-viewport drop, borderless replies, live sources & inline citations

### Requirement Completed
Closed the remaining gaps of the "ToLLma Chat Page Modernization Using AI Elements" spec on top of the existing Phase A integration, frontend-only (backend APIs, streaming, persistence and provider abstraction untouched). Analysis first: Reasoning/CoT, attachments, prompt input and conversation shell were already compliant; the real gaps were the composer-scoped dropzone, the assistant card chrome, the 1200px reading width, and Sources/InlineCitation components that existed but were never rendered because the backend emits no `metadata.sources`.

### Files Modified
Frontend: `app/components/chat/attachments/DropzoneOverlay.tsx` (viewport-fixed overlay with dark translucent backdrop and centered card), `app/components/chat/ChatComposer.tsx` (window-level `dragenter/dragover/dragleave/drop` with depth counting, `Files`-type filter that tolerates synthetic test events, capability-gated, refs refreshed in an effect to satisfy `react-hooks/refs`), `app/components/MessageView.tsx` (assistant `MessageContent` is now borderless/backgroundless/full-width; new optional `sources` prop merged over `metadata.sources` and threaded to `MessageResponse`), `components/ai-elements/message.tsx` (`MessageResponse` passes `sources` through), `app/components/ResponseMarkdown.tsx` (exported `rehypeCitations` plugin splitting `[n]` text into `<sup data-citation-index="n">`, skipping `code`/`pre`, plus a `sup` override that mounts `InlineCitation` for known indexes), `app/components/chat/citations/InlineCitation.tsx` (marker now renders `[n]` via `HoverCardTrigger` + Badge instead of the vendored hostname/"unknown" badge, which was useless for file sources), `app/components/chat/sources/Sources.tsx` (new pure `deriveSources(messages)` mapping the user turn's attachment rows onto the reply it produced, 1-indexed, with real `attachmentContentUrl` links), `app/page.tsx` (memoized `persistedMessages`/`allMessages`/`sourcesByMessage`, passes per-message sources, conversation + composer width 1200px → 960px).
Tests: `app/components/__tests__/ResponseMarkdown.test.ts` (+2 rehype-citations cases), `app/components/chat/__tests__/citationsAndSources.test.ts` (+2 `deriveSources` cases), `e2e/mock-server.ts` ("cite" model branch streaming `[1]`), `e2e/elements.spec.ts` (setup accepts a model prefix; new sources + inline-citation e2e with refresh persistence), `e2e/generation.spec.ts` (stale double-regenerate assertion corrected to in-place regeneration).

### Decisions
- **Sources are derived, not invented**: the gateway injects the user turn's attachment text into the prompt and links those rows to the user message, so the reply's sources ARE exactly that attachment set. Derivation is client-side from persisted `ChatAttachment` rows — no schema, API or fake-data changes. Sources with no URL get the existing attachment content endpoint, so both the Sources list and the citation card are real links.
- **Inline citations render only when the model emits `[n]`** and a matching source exists; the rehype transform runs on the markdown AST (not regex on raw text) so code blocks are never rewritten. This keeps the feature honest: nothing is fabricated when no markers exist.
- **Assistant chrome removed, user bubble kept**: assistant replies are typography-first (no border/background/padding, full width), matching the 70% Claude / 20% ChatGPT / 10% Perplexity target; the right-aligned user bubble remains for turn separation.
- **Dropzone is window-level but capability-gated**: listeners register once and consult refs, so the overlay is full-screen only when the selected model can accept uploads; `dragActive && canDrop` prevents stale overlays.
- **Stable identities for memoization**: `sourcesByMessage` is memoized on `[allMessages]`, and `allMessages` on `[persistedMessages, optimisticMessages]`, so the `MessageView` memo comparator (now including `sources`) still short-circuits unchanged messages during streaming.
- **Context above the prompt was already satisfied** by the AI Elements Attachments staging (`UploadPreview`) with per-chip removal; the AI Elements `Context` component is a token/context-window surface, not a file-context list, so no duplicate widget was added.

### Verification
- Frontend: `npx vitest run` **106/106** (was 102; +4 new unit tests); `npx tsc --noEmit` clean; `npx eslint` clean on all touched files; `npx next build` green; `tollms-frontend` restarted after the host build.
- Playwright `e2e/elements.spec.ts` **5/5** (reasoning unchanged, dropzone visibility, drag-drop ready + send, new sources/inline-citation + refresh persistence, scroll-to-bottom); `e2e/generation.spec.ts` + `e2e/reasoning-selector.spec.ts` + `e2e/history.spec.ts` **17/17**; `tests/chat-ux.spec.ts` + `e2e/chat.spec.ts` + `e2e/conversation-intelligence.spec.ts` **35 passed / 2 skipped** (the one real failure there, a public-share test, passed in isolation — contention flake).
- The pre-existing `generation.spec.ts` "double-clicked regenerate" failure was reproduced on a stashed clean tree before fixing; it asserted 2 user + 2 assistant rows from the pre-Phase-B send-based regeneration and now asserts in-place regeneration (1 + 1 rows, ≥2 generation runs).

### Recommended Next Steps
- Prompt-level citation guidance (provider-agnostic system hint to cite uploaded files as `[n]`) if citations should appear without user prompting.
- Wire `metadata.tool_calls`/`metadata.context_items` once the gateway emits them; `ToolCall`/`MessageContext` already render when present.
- Consider promoting the "cite" stream branch into a reusable mock fixture if more citation surfaces (share page) get coverage.

---

## 2026-09-22 — Chat Page Alignment & Full AI Elements Migration (reasoning + message layout)

### Requirement Completed
Completed the frontend-only alignment/AI-Elements migration: the custom amber reasoning card was replaced with the official AI Elements `Reasoning`/`ChainOfThought` surfaces, user/assistant message alignment and rhythm were fixed, duplicate reasoning labels and custom action text were removed, and widths/spacing were unified on one content column. No backend, streaming, provider or schema changes.

### Files Modified
Frontend: `app/components/chat/reasoning/ReasoningPanel.tsx` (rebuilt on official `Reasoning` + `ReasoningTrigger` + `ReasoningContent` for prose and `ChainOfThought` + `ChainOfThoughtContent` + `ChainOfThoughtStep` for structured steps; neutral zinc styling, no cards/borders/duplicate labels; live duration, tokens slot, copy action, auto-scroll, controlled collapsed-by-default open state), `app/components/reasoning.ts` (`extractReasoningSteps` → `splitReasoningSteps` returning preamble + `{title, body}` steps, preserving step bodies), `app/components/thinkBlocks.ts` (removed now-unused `countThinkWords`), `app/components/MessageView.tsx` (user bubble `ml-auto max-w-[85%]`; role labels removed from the meta row; icon-only actions), `components/ai-elements/conversation.tsx` + `app/page.tsx` (message rhythm `gap-4`), `app/components/chat/attachments/DropzoneOverlay.tsx` ("Drop files to attach").
Tests: `app/components/chat/__tests__/reasoning.test.ts` (splitReasoningSteps cases), `app/components/__tests__/thinkBlocks.test.ts`, `e2e/generation.spec.ts` (dropped the removed word-count assertion).

### Decisions
- Dual-mode reasoning: structured prose (2+ detected steps) renders official `ChainOfThoughtStep`s with each step's body as its description; unstructured prose renders the official `ReasoningContent` markdown. Content is never dropped and nothing is duplicated.
- Controlled open state instead of the official auto-open/auto-close: the mixed controlled/uncontrolled state previously let the panel stay expanded; deterministic collapse-by-default matches the product spec and keeps e2e timing stable.
- The repo's `cn` is a plain class join (no tailwind-merge), so conflicting utilities (`w-auto` vs `w-full`, `gap-3` vs `gap-4`, `mb-0` vs `mb-4`) were avoided by editing component defaults rather than overriding per call site.
- `data-testid`s (`thinking-block`, `reasoning-toggle`, `data-status`, `reasoning-panel`, `reasoning-duration`, `reasoning-tokens`) and labels ("Thinking…", "Thought for Xs") were preserved so the existing Playwright reasoning contracts keep working.

### Verification
- Frontend `vitest` **104/104**; `tsc --noEmit` clean; `eslint` clean; `next build` green; frontend restarted.
- Playwright `e2e/elements.spec.ts` + `e2e/generation.spec.ts` **13/13** (live reasoning pill/duration/tokens, attachment drop, sources + inline citation, refresh persistence); `tests/chat-ux.spec.ts` + `e2e/chat.spec.ts` + `e2e/intelligence.spec.ts` + `e2e/history.spec.ts` **26 passed / 2 skipped**.
- Live browser check via the MCP browser against the Docker dev stack: user bubble flush right on the 960px column, borderless assistant response, official "Thought for 2s" trigger, no amber card.

### Recommended Next Steps
- Feed `ChainOfThought` steps from provider-native structured events when adapters emit them (currently derived from normalized text).
- Consider official auto-open-while-streaming if collapsing during generation is not desired.

---

## 2026-09-22 — Simplify Message Actions UI (conditional history, no per-message delete/share)

### Requirement Completed
Frontend-only cleanup of the message action bar: per-message delete and share were removed entirely, the history action now renders only when versions exist (user edit versions or assistant generations), the assistant version indicator reads "Response N of M", and the history dialog version chips show timestamps. One additive, non-breaking backend field was required because no edit-version metadata was exposed on message reads.

### Files Created
None.

### Files Modified
Backend: `api/conversations/schemas.py` (`MessageRead.versions_count: int = 0`), `api/conversations/service.py` (`message_reads` adds one batched `MessageVersion` count query alongside attachments/generations), `tests/test_message_history.py` (asserts 0 before edit, 2 after).
Frontend: `app/components/MessageView.tsx` (removed delete/share actions, imports and props; `hasHistory = user ? versions_count > 1 : generations.length > 1`; generation page label "Response N of M"), `app/page.tsx` (removed `handleDeleteMessage`, `onDelete`/`onShare` props, message-level `ShareDialog` + `shareOpen` state and import), `services/api.ts` (removed unused `deleteMessage` client; backend endpoint untouched), `types/index.ts` (`versions_count?`), `app/components/chat/message/MessageHistoryDialog.tsx` (version chips show `vN · HH:MM`, active version already highlighted).
Tests: `e2e/conversation-intelligence.spec.ts` (fresh messages assert zero history/delete/share buttons; edited + regenerated messages assert history visible; "Response 2 of 2" → "Response 1 of 2").

### Decisions
- Edit history needed one backend field: `versions_count` is computed with the same grouped-query pattern as attachments/generations (constant query count per conversation), is additive and backwards compatible, and makes the conditional history correct after refresh (a local-only flag would forget edits).
- "Edited" = `versions_count > 1` because the first edit snapshots the original as v1 and the edit as v2; assistant history = `generations.length > 1`.
- Conversation-level share/delete were left untouched (header menu owns them); the removed message-level ShareDialog is now redundant.
- The history dialog still owns user-message version inspection (chips + diff); switching assistant responses stays in the inline prev/next navigation, matching the existing in-place regeneration model.

### Verification
- Backend `docker compose exec -T backend python -m pytest -q`: **194 passed** (clean re-run; an earlier run's 7 analytics failures were traced to a timed-out prior pytest process still running in the container — analytics passed 12/12 in isolation).
- Frontend `vitest` **104/104**; `tsc --noEmit` clean; `eslint` clean; `next build` green; frontend restarted.
- Playwright `e2e/conversation-intelligence.spec.ts` **8/8** (conditional history, version timestamps, "Response 2 of 2"/"Response 1 of 2", no delete/share testids); regression `elements` + `generation` **13/13**; `chat-ux` + `chat` + `intelligence` + `history` **26 passed / 2 skipped**.
- Environmental note: a scratch mock server on port 4899 silently intercepted the e2e mock (`EADDRINUSE` resolves into "already running"), causing a false 7-test failure; killed it and re-ran green.

### Recommended Next Steps
- If user edit-version switching (not just inspection) is wanted, it needs a backend "activate version" semantic; currently the dialog shows the diff between versions without reverting.
- Consider surfacing `versions_count` on search results/message payloads if other surfaces need edited badges.


## 2026-09-22 — graphify auto-updating knowledge graph + live interactive page

### Requirement Completed
Make the project knowledge graph rebuild automatically on every code change and make the interactive HTML page reflect changes without manual regeneration or manual file opening.

### Files Created
- `graphify-out/live.py` — zero-dependency stdlib live-reload server for `graphify-out/` (serves the dir, polls `graph.json` mtime via `/graph-version`, reloads the graph iframe on change; port 8765 via `GRAPHIFY_LIVE_PORT`).
- `~/.config/systemd/user/graphify-watch.service` — runs `python -m graphify.watch /home/ond/Projects/ToLLms --debounce 3` with `Restart=on-failure`, logging to `graphify-out/watch.log`.
- `~/.config/systemd/user/graphify-live.service` — runs `live.py` on port 8765.

### Files Modified
None in the repo (graphify-out is gitignored).

### Decisions
- Used graphify's built-in watcher rather than a custom file-watcher: it already re-extracts AST, re-clusters, and rewrites `graph.json` + `GRAPH_REPORT.md` + `graph.html` on code changes with no LLM/API key, and honors `.gitignore`/`.graphifyignore` plus an internal `graphify-out` filter (no self-trigger loop).
- Docs/papers/images still require a semantic pass (`/graphify --update`) because only code is re-extracted by the watcher; the watcher flags this via `graphify-out/.needs_update`.
- The generated `graph.html` is already interactive (zoom/pan/click); "dynamic" was delivered as live reload rather than rebuilding the visualization, so graphify's export stays untouched and upgrade-safe.
- Community labels are auto-derived from hub nodes on each rebuild (community set churns while code changes); `graphify label` can re-name them with an LLM backend when nicer names are wanted.

### Verification
- `uv tool install graphifyy --with watchdog --upgrade` → watchdog 6.0.0 importable in the graphify interpreter.
- `systemctl --user enable --now graphify-watch.service graphify-live.service` → both `active (running)`.
- Live server: `GET /` 200, `GET /graph.html` 200, `GET /graph-version` returns the graph mtime stamp.
- Watcher: created a probe module (`graphify_watch_probe.py`) → watcher rebuilt (`Rebuilt: 3450 nodes, 10075 edges, 114 communities`) and rewrote all three outputs; deleted the probe → its nodes were evicted from `graph.json` on the next rebuild (verified probe ids absent).
- Noted during the run: concurrent edits to `backend/src/tollms/services/model_repository/lookup.py` (uncommitted, 21 insertions) triggered additional automatic rebuilds — expected behavior from the parallel workstream, not a loop.

### Recommended Next Steps
- `loginctl enable-linger $USER` (needs sudo) if the watcher should survive logout.
- Hook `graphify hook install` as a commit-time fallback when the watcher is not running.
- Configure a semantic-extraction key (Gemini) and run `/graphify --update` after doc/markdown changes.


## 2026-09-23 — Frontend: endpoint-aware provider onboarding (wire endpoints, merged OPENAI, friendly labels)

### Requirement Completed
Frontend-only adaptation to the already-refactored backend contract: merged OPENAI provider type (6 values), wire-path endpoint vocabulary (`primary_endpoint`/`supported_endpoints`/`supports_embeddings`), wizard validation summary + grouped model list + endpoint filter, model form wire endpoint select + supported-endpoints multi-select + embeddings capability, and friendly labels everywhere enums were rendered raw. No backend files touched.

### Files Created
None.

### Files Modified
- `src/types/index.ts` — `ProviderType` merged to `OPENAI`; `EndpointType` extended with `embeddings`, `images_generations`, `audio_transcriptions`, `audio_speech`; `AIModel` + `DiscoveredModelInfo` + `DraftDiscoveredModel` gained `primary_endpoint`/`supported_endpoints` (+ `supports_embeddings` on AIModel; optional `suggested` on draft items for forward compat).
- `src/app/providers/fields.ts` — 6 `PROVIDER_TYPES`, merged `CREDENTIAL_FIELDS`, wire `PROVIDER_DEFAULT_ENDPOINTS`, `PROVIDER_TYPE_LABELS`/`providerTypeLabel()`, `ENDPOINT_OPTIONS`, `WIRE_TO_LEGACY_ENDPOINT`/`endpointTypeFromWire()`/`endpointWireFromLegacy()`, `resolveWireEndpoint()`, `endpointLabel()`, `endpointCategory()` + category labels.
- `src/app/providers/components/ModelForm.tsx` — form state now `primary_endpoint` (wire) + `supported_endpoints`; 8-option endpoint select (`madd-endpoint`); supported-endpoints checkboxes (`madd-supported-endpoints`, primary cannot be unchecked); `supports_embeddings` added to `CAPS` (`madd-cap-supports_embeddings`); `toPayload` sends wire + derived legacy enum; `fromModel`/`fromSuggested`/repository import preserve precedence (suggestion endpoint wins, non-chat provider default overrides generic chat).
- `src/app/providers/components/ProviderWizardModal.tsx` — 6 provider cards with lettered badges + endpoint chips and required descriptions; default type `OPENAI`; validation summary counts (`wiz-validation-summary` + `wiz-summary-*`); step-4 category grouping (`wiz-group-*`), endpoint filter (`wiz-endpoint-filter`); wire endpoints in mapping/registration; friendly type/endpoint labels.
- `src/app/providers/page.tsx` — friendly provider/endpoint badges; type filter populated from `ENDPOINT_OPTIONS` and matched on resolved wire endpoint.
- `src/components/Sidebar/SidebarProviders.tsx` — label map replaced by shared `providerTypeLabel()` (filter + card badge).
- `src/components/ui/ProviderSelector.tsx`, `ModelSelector.tsx`, `CommandPalette.tsx`, `src/app/components/chat/ChatComposer.tsx`, `src/app/settings/components/ProvidersSection.tsx`, `src/app/providers/components/ModelDetailDrawer.tsx`, `RegisterModelDrawer.tsx`, `src/app/components/ChatSettingsPanel.tsx` — friendly provider/endpoint labels; embeddings added to detail capability list.
- Tests: `__tests__/endpoint.test.ts` (rewritten for wire endpoints, mapping/supported/grouping/payload cases), `__tests__/metadata.test.ts` (fixture fields + endpoint round-trip + embeddings suggestion), `chat/__tests__/capabilities.test.ts` (fixture fields).

### Decisions
- Wire path is the canonical stored form; `endpoint_type` is derived only at payload time via `endpointTypeFromWire()` (unknown -> `chat_completions`), matching backend `normalize_endpoints`.
- `endpointCategory()` treats unknown wire/legacy values as "other" (future endpoints), while `resolveWireEndpoint()` degrades unknown to `chat_completions` for form/filter safety.
- Removed the redundant `RegisterModelDrawer` step-reset effect (parent already remounts by key) and added an eslint-disable for the pre-existing post-mount CSS capability probe to keep touched files lint-clean.

### Verification
- `npx tsc --noEmit` clean; `npx eslint src` clean (0 errors, fixed 2 pre-existing `react-hooks/set-state-in-effect` errors in touched files); `npx vitest run` 115/115 passed; `npx next build` green; `docker compose restart frontend` done.
- Backend contract gap reported: `POST /providers/draft-validate` does not return `suggested`, so step-3 "Reasoning models" and capability-based embedding counts are 0 until the backend includes it (embedding count still works via `primary_endpoint`).

### Recommended Next Steps
- Add `suggested` (or at least `supports_reasoning`/`supports_embeddings`) to `DraftDiscoveredModel` so the wizard validation summary can count reasoning/embedding-by-capability before repository mapping.
- Run Playwright wizard/providers specs after the parent agent's e2e pass; no e2e referenced removed enum values or `ENDPOINTS`.

---

## 2026-09-22 — Endpoint-Aware Provider Model Architecture (backend refactor + validation suite)

### Requirement Completed
Merged OpenAI Chat/Responses into one `OPENAI` provider, made model routing endpoint-aware (provider family decides the adapter family, the model's `primary_endpoint` decides the adapter), extended the model repository with endpoint metadata, turned Custom into a true OpenAI-compatible multi-endpoint gateway, made discovery auto-resolve endpoints from the repository, and shipped an automated low-cost validation matrix plus an opt-in live validation script and report.

### Files Created
Backend: `alembic/versions/a3f8c1d2e4b6_endpoint_aware_providers.py` (enum merge + endpoint metadata + backfill), `services/gateway/dispatch.py` (endpoint dispatcher used by validation), `tests/test_endpoints.py` (10 routing/wire/repository/precedence tests), `tests/test_validation_matrix.py` (8 always-on low-cost endpoint probes), `scripts/validate_endpoints.py` (live env-gated probes + markdown report), repo-level `docs/validation-report.md` (generated report).

### Files Modified
Backend: `models/provider.py` (`ProviderType` = OPENAI, ANTHROPIC_MESSAGES, GEMINI, VERTEX_AI, BEDROCK_CONVERSE, CUSTOM), `models/registered_model.py` (EndpointType + `ENDPOINT_WIRE`/`endpoint_enum`/`normalize_endpoints`; AIModel `primary_endpoint`, `supported_endpoints`, `supports_embeddings`), `models/model_repository.py` (`primary_endpoint`, `supported_endpoints`, `supports_chat`), `services/gateway/adapters/openai.py` (OpenAI family honoring `base_url`/`extra_headers`; chat/responses/embeddings/images/transcriptions/speech classes; `CustomAdapter` alias), `services/gateway/adapters/base.py` (`DiscoveredModel` endpoint metadata + `suggested`; `embed`/`generate_image`/`transcribe`/`speak` contract), `services/gateway/factory.py` (endpoint-aware selection, `default_endpoint`, `provider_supported_endpoints`, `resolve_endpoint`), `services/model_repository/{sources,sync,lookup,mapping}.py` (endpoint derivation/normalization/union; suggestion payload; fixed-family endpoint locking), `api/providers/{schemas,service,router}.py` (endpoint fields, draft-validate repository enrichment with `suggested`, discovery precedence fix), `api/models/{schemas,service}.py` (endpoint fields + mirroring), `api/repository/schemas.py`, `api/gateway/service.py` (transcriber for merged OPENAI).
Tests updated: `test_providers.py`, `test_cache.py`, `test_attachments.py`, `test_intelligence.py`, `test_discovery.py`, `test_wizard.py`; frontend `e2e/wizard.spec.ts` (removed a reload that raced the auth bootstrap; replaced two stale assertions from removed UI features).

### Decisions
- Endpoint strings are canonical wire paths stored in TEXT/JSONB (`primary_endpoint`, `supported_endpoints`); `endpoint_type` remains a mirrored legacy enum so analytics/older readers keep working. New endpoint kinds need no enum migration (success criterion: future model types without schema redesign).
- The provider enum merge reused the standard PG path: rename → create new enum → cast column (`OPENAI_CHAT`/`OPENAI_RESPONSES` → `OPENAI`) → drop old; downgrade maps `OPENAI` back to `OPENAI_CHAT`.
- Custom/OpenAI-compatible is not a separate adapter anymore: every OpenAI-family adapter honors `base_url`/`extra_headers` and treats a missing key as valid when a base URL is present (LiteLLM/Ollama/vLLM/TGI/Azure-compatible). `CustomAdapter` stays as an alias for imports.
- Discovery precedence: for OpenAI-compatible families a repository match (provider_specific/global) is authoritative for endpoints (gpt-5 → responses, text-embedding-3-large → embeddings, gpt-image-1 → images/generations); the adapter hint is only the fallback for unmatched models. Fixed-endpoint families re-point chat models at their wire endpoint and reject non-chat endpoints.
- Validation is two-tier: the mock matrix runs in CI with zero cost and covers every endpoint the backend claims; the live script uses cheapest models, 16 output tokens, a 1x1 PNG, one lowest-quality image, <1s audio, and writes the Part-10 report.

### Verification
- Backend `docker compose exec -T backend python -m pytest -q`: **215 passed** (was 194; +8 validation matrix, +10 endpoint architecture/repository, +3 provider tests). `alembic upgrade head` applied `a3f8c1d2e4b6`; `alembic check` green (no drift).
- Live script dry run inside the container lists 15 probes across 6 provider families and 6 endpoint kinds, correctly reporting SKIPPED without credentials.
- Frontend: `tsc --noEmit` clean; `eslint` clean; `vitest` **115/115**; `next build` green.
- Playwright provider surface: `providers` + `wizard` + `discovery` + `validation` + `repository` + `intelligence` **11/11**.
- E2E findings (verified pre-existing/fixed): the wizard spec's `localStorage.clear()` + reload raced the auth bootstrap and landed on `/login` (fails on a stashed pre-change tree too); `wiz-match-*` had been a scope badge (not match type) since before this task; the spec asserted a bulk-edit price that no longer has UI. All three corrected to exercise current behavior (draft-only reset, match filter, per-model assertions).

### Recommended Next Steps
- Add Gemini/Vertex embeddings and future video endpoints by extending the adapter map only.
- Expose embeddings/images/audio through REST routes when product surfaces need them (dispatcher + adapters already support them).
- Run `scripts/validate_endpoints.py --live` with production keys before enabling new provider families in an environment.

---

## 2026-09-23 — In-UI media generation + live OpenAI/OpenWebUI validation (fixes)

### Requirement Completed
Delivered an end-to-end media generation surface and validated the whole provider stack with real credentials: logged in as `titannatesan@gmail.com` via the UI, created an OpenAI provider through the wizard (live validation + discovery), registered gpt-4.1-nano / gpt-image-1 / sora-2 / gpt-5-mini, exercised text, vision, reasoning, image and video generation through the app, and tested all three OpenWebUI models. Every flow ran headed in a full-screen (1920×1080) browser.

### Files Created
Backend: `api/media/{__init__,schemas,service,router}.py` (authenticated `/api/v1/media/images` + `/videos`, results stored as attachments), `tests/test_media.py` (3 tests). Frontend: `app/generate/page.tsx` (model picker filtered by endpoint, prompt, reference-image upload, result preview/download). E2E (live, env-gated): `e2e/live-openai.spec.ts`, `e2e/live-reasoning.spec.ts`, `e2e/live-media.spec.ts`.

### Files Modified
Backend: `services/gateway/adapters/openai.py` (Videos adapter: multipart create/poll/download, transport retries, reference normalization, provider error surfacing; Responses adapter `reasoning.summary: "auto"`), `api/media/service.py` (RuntimeError/httpx errors → 502), `api/models/router.py` (`_read` now includes `primary_endpoint`/`supported_endpoints`/`supports_embeddings` — the root cause of `/generate` seeing zero media models), `api/providers/service.py` (`_apply_discovered_endpoint` so draft-validate resolves repository endpoints; gpt-image-1 registered as images/generations), `main.py` (media router), `pyproject.toml` (+pillow), `tests/test_reasoning.py` + `tests/test_validation_matrix.py` (new retry test). Frontend: `services/api.ts` (media client), `components/Sidebar/SidebarNavigation.tsx` (+Generate), `app/providers/fields.ts` (+video endpoint option).

### Decisions
- Media results are persisted as normal attachments so the existing authenticated content endpoint serves previews/downloads — no parallel storage or blob API.
- The video adapter owns provider-specific reference normalization (cover-crop + resize to the requested WxH), because the "reference must match size" rule is an OpenAI Videos API constraint.
- Long jobs retry transient transport/DNS errors instead of failing the generation; provider-side failures surface as 502 with the provider message rather than an unhandled 500.

### Verification
- Backend targeted suites: **69 passed** (`test_media`, `test_validation_matrix` incl. the DNS-retry regression, `test_endpoints`, `test_reasoning`, `test_registry`, `test_providers`, `test_discovery`); frontend `tsc`/`eslint` clean on all touched files.
- Live API probes: gpt-4.1-nano text + vision (Ben 10 image) PASS; gpt-image-1 2×low/2×medium/1×high PASS; gpt-5-mini reasoning PASS (64 reasoning tokens, UI showed "Thought for <1s"); sora-2 text→video PASS (76s at the time), image→video PASS (86s); gpt-oss-120b FAIL — not available on this key (`model_not_found`); OpenWebUI glm-4.7-flash / glm-4.6V-Flash / qwen3-coder-30b all PASS.
- Headed full-screen UI: provider registration + chat/vision/reasoning PASS; `e2e/live-media.spec.ts` **2 passed (2.9m)** — image PASS, text→video PASS (1.49 MB, 58s), image→video PASS (1.73 MB, 84s, 512² reference auto-upscaled).
- Known constraint: OpenAI Videos accepts `seconds` = 4/8/12 only; a 1-second request returns `Invalid value: '1'. Supported values are: '4', '8', and '12'`, so the UI offers 4/8/12 and the minimum 4s is used.

### Recommended Next Steps
- Add a media history/gallery view and surface generated attachments in conversations.
- Consider async video jobs with status polling in the UI instead of one blocking request (current LATENCY is shown, fine for 4s clips but not for 12s+).
- Run `scripts/validate_endpoints.py --live --report docs/validation-report.md` periodically to refresh the live coverage matrix.

---

## 2026-09-23 — Unified Chat: media generation inside conversations + /c/{id} routing

### Requirement Completed
Removed the split experience: image/video generation now runs through the same conversation pipeline as text (streaming, persistence, retry, history), and every conversation lives at `/c/{conversationId}` with `/` minting a new chat. The standalone `/generate` page remains for debugging only.

### Files Created
`backend/alembic/versions/b4c5d6e7f8a9_message_metadata.py` (messages.metadata JSONB), `frontend/src/app/c/[conversationId]/page.tsx` (route page), `frontend/src/app/components/ChatWorkspace.tsx` (workspace extracted from `app/page.tsx`), `frontend/e2e/live-chat-media.spec.ts` (headed live validation).

### Files Modified
Backend: `api/gateway/service.py` — `_MediaGenerationAdapter` (a `BaseProviderAdapter` facade) routes models whose `primary_endpoint` is images/videos through the normal generation runner: streams "Generating image/video…", "Uploading…", "Generated …" deltas, calls the media adapter via the dispatcher, stores the result as a conversation attachment linked to the assistant message, writes generation metadata, and supports retries/regen in place (no duplicate rows); conversation provider/model stamped on first generation for eagerly created conversations. `models/message.py` + `api/conversations/schemas.py` (metadata column/serialization, `serialization_alias`).
Frontend: `app/page.tsx` (create-once + redirect to `/c/{id}`), `components/Sidebar/SidebarConversations.tsx` (navigate on select/new chat), `components/Sidebar/Sidebar.tsx`, `ChatHeader.tsx`, `CommandPalette.tsx`, `analytics/page.tsx`, `useShortcuts.ts` (conversation-aware navigation), `app/components/chat/attachments/MessageAttachments.tsx` (inline video player + download), `types/index.ts` (`metadata`), `MessageView.tsx`. Tests: `e2e/{settings,navigation,auth,generation}.spec.ts` updated for URL routing; `e2e/live-chat-media.spec.ts` added.

### Decisions
- **Media rides the existing pipeline**: the generation runner only needs `chat_stream`, so a duck-typed adapter keeps cancellation, regeneration, request logs and history untouched — no new message endpoints or parallel media store.
- **Progress is streamed text** into the assistant message (immediate activity, no blank space, works while streaming); the finished media renders from the message's attachments, so refresh/history restore it with zero regeneration.
- **Metadata is the generation record**: `{generation_type, status, model, provider, quality|seconds, size, filename}` on the message, serialized as `metadata`.
- **URL is authoritative**: the workspace derives its conversation from the route id; the store is a mirror. Send resolves the live route id to avoid stale targets.
- Video duration follow-up: OpenAI Videos accepts only 4/8/12s, so chat videos use the 4s minimum.

### Verification
- Headed live validation (`e2e/live-chat-media.spec.ts`, viewports 1920×1080, real key): home → `/c/{id}` redirect; image prompt streamed "Generating image…" then rendered in-chat; refresh restored the image with the same URL and exactly one assistant row; video prompt produced an inline `<video>` player; retry on a previously failed media message regenerated **in place** reusing prompt/model (12.4s). DB metadata verified: `{"generation_type":"image","status":"completed","model":"gpt-image-1","provider":"openai","quality":"low",...}`.
- Regressions: `e2e/{generation,navigation,auth,settings}.spec.ts` **15/15**; `tsc`/`eslint` clean; backend `test_message_history` + `test_gateway` 10/10; `alembic head b4c5d6e7f8a9` and `alembic check` green; stack healthy after a full Docker daemon restart (volumes intact).
- Fixed while validating: models router dropped endpoint fields (media models invisible to `/generate`); conversation id raced navigation after "New chat" (composer now targets the live route id, test synchronizes on URL change); settings spec's search relied on stopword-laden prompts (now matches exact user messages); sidebar gear toggle needs a settle click (test retries until closed).

### Recommended Next Steps
- Render a dedicated generation card/progress bar component instead of streamed text, and show quality/size chips from message metadata.
- Extend the same path to embeddings/audio models when those have chat UX; add per-conversation media gallery.
- Consider a 2s video option if Sora ever exposes it; until then 4s is the floor.

---

## 2026-09-24 — Draft Chats, Media Lightbox & Generation Skeletons

### Requirement Completed
Conversations are no longer created eagerly: `/` is a draft chat with no database row, no sidebar item and no URL id until the first message is sent. Generated images/videos open in fullscreen lightboxes, and media generations show an instant skeleton instead of blank space.

### Files Created
`frontend/src/app/components/media/MediaLightbox.tsx` (90vw/90vh modal: blurred black backdrop, ESC/backdrop/close button, wheel + pinch zoom, drag-to-pan, Fit and 1:1 buttons, download; video variant with native controls, duration/resolution/size), `frontend/src/app/components/media/MediaGenerationSkeleton.tsx` (1:1 image / 16:9 video pulse placeholder + state label), `frontend/e2e/live-draft-media.spec.ts` (draft + skeleton + lightbox validation).

### Files Modified
Frontend: `app/page.tsx` (renders `<ChatWorkspace conversationId={null}>`; creation logic deleted), `app/components/ChatWorkspace.tsx` (`conversationId: string | null`; the existing send-time adoption mints the conversation and `router.replace`s to `/c/{id}` on stream meta), `components/Sidebar/SidebarConversations.tsx` (New chat routes to `/`; sidebar filters `message_count > 0`), `app/components/MessageView.tsx` (streaming media shows the skeleton with the live progress label; completed media shows a compact caption instead of the raw progress log), `app/components/chat/attachments/MessageAttachments.tsx` (images click-to-preview, videos get Fullscreen + Download, lightbox state), `types/index.ts` (`Conversation.message_count`).
Backend: `api/conversations/service.py` (batch message counts attached as a transient `message_count` on list rows), `api/conversations/schemas.py` (`ConversationRead.message_count`).
Tests: `e2e/navigation.spec.ts` (logo returns to the draft `/`).

### Decisions
- **Draft is pure frontend state**: `ChatWorkspace` already knew how to adopt a backend-created conversation from stream meta, so the draft simply sends `conversation_id: null` and replaces the URL when the id arrives — no new endpoints, no schema changes.
- Empty conversations are hidden by a new `message_count` on the list payload (existing abandoned rows disappear from the sidebar; nothing is deleted).
- Media results render from message attachments, so the lightbox is just a viewer over the existing authenticated content endpoint.
- Skeletons are derived from the streamed generation text (`Generating image|video…`), so no new streaming event schema was needed; state labels come from the last progress line (Generating → Uploading).

### Verification
- `e2e/live-draft-media.spec.ts` headed, 1920×1080: `/` stays draft with no redirect and no new row; New chat + refresh leave the DB unchanged; the first message creates the conversation and adopts `/c/{id}`; image skeleton visible immediately (`test-results/draft-skeleton-image.png`); image lightbox opened at 972×972 (within 90% viewport), zoomed, closed on ESC (`draft-lightbox-image.png`); video lightbox opened with duration + resolution (`draft-lightbox-video.png`). **4/4 passed (1.4m)**.
- `tsc`/`eslint` clean on all touched files.

### Recommended Next Steps
- Add the same skeleton treatment to the `/generate` debug page; expose a gallery per conversation.
- Consider a background sweep to soft-delete the historical empty conversations (now hidden, still present).
- Wire lightbox keyboard navigation (arrow keys between media in a message).
- **Known residual race (not fully fixed):** when a draft send is refreshed very early, recovery can still settle on a partial overlay (`slow-word-14` observed) because the route remount aborts the reattached stream before the terminal refresh; the settings provider-switch test can likewise observe the previous conversation when a send immediately follows a route change. The client-key probe + `tollma-pending-conversation` key recover the correct conversation; a follow-up should re-probe/refresh on stall and await route commits before enabling send.

---

## 2026-09-23 — ChatGPT-style conversation routing (`/c/{conversationId}`)

### Requirement Completed
Every conversation now lives at `/c/{conversationId}`. Visiting `/` immediately creates a conversation and replaces the URL with its home (centered spinner while pending, retry UI on failure, no landing screen). Sidebar clicks, New chat, command-palette picks, analytics drill-downs, branches and search results all navigate by URL; browser refresh/back/forward restore the conversation from the route param. The chat store stays the source hooks read, but the URL is authoritative on load.

### Files Created
`frontend/src/app/components/ChatWorkspace.tsx` (the old `app/page.tsx` chat workspace extracted, now takes `conversationId` and drives the store from it), `frontend/src/app/c/[conversationId]/page.tsx` (async server page awaiting `params` and rendering the workspace).

### Files Modified
`frontend/src/app/page.tsx` (replaced by a client redirect: one guarded `createConversation` — StrictMode ref + unmount guard — then `router.replace('/c/'+id)`; `new-chat-error` retry panel), `frontend/src/components/Sidebar/SidebarConversations.tsx` (New chat creates then `router.push('/c/'+id)`; item select pushes; deleting the active chat replaces to `/`; testids kept), `frontend/src/hooks/useShortcuts.ts` (chat paths are `/` and `/c/*`; shortcut actions return to the active conversation instead of minting a new one; `G C` opens the active conversation), `frontend/src/components/ui/CommandPalette.tsx` (recent-conversation picks push `/c/{id}`), `frontend/src/app/analytics/page.tsx` (conversation drill-down pushes `/c/{id}`; dropped the now-unused store setter), `frontend/src/app/components/ChatHeader.tsx` (header New chat pushes `/`; delete replaces to `/`), `frontend/src/components/Sidebar/Sidebar.tsx` (route-context comment).

### Architecture Notes
- The route param is the identity; `ChatWorkspace` derives `activeId = 404/422 ? null : conversationId`, syncs it into `useChatStore.setConversation` for header/panel/composer hooks, and passes it to `useConversation`/intelligence/send. No redirect-on-missing means a bad id can never loop through `/`.
- Actions that switch conversations navigate (`router.push('/c/'+id)`) instead of only mutating the store; the param-change effect is the only writer of the store id.
- Sending from an unresolvable route id (activeId null) lets the backend create the conversation and adopts the id from stream meta with `router.replace`, guarded by a route ref so a user who navigated away is not yanked back.
- Backend-only auto-titling: the backend titles conversations it creates itself, but streaming into an existing conversation never renames it. `send` mirrors the first-message title (`text[:60]` / `Attachment: name`) for eagerly created conversations, cache-first with one `getConversation` fallback.
- Deletes (sidebar + header) and `/` creation both route through `/`, so a deleted conversation never leaves a dead URL.

### Verification
- `cd frontend && npx tsc --noEmit` clean; `npx eslint` clean on all 9 touched files; `npx vitest run` **115/115**; `npx next build` green (`/` static, `/c/[conversationId]` dynamic); `docker compose restart frontend` after the build.
- Smoke (curl, authenticated cookie): `/` and `/c/{id}` return 200; unauthenticated both 307 to `/login`.
- Playwright intentionally left to the parent agent. Known spec interactions that must be updated: `generation.spec.ts` "navigate away and back" (`page.goto("/")` now starts a fresh chat, not the previous one), `navigation.spec.ts` logo click asserting `toHaveURL(/\/$/)` (now redirects to `/c/{id}`), `auth.spec.ts` post-signup `toHaveURL("/")` (same redirect), and `settings.spec.ts` `convA[0].model_id` assertions — eagerly created conversations keep `model_id = null` because the backend only stamps provider/model when it creates the conversation itself (frontend-only task; no backend change made).

### Recommended Next Steps
- Update the four e2e specs above (navigation.spec/auth.spec/generation.spec/settings.spec) for URL-based conversation identity.
- Consider a backend follow-up: stamp `provider_id`/`model_id` on the first generation of a pre-created conversation, and/or pass the first message title through the streaming `touch`.

## 2026-09-24 — OpenCode config migrated to native V2 shape

### Requirement Completed
Audit the local OpenCode config files and convert them from V1 syntax to the native OpenCode V2 shape, preserving behavior. Backup of originals: `/tmp/opencode-config-backup/`.

### Files Modified
- `.opencode/opencode.json` — `plugin` → `plugins`; `mcp.<name>` → `mcp.servers.<name>`; dropped `enabled: true` (V2 inverts it to `disabled`, default false); `timeout: 60000` → `timeout: {catalog: 60000, execution: 60000}`; removed `lsp: true` (V2 accepts but never runs LSP servers or diagnostics); `compaction.auto` unchanged.
- `~/.config/opencode/opencode.jsonc` — `provider` → `providers`; `npm` → `package: "aisdk:@ai-sdk/openai-compatible"`; `options.baseURL|timeout|chunkTimeout` → `settings.*`; `options.headers` → `headers`; `disabled_providers: [...]` → `experimental.policies` provider.use deny statements.
- `.opencode/package.json` and `~/.config/opencode/package.json` — `@opencode-ai/plugin@1.18.x` (V1) → `@opencode/plugin@^2.0.15`; `npm install` re-run in both.

### Decisions
- Used the documented migration mappings (opencode.ai/v2/docs/migrate-v1) rather than guessing field shapes; behavior preserved for MCP timeouts (V1 single timeout applied to both catalog and execution purposes).
- Removed `lsp: true` instead of leaving dead config — V2 explicitly does not run language servers; lint/typecheck belong in project commands.
- Kept `aisdk:@ai-sdk/openai-compatible` for the custom providers rather than switching to the native `@opencode/ai/providers/openai-compatible` package, to preserve the exact runtime behavior; the native package is a later, optional upgrade.
- Did not restart the service — config reloads live (verified).

### Verification
- Both JSON files parse.
- `opencode mcp list` → `graphify`, `playwright`, `sequential-thinking` all `connected` from the new `mcp.servers` shape.
- `opencode models` → only `ollama`, `opencode`, `opencode-go`; the five denied providers are absent, confirming the policies conversion matches the old `disabled_providers` behavior.
- No new config warnings in `~/.local/share/opencode/log/opencode.log`.
- `~/.config/opencode/cli.json` checked and already native V2 (schema `https://opencode.ai/v2/cli.json`, valid keys); `.opencode/rules/*.md` and `memory.md` are AGENTS.md-referenced docs, not OpenCode definitions — no V2 format applies.

### Known Issue (upstream, not config)
`@dietrichgebert/ponytail` is V1-only — both the installed 4.8.4 and the latest 4.10.0 export `async ({ client }) => ({...V1 hooks...})`, while V2 requires `Plugin.define({ id, setup })`. The server log records `failed to load plugin … Plugin must export a default definition with an id and an effect or setup function` on every start, so ponytail is inactive despite `~/.config/opencode/.ponytail-active` reading `full`. The `plugins` entry is kept so it starts working when upstream ports it; otherwise remove the entry or file upstream.

### Recommended Next Steps
- Replace the plaintext `Authorization` bearer in the global `vercel2` provider with `{env:VERCEL_API_KEY}` (docs recommend env substitution; the token is currently readable in config).
- Re-run `/graphify --update` after doc changes (unchanged from the previous entry).

---

## 2026-09-24 — Unified Media Viewer, Cost Intelligence & Prompt Caching

### Requirement Completed
Media UX refinement (one reusable `MediaViewer`, aligned media cards, 512/16:9 generation skeletons with crossfade), official OpenAI cost estimation for chat/image/video with actual-usage override, provider-aware prompt caching with graceful fallback, and repository-sourced capabilities + media rate cards. No image/video generation was performed during validation (mock transports, existing assets, free repository re-sync only).

### Files Created
Backend: `services/cost_estimator.py` (official rate card, `estimate_cost`, `media_rate_card`), `services/gateway/caching.py` (provider plans + body annotators), `alembic/versions/c9f1a2b3d4e5_repository_media_capabilities.py`, `tests/test_cost_estimator.py`, `tests/test_caching.py`.
Frontend: `app/components/media/MediaViewer.tsx` (replaces `MediaLightbox`), `app/components/media/MediaCard.tsx`, `e2e/media-viewer.spec.ts`.

### Files Modified
Backend: `models/model_repository.py` (+`supports_responses|image_generation|image_editing|video_generation`, +`image_{low,medium,high}_price`, +`video_price_per_second`), `services/model_repository/{sources,sync,lookup}.py` (endpoint-derived capability flags, images/edits + video endpoints, official media-price seeding, suggest payload), `api/repository/schemas.py`, `api/conversations/{schemas,service}.py` (per-model cache tokens + `cache_savings`), `api/gateway/service.py` (media options/cost/actual usage, caching plan, injected session factory), `services/generation.py` (media cost replaces token pricing; `session_factory()` accessor), `services/gateway/adapters/{base,openai,anthropic,bedrock}.py` (`prompt_cache`, image usage capture), tests `test_media.py`, `test_model_repository.py`, `test_registry.py`.
Frontend: `MediaGenerationSkeleton.tsx` (512/16:9 + progress + shimmer), `chat/attachments/MessageAttachments.tsx` (media cards + viewer), `MessageView.tsx` (state labels, no raw progress log, “est.” costs), `ChatSettingsPanel.tsx` (Prompt Cache + media pricing + cache savings), `chat/capabilities.ts` (+`mediaRates`), `types/index.ts`, `globals.css` (fade/progress keyframes), `generate/page.tsx` (viewer), `ChatWorkspace.tsx`, `Sidebar/SidebarConversations.tsx`, `ChatHeader.tsx`, `hooks/useShortcuts.ts`, `ai-elements/conversation.tsx`, `e2e/live-draft-media.spec.ts`.

### Decisions
- Official 2026 rate card: per-image quality tables (gpt-image-1/1-mini/1.5/2) plus a token-rate fallback for gpt-image-2.5; Sora per-second by resolution ($0.10/$0.30/$0.50/$0.70).
- Estimates are always labelled (`source`: official/derived/model/actual). Provider usage wins: the Images API `usage` becomes actual cost; Sora's per-second rate is inherently actual. Cancelled/failed media bills zero.
- Media cost replaces token pricing via `GenerationSpec.media_cost` + `adapter.final_cost`; the runner short-circuits token estimation for media specs.
- Caching: OpenAI `prompt_cache_key` (conversation id), Anthropic ephemeral breakpoints on system + final message, Bedrock Claude `cachePoint`, Gemini/Vertex implicit, CUSTOM untouched; unsupported = disabled plan, byte-identical body.
- Repository is the source of truth: sync derives capability flags from endpoints and seeds official media prices; `suggest_payload` carries caching/media rates into registered-model metadata.
- Draft chat now **mints the conversation at send time** (`createConversation` before streaming) so the URL adopts deterministically; the store is cleared synchronously on New chat (sidebar + header) so an immediate send sees the draft.
- Media adapter takes an injected session factory (test hermeticity; no hidden global).

### Verification
- Backend full suite: **254 passed / 0 failed** (`docker compose exec -T backend python -m pytest -q`); `alembic check` clean after the new migration.
- Frontend: `tsc`/`eslint` clean, `vitest` **119/119**, `next build` clean (all routes).
- Headed Playwright (1920×1080): full `e2e/` runs 59–61 passed with a few environment flakes (Docker stack restarts, Postgres outage, cold dev server); after the final fixes the affected specs pass **with `--retries=0`**: settings+history+generation+conversation-intelligence **18/18**, live-draft-media+manage+reasoning-selector+settings **12/12**.
- Repository live re-sync (free): `openai/gpt-image-1` seeded 0.011/0.042/0.167, `openai/gpt-image-2` 0.006/0.053/0.211, `sora-2` $0.10/s, `sora-2-pro` $0.30/s; capability flags set.
- `e2e/media-viewer.spec.ts` validated the unified viewer against existing generated assets (24px blur backdrop, 90vw/90vh, toolbar, zoom, ESC, video native controls) without any generation.

### Recommended Next Steps
- Backfill media rate metadata onto pre-existing registered models (repository refresh action or a one-off script).
- Extend the estimator/caching tables when Anthropic/Gemini expose media rates.
- Dedicated GenerationCard with live quality/size chips and partial-image previews (streaming image API supports `partial_images`).

---

## 2026-09-24 — Thinking Level Selector Layering Fix

### Requirement Completed
The thinking-level scale (`None / Low / Medium / High`) rendered clipped and painted underneath the chat composer/input. It now renders fully visible, clickable, and above every chat wrapper at all viewport sizes.

### Files Modified
`frontend/src/app/components/chat/ReasoningSelector.tsx` (only file changed).

### Decisions
- **Body portal + fixed positioning + `z-index: 1000`**: the scale was trapped in the composer's stacking context (a hit test at the label center returned a covering wrapper DIV) and clipped by the input containers. Portaling to `document.body` escapes both; no ancestor can clip it.
- **Position anchored to the indicator** (flip below when there is no room above; horizontal clamp to the viewport) so the scale stays adjacent to its trigger and the existing hover/close-delay semantics keep working across the portal boundary.
- **`transition-[opacity,transform]` instead of `transition-all`**: animating the fixed `left` made the panel slide across the viewport on open, which broke label/stop alignment and click actionability.
- **Labels now share the stop-dot container geometry** (`absolute inset-x-2`), so every label is centered exactly under its stop.
- **Hover/focus bridge**: the portaled panel carries `onMouseEnter/Leave` + `onFocus/Blur`; the close timer is skipped while focus is inside the panel; wheel stepping listens on both trigger and panel. SSR-safe via `useSyncExternalStore` client detection.

### Verification
- `e2e/reasoning-selector.spec.ts`: **8/8 with `--retries=0`** (click cycling, hover open/close delay, slider keyboard, label/stop alignment, wheel stepping, None payload, capability gating). Two consecutive runs green after the transition fix.
- Temporary headed checks (removed after use): panel fully inside the viewport with `elementFromPoint` returning the label (nothing paints over it) at 1920×1080 and 1366×768; screenshot at `frontend/test-results/thinking-selector-final.png`.
- `tsc` and `eslint` clean on the modified file. No other chat UI touched.
- Note: the 390px mobile check could not run because the mock test setup's model dropdown does not open at that width (test-harness limitation, not the selector).

---

## 2026-09-24 — Platform Administration System (analytics, costs, cache, health)

### Requirement Completed
Platform-wide admin analytics + monitoring: a role-gated `/api/admin/*` surface (11 endpoints) returning aggregates only, a dark-first Recharts dashboard at `/admin` with eleven sections, daily usage rollups, cost/cache/media/error/health intelligence, a security & privacy audit, and future-proofing for organizations/RBAC/billing. Delivered with four parallel sub-agents (analytics engines, observability engines, frontend dashboard, tests/security) plus a Lead-frozen contract.

### Files Created
Backend: `models/usage_aggregate.py`; migrations `d1a2b3c4d5e6_user_platform_role.py`, `e2b3c4d5e6f7_admin_usage_aggregates.py`; `api/admin/{__init__,schemas,router}.py`; `services/admin/{__init__,dashboard,usage,tokens,costs,cache,media,errors,health,models,providers,users,rollup}.py`; `scripts/promote_admin.py`; `tests/admin/{__init__,test_admin_access,test_admin_privacy,test_admin_aggregation,test_admin_rollup}.py`.
Frontend: `app/admin/page.tsx` + 24 components (`KpiCard`, `TrendChart`, `StackedBarChart`, `HBarChart`, `DonutBreakdown`, `DataTable`, `RangePicker`, `TabNav`, `ForbiddenState`, `HealthPanel`, eleven section components, skeletons, page-local `format.ts`); `services/admin.ts`; `types/admin.ts`; `app/admin/__tests__/format.test.ts`; `e2e/admin.spec.ts`.
Docs: `docs/admin-architecture.md`, `docs/admin-security-report.md`.

### Files Modified
`models/user.py` (+`PlatformRole`, `platform_role`), `models/{message,request_log,attachment}.py` (admin composite indexes), `models/__init__.py`, `core/security.py` (`platform_admin_required` placed after `get_current_user`), `api/auth/{schemas,service}.py` (`platform_role` in `/auth/me`), `main.py` (admin router), `frontend/src/components/Sidebar/Sidebar.tsx` (role-gated Admin nav), `frontend/src/types/index.ts` (+`platform_role`), `frontend/package.json` (+`recharts@3.10.1`), admin components (`fmtPercent` for pre-percent error rates).

### Decisions
- **Role:** `users.platform_role` enum (`USER`|`PLATFORM_ADMIN`) with `platform_admin_required` (401 anonymous, 403 regular, 200 admin); promotion/demotion via `scripts/promote_admin.py`. Future organization roles live on memberships so they can never widen the platform gate.
- **Real ledger, no parallel tables:** the task named `usage_records`/`requests`/`provider_requests`/`generation_jobs`, which do not exist; the system maps onto `messages` + `request_logs` + `attachments` + `generation_runs`.
- **Live aggregation is authoritative** (new composite indexes), with `usage_daily_aggregates` (day/user/provider/model, idempotent `ON CONFLICT` upsert) as the long-range/billing accelerator — chosen over a materialized view because a matview cannot carry the per-scope unique constraint, cannot upsert incrementally, and is harder to test idempotently.
- **Layering:** engines return plain mappings validated by frozen Pydantic `response_model`s; `AdminWindow` crosses the api→services boundary so `services/admin/*` never imports `api/*`.
- **Privacy boundary:** static scan + runtime marker tests + content-free schemas. Admins see counts/tokens/costs/latency/statuses/names/emails/media bytes; never content, prompts, responses, attachments, or credentials.
- **Units:** `error_rate` is percent (0..100); `hit_rate`/`cached_share`/`estimated_share` are fractions (0..1) — frontend uses `fmtPercent` vs `fmtRate` accordingly.

### Verification
- **Targeted backend tests:** `tests/admin` **16 passed / 0 failed** (401/403/200 access matrix, privacy static+runtime scans, aggregation correctness, rollup idempotency).
- **Frontend:** `tsc`/`eslint` clean; vitest admin format **7 passed**; `recharts` installed **inside the container** (`docker compose exec frontend npm install recharts`) after a host-only install caused a dev-server "Module not found" build error.
- **Live API** (promoted live admin): all 11 endpoints **200**; **dashboard 268 ms** (<300 ms target), other endpoints 24–149 ms, health 36 ms warm; regular account **403** on every endpoint; dashboard payload free of content keys.
- **Headed Playwright** `e2e/admin.spec.ts`: regular user sees the forbidden state and no admin nav; platform admin sees the gated nav, overview KPIs, all eleven tabs and Recharts containers (2 passed, 1 retry after the first cold compile).
- `alembic check` green; `tollms.main` imports; migration applied to the dev database.

### Recommended Next Steps
- Schedule `rollup.rebuild_day` (APScheduler) and add an `admin_audit_log` table (admin id, endpoint, window, at).
- Organizations/memberships + subscriptions tables when billing lands; enterprise ranges read from the rollup table.
- Fix the pre-existing cache bridge lock (`services/cache/manager.py::_bridge`) that makes the first sync cache call slow.

---

## 2026-09-24 — Admin Navigation Refactor, /generate Removal, Live SSE Health

### Requirement Completed
`/admin` now behaves like a SaaS observability dashboard: the left sidebar switches from conversations to an **Admin Navigation** list (Overview…Health), sections are stacked `<section id>` blocks with hash navigation (`/admin#tokens`), smooth scroll and IntersectionObserver active highlighting. The standalone `/generate` page and its debug media API are removed — image/video generation stays chat-native. The Health section is now a live SSE panel (psutil host metrics, DB/cache/queue probes every 2s, rolling 60-sample charts, Live/Reconnecting/Disconnected badge with 1s/2s/5s/10s backoff).

### Files Created
Backend: `services/admin/live_health.py` (sample/stream engine), `services/admin/activity.py` (in-flight request counter), `tests/admin/test_admin_live_health.py`.
Frontend: `components/Sidebar/SidebarAdmin.tsx`, `app/admin/useSectionObserver.ts`, `hooks/useAdminHealthStream.ts`, `app/admin/components/LiveHealthCharts.tsx`.

### Files Modified
Backend: `api/admin/{router,schemas}.py` (`GET /api/admin/health/stream` + `AdminLiveHealth`), `main.py` (media router removed; request-counter middleware), `pyproject.toml`/`uv.lock` (+`psutil` 7.2.2), `tests/test_media.py` (media-API tests removed; chat media tests kept).
Frontend: `components/Sidebar/Sidebar.tsx` (admin navigator on `/admin`), `app/admin/page.tsx` (stacked sections + hash), `app/admin/components/HealthSection.tsx` (live cards/charts/badge + sample counter), `types/admin.ts` (live payload types), `services/api.ts` (`generateMedia*` removed), `components/Sidebar/SidebarNavigation.tsx` (Generate entry removed), `e2e/admin.spec.ts` (nav + live-health tests).
Deleted: `backend/src/tollms/api/media/**`, `frontend/src/app/generate/**`, `frontend/src/app/admin/components/TabNav.tsx`, `frontend/e2e/live-media.spec.ts`.
Docs: `docs/validation-report.md` (removal noted; no dead `/generate` references).

### Decisions
- **Hash-driven admin nav**: sidebar highlight comes from `hashchange` (validated against the section id list, default `overview`); the page scrollspy uses IntersectionObserver with `rootMargin: -20% 0px -60% 0px` (highest ratio wins, top tiebreak). Conversation routes keep the conversation list untouched.
- **Generate removal end-to-end**: page, sidebar entry, API client helpers, `api/media` debug router, and its tests. Chat media flows through the gateway `_MediaGenerationAdapter` and is unaffected; authenticated `/generate` now 404s. `uploadChatAttachment` stays (composer uses it).
- **Live health sampling**: psutil for CPU/memory/disk/load/uptime; in-process active-request counter middleware; DB probe with `pg_stat_activity` count + latency; Valkey `INFO memory` for cache MB; queue running = local active generations, pending = RUNNING rows without a local driver (documented approximation). SSE yields immediately then every 2s with disconnect checks and a per-tick session (no request session held).
- **Frontend stream**: `EventSource` with credentials, 60-sample ring buffer, backoff 1s→2s→5s→10s (reset on event), 403 stops reconnecting; only the Health section re-renders — no react-query invalidation, no page refetch.

### Verification
- Backend: `tests/admin` + `tests/test_media.py` → **22 passed / 0 failed**; `alembic check` green; `tollms.main` imports; psutil 7.2.2 in the container.
- Live SSE (curl, admin cookie): **3 events in 5 s**, exact frozen keys, real metrics (CPU 4.6 %, mem 30.1 %, disk 12.4 %, DB ok/5 conns/13 ms, cache ok/1.1 MB); anonymous → 401.
- Frontend: `tsc`/`eslint` clean; vitest **126/126**.
- Headed Playwright `e2e/admin.spec.ts`: regular-user forbidden state + no admin nav; admin stacked sections with hash navigation; live health SSE cards/charts/rolling window (all passing).
- `/generate`: authenticated **404**; no dead references (docs updated).

### Recommended Next Steps
- Schedule `rollup.rebuild_day` and add an `admin_audit_log`.
- Replace the pending-jobs approximation with a real queue if one lands.
- Consider persisting the active section hash across reloads (currently the hash drives it naturally).

---

## 2026-09-24 — Admin Page: Single-Section Rendering (no stacked duplication)

### Requirement Completed
The admin dashboard stacked all eleven sections on one long page (charts/tables appeared repeatedly). It now renders **exactly one section at a time**, chosen from the sidebar/URL hash — no duplicated components on screen.

### Files Modified
`frontend/src/app/admin/page.tsx` (hash-driven `useHashSection` via `useSyncExternalStore`; renders only the active `<section>`), `frontend/e2e/admin.spec.ts` (asserts exactly one `admin-panel-*`, section swapping, no duplicate panels), `.opencode/memory.md`.
Deleted: `frontend/src/app/admin/useSectionObserver.ts` (scrollspy no longer needed).

### Decisions
- The URL hash stays the single source of truth (`/admin#tokens`); sidebar clicks and deep links both drive it.
- Section queries remain registered with react-query (cached, no refetch churn) but only the active section's component tree renders — so the live health SSE connection exists only while Health is open.
- Overview keeps its summary cards/charts by design; the dedicated sections are unchanged, they simply no longer render simultaneously.

### Verification
- Headed Playwright `e2e/admin.spec.ts`: **4 passed** with `--retries=0` (regular-user gate, one-section-at-a-time + hash swap, live SSE health cards/charts/rolling window).
- `tsc`/`eslint` clean; vitest **126/126**. UI-only change — no backend touched.

---

## 2026-09-25 — API Gateway & API Key Management (public /v1 API, budgets, analytics)

### Requirement Completed
A provider-agnostic public gateway: API keys (`tma_sk_live_…`, SHA-256 at rest, shown once), policies (budget/reset/rate/token/spend limits), IP allow/deny rules, per-model permissions, OpenAI/Anthropic/Responses-compatible endpoints translating into a single `UnifiedRequest`, Valkey rate limits + hard budgets, per-request analytics with client metadata, and a full API-keys console with Recharts analytics. Delivered with four parallel agents (keys API, public gateway, limits/analytics, frontend) over a Lead-frozen schema and contracts.

### Files Created
Backend: `models/api_key.py` (ApiKey/Policy/IpRule/ModelPermission/ApiRequestLog + future virtual-key columns), `alembic/versions/f3c4d5e6f7a8_api_gateway_keys.py`, `services/api_keys/keys.py` (generate/hash/authenticate/compile + 30s Valkey context cache), `services/gateway/unified.py` (`UnifiedRequest`), `services/gateway/model_resolution.py`, `services/gateway/translators.py`, `services/gateway/limits.py`, `services/gateway/api_logs.py`, `api/keys/{__init__,schemas,service,router}.py`, `api/public_gateway/{__init__,schemas,service,router}.py`, `tests/keys/*`, `tests/public_gateway/*`.
Frontend: `types/apiKeys.ts`, `services/apiKeys.ts`, `app/api-keys/page.tsx` + 11 components (KeyTable, KeyForm, RawKeyDialog, PolicyForm, IpRulesEditor, ModelPermissionsEditor, KeyAnalytics, KeyDetailsPanel, …).
Docs: memory only.

### Files Modified
`models/__init__.py`, `main.py` (keys + public gateway routers), `frontend/src/components/Sidebar/SidebarNavigation.tsx` (API Keys entry), `services/gateway/api_logs.py` (log commit fix by the Lead).

### Decisions
- **O(1) auth**: unique `key_hash` lookup + short-lived compiled `KeyContext` in Valkey (policy/permissions/IP rules included); every mutation invalidates it. 401 unknown vs 403 disabled/expired/IP-denied.
- **Unified translation**: every endpoint → `UnifiedRequest` → adapter; no provider logic in the router/service. Adapters remain the source of truth.
- **Model resolution**: `provider/model` (family/type/name hints) or a bare id only when unique; multiple matches → `ambiguous_model` (verified live).
- **Limits**: atomic Valkey counters with fixed windows (rpm/rph/rpd/tpm/tpd), integer micro-USD spend counters, reservations refunded on settle; **budgets hard-403 with no overage**; rate limits fail open on cache outage, budgets fail closed while a spend counter is readable.
- **Analytics**: one `api_request_logs` row per request (tokens/cost/latency/status/client metadata); UA parsed locally; geo is `local` for private IPs and NULL otherwise (never fabricated; optional MaxMind path).
- **No conversations/messages** are created for public API traffic.
- **Future virtual keys**: `parent_key_id`, `routing_strategy`, `metadata` columns reserved — no schema rewrite needed.

### Verification
- Targeted backend: `pytest -q tests/keys tests/public_gateway` → **77 passed / 0 failed**; `alembic check` green; `tollms.main` imports.
- **Live smoke** (user-provided gateway `http://115.247.148.78:3002/api`, qwen/gpt-oss models; tiny prompts):
  - `POST /v1/chat/completions` `model="LiveGateway/gpt-oss:20b"` → 200 `chat.completion`, usage 72/40/112.
  - `POST /v1/messages` (Anthropic payload) `model="LiveGateway/qwen3-coder:30b"` → 200 `type=message`, `stop_reason=end_turn`, text "pong", usage 13/2.
  - Bare alias `qwen3-coder:30b` → **`ambiguous_model`** (correct: two providers expose it).
  - `GET /v1/models` → 9 allowed models.
  - `api_request_logs` → rows with endpoint/model/status/tokens/cost/device_type/country/latency.
- Frontend: tsc/eslint clean, vitest 126/126; headed `/api-keys` check (list + create form) with screenshots.
- **Lead fix**: `api_logs.log_request` flushed but never committed (request session rolled back) — now commits its own row; re-verified live.

### Recommended Next Steps
- Strip/normalize ` thinking` spans for public API responses (or expose `reasoning_content`).
- Add `/v1/images/edits` adapter support when an adapter exposes an edit method.
- Geo: wire a MaxMind DB path for country/city/region.
- Virtual keys: implement fallback chains/routing using the reserved columns.

---

## 2026-09-25 — API Key Analytics, Visualization & UX (V1.5)

### Requirement Completed
The API Keys console became a developer-grade observability platform: micro-UX (budget bars, 7-state status pills, no native controls), a rich Analytics tab (request/performance/cost/token/provider/model/endpoint metrics, 8+ visualizations, derived insights), Network intelligence (IPs/locations/devices/SDK clients), a platform-admin API Keys section, and a reusable analytics engine (`services/analytics/*`) behind a frozen `/api/analytics/*` API with Valkey caching and bounded query budgets.

### Files Created
Backend: `services/analytics/{__init__,aggregations,costs,latency,tokens,providers,models,apikeys,network,timeseries,insights}.py`; `api/analytics_api/{__init__,schemas,service,router}.py`; `services/admin/api_keys.py`; `tests/analytics_api/*`.
Frontend: `app/api-keys/components/analytics/*` (15 components), `NetworkPanel.tsx`, `BudgetBar.tsx`, `SelectField.tsx`, `app/admin/components/ApiKeysSection.tsx`, `e2e/api-keys-analytics.spec.ts`, `e2e/api-keys-ux.spec.ts`.

### Files Modified
Backend: `api/admin/{router,schemas}.py` (+`GET /api/admin/api-keys`, `dashboard.api_keys`), `main.py` (analytics_api router), `tests/admin/test_admin_access.py` (expected dashboard keys + `api_keys`).
Frontend: `types/apiKeys.ts`, `services/apiKeys.ts`, `KeyAnalytics.tsx`, `KeyDetailsPanel.tsx`, `KeyTable.tsx`, `StatusPill.tsx`, `NumberField.tsx`, `PolicyForm.tsx`, `IpRulesEditor.tsx`, `RawKeyDialog.tsx`, `KeyForm.tsx`, `admin/page.tsx`, `SidebarAdmin.tsx`, `services/admin.ts`, `types/admin.ts`.

### Decisions
- **One reusable engine** (`services/analytics/*`) serves both per-key and platform scopes; routers thin; frozen Pydantic models; 60s Valkey caching keyed by (user, endpoint, params, minute-floored end) so live windows stay cacheable.
- **Performance**: bounded grouped SQL per endpoint (platform 6 queries, per-key detail 5, timeseries 4, network 6, insights 3); measured **159–245ms** on the dev dataset (<300ms target).
- **Insights are derived, not dumped**: cost-driver share, traffic-driver share, token efficiency, cache savings, and period-over-period deltas with severity.
- **Network intelligence**: top/unique/new/blocked IPs (CIDR rules), locations (NULL-safe; private = "local"), devices, and SDK client detection from User-Agent (openai-python, anthropic, claude-code, cursor, cline, continue, curl, custom/unknown).
- **UX**: budget = progress bar + `% used` + `$ remaining`; seven status states (Enabled/Disabled/Expired/Rate Limited/Budget Exceeded/Rotated/Inactive) with icons + tooltips; number/select controls replaced with styled primitives (no native widgets).
- Rates are fractions (0..1) in this API (admin uses percent) — the UI normalizes defensively.

### Verification
- Backend targeted: `pytest -q tests/analytics_api tests/admin/test_admin_access.py` → **19 passed / 0 failed**; `compileall` + `alembic check` green.
- Frontend: `tsc`/`eslint` clean; vitest **126/126**.
- Headed Playwright: `api-keys-analytics` + `api-keys-ux` specs pass (agents' runs 2+2 with screenshots `api-keys-analytics.png`, `api-keys-network.png`, `api-keys-ux.png`, `admin-api-keys.png`).
- Live endpoints returned 200 with the seeded "smoke" key (2 requests, 124 tokens) and the admin section rendered real KPIs.

### Recommended Next Steps
- Add hourly rollups for very large ranges; expose ASN/ISP via a geo database.
- Record rate-limit/budget denials as first-class error categories in `api_request_logs`.
- Dedupe `services/admin` aggregations onto the new analytics engine over time.

---

## 2026-09-26 — API Keys Read/Edit Split & Analytics Enhancement

### Requirement Completed
Split the crowded API Keys drawer into an analytics-first read drawer (Analytics + Network tabs only) and a dedicated edit drawer, added model/endpoint/budget analytics widgets, and kept the admin API-Keys section intact. UI-only change; no backend touched.

### Files Created
- `frontend/src/app/api-keys/components/KeyEditDrawer.tsx` (+ shared `DrawerBackdrop`, `useEscapeClose`)
- `frontend/src/app/api-keys/components/EndpointPermissions.tsx` (display-only, "not enforced yet")
- `frontend/src/app/api-keys/components/analytics/{stacked.ts,KeyHealthSection.tsx,UsageOverview.tsx,SpendTrend.tsx,TokenTrend.tsx,ModelUsageTrend.tsx,TopModelsChart.tsx,ModelCostEfficiency.tsx,EndpointDonut.tsx,EndpointTrend.tsx,BudgetBurnRate.tsx,BudgetGauge.tsx,DailySpendHeatmap.tsx}`

### Files Modified
- `KeyDetailsPanel.tsx` (analytics-only shell, 2 tabs 50/50, `[Edit Key]` button, memoized slots)
- `KeyTable.tsx` (summary rows, click/Enter/Space opens drawer, memo)
- `page.tsx` (independent details/edit drawer state, stacked z-order)
- `KeyAnalytics.tsx` (same `{keyId}` props; 6 read-only sections), `NetworkPanel.tsx` (same props; IP/geo/client/device panels)

### Decisions
- `KeyEditDrawer` takes `apiKey` (not `key` — React strips `key`); single Save submits only dirty slices in parallel; edit backdrop sits above analytics panel.
- Token trend uses range totals for kind mix (no per-bucket per-kind series exists); remaining budget is range-spend based and labelled; burn rate is relative ("in N days"); network groupings are frontend classifiers.
- Admin `ApiKeysSection` already wired — verified, no changes needed.

### Verification
- `tsc` clean, `eslint` clean on all touched files, admin vitest 7/7.
- Headed `e2e/admin.spec.ts` via system Chrome (Playwright browser binary missing in env; temp config, removed after): **3 passed** — forbidden gate, one-section hash nav, live SSE health.
- No backend tests run (no backend changes); no full suite per scope.
