import { describe, expect, it } from "vitest";
import {
  dedentBlock,
  formatReasoningDuration,
  reasoningLabel,
  splitReasoningSteps,
} from "../../reasoning";
import { splitThinkBlocks } from "../../thinkBlocks";

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

describe("splitReasoningSteps", () => {
  it("splits numbered steps and keeps each body", () => {
    const content = `
1. Analyze the user prompt and identify constraints.
The prompt asks for a plan.
2. Formulate the solution plan.
Keep it small.
3. Validate against edge cases.
`.trim();

    const outline = splitReasoningSteps(content);
    expect(outline?.preamble).toBe("");
    expect(outline?.steps).toEqual([
      { title: "Analyze the user prompt and identify constraints.", body: "The prompt asks for a plan." },
      { title: "Formulate the solution plan.", body: "Keep it small." },
      { title: "Validate against edge cases.", body: "" },
    ]);
  });

  it("splits markdown step headers and preserves the preamble", () => {
    const content = `
Let me think this through.

### Step 1: Initial exploration
Some text...
### Step 2: Implementation
More text...
`.trim();

    const outline = splitReasoningSteps(content);
    expect(outline?.preamble).toBe("Let me think this through.");
    expect(outline?.steps.map((step) => step.title)).toEqual(["Initial exploration", "Implementation"]);
    expect(outline?.steps[0].body).toBe("Some text...");
  });

  it("returns null for unstructured content or a single step", () => {
    expect(splitReasoningSteps("I will think about this problem carefully.")).toBeNull();
    expect(splitReasoningSteps("1. Only one step here.")).toBeNull();
    expect(splitReasoningSteps("")).toBeNull();
  });

  it("dedents indented bodies so prose does not render as code blocks", () => {
    const content = [
      "1. Analyze the request.",
      "    **Topic:** portfolio site.",
      "    Continuation line.",
      "2. Plan the work.",
      "\tTabbed detail line.",
    ].join("\n");

    const outline = splitReasoningSteps(content);
    expect(outline?.steps[0].body).toBe("**Topic:** portfolio site.\nContinuation line.");
    expect(outline?.steps[1].body).toBe("Tabbed detail line.");
  });

  it("leaves flush text and relative nesting untouched", () => {
    expect(dedentBlock("a\n  b\n    c")).toBe("a\n  b\n    c");
    expect(dedentBlock("plain")).toBe("plain");
    expect(dedentBlock("")).toBe("");
  });
});

describe("splitThinkBlocks", () => {
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
});
