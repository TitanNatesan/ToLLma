import { describe, expect, it } from "vitest";
import { formatReasoningDuration, reasoningLabel } from "../reasoning";

describe("formatReasoningDuration", () => {
  it("formats human durations", () => {
    expect(formatReasoningDuration(200)).toBe("<1s");
    expect(formatReasoningDuration(999)).toBe("<1s");
    expect(formatReasoningDuration(1000)).toBe("1s");
    expect(formatReasoningDuration(8200)).toBe("8s");
    expect(formatReasoningDuration(59_400)).toBe("59s");
    expect(formatReasoningDuration(60_000)).toBe("1m");
    expect(formatReasoningDuration(72_000)).toBe("1m 12s");
    expect(formatReasoningDuration(3_600_000)).toBe("60m");
  });
});

describe("reasoningLabel (provider-blind states)", () => {
  it("labels every state", () => {
    expect(reasoningLabel("streaming")).toBe("Thinking…");
    expect(reasoningLabel("complete")).toBe("Thinking");
    expect(reasoningLabel("complete", 8200)).toBe("Thought for 8s");
    expect(reasoningLabel("interrupted")).toBe("Stopped");
    expect(reasoningLabel("interrupted", 4200)).toBe("Stopped after 4s");
    expect(reasoningLabel("failed")).toBe("Reasoning failed");
  });
});
