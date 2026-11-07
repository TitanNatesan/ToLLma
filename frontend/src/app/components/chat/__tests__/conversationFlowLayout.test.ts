import { describe, expect, it } from "vitest";
import {
  layoutTree,
  linearTreeFallback,
  nodePreview,
  siblingIdsFor,
} from "../conversationFlowLayout";
import type { ChatMessage, ConversationTreeNode } from "@/types";

const node = (over: Partial<ConversationTreeNode> & { id: string }): ConversationTreeNode => ({
  parent_message_id: null,
  role: "user",
  version_number: 1,
  status: "completed",
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("siblingIdsFor", () => {
  it("groups same-parent nodes in version order", () => {
    const nodes = [
      node({ id: "a", version_number: 1 }),
      node({ id: "b", parent_message_id: "a", role: "assistant", version_number: 2 }),
      node({ id: "c", parent_message_id: "a", role: "assistant", version_number: 1 }),
    ];
    expect(siblingIdsFor(nodes, "b")).toEqual(["c", "b"]);
    expect(siblingIdsFor(nodes, "c")).toEqual(["c", "b"]);
    // Roots share the null parent.
    expect(siblingIdsFor([...nodes, node({ id: "root2" })], "a")).toEqual(["a", "root2"]);
  });

  it("returns empty for unknown ids", () => {
    expect(siblingIdsFor([node({ id: "a" })], "nope")).toEqual([]);
  });
});

describe("layoutTree", () => {
  it("lays roots on top with responses below and siblings adjacent", () => {
    const nodes = [
      node({ id: "q1", version_number: 1 }),
      node({ id: "a1", parent_message_id: "q1", role: "assistant", version_number: 1 }),
      node({ id: "a2", parent_message_id: "q1", role: "assistant", version_number: 2 }),
    ];
    const layout = layoutTree(nodes);
    expect(layout.positions.get("q1")!.depth).toBe(0);
    expect(layout.positions.get("a1")!.depth).toBe(1);
    expect(layout.positions.get("a2")!.depth).toBe(1);
    // Same row, adjacent x.
    const y1 = layout.positions.get("a1")!.y;
    expect(layout.positions.get("a2")!.y).toBe(y1);
    expect(layout.positions.get("a2")!.x).toBeGreaterThan(layout.positions.get("a1")!.x);
    expect(layout.edges).toHaveLength(2);
  });

  it("cycle-safe and empty-safe", () => {
    expect(layoutTree([]).positions.size).toBe(0);
    const cyclic = [
      node({ id: "x", parent_message_id: "y" }),
      node({ id: "y", parent_message_id: "x" }),
    ];
    const layout = layoutTree(cyclic);
    expect(layout.positions.size).toBe(2);
  });

  it("switches to compact mode for large trees", () => {
    const nodes = Array.from({ length: 30 }, (_, i) =>
      node({ id: `m${i}`, parent_message_id: i > 0 ? `m${i - 1}` : null }),
    );
    const layout = layoutTree(nodes);
    expect(layout.compact).toBe(true);
    expect(layout.nodeWidth).toBeLessThan(148);
  });
});

describe("linearTreeFallback", () => {
  it("chains persisted messages so the graph never goes blank", () => {
    const messages = [
      { id: "m1", role: "user", content: "hi", created_at: "2026-01-01T00:00:00Z" },
      { id: "m2", role: "assistant", content: "hello", created_at: "2026-01-01T00:00:01Z" },
    ] as ChatMessage[];
    const nodes = linearTreeFallback(messages);
    expect(nodes.map((n) => n.id)).toEqual(["m1", "m2"]);
    expect(nodes[1].parent_message_id).toBe("m1");
  });
});

describe("nodePreview", () => {
  it("prefers trimmed content, falls back to a role+version label", () => {
    const n = node({ id: "a", role: "assistant", version_number: 2 });
    expect(nodePreview(n, new Map([["a", "  hello   world  "]]))).toBe("hello world");
    expect(nodePreview(n, new Map())).toBe("Response version 2");
    expect(nodePreview(node({ id: "q", role: "user" }), new Map())).toBe("Request version 1");
  });
});
