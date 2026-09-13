"use client";

import type { ProviderType } from "@/types";

export const PROVIDER_TYPES: ProviderType[] = [
  "OPENAI_RESPONSES",
  "OPENAI_CHAT",
  "ANTHROPIC_MESSAGES",
  "GEMINI",
  "VERTEX_AI",
  "BEDROCK_CONVERSE",
  "CUSTOM",
];

// credential field name -> {label, secret, multiline, optional}
export const CREDENTIAL_FIELDS: Record<ProviderType, Array<[string, { label: string; secret?: boolean; multiline?: boolean; optional?: boolean }]>> = {
  OPENAI_RESPONSES: [["api_key", { label: "API Key", secret: true }]],
  OPENAI_CHAT: [["api_key", { label: "API Key", secret: true }]],
  ANTHROPIC_MESSAGES: [["api_key", { label: "API Key", secret: true }]],
  GEMINI: [["api_key", { label: "API Key", secret: true }]],
  VERTEX_AI: [
    ["project_id", { label: "Project ID" }],
    ["location", { label: "Location" }],
    ["credentials_json", { label: "Credentials JSON", secret: true, multiline: true }],
  ],
  BEDROCK_CONVERSE: [
    ["access_key", { label: "Access Key" }],
    ["secret_key", { label: "Secret Key", secret: true }],
    ["region", { label: "Region" }],
  ],
  CUSTOM: [
    ["base_url", { label: "Base URL" }],
    ["api_key", { label: "API Key", secret: true, optional: true }],
    ["extra_headers", { label: "Extra headers (JSON)", multiline: true, optional: true }],
  ],
};

export const PROVIDER_DEFAULT_ENDPOINTS: Record<ProviderType, import("@/types").EndpointType> = {
  OPENAI_RESPONSES: "responses",
  OPENAI_CHAT: "chat_completions",
  ANTHROPIC_MESSAGES: "messages",
  GEMINI: "chat_completions",
  VERTEX_AI: "chat_completions",
  BEDROCK_CONVERSE: "converse",
  CUSTOM: "chat_completions",
};
