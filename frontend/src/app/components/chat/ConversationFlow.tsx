"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Crosshair, Minus, Plus, RotateCcw, User } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useConversation } from "@/hooks/useChat";
import { useConversationPath, useConversationTree, useIntelligenceMutations } from "@/hooks/useIntelligence";
import { useChatStore } from "@/store/chat";
import { toastApiError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  layoutTree,
  linearTreeFallback,
  nodePreview,
  siblingIdsFor,
} from "./conversationFlowLayout";

/**
 * Conversation Flow graph (spec sections 7-10): top-to-bottom message tree.
 * Roots on top, responses under requests, siblings side by side. Clicking a
 * node selects that branch (select endpoint) and reloads the conversation.
 * Pure SVG edges + HTML buttons — no graph dependency.
 */
export function ConversationFlow({ conversationId }: { conversationId: string | null }) {
  const streaming = useChatStore((s) => s.streaming);
  const { data: treeData, isLoading: treeLoading } = useConversationTree(conversationId);
  const { data: pathData } = useConversationPath(conversationId);
  const { data: conversation } = useConversation(conversationId);
  const { select } = useIntelligenceMutations(conversationId);

  const [zoom, setZoom] = useState(1);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());

  const persisted = useMemo(() => conversation?.messages ?? [], [conversation?.messages]);
  const contentById = useMemo(() => new Map(persisted.map((m) => [m.id, m.content])), [persisted]);

  // Tree endpoint mid-build (404) → linear fallback from persisted messages.
  // Never blank: with no conversation yet, show the empty hint instead.
  const nodes = useMemo(
    () => treeData?.nodes ?? (persisted.length > 0 ? linearTreeFallback(persisted) : []),
    [treeData, persisted],
  );
  const onPath = useMemo(() => {
    if (pathData) return new Set(pathData.path.map((m) => m.id));
    return new Set(persisted.map((m) => m.id));
  }, [pathData, persisted]);
  const activeLeafId = treeData?.active_leaf_id ?? pathData?.active_leaf_id ?? null;

  const layout = useMemo(() => layoutTree(nodes), [nodes]);
  const maxDepth = useMemo(
    () => (layout.positions.size > 0 ? Math.max(...[...layout.positions.values()].map((p) => p.depth)) : 0),
    [layout],
  );

  // Keep-active-in-view on conversation change (click-only afterwards, so
  // background refetches never yank the scroll position mid-exploration).
  const shownForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || shownForRef.current === conversationId || !activeLeafId) return;
    shownForRef.current = conversationId;
    const t = window.setTimeout(() => {
      nodeRefs.current.get(activeLeafId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 150);
    return () => window.clearTimeout(t);
  }, [conversationId, activeLeafId]);

  if (!conversationId) {
    return <p className="text-xs text-zinc-500 dark:text-zinc-400">Open a conversation to see its flow.</p>;
  }
  if (treeLoading && nodes.length === 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400" role="status">
        Loading flow…
      </p>
    );
  }
  if (nodes.length === 0) {
    return <p className="text-xs text-zinc-500 dark:text-zinc-400">No messages yet — send one to grow the tree.</p>;
  }

  const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const showActive = () => {
    if (activeLeafId)
      nodeRefs.current
        .get(activeLeafId)
        ?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
  };

  const handleSelect = (messageId: string) => {
    if (!conversationId || streaming || select.isPending || onPath.has(messageId)) return;
    select.mutate(
      { conversationId, messageId },
      { onError: (error) => toastApiError(error, { title: "Could not switch branch" }) },
    );
  };

  return (
    <div className="flex flex-col gap-2" data-testid="conversation-flow-graph">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400" data-testid="flow-meta">
          {nodes.length} node{nodes.length === 1 ? "" : "s"} · depth {maxDepth + 1}
          {layout.compact ? " · compact" : ""}
        </p>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Flow view controls">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
            disabled={zoom <= 0.5}
            aria-label="Zoom out"
            data-testid="flow-zoom-out"
          >
            <Minus className="size-3" />
          </Button>
          <span className="w-10 text-center font-mono text-[10px] text-zinc-500" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => setZoom((z) => Math.min(2, +(z + 0.25).toFixed(2)))}
            disabled={zoom >= 2}
            aria-label="Zoom in"
            data-testid="flow-zoom-in"
          >
            <Plus className="size-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => setZoom(1)}
            disabled={zoom === 1}
            aria-label="Reset zoom"
            data-testid="flow-zoom-reset"
          >
            <RotateCcw className="size-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={showActive}
            disabled={!activeLeafId}
            aria-label="Show active response in flow"
            data-testid="flow-show-active"
          >
            <Crosshair className="size-3" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="max-h-[420px] overflow-auto rounded-md border border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/40"
        data-testid="flow-scroller"
      >
        <div
          className="relative"
          style={{
            width: Math.max(layout.width * zoom, 1),
            height: Math.max(layout.height * zoom, 1),
          }}
        >
          <svg
            width={layout.width * zoom}
            height={layout.height * zoom}
            className="absolute left-0 top-0"
            aria-hidden="true"
          >
            {layout.edges.map((e) => {
              const from = layout.positions.get(e.from);
              const to = layout.positions.get(e.to);
              if (!from || !to) return null;
              const x1 = (from.x + layout.nodeWidth / 2) * zoom;
              const y1 = (from.y + 44) * zoom;
              const x2 = (to.x + layout.nodeWidth / 2) * zoom;
              const y2 = to.y * zoom;
              const mid = (y1 + y2) / 2;
              const active = onPath.has(e.from) && onPath.has(e.to);
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                  fill="none"
                  strokeWidth={active ? 2 : 1.25}
                  className={active ? "stroke-tollma-500" : "stroke-zinc-300 dark:stroke-zinc-700"}
                />
              );
            })}
          </svg>
          {nodes.map((node) => {
            const pos = layout.positions.get(node.id);
            if (!pos) return null;
            const isActive = onPath.has(node.id);
            const isLeaf = node.id === activeLeafId;
            const isAssistant = node.role === "assistant";
            const status = (node.status ?? "").toLowerCase();
            const preview = nodePreview(node, contentById);
            const siblings = siblingIdsFor(nodes, node.id);
            const versionLabel = siblings.length > 1 ? `${siblings.indexOf(node.id) + 1}/${siblings.length}` : `v${node.version_number}`;
            return (
              <button
                key={node.id}
                ref={(el) => {
                  if (el) nodeRefs.current.set(node.id, el);
                  else nodeRefs.current.delete(node.id);
                }}
                type="button"
                onClick={() => handleSelect(node.id)}
                disabled={streaming || select.isPending}
                title={preview}
                aria-label={`Select ${isAssistant ? "response" : "request"} ${versionLabel}${status ? `, ${status}` : ""}${isLeaf ? ", active" : ""}`}
                aria-current={isLeaf ? "true" : undefined}
                data-testid={`flow-node-${node.id}`}
                data-active={isActive ? "true" : "false"}
                className={cn(
                  "absolute flex items-center gap-1 rounded-lg border px-1.5 py-1 text-left transition-opacity",
                  layout.compact ? "text-[10px]" : "text-[11px]",
                  isActive
                    ? "border-tollma-500 bg-white shadow-xs dark:bg-zinc-900"
                    : "border-zinc-200 bg-white/70 opacity-55 hover:opacity-90 dark:border-zinc-700 dark:bg-zinc-900/70",
                  isLeaf && "ring-2 ring-tollma-500",
                )}
                style={{
                  left: pos.x * zoom,
                  top: pos.y * zoom,
                  width: layout.nodeWidth * zoom,
                  height: 44 * zoom,
                }}
              >
                {isAssistant ? (
                  <Bot className="size-3.5 shrink-0 text-violet-500" aria-hidden="true" />
                ) : (
                  <User className="size-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-zinc-700 dark:text-zinc-200">
                  {isAssistant ? "Response" : "Request"} <span className="font-mono">{versionLabel}</span>
                </span>
                <span
                  aria-hidden="true"
                  title={status || "unknown"}
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    status === "failed"
                      ? "bg-red-500"
                      : status === "cancelled"
                        ? "bg-amber-500"
                        : status === "running" || status === "queued"
                          ? "animate-pulse motion-reduce:animate-none bg-tollma-500"
                          : "bg-zinc-300 dark:bg-zinc-600",
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
