# ToLLma Roadmap

> No dates. Items move from Planned → Implemented only when shipped and verified. Anything not listed under V1 is not implemented — do not document it as available.

## V1 — Implemented

The complete, verified V1 scope (backend suite green, frontend tsc/eslint/vitest green):

- **Gateway core** — 6 provider families, endpoint-aware routing, unified request pipeline, generation lifecycle (cancel/persist/recover), scheduled jobs.
- **Chat** — streaming, reasoning display, attachments (multimodal), in-chat image/video generation, regeneration + generation history, branching, message edit/version history, exports (MD/JSON/PDF), full-text search, shares.
- **Providers & models** — validation, discovery, registration wizard, repository-backed intelligence (Models.dev, startup + 6h sync), cost/capability engines, prompt-caching plans, media rate cards.
- **Public API** — `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/models`, `/v1/images/generations`, `/v1/images/edits`, `/v1/videos/generations`, `/v1/me`; SDK-compatibility tests.
- **API keys** — budgets (hard, no overage), rate limits, IP allow/deny, per-model permissions, per-key analytics + network intelligence, admin API-keys section.
- **Analytics** — user analytics + exports (CSV/XLSX/JSON), platform admin dashboard (usage, tokens, costs, cache, media, errors, health, models, providers, users, API keys) with live health SSE.
- **Auth & accounts** — email + Google OAuth, verification gate, forgot/reset, staged email change, session hardening (rotation, caps, audit), 15-day deletion lifecycle, owner-aware key auth, OAuth hardening, data-integrity pass, gateway hardening, observability events.
- **Docs & UX** — in-app `/docs`, hash-nav settings, mobile overlays, shortcuts overlay, verification banner, deletion warning screen.

## V1.5 — In Progress

None. There is no partially-shipped V1.5 scope; the next work lands directly as V2 planning.

## V2 — Planned

- **Organizations** — multi-tenant org workspaces.
- **Teams** — team membership inside organizations.
- **RBAC** — role-based access control (beyond today's single platform-admin flag).
- **Billing** — plans, subscriptions, invoicing on top of the usage rollups.
- **Agent support** — first-class agents on the gateway (execution, tool use, and agent-aware policies built on the unified pipeline and request ledger).
- Smaller planned items: virtual-key fallback chains/routing, MaxMind geo for request analytics, background job queue for large exports, per-message share links.

## V3 — Vision

ToLLma becomes the default open-source control plane for all model and agent consumption: every model, every agent framework, one gateway — with governance (policy, budget, audit), intelligence (routing, cost optimization), and observability that teams accept without friction. Concrete scope will be cut from V2 learnings; nothing here is committed.
