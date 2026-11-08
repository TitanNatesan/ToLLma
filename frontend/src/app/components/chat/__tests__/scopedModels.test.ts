import { describe, expect, it } from "vitest";
import type { AIModel, ChatKey } from "@/types";
import type { KeyModelsEntry } from "@/hooks/useChatKeys";
import { buildScopedModels, findScopedModel, findServingKeyEntry } from "../scopedModels";

function model(overrides: Partial<AIModel> = {}): AIModel {
  return {
    id: "m1",
    provider_id: "p1",
    model_id: "test-model",
    name: "Test Model",
    description: null,
    endpoint_type: "chat_completions",
    primary_endpoint: "chat_completions",
    supported_endpoints: ["chat_completions"],
    input_price: "0.000000",
    output_price: "0.000000",
    cache_read_price: "0.000000",
    cache_write_price: "0.000000",
    supports_text: true,
    supports_vision: false,
    supports_audio_input: false,
    supports_audio_output: false,
    supports_image_generation: false,
    supports_tool_calling: false,
    supports_reasoning: false,
    supports_embeddings: false,
    supports_streaming: true,
    context_window: null,
    max_output_tokens: null,
    release_date: null,
    repository_model_key: null,
    metadata: {},
    is_active: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function key(overrides: Partial<ChatKey> = {}): ChatKey {
  return {
    id: "k1",
    name: "Key",
    scope: "personal",
    org_id: null,
    org_name: null,
    enabled: true,
    model_count: 1,
    ...overrides,
  };
}

function entry(
  k: ChatKey,
  models: AIModel[] | undefined,
  overrides: Partial<KeyModelsEntry> = {},
): KeyModelsEntry {
  return { key: k, models, pending: false, error: false, ...overrides };
}

describe("buildScopedModels", () => {
  it("keeps registry-only models", () => {
    expect(buildScopedModels([model({ id: "m1" })], [])).toHaveLength(1);
  });

  it("includes key-only (org) models missing from the registry", () => {
    const union = buildScopedModels([], [entry(key({ id: "k1" }), [model({ id: "org-m" })])]);
    expect(union.map((m) => m.id)).toEqual(["org-m"]);
  });

  it("dedupes by id across registry and keys", () => {
    const union = buildScopedModels([model({ id: "m1" })], [entry(key({ id: "k1" }), [model({ id: "m1" })])]);
    expect(union.map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("findScopedModel", () => {
  it("returns null for a null selection or an unknown id", () => {
    const union = buildScopedModels([model({ id: "m1" })], []);
    expect(findScopedModel(union, null)).toBeNull();
    expect(findScopedModel(union, "gone")).toBeNull();
  });

  it("resolves registry and key-only models through one union", () => {
    const union = buildScopedModels([model({ id: "m1" })], [entry(key({ id: "k1" }), [model({ id: "org-m" })])]);
    expect(findScopedModel(union, "m1")?.id).toBe("m1");
    expect(findScopedModel(union, "org-m")?.id).toBe("org-m");
  });
});

describe("findServingKeyEntry", () => {
  const m = (id: string) => model({ id });

  it("prefers the persisted key when it serves the model", () => {
    const entries = [entry(key({ id: "k1" }), [m("m1")]), entry(key({ id: "k2" }), [m("m1")])];
    expect(findServingKeyEntry(entries, "m1", "k2")?.key.id).toBe("k2");
  });

  it("falls back to the first serving key when the persisted one does not serve", () => {
    const entries = [entry(key({ id: "k1" }), [m("other")]), entry(key({ id: "k2" }), [m("m1")])];
    expect(findServingKeyEntry(entries, "m1", "k1")?.key.id).toBe("k2");
  });

  it("binds with no persisted key yet (post-reload reconcile)", () => {
    const entries = [entry(key({ id: "k1" }), [m("m1")])];
    expect(findServingKeyEntry(entries, "m1", null)?.key.id).toBe("k1");
  });

  it("skips disabled keys, errored entries, and still-loading entries", () => {
    const entries = [
      entry(key({ id: "k1" }), undefined, { pending: true }),
      entry(key({ id: "k2" }), [m("m1")], { error: true }),
      entry(key({ id: "k3", enabled: false }), [m("m1")]),
    ];
    expect(findServingKeyEntry(entries, "m1", null)).toBeNull();
  });

  it("returns null when no key serves the model", () => {
    expect(findServingKeyEntry([entry(key({ id: "k1" }), [m("other")])], "m1", null)).toBeNull();
  });
});
