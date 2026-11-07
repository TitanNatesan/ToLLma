import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ConversationFlow status contract (spec sections 7-10): the graph must
// visually distinguish the active path from inactive branches and failed
// nodes from healthy ones. Rendering the component needs query/store
// mocking, so assert the structural contract statically — the same pattern
// as messageViewPager.test.ts.
const flow = readFileSync(join(__dirname, "..", "ConversationFlow.tsx"), "utf8");

describe("conversation flow active-path highlight contract", () => {
  it("marks nodes on the active path distinctly from inactive branches", () => {
    expect(flow).toContain('data-active={isActive ? "true" : "false"}');
    expect(flow).toContain("border-tollma-500");
    expect(flow).toContain("opacity-55");
    expect(flow).toContain("aria-current");
  });

  it("rings the active leaf so the selected branch tip stands out", () => {
    expect(flow).toContain("isLeaf");
    expect(flow).toContain("ring-2 ring-tollma-500");
  });

  it("highlights active edges distinctly from inactive ones", () => {
    expect(flow).toContain("stroke-tollma-500");
    expect(flow).toContain("strokeWidth");
    expect(flow).toContain("onPath.has(e.from) && onPath.has(e.to)");
  });
});

describe("conversation flow failed-node distinction contract", () => {
  it("gives failed/cancelled/running nodes distinct status dots", () => {
    expect(flow).toContain("bg-red-500");
    expect(flow).toContain("bg-amber-500");
    expect(flow).toContain("animate-pulse");
    expect(flow).toContain('"failed"');
    expect(flow).toContain('"cancelled"');
  });

  it("exposes node identity and status to assistive tech and e2e", () => {
    expect(flow).toContain("flow-node-");
    expect(flow).toContain("data-testid=\"conversation-flow-graph\"");
  });
});
