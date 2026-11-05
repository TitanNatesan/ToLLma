import { describe, expect, it } from "vitest";
import { EMPTY_MODEL_FORM, fromModel, fromSuggested, toPayload } from "../ModelForm";
import type { AIModel } from "@/types";

const OPTIONS = [{ type: "effort", values: ["low", "high"], default: "low" }];

function stored(overrides: Partial<AIModel> = {}): AIModel {
  return {
    id: "m1",
    provider_id: "p1",
    model_id: "m",
    name: "M",
    description: null,
    endpoint_type: "chat_completions",
    primary_endpoint: "chat_completions",
    supported_endpoints: ["chat_completions"],
    input_price: "0",
    output_price: "0",
    cache_read_price: "0",
    cache_write_price: "0",
    supports_text: true,
    supports_vision: false,
    supports_audio_input: false,
    supports_audio_output: false,
    supports_image_generation: false,
    supports_tool_calling: false,
    supports_reasoning: true,
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

describe("ModelForm reasoning_options passthrough", () => {
  it("fromSuggested carries top-level reasoning_options into existingMetadata", () => {
    const form = fromSuggested(
      { name: "M", model_id: "m", reasoning_options: OPTIONS, metadata: {} },
      "repo-key",
    );
    expect(form.existingMetadata.reasoning_options).toEqual(OPTIONS);
  });

  it("toPayload preserves reasoning_options from existingMetadata in submit metadata", () => {
    const form = fromSuggested(
      { name: "M", model_id: "m", reasoning_options: OPTIONS, metadata: {} },
      "repo-key",
    );
    const payload = toPayload("p1", { ...form, name: "M", model_id: "m" }) as {
      metadata: Record<string, unknown>;
    };
    expect(payload.metadata.reasoning_options).toEqual(OPTIONS);
  });

  it("edit-path fromModel round-trips reasoning_options through toPayload", () => {
    const form = fromModel(stored({ metadata: { reasoning_options: OPTIONS } }));
    expect(form.existingMetadata.reasoning_options).toEqual(OPTIONS);
    const payload = toPayload("p1", form) as {
      metadata: Record<string, unknown>;
    };
    expect(payload.metadata.reasoning_options).toEqual(OPTIONS);
  });

  it("leaves existingMetadata without reasoning_options when the suggestion has none", () => {
    const form = fromSuggested({ name: "M", model_id: "m", metadata: {} }, "repo-key");
    expect("reasoning_options" in form.existingMetadata).toBe(false);
    const payload = toPayload("p1", {
      ...EMPTY_MODEL_FORM,
      name: "M",
      model_id: "m",
    }) as { metadata: Record<string, unknown> };
    expect("reasoning_options" in payload.metadata).toBe(false);
  });
});
