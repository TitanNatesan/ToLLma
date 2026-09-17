"use client";

import { memo, useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronUp,
  Copy,
  OctagonX,
  Paperclip,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { MermaidBlock } from "./MermaidBlock";
import { ResponseMarkdown } from "./ResponseMarkdown";
import { attachmentContentUrl } from "@/services/api";
import type { ChatAttachment, ChatMessage } from "@/types";
import type { OptimisticMessage } from "@/store/chat";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { cn, fmtCost, fmtTokens, stripTrailingZeros } from "@/lib/utils";
import "highlight.js/styles/github-dark.css";

// Allow rendering both persisted ChatMessage and in-flight OptimisticMessage
type MessageLike = ChatMessage | (OptimisticMessage & { role: string });

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node && (node as { props?: { children?: React.ReactNode } }).props?.children) {
    return extractText((node as { props: { children: React.ReactNode } }).props.children);
  }
  return "";
}

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
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return (
    <div className="my-1.5" data-testid="thinking-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50/80 py-0 pl-2 pr-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
      >
        <Brain className="size-3 shrink-0 text-amber-500" />
        <span className="font-medium">Thinking</span>
        {words > 0 && (
          <span className="truncate font-mono text-[10px] text-zinc-400">
            · {words} {words === 1 ? "word" : "words"}
          </span>
        )}
        {open ? <ChevronUp className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-amber-200/60 bg-amber-50/40 px-2.5 py-2 text-xs leading-relaxed text-amber-900/90 shadow-[0_0_16px_-6px_rgba(217,119,6,0.35)] dark:border-amber-900/40 dark:bg-amber-950/10 dark:text-amber-200/90 dark:shadow-[0_0_16px_-6px_rgba(217,119,6,0.25)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Persisted attachment cards: images render inline, everything else links
 * to the owned download endpoint (session cookie authenticates). */
function MessageAttachments({ attachments }: { attachments?: ChatAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5" data-testid="message-attachments">
      {attachments.map((a) => {
        const url = attachmentContentUrl(a.id);
        return a.kind === "image" ? (
          <a key={a.id} href={url} target="_blank" rel="noreferrer" title={a.filename}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={a.filename}
              crossOrigin="use-credentials"
              loading="lazy"
              className="max-h-40 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
            />
          </a>
        ) : (
          <a
            key={a.id}
            href={url}
            download={a.filename}
            title={`${a.filename} (${a.kind})`}
            className="inline-flex max-w-48 items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <Paperclip className="size-3 shrink-0 text-zinc-400" />
            <span className="truncate">{a.filename}</span>
            <span className="shrink-0 text-[10px] text-zinc-400">{formatBytes(a.file_size)}</span>
          </a>
        );
      })}
    </div>
  );
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
                const codeStr = extractText(children);
                const isMermaid =
                  className === "language-mermaid" ||
                  className?.includes("mermaid") ||
                  (className?.startsWith("language-") &&
                    /^\s*(graph\s+(TD|TB|BT|RL|LR)|flowchart\s+(TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap)\b/m.test(codeStr));
                if (isMermaid) {
                  return <MermaidBlock chart={codeStr} />;
                }
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
  return fmtCost(n);
}

function formatLatency(ms: number | null): string | null {
  if (!ms) return null;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${stripTrailingZeros((ms / 1000).toFixed(1))}s`;
}

function MessageViewInner({ message, isStreaming, onRegenerate, onDelete }: ChatMessageProps) {
  const isUser = message.role === "user";
  const msg = message as ChatMessage;
  const costStr = formatCost(msg.total_cost ?? null);
  const inCostStr = formatCost(msg.input_cost ?? null);
  const outCostStr = formatCost(msg.output_cost ?? null);
  const latencyStr = formatLatency(msg.latency_ms ?? null);
  const { data: models } = useModels(undefined, undefined, { enabled: !isUser });
  const { data: providers } = useProviders();
  const modelName = !isUser ? models?.find((m) => m.id === msg.model_id)?.name : null;
  const providerName = !isUser ? providers?.find((p) => p.id === msg.provider_id)?.name : null;
  const usageTitle = [
    `in: ${msg.prompt_tokens ?? 0}`,
    `out: ${msg.completion_tokens ?? 0}`,
    msg.cache_read_tokens ? `cache-read: ${msg.cache_read_tokens}` : null,
    msg.cache_write_tokens ? `cache-write: ${msg.cache_write_tokens}` : null,
    msg.reasoning_tokens ? `reasoning: ${msg.reasoning_tokens}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const costTitle = [`in: ${inCostStr ?? "$0"}`, `out: ${outCostStr ?? "$0"}`].join(" / ");

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
      {/* Assistant icon only — user messages carry no avatar. */}
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-xs font-bold text-white">
          <Sparkles className="size-3.5" />
        </div>
      )}

      {/* Bubble */}
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1",
          isUser ? "max-w-[70%] items-end max-sm:max-w-[85%]" : "max-w-[75%] max-sm:max-w-[92%]",
        )}
      >
        {/* Header */}
        <div className={cn("flex items-center gap-2 text-[10px] text-zinc-400", isUser && "flex-row-reverse")}>
          <span className="font-semibold uppercase tracking-wide">
            {isUser ? "You" : "Assistant"}
          </span>
          <time dateTime={message.created_at} title={message.created_at}>
            {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
          {!isUser && (modelName || providerName) && (
            <span data-testid="message-model" title={`${providerName ?? ""} / ${modelName ?? ""}`}>
              {[modelName, providerName].filter(Boolean).join(" · ")}
            </span>
          )}
          {!isUser && msg.total_tokens != null && (
            <span data-testid="message-usage" title={usageTitle}>
              {fmtTokens(msg.total_tokens)} tok
            </span>
          )}
          {!isUser && costStr && (
            <span data-testid="message-cost" title={costTitle}>
              {costStr}
            </span>
          )}
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
          <MessageAttachments attachments={msg.attachments} />
          {isUser ? (
            <MessageContent content={message.content} isStreaming={isStreaming} />
          ) : (
            <ResponseMarkdown content={message.content} isStreaming={isStreaming} />
          )}
        </div>

        {/* Terminal generation states (backend-owned; never hover-only) */}
        {!isUser && (msg as ChatMessage).status === "cancelled" && (
          <div
            className="flex items-center gap-1 text-[10px] text-zinc-400"
            data-testid={`stopped-${message.id}`}
          >
            <OctagonX className="size-3" />
            <span>Stopped — partial response kept</span>
          </div>
        )}
        {!isUser && (msg as ChatMessage).status === "failed" && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
            data-testid={`failed-${message.id}`}
            role="alert"
          >
            <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
              <AlertCircle className="size-3.5 shrink-0" />
              <span className="truncate">
                Generation failed{(msg as ChatMessage).error ? `: ${(msg as ChatMessage).error}` : ""}
              </span>
            </span>
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                data-testid={`retry-${message.id}`}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-red-700"
              >
                <RotateCcw className="size-3" />
                Retry
              </button>
            )}
          </div>
        )}

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

/**
 * Per-delta renders hit only the streaming bubble: persisted message objects
 * keep referential identity across store updates, and the regenerate/delete
 * callbacks are compared by presence (they flip exactly when last-message
 * status changes, which always coincides with a message-list change).
 */
export const MessageView = memo(MessageViewInner, (prev, next) => (
  prev.message === next.message &&
  prev.isStreaming === next.isStreaming &&
  !!prev.onRegenerate === !!next.onRegenerate &&
  !!prev.onDelete === !!next.onDelete
));
