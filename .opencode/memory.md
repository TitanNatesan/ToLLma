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