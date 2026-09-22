"use client";

import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { MarkdownContent } from "@/components/ai-elements/markdown";
import { cn } from "@/lib/utils";
import {
  reasoningLabel,
  splitReasoningSteps,
  type ReasoningStatus,
} from "../../reasoning";

export interface ReasoningPanelProps {
  content: string;
  status: ReasoningStatus;
  /** Persisted duration in ms (from messages.thinking_ms); live timer when absent. */
  durationMs?: number | null;
  /** Provider-reported reasoning tokens, shown when > 0. */
  tokens?: number | null;
  title?: string;
  defaultOpen?: boolean;
}

/**
 * ToLLma reasoning surface: AI Elements `Reasoning` for streaming prose and
 * `ChainOfThought` for structured steps. Provider-agnostic, neutral styling —
 * no custom cards, borders or duplicate labels.
 */
function ReasoningPanelInner({
  content,
  status,
  durationMs,
  tokens,
  title,
  defaultOpen = false,
}: ReasoningPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const isStreaming = status === "streaming" || status === "thinking";
  const shownMs = durationMs ?? elapsedMs;
  const label = title ?? reasoningLabel(status, shownMs);
  const outline = splitReasoningSteps(content);
  const triggerLabel = outline
    ? `${label} · ${outline.steps.length} ${outline.steps.length === 1 ? "step" : "steps"}`
    : label;

  useEffect(() => {
    if (!isStreaming) return;
    startedAt.current = Date.now();
    const timer = setInterval(() => {
      if (startedAt.current !== null) setElapsedMs(Date.now() - startedAt.current);
    }, 250);
    return () => clearInterval(timer);
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || !open) return;
    const el = bodyRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [content, isStreaming, open]);

  function handleCopy(event: React.MouseEvent) {
    event.stopPropagation();
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      toast.success("Thought process copied!");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const copyButton = (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy thought process"
      aria-label="Copy thought process"
      data-testid="reasoning-copy"
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-zinc-400 opacity-0 transition-all group-hover/reasoning:opacity-100 hover:bg-zinc-100 hover:text-zinc-600 focus-visible:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
    >
      {copied ? (
        <Check className="size-3 text-tollma-600 dark:text-tollma-400" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  );

  const body = (children: React.ReactNode) => (
    <div ref={bodyRef} className="max-h-80 overflow-y-auto overscroll-contain pr-1">
      {children}
      {tokens != null && tokens > 0 && (
        <p className="mt-2 font-mono text-[10px] text-zinc-400" data-testid="reasoning-tokens">
          {tokens.toLocaleString()} reasoning tokens
        </p>
      )}
    </div>
  );

  return (
    <div className="group/reasoning" data-testid="thinking-block">
      {outline ? (
        <ChainOfThought open={open} onOpenChange={setOpen}>
          <div className="flex items-center gap-1">
            <ChainOfThoughtHeader
              className={cn(
                "min-w-0 flex-1",
                status === "failed" && "text-red-500 hover:text-red-600 dark:hover:text-red-400",
              )}
              data-status={status}
              data-testid="reasoning-toggle"
            >
              <span data-testid="reasoning-duration">{triggerLabel}</span>
            </ChainOfThoughtHeader>
            {copyButton}
          </div>
          <ChainOfThoughtContent data-testid="reasoning-panel">
            {body(
              <div className="space-y-3">
                {outline.preamble && (
                  <MarkdownContent
                    className="text-sm text-zinc-600 dark:text-zinc-400"
                    content={outline.preamble}
                  />
                )}
                {outline.steps.map((step, index) => (
                  <ChainOfThoughtStep
                    description={
                      step.body ? (
                        <MarkdownContent
                          className="text-xs text-zinc-500 dark:text-zinc-400"
                          content={step.body}
                        />
                      ) : undefined
                    }
                    key={`${index}-${step.title}`}
                    label={step.title}
                    status={isStreaming && index === outline.steps.length - 1 ? "active" : "complete"}
                  />
                ))}
              </div>,
            )}
          </ChainOfThoughtContent>
        </ChainOfThought>
      ) : (
        <Reasoning open={open} onOpenChange={setOpen}>
          <div className="flex items-center gap-1">
            <ReasoningTrigger
              className={cn(
                "min-w-0 flex-1",
                status === "failed" && "text-red-500 hover:text-red-600 dark:hover:text-red-400",
              )}
              data-status={status}
              data-testid="reasoning-toggle"
              getThinkingMessage={() => (
                <span data-testid="reasoning-duration">{triggerLabel}</span>
              )}
            />
            {copyButton}
          </div>
          <ReasoningContent data-testid="reasoning-panel">
            {body(
              <MarkdownContent
                className="text-sm text-zinc-600 dark:text-zinc-400"
                content={content}
              />,
            )}
          </ReasoningContent>
        </Reasoning>
      )}
    </div>
  );
}

export const ReasoningPanel = memo(
  ReasoningPanelInner,
  (prev, next) =>
    prev.content === next.content &&
    prev.status === next.status &&
    prev.durationMs === next.durationMs &&
    prev.tokens === next.tokens &&
    prev.title === next.title &&
    prev.defaultOpen === next.defaultOpen,
);
