import type { ChatMessage, ConversationTreeNode } from "@/types";

/** Siblings share a parent; roots share the null parent. Sorted by version. */
export function siblingIdsFor(nodes: ConversationTreeNode[], messageId: string): string[] {
  const self = nodes.find((n) => n.id === messageId);
  if (!self) return [];
  const parent = self.parent_message_id ?? null;
  return nodes
    .filter((n) => (n.parent_message_id ?? null) === parent)
    .sort((a, b) => a.version_number - b.version_number || (a.created_at < b.created_at ? -1 : 1))
    .map((n) => n.id);
}

export interface FlowPosition {
  id: string;
  depth: number;
  x: number;
  y: number;
}

export interface FlowLayout {
  positions: Map<string, FlowPosition>;
  edges: Array<{ from: string; to: string }>;
  /** Node box width actually used (compact shrinks it). */
  nodeWidth: number;
  /** Pixel size of the laid-out canvas (before zoom). */
  width: number;
  height: number;
  compact: boolean;
}

const NODE_W = 148;
const NODE_W_COMPACT = 104;
const NODE_H = 44;
const GAP_X = 16;
const GAP_Y = 56;

/**
 * Top-to-bottom tree: depth = parent-chain length, x = order within the
 * depth row (siblings adjacent). Cycle-safe: a node already on its own
 * ancestor chain is treated as a root.
 */
export function layoutTree(nodes: ConversationTreeNode[]): FlowLayout {
  const compact = nodes.length > 24;
  const nodeW = compact ? NODE_W_COMPACT : NODE_W;
  if (nodes.length === 0)
    return { positions: new Map(), edges: [], width: 0, height: 0, compact, nodeWidth: nodeW };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthOf = (id: string, seen: Set<string>): number => {
    const node = byId.get(id);
    const parent = node?.parent_message_id ?? null;
    if (!parent || !byId.has(parent) || seen.has(id)) return 0;
    seen.add(id);
    return 1 + depthOf(parent, seen);
  };
  const rows = new Map<number, ConversationTreeNode[]>();
  for (const n of nodes) {
    const depth = depthOf(n.id, new Set());
    const row = rows.get(depth) ?? [];
    row.push(n);
    rows.set(depth, row);
  }
  // Deterministic order: parents group children adjacently (siblings sort by
  // version, then creation time).
  for (const row of rows.values()) {
    row.sort(
      (a, b) =>
        (a.parent_message_id ?? "").localeCompare(b.parent_message_id ?? "") ||
        a.version_number - b.version_number ||
        (a.created_at < b.created_at ? -1 : 1),
    );
  }
  const depths = [...rows.keys()].sort((a, b) => a - b);
  const positions = new Map<string, FlowPosition>();
  const edges: Array<{ from: string; to: string }> = [];
  let width = 0;
  for (const depth of depths) {
    const row = rows.get(depth) ?? [];
    const rowWidth = row.length * nodeW + (row.length - 1) * GAP_X;
    width = Math.max(width, rowWidth);
    row.forEach((n, i) => {
      positions.set(n.id, {
        id: n.id,
        depth,
        x: i * (nodeW + GAP_X),
        y: depth * (NODE_H + GAP_Y),
      });
    });
  }
  // Center each row under the widest one so single-child chains stay aligned.
  for (const depth of depths) {
    const row = rows.get(depth) ?? [];
    const rowWidth = row.length * nodeW + (row.length - 1) * GAP_X;
    const offset = (width - rowWidth) / 2;
    if (offset > 0) for (const n of row) positions.get(n.id)!.x += offset;
  }
  for (const n of nodes) {
    const parent = n.parent_message_id;
    if (parent && byId.has(parent)) edges.push({ from: parent, to: n.id });
  }
  const maxDepth = depths.length > 0 ? depths[depths.length - 1] : 0;
  return {
    positions,
    edges,
    nodeWidth: nodeW,
    width,
    height: maxDepth * (NODE_H + GAP_Y) + NODE_H,
    compact,
  };
}

/**
 * Fallback tree when the /tree endpoint 404s mid-build: a linear chain in
 * persisted order, so the graph still renders instead of going blank.
 */
export function linearTreeFallback(messages: ChatMessage[]): ConversationTreeNode[] {
  return messages.map((m, i) => ({
    id: m.id,
    parent_message_id: i > 0 ? messages[i - 1].id : null,
    role: m.role,
    version_number: 1,
    status: (m.status as string | null) ?? null,
    created_at: m.created_at,
  }));
}

/** Content snippet for a node tooltip; falls back to a role+version label. */
export function nodePreview(
  node: ConversationTreeNode,
  contentById: Map<string, string>,
  max = 120,
): string {
  const content = (contentById.get(node.id) ?? "").trim().replace(/\s+/g, " ");
  if (content) return content.length > max ? `${content.slice(0, max)}…` : content;
  const role = node.role === "assistant" ? "Response" : node.role === "user" ? "Request" : node.role;
  return `${role} version ${node.version_number}`;
}
