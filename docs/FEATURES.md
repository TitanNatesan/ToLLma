# ToLLma Features

> The Open Source AI Gateway for Models and Agents. Everything below is implemented in V1 unless marked Planned.

## Chat

Streaming conversations with a capability-aware composer (upload controls and reasoning level render from the selected model's capabilities), stop/regenerate/retry, reasoning display via a provider-agnostic `<think>` pipeline, markdown with code tools/Mermaid/tables, and conversation pinning.

- Key endpoints: `POST /api/v1/gateway/stream`, conversation/message CRUD under `/api/v1/conversations`.
- Limits: one live generation per conversation (second start → 409 with adoption); messages carry `client_key` idempotency; media uses a 4s minimum for chat video.

## Providers

Six families (`OPENAI`, `ANTHROPIC_MESSAGES`, `GEMINI`, `VERTEX_AI`, `BEDROCK_CONVERSE`, `CUSTOM`), Fernet-encrypted credentials, live validation with persisted status, discovery with endpoint auto-resolution, and a 5-step registration wizard (persist only at finish).

- Key endpoints: `/api/v1/providers/*` incl. `POST /draft-validate`, `POST /register`, `POST /{id}/discover`.
- Limits: validation/discovery responses cached (300s/900s); fixed-endpoint families reject non-chat endpoints.

## Models

Per-provider registered models with pricing (per-1M), context limits, capability flags, and endpoint metadata (`primary_endpoint` wire path + `supported_endpoints`). Repository lookup suggests pricing/caps at registration; columns act as overrides over the repository snapshot.

- Key endpoints: `/api/v1/models/*`, `GET /api/v1/model-repository/lookup`, `POST /api/v1/model-repository/map`.
- Limits: unknown future endpoints degrade safely to chat; discovery enriches missing limits from repository intelligence.

## Repository

Global model-intelligence catalog synced from Models.dev (canonical-key dedupe, startup + 6h scheduled sync + manual trigger, history, stats, search/filter; failed runs preserve the last-known-good catalog). Source of truth for pricing, capabilities, limits, and media rate cards.

- Key endpoints: `GET /api/v1/model-repository/models`, `/stats`, `/sync-history`, `POST /sync`.
- Limits: sync is lock-guarded (concurrent run → 422); per-record failures never abort a run.

## Provider catalog

Global models.dev-sourced provider catalog (`provider_catalog`, sync-owned): every upstream provider discoverable by stable slug with logo/doc/api metadata, gateway-support distinction, and capability flags. Catalog entries never hold credentials and never imply gateway support — connections are configured separately as personal/org providers through the existing wizard.

- Key endpoints: `GET /api/v1/catalog/providers`, `/providers/{slug}`, `/stats`.
- Source precedence for model rows: LiteLLM > OpenRouter > models.dev; ToLLma operational metadata (adapters, credential schemas, enabled flags) is never overwritten.
- Adding gateway support for a new provider = implement an adapter in `services/gateway/adapters/`, register it in `factory.py`, and add the models.dev id → family mapping in `GATEWAY_FAMILIES` (`services/model_repository/sync.py`).

## Gateway

Public, provider-agnostic API translating OpenAI Chat/Responses, Anthropic Messages, images, and video into one `UnifiedRequest` pipeline with model resolution (`provider/model` or unique bare id), capability gates (`403 model_not_allowed`), rate limits, hard budgets, and per-request logging.

- Key endpoints: `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/models`, `/v1/images/generations`, `/v1/images/edits`, `/v1/videos/generations`, `/v1/me`.
- Limits: fixed-window rpm/rph/rpd + tpm/tpd; budgets hard-403 with no overage; ambiguous bare ids → `ambiguous_model` 422.

## Analytics

User analytics (KPIs, spend timeseries, provider/model breakdowns, leaderboards, heatmap, token + performance analytics, CSV/JSON export) and per-API-key analytics (request/performance/cost/token/provider/model/endpoint metrics, network intelligence, insights). Aggregation is backend-only with 60s Valkey caching.

- Key endpoints: `/api/v1/analytics/*`, `/api/v1/request-logs/*`, platform scope under `/api/admin/*`.
- Limits: bounded grouped SQL per endpoint; large account exports are synchronous and capped.

## Shares

Token-scoped, revocable public conversation sharing (`secrets.token_urlsafe`), idempotent create, disable/rotate/expire enforced server-side. Public payloads carry title/messages/model only — never user or credential data. Public read-only page at `/share/[token]`.

- Key endpoints: `/api/v1/shares/*` + public `GET /api/v1/shares/public/{token}`.
- Limits: lookups cached 60s; conversation-scoped (per-message links are Planned).

## Attachments

First-class uploads: bytes stored under immutable user-scoped paths, DB rows, native image/audio/video parts per adapter, document text extracted at upload, audio transcribed via the provider's own endpoint when native audio is unavailable, graceful 422s (never silent drops). History re-injects derived text always, media best-effort.

- Key endpoints: `POST/GET /api/v1/chat/attachments` (+ content, delete).
- Limits: size caps via config; sent attachments are undeletable (history); cross-owner access → 404.

## Exports

Server-rendered conversation exports (Markdown/JSON/PDF — single, selected, or whole account) and analytics exports (CSV/XLSX/JSON), each writing an `export_events` audit row.

- Key endpoints: `/api/v1/exports/*`.
- Limits: synchronous, capped at 200 conversations; background job queue is Planned.

## Authentication

Email + password (strength policy), Google OAuth (PKCE, state binding, link-on-verified-email), mandatory email verification gate, forgot/reset password with hashed single-use expiring tokens, staged email change, refresh rotation with reuse detection, per-user session management (cap 10, revoke/revoke-others), and full account deletion (15-day grace → purge with audit).

- Key endpoints: `/auth/*` (signup, verify, login, Google, refresh, logout, forgot/reset, resend-verification), `/api/v1/settings/*` (profile, password, sessions, danger zone), `POST /auth/restore`.
- Limits: auth rate limits + login lockout; unverified accounts get `403 EMAIL_VERIFICATION_REQUIRED`; pending-deletion accounts get `403 ACCOUNT_PENDING_DELETION`.
