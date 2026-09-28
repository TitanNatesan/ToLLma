/**
 * Competitor intelligence matrix for the ToLLma landing page.
 *
 * Intended consumer: the comparison table section (Agent C owns `why.tsx`).
 * This file is DATA ONLY — no JSX, no styling.
 *
 * Sourcing rules:
 * - Competitor cells cite OFFICIAL vendor docs only (see `sources` per cell).
 * - ToLLma cells cite repo evidence paths (prefix `repo:`) instead of URLs,
 *   because ToLLma has no separate docs site. Full code evidence for every
 *   ToLLma claim lives in `/tmp/opencode/tollma-design/COMPETITORS.md`.
 * - ToLLma column values match `landing/src/components/why.tsx` claims unless
 *   a repo correction was verified — see `TOLLMA_CLAIM_FLAGS` below.
 *
 * Value semantics: "yes" = fully supported, "partial" = limited form,
 * plugin/enterprise-gated, or adjacent capability, "no" = not offered.
 */

export type ProductId =
  | "tollma"
  | "openwebui"
  | "litellm"
  | "openrouter"
  | "bifrost"
  | "librechat"
  | "langfuse"
  | "helicone"
  | "portkey"
  | "openpipe";

export type CellTone = "yes" | "partial" | "no";

export interface CompetitorColumn {
  id: ProductId;
  label: string;
  tagline: string;
}

export interface MatrixCell {
  /** Badge text: "Yes" | "Partial" | "—", or free text (license row). */
  display: string;
  tone: CellTone;
  /** One-line justification shown as subtext/tooltip. */
  note: string;
  /** Official docs URLs (competitors) or `repo:` code paths (ToLLma). */
  sources: string[];
}

export interface MatrixRow {
  id: string;
  label: string;
  cells: Record<ProductId, MatrixCell>;
}

export interface CompetitorMatrix {
  columns: CompetitorColumn[];
  rows: MatrixRow[];
}

export const COLUMNS: CompetitorColumn[] = [
  { id: "tollma", label: "ToLLma", tagline: "Gateway for models + agents" },
  { id: "openwebui", label: "Open WebUI", tagline: "Self-hosted chat UI for LLMs" },
  { id: "litellm", label: "LiteLLM", tagline: "LLM API proxy & SDK" },
  { id: "openrouter", label: "OpenRouter", tagline: "Unified SaaS API for hundreds of models" },
  { id: "bifrost", label: "Bifrost", tagline: "Open-source AI gateway (Go)" },
  { id: "librechat", label: "LibreChat", tagline: "Open-source chat UI" },
  { id: "langfuse", label: "Langfuse", tagline: "Open-source LLM observability" },
  { id: "helicone", label: "Helicone", tagline: "Observability + AI gateway" },
  { id: "portkey", label: "Portkey", tagline: "AI gateway + governance platform" },
  { id: "openpipe", label: "OpenPipe", tagline: "Fine-tuning / agent RL platform" },
];

export const COMPETITOR_MATRIX: CompetitorMatrix = {
  columns: COLUMNS,
  rows: [
    {
      id: "gateway",
      label: "OpenAI-compatible gateway",
      cells: {
        tollma: {
          display: "Yes",
          tone: "yes",
          note: "OpenAI-compatible /v1 gateway: chat, responses, messages, images, video.",
          sources: ["repo:backend/src/tollms/api/public_gateway/router.py"],
        },
        openwebui: {
          display: "—",
          tone: "no",
          note: "Chat UI that connects out to providers; no request gateway surface.",
          sources: ["https://docs.openwebui.com/", "https://docs.openwebui.com/features/"],
        },
        litellm: {
          display: "Yes",
          tone: "yes",
          note: "Self-hosted OpenAI-compatible proxy; any OpenAI client works unchanged.",
          sources: ["https://docs.litellm.ai/docs/"],
        },
        openrouter: {
          display: "Yes",
          tone: "yes",
          note: "Single API endpoint for hundreds of models; SaaS only, no self-host.",
          sources: ["https://openrouter.ai/docs/quickstart"],
        },
        bifrost: {
          display: "Yes",
          tone: "yes",
          note: "Single OpenAI-compatible API unifying 20+ providers, zero-config deploy.",
          sources: ["https://docs.getbifrost.ai/overview"],
        },
        librechat: {
          display: "—",
          tone: "no",
          note: "Self-hosted chat app; no gateway/proxy surface.",
          sources: ["https://www.librechat.ai/docs"],
        },
        langfuse: {
          display: "—",
          tone: "no",
          note: "Observability platform; plugs into external gateways, is not one.",
          sources: [
            "https://langfuse.com/docs",
            "https://langfuse.com/integrations/gateways/portkey",
          ],
        },
        helicone: {
          display: "Yes",
          tone: "yes",
          note: "OpenAI-compatible AI Gateway across 100+ models with built-in logging.",
          sources: ["https://docs.helicone.ai/"],
        },
        portkey: {
          display: "Yes",
          tone: "yes",
          note: "AI Gateway with OpenAI-compatible endpoints for 250+ models.",
          sources: ["https://portkey.ai/docs"],
        },
        openpipe: {
          display: "—",
          tone: "no",
          note: "Fine-tuning / RL training platform, not a request gateway.",
          sources: ["https://docs.openpipe.ai/overview", "https://github.com/OpenPipe/ART"],
        },
      },
    },
    {
      id: "providers",
      label: "Multi-provider management",
      cells: {
        tollma: {
          display: "Yes",
          tone: "yes",
          note: "Provider registry (OpenAI, Anthropic, Gemini, Bedrock, Ollama) with validation + discovery.",
          sources: [
            "repo:backend/src/tollms/api/providers/router.py",
            "repo:backend/src/tollms/services/gateway/adapters/",
          ],
        },
        openwebui: {
          display: "Partial",
          tone: "partial",
          note: "Connects Ollama / OpenAI / Anthropic as chat backends; no managed credentials or routing.",
          sources: ["https://docs.openwebui.com/", "https://docs.openwebui.com/features/"],
        },
        litellm: {
          display: "Yes",
          tone: "yes",
          note: "One interface to 100+ providers (OpenAI, Anthropic, Vertex, Bedrock, Ollama…).",
          sources: ["https://docs.litellm.ai/docs/"],
        },
        openrouter: {
          display: "Partial",
          tone: "partial",
          note: "Routes across its own provider network; BYOK covers supported providers only, no arbitrary/local ones.",
          sources: [
            "https://openrouter.ai/docs/guides/routing/provider-selection",
            "https://openrouter.ai/docs/llms.txt",
          ],
        },
        bifrost: {
          display: "Yes",
          tone: "yes",
          note: "20+ providers (incl. Ollama, vLLM) with automatic routing and failover.",
          sources: ["https://docs.getbifrost.ai/overview"],
        },
        librechat: {
          display: "Partial",
          tone: "partial",
          note: "Custom endpoints connect Ollama, DeepSeek, Groq and more for chat; no credential governance.",
          sources: [
            "https://www.librechat.ai/docs",
            "https://www.librechat.ai/docs/features",
          ],
        },
        langfuse: {
          display: "Partial",
          tone: "partial",
          note: "LLM Connections exist for playground/evals only — no gateway provider management.",
          sources: ["https://langfuse.com/llms.txt"],
        },
        helicone: {
          display: "Yes",
          tone: "yes",
          note: "100+ models via gateway; Helicone-held keys or bring-your-own provider keys.",
          sources: ["https://docs.helicone.ai/"],
        },
        portkey: {
          display: "Yes",
          tone: "yes",
          note: "Model Catalog / virtual keys centralize credentials across providers and workspaces.",
          sources: ["https://docs.portkey.ai/docs/product/ai-gateway/virtual-keys"],
        },
        openpipe: {
          display: "—",
          tone: "no",
          note: "No provider management; trains and serves its own fine-tuned models.",
          sources: ["https://docs.openpipe.ai/overview", "https://github.com/OpenPipe/ART"],
        },
      },
    },
    {
      id: "routing",
      label: "Routing, fallbacks & load balancing",
      cells: {
        tollma: {
          display: "Yes",
          tone: "yes",
          note: "Model aliases + provider candidates, per-key routing rules, fallback matching.",
          sources: [
            "repo:backend/src/tollms/services/gateway/model_resolution.py",
            "repo:backend/src/tollms/api/providers/service.py",
            "repo:landing/src/components/features.tsx",
          ],
        },
        openwebui: {
          display: "Partial",
          tone: "partial",
          note: "Pipelines can filter/route chat messages; no gateway failover or load balancing.",
          sources: ["https://docs.openwebui.com/features/"],
        },
        litellm: {
          display: "Yes",
          tone: "yes",
          note: "Router with retry, fallback and load balancing across deployments.",
          sources: ["https://docs.litellm.ai/docs/"],
        },
        openrouter: {
          display: "Yes",
          tone: "yes",
          note: "Price-based load balancing, model fallbacks, order/sort/allow-fallbacks controls.",
          sources: [
            "https://openrouter.ai/docs/guides/routing/provider-selection",
            "https://openrouter.ai/docs/llms.txt",
          ],
        },
        bifrost: {
          display: "Yes",
          tone: "yes",
          note: "Automatic fallbacks, weighted load balancing, routing strategies, semantic caching.",
          sources: ["https://docs.getbifrost.ai/overview"],
        },
        librechat: {
          display: "—",
          tone: "no",
          note: "Endpoint chosen per chat; no failover or load balancing.",
          sources: ["https://www.librechat.ai/docs/features"],
        },
        langfuse: {
          display: "—",
          tone: "no",
          note: "No traffic routing; observability layer only.",
          sources: ["https://langfuse.com/docs"],
        },
        helicone: {
          display: "Yes",
          tone: "yes",
          note: "Automatic model routing across 100+ providers with fallbacks.",
          sources: [
            "https://docs.helicone.ai/",
            "https://docs.helicone.ai/llms.txt",
          ],
        },
        portkey: {
          display: "Yes",
          tone: "yes",
          note: "Config strategies: fallback, loadbalance, retries, caching, conditional routing.",
          sources: ["https://docs.portkey.ai/docs/product/ai-gateway/configs"],
        },
        openpipe: {
          display: "—",
          tone: "no",
          note: "No request routing; serves trained models via standard endpoints.",
          sources: ["https://docs.openpipe.ai/overview"],
        },
      },
    },
    {
      id: "keys",
      label: "API keys & budgets",
      cells: {
        tollma: {
          display: "Yes",
          tone: "yes",
          note: "Scoped keys with rotation/revoke, per-key budgets, daily/monthly spend limits.",
          sources: [
            "repo:backend/src/tollms/api/keys/router.py",
            "repo:backend/src/tollms/api/keys/schemas.py",
          ],
        },
        openwebui: {
          display: "Partial",
          tone: "partial",
          note: "API keys + RBAC for access; no per-key budgets documented.",
          sources: ["https://docs.openwebui.com/features/"],
        },
        litellm: {
          display: "Yes",
          tone: "yes",
          note: "Virtual keys with per-key / team / user budgets and rate limits.",
          sources: ["https://docs.litellm.ai/docs/"],
        },
        openrouter: {
          display: "Yes",
          tone: "yes",
          note: "API + management keys; workspace budgets with automatic enforcement (Enterprise).",
          sources: [
            "https://openrouter.ai/docs/guides/features/workspaces/workspace-budgets",
            "https://openrouter.ai/docs/guides/features/activity",
          ],
        },
        bifrost: {
          display: "Yes",
          tone: "yes",
          note: "Virtual keys with budgets and rate limits at key, team and customer levels.",
          sources: ["https://docs.getbifrost.ai/overview"],
        },
        librechat: {
          display: "Partial",
          tone: "partial",
          note: "Per-user token credit balances with auto-refill; no gateway keys or budgets.",
          sources: [
            "https://www.librechat.ai/docs/configuration/token_usage",
            "https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/balance",
          ],
        },
        langfuse: {
          display: "Partial",
          tone: "partial",
          note: "Ingestion API keys + spend alerts; no gateway key budgets.",
          sources: ["https://langfuse.com/llms.txt", "https://langfuse.com/docs"],
        },
        helicone: {
          display: "Partial",
          tone: "partial",
          note: "API keys + request/cost rate limits per app, user or property; no budget objects.",
          sources: [
            "https://docs.helicone.ai/features/advanced-usage/custom-rate-limits",
            "https://docs.helicone.ai/",
          ],
        },
        portkey: {
          display: "Yes",
          tone: "yes",
          note: "API keys with default configs; Model Catalog budgets, rate limits, allow-lists.",
          sources: [
            "https://docs.portkey.ai/docs/product/ai-gateway/virtual-keys",
            "https://docs.portkey.ai/docs/product/ai-gateway/configs",
          ],
        },
        openpipe: {
          display: "—",
          tone: "no",
          note: "No gateway key management or budgets; platform API keys only.",
          sources: ["https://docs.openpipe.ai/overview"],
        },
      },
    },
    {
      id: "analytics",
      label: "Usage analytics & request logs",
      cells: {
        tollma: {
          display: "Yes",
          tone: "yes",
          note: "Per-key analytics plus gateway request logs with latency and status.",
          sources: [
            "repo:backend/src/tollms/api/analytics/router.py",
            "repo:backend/src/tollms/api/request_logs/router.py",
          ],
        },
        openwebui: {
          display: "Yes",
          tone: "yes",
          note: "Admin analytics: message volume, token consumption, cost tracking. (Not gateway request logs.)",
          sources: ["https://docs.openwebui.com/features/"],
        },
        litellm: {
          display: "Yes",
          tone: "yes",
          note: "Spend tracking per key/team/user, admin UI, observability integrations.",
          sources: ["https://docs.litellm.ai/docs/"],
        },
        openrouter: {
          display: "Yes",
          tone: "yes",
          note: "Activity dashboard (spend, requests, tokens) + per-generation Logs + analytics API.",
          sources: ["https://openrouter.ai/docs/guides/features/activity"],
        },
        bifrost: {
          display: "Yes",
          tone: "yes",
          note: "Built-in observability, real-time monitoring web UI, Prometheus + OpenTelemetry.",
          sources: ["https://docs.getbifrost.ai/overview"],
        },
        librechat: {
          display: "Partial",
          tone: "partial",
          note: "Admin Insights dashboards and token transactions; no gateway request analytics.",
          sources: [
            "https://www.librechat.ai/docs/features/insights",
            "https://www.librechat.ai/docs/configuration/token_usage",
          ],
        },
        langfuse: {
          display: "Yes",
          tone: "yes",
          note: "Tracing, dashboards, token & cost tracking, evals — observability is the product.",
          sources: ["https://langfuse.com/docs"],
        },
        helicone: {
          display: "Yes",
          tone: "yes",
          note: "Request logging, sessions, user metrics, cost tracking, alerts — observability is the product.",
          sources: ["https://docs.helicone.ai/", "https://docs.helicone.ai/llms.txt"],
        },
        portkey: {
          display: "Yes",
          tone: "yes",
          note: "Request logs with per-request gateway status, analytics and observability views.",
          sources: [
            "https://docs.portkey.ai/docs/product/ai-gateway/configs",
            "https://portkey.ai/docs/product/observability/logs",
          ],
        },
        openpipe: {
          display: "Partial",
          tone: "partial",
          note: "Fine-tuned model monitoring; no gateway request analytics. (Lower confidence — docs site unreachable at research time.)",
          sources: ["https://docs.openpipe.ai/overview", "https://github.com/OpenPipe/ART"],
        },
      },
    },
    {
      id: "oss",
      label: "Open-source & self-hostable",
      cells: {
        tollma: {
          display: "Yes",
          tone: "yes",
          note: "Apache 2.0; Docker Compose deploy with Postgres + Redis.",
          sources: ["repo:LICENSE", "repo:landing/src/components/features.tsx"],
        },
        openwebui: {
          display: "Partial",
          tone: "partial",
          note: "Source-public + self-hostable, but v0.6.6+ adds a branding clause — not OSI-approved.",
          sources: ["https://docs.openwebui.com/license"],
        },
        litellm: {
          display: "Yes",
          tone: "yes",
          note: "Open-source library + self-hosted gateway (Docker/CLI).",
          sources: ["https://docs.litellm.ai/docs/"],
        },
        openrouter: {
          display: "—",
          tone: "no",
          note: "Proprietary SaaS; no self-hosted option documented.",
          sources: ["https://openrouter.ai/docs/quickstart"],
        },
        bifrost: {
          display: "Yes",
          tone: "yes",
          note: "Open-source gateway (Maxim AI), Docker/Go deploy.",
          sources: [
            "https://docs.getbifrost.ai/overview",
            "https://github.com/maximhq/bifrost/blob/main/LICENSE",
          ],
        },
        librechat: {
          display: "Yes",
          tone: "yes",
          note: "Open-source (MIT), self-hosted via Docker/npm/Helm.",
          sources: [
            "https://www.librechat.ai/docs",
            "https://github.com/LibreChat-AI/LibreChat/blob/main/LICENSE",
          ],
        },
        langfuse: {
          display: "Yes",
          tone: "yes",
          note: "Open-source, self-hostable (Docker Compose / Helm).",
          sources: ["https://langfuse.com/docs", "https://langfuse.com/llms.txt"],
        },
        helicone: {
          display: "Yes",
          tone: "yes",
          note: "Open-source (Apache 2.0), self-hostable via Docker/Kubernetes.",
          sources: [
            "https://docs.helicone.ai/references/open-source",
            "https://docs.helicone.ai/llms.txt",
          ],
        },
        portkey: {
          display: "Partial",
          tone: "partial",
          note: "Gateway OSS (MIT); cloud platform proprietary, now Prisma AIRS.",
          sources: [
            "https://github.com/Portkey-AI/gateway/blob/main/LICENSE",
            "https://portkey.ai/docs",
          ],
        },
        openpipe: {
          display: "Partial",
          tone: "partial",
          note: "ART trainer OSS (Apache-2.0); platform proprietary, now under CoreWeave/W&B.",
          sources: ["https://github.com/OpenPipe/ART", "https://openpipe.ai"],
        },
      },
    },
    {
      id: "license",
      label: "License",
      cells: {
        tollma: {
          display: "Apache 2.0",
          tone: "yes",
          note: "Permissive OSI-approved license.",
          sources: ["repo:LICENSE"],
        },
        openwebui: {
          display: "BSD-3-Clause + branding clause",
          tone: "partial",
          note: "Pre-v0.6.6 code is pure BSD-3; current license adds branding restrictions, not OSI-approved.",
          sources: ["https://docs.openwebui.com/license"],
        },
        litellm: {
          display: "MIT",
          tone: "yes",
          note: "MIT for OSS; enterprise/ directory carries a separate license.",
          sources: ["https://github.com/BerriAI/litellm/blob/main/LICENSE"],
        },
        openrouter: {
          display: "Proprietary",
          tone: "no",
          note: "No OSS license published; SaaS terms apply.",
          sources: ["https://openrouter.ai/docs/quickstart"],
        },
        bifrost: {
          display: "Apache 2.0",
          tone: "yes",
          note: "Permissive OSI-approved license (© H3 Labs Inc.).",
          sources: ["https://github.com/maximhq/bifrost/blob/main/LICENSE"],
        },
        librechat: {
          display: "MIT",
          tone: "yes",
          note: "Permissive OSI-approved license.",
          sources: ["https://github.com/LibreChat-AI/LibreChat/blob/main/LICENSE"],
        },
        langfuse: {
          display: "MIT core + Enterprise",
          tone: "partial",
          note: "MIT-licensed core features; paid Enterprise additions.",
          sources: ["https://langfuse.com/llms.txt", "https://langfuse.com/pricing-self-host"],
        },
        helicone: {
          display: "Apache 2.0",
          tone: "yes",
          note: "Permissive OSI-approved license.",
          sources: ["https://docs.helicone.ai/references/open-source"],
        },
        portkey: {
          display: "MIT (gateway) / Proprietary (platform)",
          tone: "partial",
          note: "OSS gateway is MIT; managed platform is proprietary.",
          sources: [
            "https://github.com/Portkey-AI/gateway/blob/main/LICENSE",
            "https://portkey.ai/docs",
          ],
        },
        openpipe: {
          display: "Proprietary (ART: Apache-2.0)",
          tone: "partial",
          note: "Platform proprietary; ART trainer repo is Apache-2.0.",
          sources: ["https://github.com/OpenPipe/ART", "https://openpipe.ai"],
        },
      },
    },
  ],
};

/**
 * ToLLma-side claim flags for the section owner (Agent C).
 * The ToLLma column above already reflects these; no why.tsx edit was made here.
 */
export interface ClaimFlag {
  area: string;
  finding: string;
  evidence: string;
}

export const TOLLMA_CLAIM_FLAGS: ClaimFlag[] = [
  {
    area: "why.tsx license row (Open WebUI)",
    finding:
      'why.tsx says Open WebUI license is "BSD-3-Clause". Since v0.6.6 (Apr 2025) the license adds a branding-protection clause and the project states it is NOT OSI-approved. Recommend "BSD-3-Clause + branding clause" with a footnote.',
    evidence: "https://docs.openwebui.com/license",
  },
  {
    area: "why.tsx agent-hosting row (LiteLLM)",
    finding:
      'why.tsx says LiteLLM agent hosting is "no". LiteLLM docs now market a unified "Agent & MCP Gateway" (A2A agents + MCP tools via the gateway). Consider "partial" — it brokers agent/tool calls but does not host agent runtimes.',
    evidence: "https://docs.litellm.ai/docs/",
  },
  {
    area: "why.tsx gateway-logs row (LiteLLM)",
    finding:
      'why.tsx says LiteLLM gateway request logs are "partial". The proxy persists spend/request logs queryable per key/team with an admin UI — verify whether this now qualifies as "yes".',
    evidence: "https://docs.litellm.ai/docs/",
  },
  {
    area: "why.tsx analytics nuance (Open WebUI)",
    finding:
      'why.tsx says Open WebUI gateway request logs are "no" — still accurate. Note separately that Open WebUI DOES ship admin analytics (message volume, tokens, cost), so an "analytics" dimension reads "yes" for it.',
    evidence: "https://docs.openwebui.com/features/",
  },
];
