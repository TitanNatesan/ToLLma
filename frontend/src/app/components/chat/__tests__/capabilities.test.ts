import { describe, expect, it } from "vitest";
import type { AIModel } from "@/types";
import {
  defaultReasoningLevel,
  getModelCapabilities,
  kindForFile,
  uploadKinds,
} from "../capabilities";

function model(overrides: Partial<AIModel> = {}): AIModel {
  return {
    id: "m1",
    provider_id: "p1",
    model_id: "test-model",
    name: "Test Model",
    description: null,
    endpoint_type: "chat_completions",
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

describe("getModelCapabilities", () => {
  it("text-only model exposes no uploads and no reasoning", () => {
    const caps = getModelCapabilities(model());
    expect(uploadKinds(caps)).toEqual([]);
    expect(caps.reasoningLevels).toEqual([]);
    expect(defaultReasoningLevel(caps)).toBeNull();
  });

  it("vision model exposes image upload only", () => {
    const caps = getModelCapabilities(model({ supports_vision: true }));
    expect(uploadKinds(caps)).toEqual(["image"]);
  });

  it("multi-capability model exposes file+image+audio, never video", () => {
    const caps = getModelCapabilities(
      model({ supports_vision: true, supports_audio_input: true, metadata: { supports_files: true } }),
    );
    expect(uploadKinds(caps)).toEqual(["file", "image", "audio"]);
  });

  it("video comes from metadata, never from model names", () => {
    const caps = getModelCapabilities(model({ metadata: { supports_video_input: true } }));
    expect(uploadKinds(caps)).toEqual(["video"]);
  });

  it("reasoning without declared levels falls back to low/medium/high", () => {
    const caps = getModelCapabilities(model({ supports_reasoning: true }));
    expect(caps.reasoningLevels).toEqual(["low", "medium", "high"]);
    expect(defaultReasoningLevel(caps)).toBe("low");
  });

  it("reasoning honors per-model levels from metadata", () => {
    const caps = getModelCapabilities(
      model({ supports_reasoning: true, metadata: { reasoning_levels: ["default", "low", "medium", "high", "ultra"] } }),
    );
    expect(caps.reasoningLevels).toEqual(["default", "low", "medium", "high", "ultra"]);
    expect(defaultReasoningLevel(caps)).toBe("default");
  });

  it("ignores malformed reasoning_levels instead of crashing", () => {
    const caps = getModelCapabilities(
      model({ supports_reasoning: true, metadata: { reasoning_levels: "high" } }),
    );
    expect(caps.reasoningLevels).toEqual(["low", "medium", "high"]);
  });

  it("null model yields safe empty capabilities", () => {
    expect(uploadKinds(getModelCapabilities(null))).toEqual([]);
  });
});

describe("kindForFile", () => {
  const f = (name: string, type: string) => new File(["x"], name, { type });
  it("classifies by mime, then extension", () => {
    expect(kindForFile(f("a.png", "image/png"))).toBe("image");
    expect(kindForFile(f("a.mp3", "audio/mpeg"))).toBe("audio");
    expect(kindForFile(f("a.mp4", "video/mp4"))).toBe("video");
    expect(kindForFile(f("a.pdf", "application/pdf"))).toBe("file");
    expect(kindForFile(f("a.bin", "application/octet-stream"))).toBeNull();
  });
});
