"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  Copy,
  RotateCcw,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import type { ChatMessage } from "@/types";
import type { OptimisticMessage } from "@/store/chat";
import { cn } from "@/lib/utils";
import "highlight.js/styles/github-dark.css";

// Allow rendering both persisted ChatMessage and in-flight OptimisticMessage
type MessageLike = ChatMessage | (OptimisticMessage & { role: string });

function copyText(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success("Copied!")).catch(() => {});
}

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const code = typeof children === "string" ? children : "";
  return (
    <div className="relative my-2 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-3 py-1.5">
        <span className="text-[10px] text-zinc-500 font-mono">{className?.replace("language-", "") ?? "code"}</span>
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
          onClick={() => copyText(code)}
        >
          <Copy className="size-3" />
          <span>Copy</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-sm text-zinc-100">{children}</pre>
    </div>
  );
}

function ThinkBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-amber-700 dark:text-amber-400"
        onClick={() => setOpen((v) => !v)}
      >
        <Brain className="size-3.5 text-amber-600 dark:text-amber-400" />
        <span>Reasoning</span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-500">
          {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          <span>{open ? "hide" : "show"}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-amber-200 px-3 py-2 dark:border-amber-900/50">
          <div className="prose text-xs text-amber-800 dark:text-amber-300">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

function renderContent(content: string) {
  // Split <think>...</think> blocks from the rest
  const parts: Array<{ type: "think" | "text"; content: string }> = [];
  const regex = /<think>([\s\S]*?)<\/think>/g;
  let last = 0;
  let m;
  while ((m = regex.exec(content)) !== null) {
    if (m.index > last) parts.push({ type: "text", content: content.slice(last, m.index) });
    parts.push({ type: "think", content: m[1] });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ type: "text", content: content.slice(last) });
  return parts;
}

function MessageContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const parts = renderContent(content);
  return (
    <div className={cn("prose text-sm leading-relaxed", isStreaming && "streaming-cursor")}>
      {parts.map((part, i) =>
        part.type === "think" ? (
          <ThinkBlock key={i} content={part.content} />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              pre: ({ children }) => <>{children}</>,
              code: ({ className, children, ...props }) => {
                const isBlock = className?.startsWith("language-");
                return isBlock ? (
                  <CodeBlock className={className}>{children}</CodeBlock>
                ) : (
                  <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800" {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {part.content}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
}

interface ChatMessageProps {
  message: MessageLike;
  isStreaming?: boolean;
  onCopy?: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
}

function formatCost(val: string | null): string | null {
  if (!val) return null;
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  if (n === 0) return null;
  return n < 0.001 ? `$${n.toExponential(2)}` : `$${n.toFixed(4)}`;
}

function formatLatency(ms: number | null): string | null {
  if (!ms) return null;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function MessageView({ message, isStreaming, onRegenerate, onDelete }: ChatMessageProps) {
  const isUser = message.role === "user";
  const msg = message as ChatMessage;
  const costStr = formatCost(msg.total_cost ?? null);
  const latencyStr = formatLatency(msg.latency_ms ?? null);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("group flex gap-3", isUser && "flex-row-reverse")}
      data-testid={`message-${message.role}`}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          isUser
            ? "bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900"
            : "bg-gradient-to-br from-violet-500 to-indigo-500 text-white",
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </div>

      {/* Bubble */}
      <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-1", isUser && "items-end")}>
        {/* Header */}
        <div className={cn("flex items-center gap-2 text-[10px] text-zinc-400", isUser && "flex-row-reverse")}>
          <span className="font-semibold uppercase tracking-wide">
            {isUser ? "You" : "Assistant"}
          </span>
          <time dateTime={message.created_at} title={message.created_at}>
            {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
          {!isUser && msg.total_tokens != null && (
            <span title={`in: ${msg.prompt_tokens} / out: ${msg.completion_tokens}`}>
              {msg.total_tokens.toLocaleString()} tok
            </span>
          )}
          {!isUser && costStr && <span>{costStr}</span>}
          {!isUser && latencyStr && <span>{latencyStr}</span>}
        </div>

        {/* Content */}
        <div
          className={cn(
            "rounded-2xl px-3 py-2.5 text-sm",
            isUser
              ? "rounded-tr-sm bg-zinc-100 dark:bg-zinc-800"
              : "rounded-tl-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
          )}
        >
          <MessageContent content={message.content} isStreaming={isStreaming} />
        </div>

        {/* Action bar */}
        <div className={cn("flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100", isUser && "flex-row-reverse")}>
          <button
            className="flex items-center gap-1 rounded p-1 text-[10px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            onClick={() => copyText(message.content)}
            title="Copy"
            data-testid={`copy-button-${message.id}`}
          >
            <Copy className="size-3" />
            <span>Copy</span>
          </button>
          {!isUser && onRegenerate && (
            <button
              className="flex items-center gap-1 rounded p-1 text-[10px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              onClick={onRegenerate}
              title="Regenerate"
              data-testid={`regenerate-button-${message.id}`}
            >
              <RotateCcw className="size-3" />
              <span>Regenerate</span>
            </button>
          )}
          {onDelete && (
            <button
              className="rounded p-1 text-[10px] text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
              onClick={onDelete}
              title="Delete"
              data-testid={`delete-message-${message.id}`}
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
