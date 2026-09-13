import { describe, expect, it } from "vitest";
import { fromSuggested } from "../ModelForm";

describe("fromSuggested endpoint resolution", () => {
  it("defaults to converse when provider defaultEndpoint is converse and suggestion is generic chat_completions", () => {
    const suggested = {
      name: "Global Anthropic Claude Haiku 4.5",
      model_id: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
      endpoint_type: "chat_completions",
    };

    const form = fromSuggested(suggested, "repo-key", "converse");
    expect(form.endpoint_type).toBe("converse");
  });

  it("respects explicit converse endpoint in suggested payload", () => {
    const suggested = {
      name: "Global Anthropic Claude Haiku 4.5",
      model_id: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
      endpoint_type: "converse",
    };

    const form = fromSuggested(suggested, "repo-key");
    expect(form.endpoint_type).toBe("converse");
  });

  it("defaults to messages for Anthropic provider", () => {
    const suggested = {
      name: "Claude 3.5 Sonnet",
      model_id: "claude-3-5-sonnet-20240620",
      endpoint_type: "chat_completions",
    };

    const form = fromSuggested(suggested, "repo-key", "messages");
    expect(form.endpoint_type).toBe("messages");
  });

  it("defaults to chat_completions for standard chat providers", () => {
    const suggested = {
      name: "GPT-4o",
      model_id: "gpt-4o",
      endpoint_type: "chat_completions",
    };

    const form = fromSuggested(suggested, "repo-key");
    expect(form.endpoint_type).toBe("chat_completions");
  });
});
