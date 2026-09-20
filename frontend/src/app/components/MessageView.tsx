"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  AlertCircle,
  Copy,
  OctagonX,
  Paperclip,
  RotateCcw,
} from "lucide-react";
import { MermaidBlock } from "./MermaidBlock";
import { ResponseMarkdown } from "./ResponseMarkdown";
import { ChainOfThought } from "./chat/reasoning/ChainOfThought";
import { Sources } from "./chat/sources/Sources";
import { ToolCall } from "./chat/tools/ToolCall";
import { MessageContext } from "./chat/context/MessageContext";
import {
  MessageRoot,
  MessageAvatar,
  MessageBubble,
  MessageHeader,
  MessageBodyContainer,
  MessageActions,
} from "./chat/message/Message";
import { splitThinkBlocks } from "./thinkBlocks";
import type { ReasoningStatus } from "./reasoning";
import { attachmentContentUrl } from "@/services/api";
import type { ChatAttachment, ChatMessage } from "@/types";
import type { OptimisticMessage } from "@/store/chat";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { fmtCost, fmtTokens, stripTrailingZeros } from "@/lib/utils";
import "highlight.js/styles/github-dark.css";

// Allow rendering both persisted ChatMessage and in-flight OptimisticMessage
type MessageLike = ChatMessage | (OptimisticMessage & { role: string });

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (
    typeof node === "object" &&
    "props" in node &&
    (node as { props?: { children?: React.ReactNode } }).props?.children
  ) {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Persisted attachment cards: images render inline, documents link to download. */
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

/** User content is plain text or user markdown. */
function MessageContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className={isStreaming ? "streaming-cursor" : undefined}>
      <ReactMarkdown
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
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Composable assistant body: reasoning parts first, then answer parts. */
function AssistantContent({
  content,
  isStreaming,
  status,
  thinkingMs,
  reasoningTokens,
}: {
  content: string;
  isStreaming?: boolean;
  status: ReasoningStatus;
  thinkingMs?: number | null;
  reasoningTokens?: number | null;
}) {
  return (
    <>
      {splitThinkBlocks(content).map((part, i) =>
        part.type === "think" ? (
          <ChainOfThought
            key={i}
            content={part.content}
            status={status}
            durationMs={thinkingMs}
            tokens={reasoningTokens}
          />
        ) : (
          part.content.trim() && (
            <ResponseMarkdown key={i} content={part.content} isStreaming={isStreaming} />
          )
        ),
      )}
    </>
  );
}

export interface ChatMessageProps {
  message: MessageLike;
  isStreaming?: boolean;
  onCopy?: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
}

function formatCost(val: string | null): string | null {
  if (!val) return null;
  const n = parseFloat(val);
  if (isNaN(n) || n === 0) return null;
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

  // Mapped generation lifecycle status for reasoning
  const reasoningStatus: ReasoningStatus = isStreaming
    ? (message.content.includes("<think>") && !message.content.includes("</think>") ? "streaming" : "thinking")
    : msg.status === "cancelled"
      ? "interrupted"
      : msg.status === "failed"
        ? "failed"
        : "complete";

  // Optional attached metadata for sources, tools, and context
  const metadata = (msg as unknown as { metadata?: Record<string, unknown> })?.metadata;
  const sources = (metadata?.sources as Array<import("./chat/citations/InlineCitation").CitationSource>) ?? undefined;
  const toolCalls = (metadata?.tool_calls as Array<import("./chat/tools/ToolCall").ToolCallProps>) ?? undefined;
  const contextItems = (metadata?.context_items as Array<import("./chat/context/MessageContext").ContextItem>) ?? undefined;

  return (
    <MessageRoot role={message.role as "user" | "assistant" | "system"} id={message.id}>
      <MessageAvatar role={message.role as "user" | "assistant" | "system"} />

      <MessageBubble role={message.role as "user" | "assistant" | "system"}>
        {/* Header Metadata */}
        <MessageHeader
          role={message.role as "user" | "assistant" | "system"}
          timestamp={message.created_at}
          modelName={modelName}
          providerName={providerName}
          tokens={msg.total_tokens}
          tokensTooltip={usageTitle}
          cost={costStr}
          costTooltip={costTitle}
          latency={latencyStr}
        />

        {/* Bubble Body */}
        <MessageBodyContainer role={message.role as "user" | "assistant" | "system"}>
          {/* Attachments */}
          <MessageAttachments attachments={msg.attachments} />

          {/* Context Used (if any) */}
          <MessageContext contextItems={contextItems} />

          {/* User Content vs Assistant Composed Body */}
          {isUser ? (
            <MessageContent content={message.content} isStreaming={isStreaming} />
          ) : (
            <>
              {/* Tool calls (if any) */}
              {toolCalls?.map((tool, idx) => (
                <ToolCall key={idx} {...tool} />
              ))}

              {/* Reasoning + Markdown Response */}
              <AssistantContent
                content={message.content}
                isStreaming={isStreaming}
                status={reasoningStatus}
                thinkingMs={msg.thinking_ms}
                reasoningTokens={msg.reasoning_tokens}
              />

              {/* Sources / Citations (if any) */}
              <Sources sources={sources} />
            </>
          )}
        </MessageBodyContainer>

        {/* Terminal generation states (backend-owned) */}
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
        <MessageActions
          role={message.role as "user" | "assistant" | "system"}
          contentToCopy={message.content}
          onRegenerate={onRegenerate}
          onDelete={onDelete}
          id={message.id}
        />
      </MessageBubble>
    </MessageRoot>
  );
}

/**
 * Optimized memoization: unchanged messages do not re-render during streaming.
 */
export const MessageView = memo(MessageViewInner, (prev, next) => (
  prev.message === next.message &&
  prev.isStreaming === next.isStreaming &&
  !!prev.onRegenerate === !!next.onRegenerate &&
  !!prev.onDelete === !!next.onDelete
));
