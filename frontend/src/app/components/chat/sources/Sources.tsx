"use client";

import { memo } from "react";
import {
  Source,
  Sources as SourcesRoot,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import type { CitationSource } from "../citations/InlineCitation";

export interface SourcesProps {
  sources?: CitationSource[];
}

/**
 * Dedicated sources section built on the AI Elements Sources primitives.
 * Renders only when backend-provided sources exist; hidden otherwise.
 */
function SourcesInner({ sources }: SourcesProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <SourcesRoot data-testid="message-sources">
      <SourcesTrigger count={sources.length} />
      <SourcesContent>
        {sources.map((source) => (
          <Source
            href={source.url}
            key={source.id}
            title={source.title}
            {...(source.url ? { target: "_blank", rel: "noreferrer" } : {})}
          />
        ))}
      </SourcesContent>
    </SourcesRoot>
  );
}

export const Sources = memo(SourcesInner, (prev, next) => prev.sources === next.sources);
