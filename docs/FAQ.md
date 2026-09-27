# ToLLma FAQ

> The Open Source AI Gateway for Models and Agents.

## Is ToLLma a ChatGPT clone?

No. Chat is one surface, not the product. ToLLma is a unified gateway: provider management, endpoint-aware routing, model intelligence, usage tracking, API keys with budgets and rate limits, and OpenAI/Anthropic-compatible APIs for your own tools and agents.

## Is ToLLma an OpenAI wrapper?

No. OpenAI is one of six provider families (`OPENAI`, `ANTHROPIC_MESSAGES`, `GEMINI`, `VERTEX_AI`, `BEDROCK_CONVERSE`, `CUSTOM`). The gateway translates every request into a provider-agnostic internal shape and routes to the right adapter — including Anthropic-native, Gemini, Vertex, Bedrock Converse, and any OpenAI-compatible endpoint.

## How does ToLLma compare to OpenWebUI and LiteLLM?

Objective comparison:

| | ToLLma | OpenWebUI | LiteLLM |
|---|---|---|---|
| Primary job | Gateway + management + chat | Chat frontend over backends | LLM proxy / router library + proxy server |
| Provider registry with validation + discovery | Yes (built-in wizard, persisted status) | Connects to endpoints; not a registry | Config-file based |
| Model intelligence catalog | Yes (synced, priced, searchable) | No | Model lists/pricing data, not a managed catalog UI |
| API keys with budgets/rate limits/IP rules | Yes | No (relies on backend auth) | Yes (key management + budgets) |
| Usage/cost analytics + admin dashboard | Yes | Basic | Logging + spend tracking via proxy |
| Chat workspace | Yes (built in) | Yes (its strength) | No |
| Self-hosted, open source | Yes (Apache-2.0) | Yes | Yes |

Choose ToLLma when you want one system that registers providers, serves chat, and meters programmatic access.

## Can I self-host ToLLma?

Yes — that is the primary deployment model. `cp .env.example .env && docker compose up -d --build` gives you PostgreSQL, Valkey, backend, and frontend. PostgreSQL is the source of truth; Valkey is cache-only and safe to wipe.

## Can I use ToLLma commercially?

Yes. ToLLma is licensed under Apache-2.0, which permits commercial use, modification, and distribution. (The license text itself is owned by the release process — see `LICENSE`.)

## Why does ToLLma exist when LiteLLM/OpenWebUI already do?

Because the gap is the combination: a managed provider registry, a synced model-intelligence catalog, chat, programmatic gateway access with real budgets and analytics, and platform administration — in one self-hosted Apache-2.0 codebase, with agent support on the roadmap ([docs/ROADMAP.md](ROADMAP.md)) instead of as an afterthought.

## What is Planned but not yet built?

Organizations, Teams, RBAC (beyond the single platform-admin role), billing, first-class agent support, virtual-key routing, MaxMind geo, background export jobs, and per-message share links. Anything outside [docs/ROADMAP.md](ROADMAP.md)'s V1 list is not implemented — treat undocumented claims as Planned at best.
