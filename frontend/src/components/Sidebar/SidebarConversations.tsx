"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { SearchInput } from "@/components/ui/SearchInput";
import { useConversationMutations, useConversations } from "@/hooks/useChat";
import { useChatStore } from "@/store/chat";
import type { Conversation } from "@/types";
import { cn } from "@/lib/utils";

function ConvItem({
  conv,
  active,
  onSelect,
  onRename,
  onPin,
  onDelete,
}: {
  conv: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conv.title);

  if (renaming) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onRename(title);
          setRenaming(false);
        }}
        className="px-1 py-0.5"
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
          aria-label="Conversation title"
          className="h-7 w-full rounded border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </form>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800",
        active && "bg-tollma-50 font-medium text-tollma-800 dark:bg-tollma-950 dark:text-tollma-200",
      )}
    >
      {conv.is_pinned && (
        <span title="Pinned">
          <Pin className="size-3 shrink-0 text-amber-500 fill-amber-500" />
        </span>
      )}
      <button
        className="flex-1 truncate text-left"
        onClick={onSelect}
        title={conv.title}
        data-testid={`conversation-item-${conv.id}`}
      >
        {conv.title}
      </button>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <button
          onClick={onPin}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          title={conv.is_pinned ? "Unpin" : "Pin"}
          data-testid={`pin-button-${conv.id}`}
        >
          <Pin
            className={cn("size-3", conv.is_pinned ? "text-amber-500 fill-amber-500" : "text-zinc-400")}
          />
        </button>
        <button
          onClick={() => {
            setTitle(conv.title);
            setRenaming(true);
          }}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          title="Rename"
          data-testid={`rename-button-${conv.id}`}
        >
          <Pencil className="size-3" />
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30"
          title="Delete"
          data-testid={`delete-button-${conv.id}`}
        >
          <Trash2 className="size-3" />
        </button>
      </span>
    </motion.div>
  );
}

/** Chat context: new chat, conversation search, pinned + recent lists. */
export function SidebarConversations() {
  const { activeConversationId, sidebarSearch, setConversation, setSearch } = useChatStore();
  const { data: convs = [] } = useConversations(sidebarSearch);
  const mutations = useConversationMutations();

  const pinnedConvs = convs.filter((c) => c.is_pinned);
  const recentConvs = convs.filter((c) => !c.is_pinned);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Conversations">
      {/* New Chat Button */}
      <div className="p-2.5 pb-2">
        <button
          onClick={() => setConversation(null)}
          data-testid="new-chat"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 shadow-sm transition-all hover:bg-zinc-50 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          <Plus className="size-3.5" />
          <span>New chat</span>
        </button>
      </div>

      {/* Conversation Search Input */}
      <div className="px-2 pb-2">
        <SearchInput
          placeholder="Search conversations…"
          value={sidebarSearch}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          aria-label="Search conversations"
          data-testid="conversation-search"
        />
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 pt-0 space-y-3">
        {/* Pinned section */}
        <AnimatePresence>
          {pinnedConvs.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Pinned
              </p>
              <div className="space-y-0.5">
                {pinnedConvs.map((c) => (
                  <ConvItem
                    key={c.id}
                    conv={c}
                    active={activeConversationId === c.id}
                    onSelect={() => setConversation(c.id)}
                    onRename={(t) => mutations.rename.mutate({ id: c.id, title: t })}
                    onPin={() =>
                      mutations.pin.mutate({ id: c.id, pinned: !c.is_pinned })
                    }
                    onDelete={() => {
                      if (activeConversationId === c.id) setConversation(null);
                      mutations.remove.mutate(c.id);
                    }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recent section */}
        {recentConvs.length > 0 && (
          <div>
            {pinnedConvs.length > 0 && (
              <p className="mb-1 mt-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Recent
              </p>
            )}
            <div className="space-y-0.5">
              <AnimatePresence>
                {recentConvs.map((c) => (
                  <ConvItem
                    key={c.id}
                    conv={c}
                    active={activeConversationId === c.id}
                    onSelect={() => setConversation(c.id)}
                    onRename={(t) => mutations.rename.mutate({ id: c.id, title: t })}
                    onPin={() =>
                      mutations.pin.mutate({ id: c.id, pinned: !c.is_pinned })
                    }
                    onDelete={() => {
                      if (activeConversationId === c.id) setConversation(null);
                      mutations.remove.mutate(c.id);
                    }}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

        {convs.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-zinc-400">
            {sidebarSearch ? "No conversations found" : "No conversations yet"}
          </p>
        )}
      </div>
    </section>
  );
}
