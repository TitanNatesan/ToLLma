import { describe, expect, it } from "vitest";
import { countThinkWords, splitThinkBlocks } from "../thinkBlocks";

describe("think-block contract (mirrors backend THINK_OPEN/THINK_CLOSE)", () => {
  it("splits provider-normalized reasoning from answer text", () => {
    expect(splitThinkBlocks("<think>\nR\n</think>\n\nA")).toEqual([
      { type: "think", content: "\nR\n" },
      { type: "text", content: "\n\nA" },
    ]);
  });

  it("passes plain answers through untouched", () => {
    expect(splitThinkBlocks("Just text")).toEqual([{ type: "text", content: "Just text" }]);
    expect(splitThinkBlocks("")).toEqual([]);
  });

  it("handles multiple spans and unclosed spans safely", () => {
    const parts = splitThinkBlocks("a<think>\n1\n</think>\n\nb<think>\n2\n</think>\n\nc");
    expect(parts.filter((p) => p.type === "think").map((p) => p.content)).toEqual(["\n1\n", "\n2\n"]);
    // Unclosed span: no think part (renders as plain text, never lost).
    expect(splitThinkBlocks("answer <think>\ncut off").every((p) => p.type === "text")).toBe(true);
  });

  it("renders any provider's normalized output identically", () => {
    // These strings are exactly what each adapter now emits for the same
    // semantic stream (see backend tests/test_reasoning.py).
    const normalized = [
      "<think>\nR\n</think>\n\nA", // anthropic thinking_delta
      "<think>\nR\n</think>\n\nA", // openai reasoning_content
      "<think>\nR\n</think>\n\nA", // responses reasoning summary
      "<think>\nR\n</think>\n\nA", // gemini thought part
      "<think>\nR\n</think>\n\nA", // bedrock reasoningContent
    ];
    for (const content of normalized) {
      const parts = splitThinkBlocks(content);
      expect(parts[0]).toMatchObject({ type: "think" });
      expect(parts[parts.length - 1]).toMatchObject({ type: "text", content: expect.stringContaining("A") });
    }
  });

  it("counts words for the pill label", () => {
    expect(countThinkWords("  Let me consider the options. ")).toBe(5);
    expect(countThinkWords("")).toBe(0);
    expect(countThinkWords("   ")).toBe(0);
  });
});
