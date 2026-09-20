"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { toast } from "sonner";
import { Dialog, DialogContent } from "./primitives";
import { useChatStore } from "@/store/chat";
import { useConversations } from "@/hooks/useChat";
import { useProviders } from "@/hooks/useRegistry";
import {
  Command as CommandIcon,
  Cpu,
  MessageSquare,
  Pin,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const {
    setConversation,
    setSearch,
    setLeftSidebar,
    setAddProviderOpen,
  } = useChatStore();
  const { data: convs = [] } = useConversations("");
  const { data: providers = [] } = useProviders();
  const [query, setQuery] = useState("");

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setQuery("");
  }

  const run = useCallback(
    (fn: () => void) => {
      fn();
      onClose();
    },
    [onClose],
  );

  const filteredConvs = convs
    .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="p-0 overflow-hidden shadow-2xl">
        <Command
          className="rounded-xl bg-white dark:bg-zinc-950"
          label="Command palette"
          data-testid="command-palette"
        >
          <div className="flex items-center border-b border-zinc-200 px-3 dark:border-zinc-800">
            <CommandIcon className="mr-2 size-4 text-zinc-400" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search commands, models, or conversations…"
              className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-zinc-400"
              data-testid="command-palette-input"
            />
            <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 font-mono dark:bg-zinc-800">
              Esc
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto py-1">
            <Command.Empty className="py-6 text-center text-sm text-zinc-400">
              No results found.
            </Command.Empty>

            {/* Core Actions */}
            <Command.Group heading="Workspace Actions" className="px-1 text-[10px] uppercase text-zinc-400 font-semibold tracking-wider">
              <Command.Item
                value="new chat start conversation"
                onSelect={() =>
                  run(() => {
                    setConversation(null);
                    router.push("/");
                  })
                }
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 data-[selected=true]:bg-tollma-50 dark:data-[selected=true]:bg-tollma-950"
                data-testid="cmd-new-chat"
              >
                <Plus className="size-4 text-zinc-500" />
                <span className="font-medium">New Chat</span>
              </Command.Item>

              <Command.Item
                value="search conversations filter chats"
                onSelect={() =>
                  run(() => {
                    setLeftSidebar(true);
                    setSearch("");
                  })
                }
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 data-[selected=true]:bg-tollma-50 dark:data-[selected=true]:bg-tollma-950"
                data-testid="cmd-search-conversations"
              >
                <Search className="size-4 text-zinc-500" />
                <span>Search Conversations</span>
              </Command.Item>

              <Command.Item
                value="go to providers manage"
                onSelect={() => run(() => router.push("/providers"))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 data-[selected=true]:bg-tollma-50 dark:data-[selected=true]:bg-tollma-950"
                data-testid="cmd-providers"
              >
                <Cpu className="size-4 text-zinc-500" />
                <span>Manage Providers</span>
              </Command.Item>

              <Command.Item
                value="add provider create new connection"
                onSelect={() =>
                  run(() => {
                    router.push("/providers");
                    setAddProviderOpen(true);
                  })
                }
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 data-[selected=true]:bg-tollma-50 dark:data-[selected=true]:bg-tollma-950"
                data-testid="cmd-add-provider"
              >
                <Plus className="size-4 text-tollma-500" />
                <span>Add Provider</span>
              </Command.Item>

            </Command.Group>

            {/* Provider Shortcuts */}
            {providers.length > 0 && (
              <Command.Group heading="Configured Providers" className="px-1 text-[10px] uppercase text-zinc-400 font-semibold tracking-wider mt-2">
                {providers.slice(0, 5).map((p) => (
                  <Command.Item
                    key={p.id}
                    value={`provider ${p.name} ${p.provider_type}`}
                    onSelect={() =>
                      run(() => {
                        router.push("/providers");
                      })
                    }
                    className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 data-[selected=true]:bg-tollma-50 dark:data-[selected=true]:bg-tollma-950"
                  >
                    <Cpu className="size-4 text-zinc-500" />
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-auto text-xs text-zinc-400 font-mono">
                      {p.provider_type}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Recent Conversations */}
            {filteredConvs.length > 0 && (
              <Command.Group heading="Recent Conversations" className="px-1 text-[10px] uppercase text-zinc-400 font-semibold tracking-wider mt-2">
                {filteredConvs.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`conversation ${c.title}`}
                    onSelect={() =>
                      run(() => {
                        setConversation(c.id);
                        router.push("/");
                      })
                    }
                    className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 data-[selected=true]:bg-tollma-50 dark:data-[selected=true]:bg-tollma-950"
                    data-testid={`cmd-conv-${c.id}`}
                  >
                    <MessageSquare className="size-4 text-zinc-500" />
                    <span className="flex-1 truncate">{c.title}</span>
                    {c.is_pinned && <Pin className="size-3.5 text-amber-500 fill-amber-500" />}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>

          <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
              <Sparkles className="size-3 text-zinc-400" />
              <span>ToLLma AI Workspace</span>
            </div>
            <p className="text-[10px] text-zinc-400 font-mono">
              <kbd className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">↑↓</kbd> navigate ·
              <kbd className="ml-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">Enter</kbd> select ·
              <kbd className="ml-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">Esc</kbd> close
            </p>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function useCommandPalette() {
  // Ctrl+K is owned by useGlobalShortcuts (single listener, one source of
  // truth); this hook only holds the open state for AppShell.
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
