"use client";

import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Brain, Check, ChevronDown, ChevronUp, Copy, ListOrdered } from "lucide-react";
import { cn } from "@/lib/utils";
import { countThinkWords } from "../../thinkBlocks";
import {
  extractReasoningSteps,
  formatReasoningDuration,
  reasoningLabel,
  type ReasoningStatus,
} from "../../reasoning";

export interface ChainOfThoughtProps {
  content: string;
  status: ReasoningStatus;
  /** Persisted duration in ms (from messages.thinking_ms); live timer when absent. */
  durationMs?: number | null;
  /** Provider-reported reasoning tokens, shown when > 0. */
  tokens?: number | null;
  /** Optional custom title override */
  title?: string;
  /** Controlled or initial open state */
  defaultOpen?: boolean;
}

/**
 * AI SDK Elements Chain-of-Thought & Reasoning Component.
 *
 * Provides a rich, collapsible thought-process visualization across any provider
 * (DeepSeek, Claude, OpenAI, Gemini, Bedrock) using normalized <think> data.
 *
 * States supported:
 * - "thinking": waiting for tokens
 * - "streaming": tokens actively streaming with live stopwatch
 * - "complete": final thought summary with timing, word count, and token metrics
 * - "interrupted": user cancelled generation mid-thought
 * - "failed": reasoning model encountered error
 */
function ChainOfThoughtInner({
  content,
  status,
  durationMs,
  tokens,
  title,
  defaultOpen = false,
}: ChainOfThoughtProps) {
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

  // Live stopwatch when streaming
  useEffect(() => {
    if (!isStreaming) return;
    startedAt.current = Date.now();
    const timer = setInterval(() => {
      if (startedAt.current !== null) {
        setElapsedMs(Date.now() - startedAt.current);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [isStreaming]);

  // Auto-scroll to bottom of thinking panel as tokens stream (unless user scrolled up)
  useEffect(() => {
    if (!isStreaming || !open) return;
    const el = bodyRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [content, isStreaming, open]);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      toast.success("Thought process copied!");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="my-1.5" data-testid="thinking-block">
      {/* Trigger Pill */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="reasoning-toggle"
          data-status={status}
          className={cn(
            "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border py-0 pl-2.5 pr-2 text-xs transition-colors",
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
              "size-3.5 shrink-0",
              status === "failed"
                ? "text-red-500"
                : isStreaming
                  ? "text-amber-500 animate-pulse"
                  : "text-amber-500",
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
          {open ? <ChevronUp className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
        </button>

        <button
          type="button"
          onClick={handleCopy}
          title="Copy thought process"
          aria-label="Copy thought process"
          data-testid="reasoning-copy"
          className="flex size-6 items-center justify-center rounded-full text-zinc-400 opacity-0 transition-all hover:bg-zinc-100 hover:text-zinc-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          {copied ? (
            <Check className="size-3 text-tollma-600 dark:text-tollma-400" />
          ) : (
            <Copy className="size-3" />
          )}
        </button>
      </div>

      {/* Expanded Accordion Panel */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                "mt-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed",
                status === "failed"
                  ? "border-red-200/70 bg-red-50/50 text-red-900/90 dark:border-red-900/40 dark:bg-red-950/15 dark:text-red-200/90"
                  : "border-amber-200/70 bg-amber-50/50 text-amber-950/90 shadow-[0_0_20px_-8px_rgba(217,119,6,0.3)] dark:border-amber-900/50 dark:bg-amber-950/15 dark:text-amber-200/90 dark:shadow-[0_0_20px_-8px_rgba(217,119,6,0.2)]",
              )}
              data-testid="reasoning-panel"
            >
              {/* Telemetry metadata header */}
              <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-amber-200/40 pb-1.5 text-[10px] uppercase tracking-wider text-amber-800/80 dark:border-amber-900/40 dark:text-amber-300/80">
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

              {/* Detected Steps Preview (if structured) */}
              {steps.length > 1 && (
                <div className="mb-2 rounded-lg bg-amber-100/50 p-2 text-[11px] dark:bg-amber-950/30">
                  <span className="font-semibold text-amber-900 dark:text-amber-200">Key Steps:</span>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-800 dark:text-amber-300">
                    {steps.slice(0, 5).map((step, idx) => (
                      <li key={idx} className="truncate">{step}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Thought Body */}
              <div ref={bodyRef} className="prose prose-sm max-h-96 overflow-y-auto pr-1 dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const ChainOfThought = memo(ChainOfThoughtInner, (prev, next) => (
  prev.content === next.content &&
  prev.status === next.status &&
  prev.durationMs === next.durationMs &&
  prev.tokens === next.tokens &&
  prev.title === next.title &&
  prev.defaultOpen === next.defaultOpen
));
