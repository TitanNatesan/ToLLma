"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog, DialogContent } from "@/components/ui";
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
} from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const { setConversation, setSearch, setLeftSidebar } = useChatStore();
  const { data: convs = [] } = useConversations("");
  const { data: providers = [] } = useProviders();
  const [query, setQuery] = useState("");

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setQuery("");
  }

  const run = useCallback((fn: () => void) => {
    fn();
    onClose();
  }, [onClose]);

  const filteredConvs = convs
    .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="p-0">
        <Command
          className="rounded-xl"
          label="Command palette"
          data-testid="command-palette"
        >
          <div className="flex items-center border-b border-zinc-200 px-3 dark:border-zinc-800">
            <CommandIcon className="mr-2 size-4 text-zinc-400" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search commands or conversations…"
              className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-zinc-400"
              data-testid="command-palette-input"
            />
            <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">Esc</kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto py-1">
            <Command.Empty className="py-6 text-center text-sm text-zinc-400">
              No results found.
            </Command.Empty>

            {/* Actions */}
            <Command.Group heading="Actions">
              <Command.Item
                value="new chat"
                onSelect={() => run(() => { setConversation(null); router.push("/"); })}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm data-[selected=true]:bg-zinc-100 dark:data-[selected=true]:bg-zinc-800"
                data-testid="cmd-new-chat"
              >
                <Plus className="size-4 text-zinc-500" />
                New Chat
              </Command.Item>
              <Command.Item
                value="search conversations"
                onSelect={() => run(() => { setLeftSidebar(true); setSearch(""); })}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm data-[selected=true]:bg-zinc-100 dark:data-[selected=true]:bg-zinc-800"
                data-testid="cmd-search-conversations"
              >
                <Search className="size-4 text-zinc-500" />
                Search Conversations
              </Command.Item>
              <Command.Item
                value="go to providers"
                onSelect={() => run(() => router.push("/providers"))}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm data-[selected=true]:bg-zinc-100 dark:data-[selected=true]:bg-zinc-800"
                data-testid="cmd-providers"
              >
                <Cpu className="size-4 text-zinc-500" />
                Go to Providers
              </Command.Item>
            </Command.Group>

            {/* Provider shortcuts */}
            {providers.length > 0 && (
              <Command.Group heading="Providers">
                {providers.filter((p) => p.is_active).slice(0, 4).map((p) => (
                  <Command.Item
                    key={p.id}
                    value={`provider ${p.name}`}
                    onSelect={() => run(() => { router.push("/providers"); })}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm data-[selected=true]:bg-zinc-100 dark:data-[selected=true]:bg-zinc-800"
                  >
                    <Cpu className="size-4 text-zinc-500" />
                    {p.name}
                    <span className="ml-auto text-xs text-zinc-400">{p.provider_type}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Recent conversations */}
            {filteredConvs.length > 0 && (
              <Command.Group heading="Conversations">
                {filteredConvs.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`conversation ${c.title}`}
                    onSelect={() => run(() => { setConversation(c.id); router.push("/"); })}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm data-[selected=true]:bg-zinc-100 dark:data-[selected=true]:bg-zinc-800"
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

          <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <p className="text-[10px] text-zinc-400">
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

/** Hook to mount Ctrl+K globally */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}
