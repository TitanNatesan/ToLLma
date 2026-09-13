"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useConversationMutations, useConversations } from "@/hooks/useChat";
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "lucide-react";
import { useChatStore } from "@/store/chat";
import { IconButton, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types";

// Suppress unused import warning
void IconButton;

const NAV = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/providers", label: "Providers", icon: Cpu },
];

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
        className="px-1"
      >
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
          aria-label="Conversation title"
          className="h-7 text-xs"
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
        "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800",
        active && "bg-zinc-100 font-medium dark:bg-zinc-800",
      )}
    >
      {conv.is_pinned && (
        <span title="Pinned">
          <Pin className="size-3 shrink-0 text-amber-500 fill-amber-500" />
        </span>
      )}
      <button
        className="flex-1 truncate text-left text-xs"
        onClick={onSelect}
        title={conv.title}
        data-testid={`conversation-item-${conv.id}`}
      >
        {conv.title}
      </button>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <button
          onClick={onPin}
          className="rounded p-1 text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700"
          title={conv.is_pinned ? "Unpin" : "Pin"}
          data-testid={`pin-button-${conv.id}`}
        >
          <Pin className={cn("size-3", conv.is_pinned ? "text-amber-500 fill-amber-500" : "text-zinc-400")} />
        </button>
        <button
          onClick={() => { setTitle(conv.title); setRenaming(true); }}
          className="rounded p-1 text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700"
          title="Rename"
          data-testid={`rename-button-${conv.id}`}
        >
          <Pencil className="size-3 text-zinc-400" />
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-xs text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30"
          title="Delete"
          data-testid={`delete-button-${conv.id}`}
        >
          <Trash2 className="size-3" />
        </button>
      </span>
    </motion.div>
  );
}

export function LeftSidebar() {
  const pathname = usePathname();
  const { activeConversationId, sidebarSearch, leftSidebarOpen, setConversation, setSearch, setLeftSidebar } =
    useChatStore();
  const { data: convs = [] } = useConversations(sidebarSearch);
  const mutations = useConversationMutations();

  const pinned = convs.filter((c) => c.is_pinned);
  const recent = convs.filter((c) => !c.is_pinned);

  return (
    <>
      {/* Collapse toggle — always visible */}
      <button
        className={cn(
          "fixed left-0 top-1/2 z-20 -translate-y-1/2 rounded-r-md border border-l-0 border-zinc-200 bg-white px-1 py-3 text-xs text-zinc-400 shadow-sm transition-all hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900",
          leftSidebarOpen ? "translate-x-56" : "translate-x-0",
        )}
        onClick={() => setLeftSidebar(!leftSidebarOpen)}
        aria-label={leftSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        data-testid="left-sidebar-toggle"
        style={{ transition: "transform 0.25s" }}
      >
        {leftSidebarOpen ? <ChevronLeft className="size-3 text-zinc-400" /> : <ChevronRight className="size-3 text-zinc-400" />}
      </button>

      <motion.aside
        animate={{ width: leftSidebarOpen ? 224 : 0 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        className="relative flex shrink-0 flex-col overflow-hidden border-r border-zinc-200 dark:border-zinc-800"
        aria-label="Conversations"
        data-testid="left-sidebar"
      >
        <div className="flex min-h-0 w-56 flex-1 flex-col">
          {/* Logo + nav */}
          <div className="border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
            <Link href="/" className="mb-3 block text-base font-bold tracking-tight" data-testid="app-logo">
              ToLLms
            </Link>
            <nav className="flex flex-col gap-0.5" aria-label="Main">
              {NAV.map((n) => {
                const Icon = n.icon;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800",
                      pathname === n.href && "bg-zinc-100 dark:bg-zinc-800",
                    )}
                  >
                    <Icon className="size-3.5 text-zinc-500" />
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* New chat */}
          <div className="px-3 py-2">
            <button
              onClick={() => setConversation(null)}
              data-testid="new-chat"
              className="flex w-full items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <Plus className="size-3.5 text-zinc-500" />
              New chat
            </button>
          </div>

          {/* Search */}
          <div className="px-3 pb-2">
            <Input
              placeholder="Search conversations…"
              value={sidebarSearch}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search conversations"
              data-testid="conversation-search"
              className="h-7 text-xs"
            />
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto px-2 pb-4">
            {/* Pinned section */}
            <AnimatePresence>
              {pinned.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Pinned
                  </p>
                  {pinned.map((c) => (
                    <ConvItem
                      key={c.id}
                      conv={c}
                      active={activeConversationId === c.id}
                      onSelect={() => setConversation(c.id)}
                      onRename={(t) => mutations.rename.mutate({ id: c.id, title: t })}
                      onPin={() => mutations.pin.mutate({ id: c.id, pinned: !c.is_pinned })}
                      onDelete={() => {
                        if (activeConversationId === c.id) setConversation(null);
                        mutations.remove.mutate(c.id);
                      }}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Recent section */}
            {recent.length > 0 && (
              <div>
                {pinned.length > 0 && (
                  <p className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Recent
                  </p>
                )}
                <AnimatePresence>
                  {recent.map((c) => (
                    <ConvItem
                      key={c.id}
                      conv={c}
                      active={activeConversationId === c.id}
                      onSelect={() => setConversation(c.id)}
                      onRename={(t) => mutations.rename.mutate({ id: c.id, title: t })}
                      onPin={() => mutations.pin.mutate({ id: c.id, pinned: !c.is_pinned })}
                      onDelete={() => {
                        if (activeConversationId === c.id) setConversation(null);
                        mutations.remove.mutate(c.id);
                      }}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}

            {convs.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-zinc-400">
                {sidebarSearch ? "No conversations found" : "No conversations yet"}
              </p>
            )}
          </div>
        </div>
      </motion.aside>
    </>
  );
}
