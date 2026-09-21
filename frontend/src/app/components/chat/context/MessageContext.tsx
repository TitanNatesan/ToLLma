"use client";

import { memo } from "react";
import { Layers } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ai-elements/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ContextItem {
  id: string;
  type: "file" | "rag_doc" | "memory" | "system_instruction";
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface MessageContextProps {
  contextItems?: ContextItem[];
}

const TYPE_LABEL: Record<ContextItem["type"], string> = {
  file: "File",
  rag_doc: "RAG document",
  memory: "Memory",
  system_instruction: "System instruction",
};

/**
 * Context display built on the AI Elements Collapsible primitives.
 * Renders attached RAG/memory/file context when the backend provides it.
 */
function MessageContextInner({ contextItems }: MessageContextProps) {
  if (!contextItems || contextItems.length === 0) return null;

  return (
    <Collapsible className="mb-2" data-testid="message-context">
      <CollapsibleTrigger
        className={cn(
          "flex items-center gap-1.5 text-xs text-zinc-500 transition-colors",
          "hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
        )}
      >
        <Layers className="size-3.5" />
        <span className="font-medium">
          {contextItems.length} context {contextItems.length === 1 ? "item" : "items"}
        </span>
        <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]/collapsible:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 space-y-1 border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
          {contextItems.map((item) => (
            <li className="text-xs text-zinc-500 dark:text-zinc-400" key={item.id}>
              <span className="font-medium text-zinc-700 dark:text-zinc-200">{item.title}</span>
              <span className="ml-1.5 text-[10px] tracking-wide text-zinc-400 uppercase">
                {TYPE_LABEL[item.type]}
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export const MessageContext = memo(
  MessageContextInner,
  (prev, next) => prev.contextItems === next.contextItems,
);
