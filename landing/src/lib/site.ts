// ============================================================
// Single source of truth for outbound links, brand, and VERIFIED
// product facts. Section agents MUST read claims from here and must
// not invent capabilities, counts, benchmarks, or customer logos.
// ============================================================

// --- Outbound links (placeholders until the public repo exists) ---
export const GITHUB_URL = "https://github.com/TitanNatesan/tollma";
export const DOCS_URL = "https://github.com/TitanNatesan/tollma#readme";
export const ROADMAP_URL = "https://github.com/TitanNatesan/tollma#roadmap";
export const COMMUNITY_URL = "https://github.com/TitanNatesan/tollma/discussions";
export const LICENSE_URL = "https://github.com/TitanNatesan/tollma/blob/main/LICENSE";
export const GET_STARTED_URL = "https://github.com/TitanNatesan/tollma#quickstart";

export const IS_PLACEHOLDER_LINKS = true;

export const BRAND = {
  positioning: "The Open Source AI Gateway for Models and Agents",
  headline: "One Gateway for All Your AI Models & Agents",
  license: "Apache 2.0",
} as const;

// --- Public gateway base (used by code examples) ---
export const GATEWAY_BASE = "https://gateway.tollma.dev/v1";

// --- VERIFIED product facts (from backend/ source of truth) ---

/** Provider adapters implemented in services/gateway/adapters/. */
export const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    api: "Chat Completions + Responses",
    endpoints: ["/v1/chat/completions", "/v1/responses"],
    tools: true,
    streaming: true,
    note: "Full tool_calls, streaming, embeddings, images, audio.",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    api: "Messages",
    endpoints: ["/v1/messages"],
    tools: true,
    streaming: true,
    note: "Native tool_use / tool_result and extended thinking.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    api: "generateContent",
    endpoints: ["/v1/chat/completions"],
    tools: false,
    streaming: true,
    note: "Text + streaming today; function calling not yet mapped.",
  },
  {
    id: "vertex",
    name: "Vertex AI",
    api: "generateContent",
    endpoints: ["/v1/chat/completions"],
    tools: false,
    streaming: true,
    note: "Google-cloud hosted Gemini endpoint.",
  },
  {
    id: "bedrock",
    name: "AWS Bedrock",
    api: "Converse",
    endpoints: ["/v1/chat/completions"],
    tools: true,
    streaming: true,
    note: "Converse API with toolConfig support.",
  },
  {
    id: "custom",
    name: "Custom / OpenAI-compatible",
    api: "Chat Completions",
    endpoints: ["/v1/chat/completions"],
    tools: true,
    streaming: true,
    note: "Any OpenAI-compatible endpoint (vLLM, Ollama, LiteLLM...).",
  },
] as const;

/** Guardrail protection categories (models/guardrail.py Category). */
export const GUARDRAIL_CATEGORIES = [
  "harmful_content",
  "prompt_injection",
  "secret_leakage",
  "pii",
  "unsafe_output",
  "data_disclosure",
  "untrusted_instruction",
  "invalid_structure",
  "domain_violation",
  "tool_action",
] as const;

/** Guardrail evaluator engines. */
export const EVALUATORS = ["internal", "laya", "openai_moderation", "jev", "llm"] as const;

/** Enforcement modes + policy scope. */
export const ENFORCEMENT = ["monitor", "block"] as const;
export const POLICY_SCOPE = ["global", "api_key"] as const;

/** Top-level backend services/modules (for the "how it works" + features). */
export const MODULES = [
  "providers", "models", "keys", "orgs", "guardrails", "prompt_logging",
  "analytics", "conversations", "request_logs", "repository", "exports",
  "shares", "notifications", "admin",
] as const;

/** Compose services for the self-host story. */
export const STACK = ["postgres", "backend", "frontend", "valkey", "laya"] as const;
