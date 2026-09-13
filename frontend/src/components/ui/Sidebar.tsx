"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
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
import { Badge, Button } from "./primitives";
import { SearchInput } from "./SearchInput";
import { StatusBadge } from "./StatusBadge";
import { useConversationMutations, useConversations } from "@/hooks/useChat";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { useChatStore } from "@/store/chat";
import { PROVIDER_TYPES } from "@/app/providers/fields";
import type { Conversation, Provider, ProviderType } from "@/types";
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
        active && "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
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

export function Sidebar() {
  const pathname = usePathname();
  const isProvidersPage = pathname === "/providers";

  const {
    activeConversationId,
    sidebarSearch,
    leftSidebarOpen,
    sidebarWidth,
    providerSearch,
    providerTypeFilter,
    selectedProviderId,
    setConversation,
    setSearch,
    setLeftSidebar,
    setSidebarWidth,
    setProviderSearch,
    setProviderTypeFilter,
    setSelectedProviderId,
    setAddProviderOpen,
  } = useChatStore();

  // Chat queries
  const { data: convs = [] } = useConversations(sidebarSearch);
  const mutations = useConversationMutations();

  // Provider queries
  const { data: providers = [], isLoading: providersLoading } = useProviders();
  const { data: allModels = [] } = useModels();

  // Resizing state
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 200), 450);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, setSidebarWidth]);

  // Filtered providers
  const filteredProviders = providers.filter((p) => {
    const matchSearch =
      !providerSearch || p.name.toLowerCase().includes(providerSearch.toLowerCase());
    const matchType =
      providerTypeFilter === "ALL" || p.provider_type === providerTypeFilter;
    return matchSearch && matchType;
  });

  const pinnedConvs = convs.filter((c) => c.is_pinned);
  const recentConvs = convs.filter((c) => !c.is_pinned);

  const currentWidth = leftSidebarOpen ? sidebarWidth : 0;

  return (
    <>
      {/* Collapse Toggle Button */}
      <button
        className={cn(
          "fixed left-0 top-1/2 z-20 -translate-y-1/2 rounded-r-md border border-l-0 border-zinc-200 bg-white px-1 py-3 text-xs text-zinc-400 shadow-sm transition-all hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900",
        )}
        style={{
          transform: `translate(${leftSidebarOpen ? `${sidebarWidth}px` : "0px"}, -50%)`,
          transition: isResizing ? "none" : "transform 0.25s ease-in-out",
        }}
        onClick={() => setLeftSidebar(!leftSidebarOpen)}
        aria-label={leftSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        data-testid="left-sidebar-toggle"
      >
        {leftSidebarOpen ? (
          <ChevronLeft className="size-3 text-zinc-400" />
        ) : (
          <ChevronRight className="size-3 text-zinc-400" />
        )}
      </button>

      <motion.aside
        animate={{ width: currentWidth }}
        transition={{
          duration: isResizing ? 0 : 0.25,
          ease: "easeInOut",
        }}
        className="relative flex shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-950/40"
        aria-label={isProvidersPage ? "Provider list" : "Conversations"}
        data-testid="left-sidebar"
        style={{ width: currentWidth }}
      >
        <div
          className="flex h-full flex-col overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          {isProvidersPage ? (
            /* =======================================================
               PROVIDERS SIDEBAR VIEW
               ======================================================= */
            <section
              className="flex h-full flex-1 flex-col overflow-hidden"
              aria-label="Provider list"
            >
              {/* Header & Add Provider Action */}
              <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
                <div className="flex items-center gap-1.5">
                  <Cpu className="size-3.5 text-zinc-500" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Providers
                  </span>
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {providers.length}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  onClick={() => setAddProviderOpen(true)}
                  data-testid="add-provider"
                  className="h-7 gap-1 px-2 text-xs"
                >
                  <Plus className="size-3" />
                  <span>Add</span>
                </Button>
              </div>

              {/* Search & Filter Chips */}
              <div className="flex flex-col gap-2 border-b border-zinc-200 p-2.5 dark:border-zinc-800">
                <SearchInput
                  placeholder="Search providers…"
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                  onClear={() => setProviderSearch("")}
                  aria-label="Search providers"
                  data-testid="provider-search"
                />

                {/* Filter chips */}
                <div className="flex flex-wrap gap-1">
                  {(["ALL", ...PROVIDER_TYPES] as Array<ProviderType | "ALL">).map((t) => {
                    const isSelected = providerTypeFilter === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setProviderTypeFilter(t)}
                        data-testid={`type-filter-${t}`}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                          isSelected
                            ? "border-zinc-700 bg-zinc-700 text-white dark:border-zinc-300 dark:bg-zinc-300 dark:text-zinc-900"
                            : "border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600",
                        )}
                      >
                        {t === "ALL" ? "All" : t}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Providers list */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-[300px]">
                {providersLoading && (
                  <p className="p-4 text-center text-xs text-zinc-400">Loading providers…</p>
                )}

                {filteredProviders.map((p) => {
                  const count = allModels.filter((m) => m.provider_id === p.id).length;
                  const isSelected = selectedProviderId === p.id;

                  return (
                    <div
                      key={p.id}
                      data-testid={`provider-card-${p.id}`}
                      onClick={() => setSelectedProviderId(p.id)}
                      className={cn(
                        "group cursor-pointer rounded-lg border p-2.5 transition-all text-xs",
                        isSelected
                          ? "border-zinc-500 bg-white shadow-sm ring-1 ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-900"
                          : "border-zinc-200 bg-white/70 hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {p.name}
                        </span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                          {p.provider_type}
                        </Badge>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
                        <StatusBadge
                          status={p.validation_status}
                          label={
                            p.validation_status === "valid"
                              ? "Valid"
                              : p.validation_status === "invalid"
                                ? "Invalid"
                                : "Unvalidated"
                          }
                        />
                        <span data-testid={`model-count-${p.id}`} className="font-mono">
                          {count} model{count === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {filteredProviders.length === 0 && !providersLoading && (
                  <div className="py-8 text-center text-xs text-zinc-400">
                    No providers found
                  </div>
                )}
              </div>
            </section>
          ) : (
            /* =======================================================
               CHAT SIDEBAR VIEW
               ======================================================= */
            <section
              className="flex h-full flex-1 flex-col overflow-hidden"
              aria-label="Conversations"
            >
              {/* New Chat Button */}
              <div className="p-2.5 border-b border-zinc-200 dark:border-zinc-800">
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
              <div className="p-2 border-b border-zinc-200 dark:border-zinc-800">
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
              <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
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
          )}
        </div>

        {/* Resizer Handle */}
        <div
          id="sidebar-resizer"
          onMouseDown={() => setIsResizing(true)}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-zinc-400/50 active:bg-zinc-500 transition-colors z-10"
        />
      </motion.aside>
    </>
  );
}
