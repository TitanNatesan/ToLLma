"use client";

import type { EndpointType, ProviderType } from "@/types";

export const PROVIDER_TYPES: ProviderType[] = [
  "OPENAI",
  "ANTHROPIC_MESSAGES",
  "GEMINI",
  "VERTEX_AI",
  "BEDROCK_CONVERSE",
  "CUSTOM",
];

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  OPENAI: "OpenAI",
  ANTHROPIC_MESSAGES: "Anthropic",
  GEMINI: "Google Gemini",
  VERTEX_AI: "Vertex AI",
  BEDROCK_CONVERSE: "AWS Bedrock",
  CUSTOM: "Custom / OpenAI-Compatible",
};

export function providerTypeLabel(value: string | null | undefined): string {
  if (!value) return "";
  return PROVIDER_TYPE_LABELS[value as ProviderType] ?? value;
}

// credential field name -> {label, secret, multiline, optional}
export const CREDENTIAL_FIELDS: Record<ProviderType, Array<[string, { label: string; secret?: boolean; multiline?: boolean; optional?: boolean }]>> = {
  OPENAI: [["api_key", { label: "API Key", secret: true }]],
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

/** Default wire endpoint per provider type. */
export const PROVIDER_DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  OPENAI: "chat_completions",
  ANTHROPIC_MESSAGES: "messages",
  GEMINI: "chat_completions",
  VERTEX_AI: "chat_completions",
  BEDROCK_CONVERSE: "converse",
  CUSTOM: "chat_completions",
};

export const ENDPOINT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "responses", label: "Responses API" },
  { value: "chat_completions", label: "Chat Completions" },
  { value: "messages", label: "Messages" },
  { value: "converse", label: "Converse" },
  { value: "embeddings", label: "Embeddings" },
  { value: "images/generations", label: "Image Generation" },
  { value: "audio/transcriptions", label: "Audio Transcriptions" },
  { value: "audio/speech", label: "Audio Speech" },
  { value: "video/generations", label: "Video Generation" },
];

const WIRE_ENDPOINTS = new Set(ENDPOINT_OPTIONS.map((o) => o.value));

/** Wire path -> legacy enum value the API still accepts. */
export const WIRE_TO_LEGACY_ENDPOINT: Record<string, EndpointType> = {
  responses: "responses",
  chat_completions: "chat_completions",
  messages: "messages",
  converse: "converse",
  embeddings: "embeddings",
  "images/generations": "images_generations",
  "audio/transcriptions": "audio_transcriptions",
  "audio/speech": "audio_speech",
};

const LEGACY_TO_WIRE_ENDPOINT: Record<string, string> = Object.fromEntries(
  Object.entries(WIRE_TO_LEGACY_ENDPOINT).map(([wire, legacy]) => [legacy, wire]),
);

export function endpointTypeFromWire(wire: string | null | undefined): EndpointType {
  return WIRE_TO_LEGACY_ENDPOINT[wire ?? ""] ?? "chat_completions";
}

/** Legacy enum or wire string -> wire path (null for unknown). */
export function endpointWireFromLegacy(value: string | null | undefined): string | null {
  if (!value) return null;
  if (WIRE_ENDPOINTS.has(value)) return value;
  return LEGACY_TO_WIRE_ENDPOINT[value] ?? null;
}

/** Resolve a model's wire endpoint: primary wins, legacy enum falls back to chat. */
export function resolveWireEndpoint(
  primary?: string | null,
  legacy?: string | null,
): string {
  return endpointWireFromLegacy(primary) ?? endpointWireFromLegacy(legacy) ?? "chat_completions";
}

export function endpointLabel(value: string | null | undefined): string {
  const wire = endpointWireFromLegacy(value);
  if (!wire) return value ?? "";
  return ENDPOINT_OPTIONS.find((o) => o.value === wire)?.label ?? wire;
}

export const CHAT_WIRE_ENDPOINTS = ["responses", "chat_completions", "messages", "converse"];

export type EndpointCategory = "chat" | "embeddings" | "image" | "audio" | "other";

export const ENDPOINT_CATEGORY_LABELS: Record<EndpointCategory, string> = {
  chat: "Chat Models",
  embeddings: "Embeddings",
  image: "Image Generation",
  audio: "Audio",
  other: "Other",
};

export function endpointCategory(
  primary?: string | null,
  legacy?: string | null,
): EndpointCategory {
  const wire = endpointWireFromLegacy(primary) ?? endpointWireFromLegacy(legacy);
  if (!wire) return primary || legacy ? "other" : "chat";
  if (wire === "embeddings") return "embeddings";
  if (wire === "images/generations") return "image";
  if (wire.startsWith("audio/")) return "audio";
  if (CHAT_WIRE_ENDPOINTS.includes(wire)) return "chat";
  return "other";
}
