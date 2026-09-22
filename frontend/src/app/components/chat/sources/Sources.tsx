"use client";

import { memo } from "react";
import {
  Source,
  Sources as SourcesRoot,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import type { CitationSource } from "../citations/InlineCitation";
import { attachmentContentUrl } from "@/services/api";
import type { ChatMessage } from "@/types";

export interface SourcesProps {
  sources?: CitationSource[];
}

/**
 * Sources for a reply are the attachments of the user turn it answers —
 * exactly what the gateway injected into the model prompt. Assistant replies
 * with no preceding attachment turn get none. Pure + unit tested.
 */
export function deriveSources(messages: ChatMessage[]): Map<string, CitationSource[]> {
  const byMessage = new Map<string, CitationSource[]>();
  let pending: CitationSource[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      pending = (message.attachments ?? []).map(
        (attachment, index): CitationSource => ({
          id: attachment.id,
          index: index + 1,
          title: attachment.filename,
          url: attachmentContentUrl(attachment.id),
          kind: "file",
        }),
      );
      continue;
    }
    if (message.role === "assistant" && pending.length > 0) {
      byMessage.set(message.id, pending);
    }
  }
  return byMessage;
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
