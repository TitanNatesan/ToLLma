import { describe, expect, it } from "vitest";
import { EMPTY_MODEL_FORM, fromModel, fromSuggested, metaFromRecord, toPayload } from "../ModelForm";
import type { AIModel } from "@/types";

function stored(overrides: Partial<AIModel> = {}): AIModel {
  return {
    id: "m1",
    provider_id: "p1",
    model_id: "m",
    name: "M",
    description: null,
    endpoint_type: "chat_completions",
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

describe("model metadata capabilities", () => {
  it("toPayload stores files/video/levels in metadata", () => {
    const payload = toPayload("p1", {
      ...EMPTY_MODEL_FORM,
      name: "M",
      model_id: "m",
      meta: { supports_files: true, supports_video_input: true, reasoning_levels: "low, high" },
    }) as { metadata: Record<string, unknown> };
    expect(payload.metadata.supports_files).toBe(true);
    expect(payload.metadata.supports_video_input).toBe(true);
    expect(payload.metadata.reasoning_levels).toEqual(["low", "high"]);
  });

  it("update round-trip preserves untouched metadata keys", () => {
    const form = fromModel(
      stored({ metadata: { repository_snapshot: { model_key: "k" }, supports_files: true } }),
    );
    expect(form.meta.supports_files).toBe(true);
    const payload = toPayload("p1", { ...form, name: "M", model_id: "m" }) as {
      metadata: Record<string, unknown>;
    };
    expect(payload.metadata.repository_snapshot).toEqual({ model_key: "k" });
    expect(payload.metadata.supports_files).toBe(true);
  });

  it("fromSuggested carries repository-seeded video flag", () => {
    const form = fromSuggested(
      { name: "V", model_id: "v", metadata: { supports_video_input: true } },
      "repo-key",
    );
    expect(form.meta.supports_video_input).toBe(true);
  });

  it("metaFromRecord tolerates missing or malformed metadata", () => {
    expect(metaFromRecord(null)).toEqual({ supports_files: false, supports_video_input: false, reasoning_levels: "" });
    expect(metaFromRecord({ metadata: { reasoning_levels: "high" } }).reasoning_levels).toBe("");
  });
});
