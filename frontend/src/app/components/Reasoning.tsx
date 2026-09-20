"use client";

import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Brain, Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { countThinkWords } from "./thinkBlocks";
import { formatReasoningDuration, reasoningLabel, type ReasoningStatus } from "./reasoning";

export interface ReasoningProps {
  content: string;
  status: ReasoningStatus;
  /** Persisted duration (messages.thinking_ms); live timer when absent. */
  durationMs?: number | null;
  /** Provider-reported reasoning tokens, shown when > 0. */
  tokens?: number | null;
}

/**
 * The one reasoning surface for every provider (DeepSeek, Claude, OpenAI,
 * Gemini, Bedrock, future). Renders normalized <think> content that the
 * backend already extracted and persisted. AI SDK Elements Reasoning /
 * Chain-of-Thought interaction patterns, ToLLma-native markup:
 * collapsed pill at rest, expandable panel, live stream updates.
 *
 * States: Thinking… (streaming) → Thought for Xs (complete) →
 * Stopped after Xs (interrupted) → Reasoning failed.
 */
function ReasoningInner({ content, status, durationMs, tokens }: ReasoningProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Live elapsed while streaming; freezes at the last tick when the stream
  // ends (effect cleanup clears the interval, state keeps its value).
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const words = countThinkWords(content);
  const active = status === "streaming";
  const shownMs = durationMs ?? elapsedMs;
  const label = reasoningLabel(status, shownMs);

  useEffect(() => {
    if (!active) return;
    startedAt.current = Date.now();
    const timer = setInterval(() => {
      if (startedAt.current !== null) setElapsedMs(Date.now() - startedAt.current);
    }, 250);
    return () => clearInterval(timer);
  }, [active]);

  // Follow the stream inside the panel unless the user scrolled up.
  useEffect(() => {
    if (!active || !open) return;
    const el = bodyRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [content, active, open]);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      toast.success("Reasoning copied!");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="my-1.5" data-testid="thinking-block">
      {/* Collapsed pill — secondary to the final answer */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="reasoning-toggle"
          data-status={status}
          className={cn(
            "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border py-0 pl-2 pr-1.5 text-xs transition-colors",
            status === "failed"
              ? "border-red-200 bg-red-50/60 text-red-600 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
              : "border-zinc-200 bg-zinc-50/80 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200",
          )}
        >
          <Brain
            className={cn(
              "size-3 shrink-0",
              status === "failed" ? "text-red-500" : "text-amber-500",
              active && "animate-pulse",
            )}
          />
          <span className="font-medium whitespace-nowrap">{label}</span>
          {words > 0 && (
            <span className="truncate font-mono text-[10px] text-zinc-400" data-testid="reasoning-meta">
              · {words} {words === 1 ? "word" : "words"}
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

      {/* Expanded panel — subtle accent glow, low padding */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                "mt-1.5 rounded-lg border px-2.5 py-2 text-xs leading-relaxed",
                status === "failed"
                  ? "border-red-200/60 bg-red-50/40 text-red-900/90 dark:border-red-900/40 dark:bg-red-950/10 dark:text-red-200/90"
                  : "border-amber-200/60 bg-amber-50/40 text-amber-900/90 shadow-[0_0_16px_-6px_rgba(217,119,6,0.35)] dark:border-amber-900/40 dark:bg-amber-950/10 dark:text-amber-200/90 dark:shadow-[0_0_16px_-6px_rgba(217,119,6,0.25)]",
              )}
              data-testid="reasoning-panel"
            >
              <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-70">
                <span>Reasoning</span>
                {shownMs != null && (
                  <span data-testid="reasoning-duration">{formatReasoningDuration(shownMs)}</span>
                )}
                {words > 0 && <span>· {words} words</span>}
                {tokens != null && tokens > 0 && (
                  <span data-testid="reasoning-tokens">· {tokens.toLocaleString()} tokens</span>
                )}
              </div>
              <div ref={bodyRef} className="prose prose-sm max-h-80 overflow-y-auto pr-1 dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const Reasoning = memo(ReasoningInner, (prev, next) => (
  prev.content === next.content &&
  prev.status === next.status &&
  prev.durationMs === next.durationMs &&
  prev.tokens === next.tokens
));
