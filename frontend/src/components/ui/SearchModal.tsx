"use client";

import { useEffect, useMemo, useState } from "react";
import { CornerDownLeft, FileText, MessageSquare, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { useConversationSearch } from "@/hooks/useIntelligence";
import { splitHighlight } from "@/lib/diff";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/types";

export interface SearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (result: SearchResult) => void;
}

/** Global conversation/message search (Ctrl+Shift+F) backed by PostgreSQL FTS. */
export function SearchModal({ open, onOpenChange, onSelect }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useConversationSearch(debounced);
  const results = useMemo(() => data?.results ?? [], [data]);
  const safeIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("");
      setDebounced("");
      setActiveIndex(0);
    }
    onOpenChange(next);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && results[safeIndex]) {
      event.preventDefault();
      onSelect(results[safeIndex]);
      handleOpenChange(false);
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="top-[12%] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0" data-testid="search-modal">
        <DialogTitle className="sr-only">Search conversations</DialogTitle>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
          <Search className="size-4 shrink-0 text-zinc-400" />
          <input
            autoFocus
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
            data-testid="search-modal-input"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search conversations and messages…"
            value={query}
          />
          {isFetching && <span className="text-[10px] text-zinc-400">searching…</span>}
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-1.5" data-testid="search-results">
          {debounced.trim().length < 2 && (
            <p className="px-3 py-6 text-center text-xs text-zinc-400">
              Type at least two characters. Search covers titles, prompts and answers.
            </p>
          )}
          {debounced.trim().length >= 2 && results.length === 0 && !isFetching && (
            <p className="px-3 py-6 text-center text-xs text-zinc-400" data-testid="search-empty">
              No matches for “{debounced}”.
            </p>
          )}
          {results.map((result, index) => (
            <button
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                index === safeIndex ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
              )}
              data-testid={`search-result-${index}`}
              key={`${result.conversation_id}-${result.message_id ?? "title"}`}
              onClick={() => {
                onSelect(result);
                handleOpenChange(false);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              type="button"
            >
              <span className="mt-0.5 shrink-0 text-zinc-400">
                {result.kind === "conversation" ? <FileText className="size-3.5" /> : <MessageSquare className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{result.conversation_title}</span>
                  {result.model_name && (
                    <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {result.model_name}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-500 dark:text-zinc-400">
                  {splitHighlight(result.snippet).map((part, partIndex) =>
                    part.highlight ? (
                      <mark
                        className="rounded bg-amber-200/70 px-0.5 text-amber-900 dark:bg-amber-500/30 dark:text-amber-100"
                        key={partIndex}
                      >
                        {part.text}
                      </mark>
                    ) : (
                      <span key={partIndex}>{part.text}</span>
                    ),
                  )}
                </span>
                <span className="mt-1 block text-[10px] text-zinc-400">
                  {new Date(result.created_at).toLocaleString()} · {result.provider_name ?? "unknown provider"}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 px-3 py-2 text-[10px] text-zinc-400 dark:border-zinc-800">
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="size-3" /> open · ↑↓ navigate · Esc close
          </span>
          {data && <span>{data.total} result{data.total === 1 ? "" : "s"}</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
