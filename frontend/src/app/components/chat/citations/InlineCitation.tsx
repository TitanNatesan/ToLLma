"use client";

import { BookOpen, ExternalLink, FileText, Globe } from "lucide-react";
import {
  InlineCitation as InlineCitationRoot,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationQuote,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
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

const sourceIcon = (source: CitationSource) => {
  if (source.kind === "web" || source.url?.startsWith("http")) {
    return <Globe className="size-3.5 shrink-0 text-sky-500" />;
  }
  if (source.kind === "file" || source.kind === "document") {
    return <FileText className="size-3.5 shrink-0 text-tollma-600 dark:text-tollma-400" />;
  }
  return <BookOpen className="size-3.5 shrink-0 text-amber-500" />;
};

/**
 * Inline citation marker built on the AI Elements InlineCitation primitives.
 * Renders only when backend-provided citation data exists.
 */
export function InlineCitation({ source, className }: InlineCitationProps) {
  return (
    <InlineCitationRoot className={className}>
      <InlineCitationCard>
        <InlineCitationCardTrigger
          data-testid={`citation-marker-${source.index}`}
          sources={source.url ? [source.url] : []}
        />
        <InlineCitationCardBody>
          <InlineCitationSource
            className="p-3"
            description={source.snippet}
            title={source.title}
            url={source.url}
          >
            <div className="flex items-center gap-1.5">
              {sourceIcon(source)}
              <span className="text-[10px] text-zinc-400">
                {source.author ? `By ${source.author}` : `Source [${source.index}]`}
              </span>
            </div>
            {source.snippet && <InlineCitationQuote className="mt-1">{source.snippet}</InlineCitationQuote>}
            {source.url && (
              <a
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-medium text-tollma-600",
                  "hover:text-tollma-700 dark:text-tollma-400 dark:hover:text-tollma-300",
                )}
                href={source.url}
                rel="noreferrer"
                target="_blank"
              >
                <span>View source</span>
                <ExternalLink className="size-2.5" />
              </a>
            )}
          </InlineCitationSource>
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitationRoot>
  );
}
