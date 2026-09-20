"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ExternalLink, FileText, Globe, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CitationSource {
  id: string | number;
  index: number;
  title: string;
  url?: string;
  snippet?: string;
  author?: string;
  publishedAt?: string;
  kind?: "web" | "file" | "document" | "knowledge_base";
}

export interface InlineCitationProps {
  source: CitationSource;
  className?: string;
}

/**
 * AI SDK Elements Inline Citation Component.
 *
 * Renders an inline numerical or badge marker that opens a popover card with
 * source title, snippet, metadata, and link.
 */
export function InlineCitation({ source, className }: InlineCitationProps) {
  const [open, setOpen] = useState(false);

  const isWeb = source.kind === "web" || !!source.url?.startsWith("http");
  const isFile = source.kind === "file" || source.kind === "document";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Citation ${source.index}: ${source.title}`}
          data-testid={`citation-marker-${source.index}`}
          onMouseEnter={() => setOpen(true)}
          className={cn(
            "inline-flex items-center justify-center align-super mx-0.5 min-w-4 h-4 px-1 rounded-full text-[10px] font-mono font-medium",
            "bg-zinc-100 text-zinc-600 hover:bg-tollma-100 hover:text-tollma-800 transition-colors",
            "dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-tollma-900/60 dark:hover:text-tollma-300",
            className,
          )}
        >
          {source.index}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={5}
          onMouseLeave={() => setOpen(false)}
          className={cn(
            "z-50 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg outline-none",
            "dark:border-zinc-800 dark:bg-zinc-900 text-xs animate-in fade-in-0 zoom-in-95",
          )}
        >
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              {isWeb ? (
                <Globe className="size-3.5 shrink-0 text-sky-500" />
              ) : isFile ? (
                <FileText className="size-3.5 shrink-0 text-tollma-600 dark:text-tollma-400" />
              ) : (
                <BookOpen className="size-3.5 shrink-0 text-amber-500" />
              )}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {source.title}
              </span>
            </div>
            <span className="shrink-0 rounded bg-zinc-100 px-1 py-0.2 text-[9px] font-mono text-zinc-500 dark:bg-zinc-800">
              [{source.index}]
            </span>
          </div>

          {source.snippet && (
            <p className="text-zinc-600 dark:text-zinc-300 text-[11px] leading-relaxed line-clamp-3 mb-2 italic bg-zinc-50 dark:bg-zinc-800/50 p-1.5 rounded">
              "{source.snippet}"
            </p>
          )}

          <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            {source.author && <span className="truncate">By {source.author}</span>}
            {source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-tollma-600 hover:text-tollma-700 dark:text-tollma-400 dark:hover:text-tollma-300 ml-auto font-medium"
              >
                <span>View Source</span>
                <ExternalLink className="size-2.5" />
              </a>
            ) : isFile ? (
              <span className="text-zinc-400">Attached File</span>
            ) : null}
          </div>
          <Popover.Arrow className="fill-white dark:fill-zinc-900" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
