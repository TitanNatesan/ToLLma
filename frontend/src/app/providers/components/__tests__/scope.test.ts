import { describe, expect, it } from "vitest";
import { getModelScope } from "../ProviderWizardModal";

describe("getModelScope", () => {
  it("identifies US-specific Bedrock cross-region inference profiles", () => {
    const s1 = getModelScope("us.anthropic.claude-3-haiku-20240307-v1:0", "global");
    expect(s1).not.toBeNull();
    expect(s1?.scope).toBe("US");
    expect(s1?.label).toBe("US");
    expect(s1?.badgeClass).toContain("bg-blue-100");

    const s2 = getModelScope("us.anthropic.claude-haiku-4-5-20251001-v1:0", "global");
    expect(s2).not.toBeNull();
    expect(s2?.scope).toBe("US");
    expect(s2?.label).toBe("US");
  });

  it("identifies explicit global models and profiles", () => {
    const s1 = getModelScope("global.anthropic.claude-haiku-4-5-20251001-v1:0", "global");
    expect(s1).not.toBeNull();
    expect(s1?.scope).toBe("global");
    expect(s1?.label).toBe("global");
    expect(s1?.badgeClass).toContain("bg-sky-100");

    // Models without explicit global/regional prefix return null (no region shown)
    const s2 = getModelScope("anthropic.claude-haiku-4-5-20251001-v1:0", "global");
    expect(s2).toBeNull();
  });

  it("identifies EU and APAC regional models", () => {
    const eu = getModelScope("eu.anthropic.claude-3-5-sonnet-20240620-v1:0", "global");
    expect(eu).not.toBeNull();
    expect(eu?.scope).toBe("EU");
    expect(eu?.label).toBe("EU");

    const crce = getModelScope("crce.anthropic.claude-3-5-sonnet-20240620-v1:0", "fallback");
    expect(crce).not.toBeNull();
    expect(crce?.scope).toBe("EU");
    expect(crce?.label).toBe("EU");

    const apac = getModelScope("apac.anthropic.claude-3-5-sonnet-20240620-v1:0", "global");
    expect(apac).not.toBeNull();
    expect(apac?.scope).toBe("APAC");
    expect(apac?.label).toBe("APAC");
  });

  it("identifies regional prefixes even when matchType is fallback", () => {
    const s1 = getModelScope("us.anthropic.claude-3-sonnet-20240229-v1:0", "fallback");
    expect(s1).not.toBeNull();
    expect(s1?.scope).toBe("US");
    expect(s1?.label).toBe("US");

    const s2 = getModelScope("us.meta.llama3-2-11b-instruct-v1:0", "fallback");
    expect(s2).not.toBeNull();
    expect(s2?.scope).toBe("US");

    const s3 = getModelScope("eu.anthropic.claude-3-haiku-20240307-v1:0", "fallback");
    expect(s3).not.toBeNull();
    expect(s3?.scope).toBe("EU");
  });

  it("returns null when no region is found (does not show fallback badge)", () => {
    const s = getModelScope("mock-disc-a", "fallback");
    expect(s).toBeNull();

    const p = getModelScope("openai/gpt-4o", "provider_specific");
    expect(p).toBeNull();
  });

  it("does not false-positive match words containing 'us' such as opus or nexus", () => {
    const opus = getModelScope("claude-3-opus-20240229", "global", "Claude 3 Opus");
    expect(opus).toBeNull();

    const nexus = getModelScope("nexus-7b-instruct", "global", "Nexus 7B");
    expect(nexus).toBeNull();
  });
});
