"use client";

import { memo, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, FileText, Globe, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CitationSource } from "../citations/InlineCitation";

export interface SourcesProps {
  sources?: CitationSource[];
  className?: string;
  defaultExpanded?: boolean;
}

/**
 * AI SDK Elements Sources Component.
 *
 * Renders a collapsible section of external sources, documents, or citations
 * referenced in the assistant message. Hidden when no sources exist.
 */
function SourcesInner({ sources, className, defaultExpanded = false }: SourcesProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!sources || sources.length === 0) return null;

  return (
    <div
      className={cn(
        "my-2 rounded-xl border border-zinc-200 bg-zinc-50/80 p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/60",
        className,
      )}
      data-testid="message-sources"
    >
      {/* Header / Toggle Button */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between text-left text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      >
        <div className="flex items-center gap-1.5 font-medium">
          <Layers className="size-3.5 text-tollma-600 dark:text-tollma-400" />
          <span>Sources</span>
          <span className="rounded-full bg-zinc-200/80 px-1.5 py-0.2 text-[10px] font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {sources.length}
          </span>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-zinc-400">
          <span>{expanded ? "Hide" : "Show all"}</span>
          {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </span>
      </button>

      {/* Preview Grid (Collapsed: 3 chips, Expanded: full card list) */}
      <div className="mt-2">
        {!expanded ? (
          <div className="flex flex-wrap gap-1.5">
            {sources.slice(0, 3).map((source) => (
              <a
                key={source.id}
                href={source.url ?? "#"}
                target={source.url ? "_blank" : undefined}
                rel="noreferrer"
                title={source.title}
                className="inline-flex max-w-[180px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-white"
              >
                {source.url ? (
                  <Globe className="size-3 shrink-0 text-sky-500" />
                ) : (
                  <FileText className="size-3 shrink-0 text-zinc-400" />
                )}
                <span className="truncate">{source.title}</span>
              </a>
            ))}
            {sources.length > 3 && (
              <span className="inline-flex items-center px-1.5 py-1 text-[10px] text-zinc-400">
                +{sources.length - 3} more
              </span>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sources.map((source) => (
              <div
                key={source.id}
                className="flex flex-col justify-between rounded-lg border border-zinc-200 bg-white p-2 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-800/90 dark:text-zinc-200"
              >
                <div className="flex items-start justify-between gap-1.5 mb-1">
                  <span className="flex items-center gap-1 text-[10px] font-mono text-zinc-400">
                    [{source.index}]
                  </span>
                  <span className="font-medium text-xs truncate flex-1">{source.title}</span>
                  {source.url && (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${source.title}`}
                      className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>

                {source.snippet && (
                  <p className="line-clamp-2 text-[11px] text-zinc-500 dark:text-zinc-400 italic mb-1.5">
                    "{source.snippet}"
                  </p>
                )}

                <div className="flex items-center justify-between text-[10px] text-zinc-400 mt-auto pt-1 border-t border-zinc-100 dark:border-zinc-800">
                  <span className="truncate">{source.author ?? (source.url ? new URL(source.url).hostname : "Local File")}</span>
                  {source.publishedAt && <span>{source.publishedAt}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const Sources = memo(SourcesInner);
