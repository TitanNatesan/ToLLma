"use client";

import { useState } from "react";
import { useConversationMutations, useConversations } from "@/hooks/useChat";
import { useChatStore } from "@/store/chat";
import { GhostButton, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { activeConversationId, sidebarSearch, setConversation, setSearch } = useChatStore();
  const { data } = useConversations(sidebarSearch);
  const mutations = useConversationMutations();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-2 border-r border-zinc-200 p-3 dark:border-zinc-800" aria-label="Conversations">
      <GhostButton
        onClick={() => setConversation(null)}
        data-testid="new-chat"
      >
        + New chat
      </GhostButton>
      <Input
        placeholder="Search conversations"
        value={sidebarSearch}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search conversations"
      />
      <ul className="flex flex-col gap-1 overflow-y-auto">
        {(data ?? []).map((c) => (
          <li key={c.id}>
            {renaming === c.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  mutations.rename.mutate({ id: c.id, title });
                  setRenaming(null);
                }}
              >
                <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Conversation title" />
              </form>
            ) : (
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  activeConversationId === c.id && "bg-zinc-100 dark:bg-zinc-800",
                )}
              >
                <button
                  className="flex-1 truncate text-left"
                  onClick={() => setConversation(c.id)}
                  title={c.title}
                >
                  {c.title}
                </button>
                <button
                  className="hidden px-1 text-xs group-hover:inline"
                  title="Rename"
                  onClick={() => {
                    setRenaming(c.id);
                    setTitle(c.title);
                  }}
                >
                  ✎
                </button>
                <button
                  className="hidden px-1 text-xs group-hover:inline"
                  title="Delete"
                  onClick={() => {
                    if (activeConversationId === c.id) setConversation(null);
                    mutations.remove.mutate(c.id);
                  }}
                >
                  🗑
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
