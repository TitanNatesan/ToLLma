"use client";

import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Brain, Check, ChevronDown, ChevronUp, Copy, ListOrdered } from "lucide-react";
import {
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
} from "@/components/ai-elements/chain-of-thought";
import { Reasoning, ReasoningContent } from "@/components/ai-elements/reasoning";
import { cn } from "@/lib/utils";
import { countThinkWords } from "../../thinkBlocks";
import {
  extractReasoningSteps,
  formatReasoningDuration,
  reasoningLabel,
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
 * ToLLma reasoning surface built on the AI Elements Reasoning primitives.
 *
 * Provider-agnostic: consumes normalized `<think>` content from the backend
 * (DeepSeek, Claude, OpenAI, Gemini, Bedrock) and owns the five reasoning
 * states, live/persisted duration, token counts and detected CoT steps.
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

  const words = countThinkWords(content);
  const isStreaming = status === "streaming" || status === "thinking";
  const shownMs = durationMs ?? elapsedMs;
  const label = title ?? reasoningLabel(status, shownMs);
  const steps = extractReasoningSteps(content);

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

  return (
    <div className="my-1.5" data-testid="thinking-block">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          data-testid="reasoning-toggle"
          data-status={status}
          className={cn(
            "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border py-0 pr-2 pl-2.5 text-xs transition-colors",
            status === "failed"
              ? "border-red-200 bg-red-50/60 text-red-600 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
              : status === "interrupted"
                ? "border-zinc-200 bg-zinc-50/80 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400"
                : isStreaming
                  ? "border-amber-300 bg-amber-50/80 text-amber-800 shadow-sm dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  : "border-zinc-200 bg-zinc-50/80 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
          )}
        >
          <Brain
            className={cn(
              "size-3.5 shrink-0 text-amber-500",
              status === "failed" && "text-red-500",
              isStreaming && "animate-pulse",
            )}
          />
          <span className="font-medium whitespace-nowrap">{label}</span>
          {words > 0 && (
            <span className="truncate font-mono text-[10px] text-zinc-400" data-testid="reasoning-meta">
              · {words} {words === 1 ? "word" : "words"}
            </span>
          )}
          {tokens != null && tokens > 0 && (
            <span className="hidden font-mono text-[10px] text-zinc-400 sm:inline">
              · {tokens.toLocaleString()} tok
            </span>
          )}
          {open ? (
            <ChevronUp className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
        </button>

        <button
          type="button"
          onClick={handleCopy}
          title="Copy thought process"
          aria-label="Copy thought process"
          data-testid="reasoning-copy"
          className="flex size-6 items-center justify-center rounded-full text-zinc-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-zinc-100 hover:text-zinc-600 focus-visible:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          {copied ? (
            <Check className="size-3 text-tollma-600 dark:text-tollma-400" />
          ) : (
            <Copy className="size-3" />
          )}
        </button>
      </div>

      <Reasoning
        className="mb-0"
        isStreaming={isStreaming}
        open={open}
        onOpenChange={setOpen}
        duration={durationMs ? Math.round(durationMs / 1000) : undefined}
      >
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <ReasoningContent
                className={cn(
                  "mt-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed",
                  status === "failed"
                    ? "border-red-200/70 bg-red-50/50 text-red-900/90 dark:border-red-900/40 dark:bg-red-950/15 dark:text-red-200/90"
                    : "border-amber-200/70 bg-amber-50/50 text-amber-950/90 shadow-[0_0_20px_-8px_rgba(217,119,6,0.3)] dark:border-amber-900/50 dark:bg-amber-950/15 dark:text-amber-200/90 dark:shadow-[0_0_20px_-8px_rgba(217,119,6,0.2)]",
                )}
                data-testid="reasoning-panel"
                forceMount
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-amber-200/40 pb-1.5 text-[10px] tracking-wider text-amber-800/80 uppercase dark:border-amber-900/40 dark:text-amber-300/80">
                  <span className="font-semibold">Chain of Thought</span>
                  {shownMs != null && (
                    <span data-testid="reasoning-duration" className="font-mono lowercase">
                      {formatReasoningDuration(shownMs)}
                    </span>
                  )}
                  {words > 0 && <span>· {words} words</span>}
                  {tokens != null && tokens > 0 && (
                    <span data-testid="reasoning-tokens" className="font-mono">
                      · {tokens.toLocaleString()} tokens
                    </span>
                  )}
                  {steps.length > 0 && (
                    <span className="inline-flex items-center gap-1 font-mono">
                      <ListOrdered className="size-3" />
                      {steps.length} {steps.length === 1 ? "step" : "steps"}
                    </span>
                  )}
                </div>

                {steps.length > 1 && (
                  <ChainOfThoughtSearchResults className="mb-2 rounded-lg bg-amber-100/50 p-2 text-[11px] dark:bg-amber-950/30">
                    {steps.slice(0, 5).map((step, index) => (
                      <ChainOfThoughtSearchResult key={index} className="max-w-full truncate">
                        {step}
                      </ChainOfThoughtSearchResult>
                    ))}
                  </ChainOfThoughtSearchResults>
                )}

                <div
                  ref={bodyRef}
                  className="prose prose-sm max-h-96 overflow-y-auto pr-1 dark:prose-invert"
                >
                  {content}
                </div>
              </ReasoningContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Reasoning>
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
