"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, OctagonX } from "lucide-react";
import { ResponseMarkdown } from "@/app/components/ResponseMarkdown";
import { ConversationFlowGraph } from "@/app/components/chat/ConversationFlow";
import { pathToLeaf, siblingIdsFor } from "@/app/components/chat/conversationFlowLayout";
import type { ConversationTreeNode, PublicShare, PublicShareMessage } from "@/types";
import { cn } from "@/lib/utils";

interface PublicConversationViewProps {
  data: PublicShare;
  token: string;
}

function messageKey(message: PublicShareMessage, index: number): string {
  return message.id ?? `index-${index}`;
}

/**
 * Read-only branched conversation view. All navigation is local component
 * state (useState, default = owner's active leaf): node clicks and
 * version pagers only re-derive the visible path client-side. This module
 * never imports mutation hooks — no select/regenerate/edit/branch/delete
 * request can fire from the public route.
 */
export function PublicConversationView({ data, token }: PublicConversationViewProps) {
  const nodes: ConversationTreeNode[] = useMemo(() => data.tree?.nodes ?? [], [data.tree]);
  const ownerLeafId = data.tree?.active_leaf_id ?? null;

  const indexed = useMemo(
    () =>
      data.messages.map((message, index) => ({
        message,
        // Old backends omit ids: fall back to a stable positional id so the
        // flat list still renders (no tree navigation without real ids).
        key: message.id ?? `index-${index}`,
      })),
    [data.messages],
  );
  const messageByKey = useMemo(() => new Map(indexed.map((entry) => [entry.key, entry.message])), [indexed]);
  const contentById = useMemo(
    () => new Map(indexed.map((entry) => [entry.key, entry.message.content])),
    [indexed],
  );

  // A tree is only navigable when its nodes line up with message identity.
  const navigable = nodes.length > 0 && indexed.some((entry) => nodes.some((n) => n.id === entry.key));

  const [selectedLeafId, setSelectedLeafId] = useState<string | null>(null);

  // Effective leaf: viewer selection wins when it still resolves, otherwise
  // the owner's active path, otherwise no path (flat fallback below).
  const effectiveLeafId = useMemo(() => {
    if (!navigable) return null;
    if (selectedLeafId && pathToLeaf(nodes, selectedLeafId).length > 0) return selectedLeafId;
    if (ownerLeafId && pathToLeaf(nodes, ownerLeafId).length > 0) return ownerLeafId;
    return null;
  }, [navigable, nodes, selectedLeafId, ownerLeafId]);

  const visiblePath = useMemo(
    () => (effectiveLeafId ? pathToLeaf(nodes, effectiveLeafId) : []),
    [nodes, effectiveLeafId],
  );
  const visibleMessages: Array<{ message: PublicShareMessage; key: string }> = useMemo(() => {
    if (!navigable || visiblePath.length === 0) return indexed;
    const resolved = visiblePath
      .map((id) => {
        const message = messageByKey.get(id);
        return message ? { message, key: id } : null;
      })
      .filter((entry): entry is { message: PublicShareMessage; key: string } => entry !== null);
    // Dangling tree (nodes without message payloads): never blank the page.
    return resolved.length > 0 ? resolved : indexed;
  }, [navigable, visiblePath, messageByKey, indexed]);

  return (
    <div className="space-y-6">
      {navigable && (
        <section aria-label="Conversation tree">
          <ConversationFlowGraph
            nodes={nodes}
            contentById={contentById}
            selectedLeafId={effectiveLeafId}
            onSelectNode={setSelectedLeafId}
            revealKey={token}
          />
        </section>
      )}

      <div className="space-y-5">
        {visibleMessages.map(({ message, key }, position) => {
          const role = message.role === "user" ? "user" : "assistant";
          const status = (message.status ?? "").toLowerCase();
          const siblings = navigable ? siblingIdsFor(nodes, key) : [];
          const siblingNav = siblings.length > 1 ? siblings : null;
          const siblingIndex = siblingNav ? siblingNav.indexOf(key) : -1;
          const pagerKind = role === "user" ? "request" : "generation";
          return (
            <article
              className={cn(
                "rounded-2xl border px-4 py-3",
                role === "user"
                  ? "ml-auto max-w-[85%] border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800"
                  : "max-w-[92%] border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
              )}
              data-testid={`public-message-${role}`}
              key={key}
            >
              <header className="mb-1.5 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
                {role === "user" ? "User" : "Assistant"}
              </header>
              <ResponseMarkdown content={message.content} />
              {siblingNav && siblingIndex >= 0 && (
                <div className="mt-2 flex justify-end">
                  <div
                    className="inline-flex w-fit items-center gap-0.5 rounded-full border border-zinc-200 bg-zinc-50 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800"
                    data-testid={role === "user" ? `public-request-nav-${messageKey(message, position)}` : `public-generation-nav-${messageKey(message, position)}`}
                  >
                    <button
                      aria-label={role === "user" ? "Previous request version" : "Previous response version"}
                      className="rounded-full p-0.5 text-zinc-500 hover:bg-zinc-200 disabled:opacity-40 dark:hover:bg-zinc-700"
                      data-testid={role === "user" ? "public-request-prev" : "public-generation-prev"}
                      disabled={siblingIndex <= 0}
                      onClick={() => {
                        const target = siblingNav[siblingIndex - 1];
                        if (target) setSelectedLeafId(target);
                      }}
                      type="button"
                    >
                      <ChevronLeft className="size-3.5" />
                    </button>
                    <span
                      className="px-1 font-mono text-[10px] text-zinc-500 dark:text-zinc-400"
                      data-testid={role === "user" ? "public-request-page" : "public-generation-page"}
                    >
                      {role === "user"
                        ? `${siblingIndex + 1} / ${siblingNav.length}`
                        : `Response ${siblingIndex + 1} of ${siblingNav.length}`}
                    </span>
                    <button
                      aria-label={role === "user" ? "Next request version" : "Next response version"}
                      className="rounded-full p-0.5 text-zinc-500 hover:bg-zinc-200 disabled:opacity-40 dark:hover:bg-zinc-700"
                      data-testid={role === "user" ? "public-request-next" : "public-generation-next"}
                      disabled={siblingIndex >= siblingNav.length - 1}
                      onClick={() => {
                        const target = siblingNav[siblingIndex + 1];
                        if (target) setSelectedLeafId(target);
                      }}
                      type="button"
                    >
                      <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                </div>
              )}
              {role === "assistant" && status === "cancelled" && (
                <div
                  className="mt-2 flex items-center gap-1 text-[10px] text-zinc-400"
                  data-testid={`public-stopped-${messageKey(message, position)}`}
                >
                  <OctagonX className="size-3" />
                  <span>Stopped — partial response kept</span>
                </div>
              )}
              {role === "assistant" && status === "failed" && (
                <div
                  className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
                  data-testid={`public-failed-${messageKey(message, position)}`}
                  role="alert"
                >
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span>
                    Generation failed
                    {message.error
                      ? `: ${message.error}`
                      : " — no further attempts were made on this shared copy."}
                  </span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
