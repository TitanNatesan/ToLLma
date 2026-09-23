import { describe, expect, it } from "vitest";
import type { AIModel } from "@/types";
import {
  combinedAccept,
  defaultReasoningLevel,
  getModelCapabilities,
  kindForFile,
  suggestModels,
  unsupportedMessage,
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

  it("reasoning without declared levels falls back to none/low/medium/high", () => {
    const caps = getModelCapabilities(model({ supports_reasoning: true }));
    expect(caps.reasoningLevels).toEqual(["none", "low", "medium", "high"]);
    // Adding "none" must not change the previous default (low).
    expect(defaultReasoningLevel(caps)).toBe("low");
  });

  it("reasoning honors per-model levels from metadata, with none first", () => {
    const caps = getModelCapabilities(
      model({ supports_reasoning: true, metadata: { reasoning_levels: ["default", "low", "medium", "high", "ultra"] } }),
    );
    expect(caps.reasoningLevels).toEqual(["none", "default", "low", "medium", "high", "ultra"]);
    expect(defaultReasoningLevel(caps)).toBe("default");
  });

  it("does not duplicate a declared none level", () => {
    const caps = getModelCapabilities(
      model({ supports_reasoning: true, metadata: { reasoning_levels: ["low", "none", "high"] } }),
    );
    expect(caps.reasoningLevels).toEqual(["none", "low", "high"]);
    expect(defaultReasoningLevel(caps)).toBe("low");
  });

  it("ignores malformed reasoning_levels instead of crashing", () => {
    const caps = getModelCapabilities(
      model({ supports_reasoning: true, metadata: { reasoning_levels: "high" } }),
    );
    expect(caps.reasoningLevels).toEqual(["none", "low", "medium", "high"]);
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

  it("matches the spec upload matrix", () => {
    for (const ext of ["jpg", "jpeg", "png", "webp", "gif"])
      expect(kindForFile(f(`a.${ext}`, "application/octet-stream"))).toBe("image");
    for (const ext of ["mp3", "wav", "ogg", "m4a"])
      expect(kindForFile(f(`a.${ext}`, "application/octet-stream"))).toBe("audio");
    for (const ext of ["mp4", "mov", "avi", "webm"])
      expect(kindForFile(f(`a.${ext}`, "application/octet-stream"))).toBe("video");
    for (const ext of ["pdf", "docx", "txt", "md", "csv", "xlsx", "json"])
      expect(kindForFile(f(`a.${ext}`, "application/octet-stream"))).toBe("file");
  });
});

describe("combinedAccept", () => {
  it("joins only the supported kinds", () => {
    expect(combinedAccept([])).toBe("");
    expect(combinedAccept(["image"])).toContain("image/png");
    expect(combinedAccept(["image"])).not.toContain("audio/");
    expect(combinedAccept(["file", "video"])).toContain(".pdf");
    expect(combinedAccept(["file", "video"])).toContain("video/mp4");
  });
});

describe("unsupportedMessage", () => {
  it("names the rejected type", () => {
    expect(unsupportedMessage("image", "a.png")).toBe("This model does not support image inputs.");
    expect(unsupportedMessage("file", "report.pdf")).toBe("This model does not support PDF files.");
    expect(unsupportedMessage("audio", "a.mp3")).toContain("MP3");
    expect(unsupportedMessage("video", "a.mp4")).toContain("MP4");
  });
});

describe("suggestModels", () => {
  const vision = () => model({ id: "v", name: "Vision One", supports_vision: true });
  it("suggests only active models supporting the kind, excluding current", () => {
    const models = [
      vision(),
      model({ id: "t", name: "Text Only" }),
      model({ id: "off", name: "Vision Off", supports_vision: true, is_active: false }),
    ];
    expect(suggestModels(models, "image", "v").map((m) => m.id)).toEqual([]);
    expect(suggestModels(models, "image", "t").map((m) => m.id)).toEqual(["v"]);
    expect(suggestModels(models, null, "t")).toEqual([]);
  });
});
