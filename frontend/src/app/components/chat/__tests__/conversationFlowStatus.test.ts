import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layoutTree } from "../conversationFlowLayout";
import type { ConversationTreeNode } from "@/types";

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

describe("conversation flow square canvas contract", () => {
  it("renders the graph in a square, center-aligned viewport", () => {
    expect(flow).toContain("aspect-square");
    // Safe-centering: flex auto margins center small canvases on both axes
    // yet collapse when zoomed content overflows, keeping it scrollable.
    expect(flow).toContain("m-auto");
    expect(flow).toContain("shrink-0");
  });

  it("keeps zoom/compact working inside the square", () => {
    expect(flow).toContain("flow-zoom-in");
    expect(flow).toContain("flow-zoom-out");
    expect(flow).toContain("flow-zoom-reset");
    expect(flow).toContain("flow-show-active");
    expect(flow).toContain("layout.compact");
  });
});

describe("conversation flow icon-only node contract", () => {
  it("shows only the role glyph in the node body (no visible text labels)", () => {
    expect(flow).toContain("<Bot");
    expect(flow).toContain("<User");
    // The old inline label `{isAssistant ? "Response" : "Request"}` is gone —
    // role/version info lives in the tooltip + accessible name instead.
    expect(flow).not.toMatch(/\{\s*isAssistant \? "Response" : "Request"\s*\}/);
    expect(flow).toContain("justify-center");
  });

  it("keeps version/status info in the accessible name", () => {
    expect(flow).toContain("aria-label");
    expect(flow).toContain("roleLabel");
  });

  it("shows a hover/focus tooltip with label, version, status, and preview", () => {
    expect(flow).toContain("<Tooltip");
    expect(flow).toContain("of ${siblings.length}");
    expect(flow).toContain("Status:");
    expect(flow).toContain("{preview}");
  });
});

describe("conversation flow layout icon-size contract", () => {
  const iconNode = (over: Partial<ConversationTreeNode> & { id: string }): ConversationTreeNode => ({
    parent_message_id: null,
    role: "user",
    version_number: 1,
    status: "completed",
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("sizes nodes for glyphs, not text (normal and compact)", () => {
    const small = layoutTree([
      iconNode({ id: "q1" }),
      iconNode({ id: "a1", parent_message_id: "q1", role: "assistant" }),
    ]);
    expect(small.nodeWidth).toBeLessThanOrEqual(48);
    const big = layoutTree(
      Array.from({ length: 30 }, (_, i) =>
        iconNode({ id: `m${i}`, parent_message_id: i > 0 ? `m${i - 1}` : null }),
      ),
    );
    expect(big.compact).toBe(true);
    expect(big.nodeWidth).toBeLessThanOrEqual(48);
  });
});

describe("intelligence-panel branch-switch scroll contract", () => {
  it("scrolls the selected message to the top of the chat after switching", () => {
    expect(flow).toContain("scrollMessageToTop");
    expect(flow).toContain("getElementById");
    expect(flow).toContain('block: "start"');
    expect(flow).toContain("prefers-reduced-motion");
  });
});

describe("intelligence panel section order contract", () => {
  const panel = readFileSync(
    join(__dirname, "..", "..", "ChatSettingsPanel.tsx"),
    "utf8",
  );

  it("places Conversation Flow last, after Reasoning & Tooling", () => {
    const flowIdx = panel.indexOf('testid="intelligence-flow"');
    const reasoningIdx = panel.indexOf('testid="intelligence-reasoning"');
    expect(flowIdx).toBeGreaterThan(-1);
    expect(reasoningIdx).toBeGreaterThan(-1);
    expect(flowIdx).toBeGreaterThan(reasoningIdx);
  });
});
