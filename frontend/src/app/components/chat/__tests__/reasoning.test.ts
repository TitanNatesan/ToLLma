import { describe, expect, it } from "vitest";
import {
  extractReasoningSteps,
  formatReasoningDuration,
  reasoningLabel,
  type ReasoningStatus,
} from "../../reasoning";
import { countThinkWords, splitThinkBlocks } from "../../thinkBlocks";

describe("reasoning formatters & labels", () => {
  it("formats duration human-readably", () => {
    expect(formatReasoningDuration(300)).toBe("<1s");
    expect(formatReasoningDuration(1000)).toBe("1s");
    expect(formatReasoningDuration(4500)).toBe("5s");
    expect(formatReasoningDuration(60000)).toBe("1m");
    expect(formatReasoningDuration(72000)).toBe("1m 12s");
  });

  it("produces correct label for all 5 reasoning states", () => {
    expect(reasoningLabel("thinking")).toBe("Thinking…");
    expect(reasoningLabel("streaming")).toBe("Thinking…");
    expect(reasoningLabel("complete", 3200)).toBe("Thought for 3s");
    expect(reasoningLabel("complete", null)).toBe("Thinking");
    expect(reasoningLabel("interrupted", 1500)).toBe("Stopped after 2s");
    expect(reasoningLabel("interrupted", null)).toBe("Stopped");
    expect(reasoningLabel("failed")).toBe("Reasoning failed");
  });
});

describe("extractReasoningSteps", () => {
  it("extracts numbered steps from structured thinking content", () => {
    const content = `
1. Analyze the user prompt and identify constraints.
2. Formulate the solution plan.
3. Validate against edge cases.
    `.trim();

    const steps = extractReasoningSteps(content);
    expect(steps).toEqual([
      "Analyze the user prompt and identify constraints.",
      "Formulate the solution plan.",
      "Validate against edge cases.",
    ]);
  });

  it("extracts markdown step headers", () => {
    const content = `
### Step 1: Initial exploration
Some text...
### Step 2: Implementation
More text...
    `.trim();

    const steps = extractReasoningSteps(content);
    expect(steps).toEqual(["Initial exploration", "Implementation"]);
  });

  it("returns empty array for unstructured thinking text", () => {
    const content = "I will think about this problem carefully and compute the sum.";
    expect(extractReasoningSteps(content)).toEqual([]);
    expect(extractReasoningSteps("")).toEqual([]);
  });
});

describe("splitThinkBlocks & countThinkWords", () => {
  it("splits closed think tags", () => {
    const parts = splitThinkBlocks("<think>Let me see.</think>The answer is 42.");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "think", content: "Let me see." });
    expect(parts[1]).toEqual({ type: "text", content: "The answer is 42." });
  });

  it("handles unclosed trailing think tag during streaming", () => {
    const parts = splitThinkBlocks("<think>Streaming thoughts in progress");
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ type: "think", content: "Streaming thoughts in progress" });
  });

  it("counts words in thinking content", () => {
    expect(countThinkWords("one two three")).toBe(3);
    expect(countThinkWords("   ")).toBe(0);
    expect(countThinkWords("one\ntwo\tthree  four")).toBe(4);
  });
});
