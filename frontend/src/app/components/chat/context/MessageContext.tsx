"use client";

import { memo, useState } from "react";
import { ChevronDown, ChevronUp, Database, FileCode } from "lucide-react";
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
  className?: string;
}

/**
 * AI SDK Elements Context Component.
 *
 * Renders contextual knowledge, attached files, or system memories utilized
 * during response generation. Stays completely hidden when no context exists.
 */
function MessageContextInner({ contextItems, className }: MessageContextProps) {
  const [open, setOpen] = useState(false);

  if (!contextItems || contextItems.length === 0) return null;

  return (
    <div
      className={cn(
        "mb-2 rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/40",
        className,
      )}
      data-testid="message-context"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <div className="flex items-center gap-1.5 font-medium">
          <Database className="size-3.5 text-zinc-500" />
          <span>Context Used</span>
          <span className="rounded-full bg-zinc-200/80 px-1.5 py-0.2 text-[10px] font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {contextItems.length}
          </span>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-zinc-400">
          <span>{open ? "Hide" : "View"}</span>
          {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 border-t border-zinc-200/60 pt-2 dark:border-zinc-800">
          {contextItems.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-zinc-200/60 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-200">
                <FileCode className="size-3 text-zinc-400" />
                <span className="truncate">{item.title}</span>
                <span className="ml-auto text-[10px] font-mono uppercase text-zinc-400">
                  {item.type}
                </span>
              </div>
              {item.content && (
                <p className="mt-1 line-clamp-3 text-[11px] text-zinc-500 font-mono">
                  {item.content}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const MessageContext = memo(MessageContextInner);
