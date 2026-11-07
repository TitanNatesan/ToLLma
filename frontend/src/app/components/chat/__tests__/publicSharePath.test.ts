import { describe, expect, it } from "vitest";
import { pathToLeaf } from "../conversationFlowLayout";
import type { ConversationTreeNode } from "@/types";

const node = (over: Partial<ConversationTreeNode> & { id: string }): ConversationTreeNode => ({
  parent_message_id: null,
  role: "user",
  version_number: 1,
  status: "completed",
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

// Branched fixture: q1 -> a1 -> u2 -> a2, plus q1 -> a1b (regeneration),
// u2 -> u2b (edited follow-up), a failed a2f under u2, and a second root r1.
const nodes = [
  node({ id: "q1", version_number: 1 }),
  node({ id: "a1", parent_message_id: "q1", role: "assistant", version_number: 1 }),
  node({ id: "a1b", parent_message_id: "q1", role: "assistant", version_number: 2 }),
  node({ id: "u2", parent_message_id: "a1", version_number: 1 }),
  node({ id: "a2", parent_message_id: "u2", role: "assistant", version_number: 1 }),
  node({
    id: "a2f",
    parent_message_id: "u2",
    role: "assistant",
    version_number: 2,
    status: "failed",
  }),
  node({ id: "u2b", parent_message_id: "a1", version_number: 2 }),
  node({ id: "r1", version_number: 1 }),
];

describe("pathToLeaf (public viewer path derivation)", () => {
  it("walks the edited branch root→leaf", () => {
    expect(pathToLeaf(nodes, "u2b")).toEqual(["q1", "a1", "u2b"]);
  });

  it("walks the active leaf path, skipping the inactive regeneration", () => {
    expect(pathToLeaf(nodes, "a2")).toEqual(["q1", "a1", "u2", "a2"]);
    expect(pathToLeaf(nodes, "a2")).not.toContain("a1b");
  });

  it("includes failed/cancelled nodes instead of dropping them", () => {
    expect(pathToLeaf(nodes, "a2f")).toEqual(["q1", "a1", "u2", "a2f"]);
  });

  it("resolves a second root as its own single-node path", () => {
    expect(pathToLeaf(nodes, "r1")).toEqual(["r1"]);
  });

  it("returns empty for null, unknown, or dangling leaves", () => {
    expect(pathToLeaf(nodes, null)).toEqual([]);
    expect(pathToLeaf(nodes, "nope")).toEqual([]);
    expect(pathToLeaf([], "q1")).toEqual([]);
  });

  it("is cycle-safe and stops at dangling parents", () => {
    const cyclic = [node({ id: "x", parent_message_id: "y" }), node({ id: "y", parent_message_id: "x" })];
    expect(pathToLeaf(cyclic, "x")).toEqual(["y", "x"]);
    const dangling = [node({ id: "z", parent_message_id: "ghost" })];
    expect(pathToLeaf(dangling, "z")).toEqual(["z"]);
  });
});
