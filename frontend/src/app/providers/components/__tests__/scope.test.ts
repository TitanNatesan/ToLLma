import { describe, expect, it } from "vitest";
import { getModelScope } from "../ProviderWizardModal";

describe("getModelScope", () => {
  it("identifies US-specific Bedrock cross-region inference profiles", () => {
    const s1 = getModelScope("us.anthropic.claude-3-haiku-20240307-v1:0", "global");
    expect(s1.scope).toBe("US");
    expect(s1.label).toBe("US");
    expect(s1.badgeClass).toContain("bg-blue-100");

    const s2 = getModelScope("us.anthropic.claude-haiku-4-5-20251001-v1:0", "global");
    expect(s2.scope).toBe("US");
    expect(s2.label).toBe("US");
  });

  it("identifies global models and profiles", () => {
    const s1 = getModelScope("global.anthropic.claude-haiku-4-5-20251001-v1:0", "global");
    expect(s1.scope).toBe("global");
    expect(s1.label).toBe("global");
    expect(s1.badgeClass).toContain("bg-sky-100");

    const s2 = getModelScope("anthropic.claude-haiku-4-5-20251001-v1:0", "global");
    expect(s2.scope).toBe("global");
    expect(s2.label).toBe("global");
  });

  it("identifies EU and APAC regional models", () => {
    const eu = getModelScope("eu.anthropic.claude-3-5-sonnet-20240620-v1:0", "global");
    expect(eu.scope).toBe("EU");
    expect(eu.label).toBe("EU");

    const apac = getModelScope("apac.anthropic.claude-3-5-sonnet-20240620-v1:0", "global");
    expect(apac.scope).toBe("APAC");
    expect(apac.label).toBe("APAC");
  });

  it("preserves fallback for unmatched models", () => {
    const s = getModelScope("mock-disc-a", "fallback");
    expect(s.scope).toBe("fallback");
    expect(s.label).toBe("fallback");
    expect(s.badgeClass).toContain("bg-zinc-200");
  });

  it("preserves provider for provider-specific models without region prefix", () => {
    const s = getModelScope("openai/gpt-4o", "provider_specific");
    expect(s.scope).toBe("provider");
    expect(s.label).toBe("provider");
    expect(s.badgeClass).toContain("bg-emerald-100");
  });

  it("does not false-positive match words containing 'us' such as opus or nexus", () => {
    const opus = getModelScope("claude-3-opus-20240229", "global", "Claude 3 Opus");
    expect(opus.scope).toBe("global");
    expect(opus.label).toBe("global");

    const nexus = getModelScope("nexus-7b-instruct", "global", "Nexus 7B");
    expect(nexus.scope).toBe("global");
    expect(nexus.label).toBe("global");
  });
});
