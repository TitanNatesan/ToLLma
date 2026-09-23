import { describe, expect, it } from "vitest";
import { fromSuggested, toPayload, EMPTY_MODEL_FORM } from "../ModelForm";
import {
  endpointCategory,
  endpointTypeFromWire,
  endpointWireFromLegacy,
} from "@/app/providers/fields";

describe("fromSuggested endpoint resolution", () => {
  it("defaults to converse when provider defaultEndpoint is converse and suggestion is generic chat_completions", () => {
    const suggested = {
      name: "Global Anthropic Claude Haiku 4.5",
      model_id: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
      endpoint_type: "chat_completions",
    };

    const form = fromSuggested(suggested, "repo-key", "converse");
    expect(form.primary_endpoint).toBe("converse");
  });

  it("respects explicit converse endpoint in suggested payload", () => {
    const suggested = {
      name: "Global Anthropic Claude Haiku 4.5",
      model_id: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
      endpoint_type: "converse",
    };

    const form = fromSuggested(suggested, "repo-key");
    expect(form.primary_endpoint).toBe("converse");
  });

  it("defaults to messages for Anthropic provider", () => {
    const suggested = {
      name: "Claude 3.5 Sonnet",
      model_id: "claude-3-5-sonnet-20240620",
      endpoint_type: "chat_completions",
    };

    const form = fromSuggested(suggested, "repo-key", "messages");
    expect(form.primary_endpoint).toBe("messages");
  });

  it("defaults to chat_completions for standard chat providers", () => {
    const suggested = {
      name: "GPT-4o",
      model_id: "gpt-4o",
      endpoint_type: "chat_completions",
    };

    const form = fromSuggested(suggested, "repo-key");
    expect(form.primary_endpoint).toBe("chat_completions");
  });

  it("prefers the wire primary_endpoint over the legacy endpoint_type", () => {
    const form = fromSuggested(
      {
        name: "GPT-5",
        model_id: "gpt-5",
        endpoint_type: "chat_completions",
        primary_endpoint: "responses",
      },
      "openai/gpt-5",
      "chat_completions",
    );
    expect(form.primary_endpoint).toBe("responses");
  });

  it("maps a legacy specialized endpoint_type to its wire path", () => {
    const form = fromSuggested(
      { name: "Embed", model_id: "text-embedding-3-large", endpoint_type: "embeddings" },
      "openai/text-embedding-3-large",
    );
    expect(form.primary_endpoint).toBe("embeddings");
  });

  it("always includes the primary endpoint in supported_endpoints", () => {
    const form = fromSuggested(
      {
        name: "GPT-5",
        model_id: "gpt-5",
        endpoint_type: "responses",
        supported_endpoints: ["chat_completions"],
      },
      "openai/gpt-5",
    );
    expect(form.primary_endpoint).toBe("responses");
    expect(form.supported_endpoints).toContain("responses");
    expect(form.supported_endpoints).toContain("chat_completions");
  });

  it("falls back to [primary] when the suggestion has no supported_endpoints", () => {
    const form = fromSuggested({ name: "M", model_id: "m" }, "key");
    expect(form.supported_endpoints).toEqual([form.primary_endpoint]);
  });
});

describe("wire <-> legacy endpoint mapping", () => {
  it("maps every wire path to its legacy enum value", () => {
    expect(endpointTypeFromWire("responses")).toBe("responses");
    expect(endpointTypeFromWire("chat_completions")).toBe("chat_completions");
    expect(endpointTypeFromWire("messages")).toBe("messages");
    expect(endpointTypeFromWire("converse")).toBe("converse");
    expect(endpointTypeFromWire("embeddings")).toBe("embeddings");
    expect(endpointTypeFromWire("images/generations")).toBe("images_generations");
    expect(endpointTypeFromWire("audio/transcriptions")).toBe("audio_transcriptions");
    expect(endpointTypeFromWire("audio/speech")).toBe("audio_speech");
  });

  it("falls back to chat_completions for unknown or missing endpoints", () => {
    expect(endpointTypeFromWire(null)).toBe("chat_completions");
    expect(endpointTypeFromWire("some/future-endpoint")).toBe("chat_completions");
  });

  it("resolves legacy enum values back to wire paths", () => {
    expect(endpointWireFromLegacy("images_generations")).toBe("images/generations");
    expect(endpointWireFromLegacy("audio_transcriptions")).toBe("audio/transcriptions");
    expect(endpointWireFromLegacy("images/generations")).toBe("images/generations");
    expect(endpointWireFromLegacy("nope")).toBeNull();
  });
});

describe("endpointCategory grouping", () => {
  it("groups wire endpoints and legacy fallbacks", () => {
    expect(endpointCategory("responses", null)).toBe("chat");
    expect(endpointCategory(null, "chat_completions")).toBe("chat");
    expect(endpointCategory("embeddings", null)).toBe("embeddings");
    expect(endpointCategory(null, "embeddings")).toBe("embeddings");
    expect(endpointCategory("images/generations", null)).toBe("image");
    expect(endpointCategory(null, "images_generations")).toBe("image");
    expect(endpointCategory("audio/transcriptions", null)).toBe("audio");
    expect(endpointCategory("audio/speech", null)).toBe("audio");
    expect(endpointCategory("some/future-endpoint", null)).toBe("other");
    expect(endpointCategory(null, null)).toBe("chat");
  });
});

describe("toPayload endpoint fields", () => {
  it("sends the wire primary endpoint and its legacy mirror", () => {
    const payload = toPayload("p1", {
      ...EMPTY_MODEL_FORM,
      name: "M",
      model_id: "m",
      primary_endpoint: "images/generations",
      supported_endpoints: ["images/generations", "chat_completions"],
    });
    expect(payload.primary_endpoint).toBe("images/generations");
    expect(payload.supported_endpoints).toEqual(["images/generations", "chat_completions"]);
    expect(payload.endpoint_type).toBe("images_generations");
  });
});
