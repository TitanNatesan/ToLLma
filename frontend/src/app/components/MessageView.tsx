"use client";

import { memo, useMemo, useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  History,
  OctagonX,
  Pencil,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { MermaidBlock } from "./MermaidBlock";
import { ReasoningPanel } from "./chat/reasoning/ReasoningPanel";
import { Sources } from "./chat/sources/Sources";
import { ToolCall } from "./chat/tools/ToolCall";
import { MessageContext } from "./chat/context/MessageContext";
import { MessageAttachments } from "./chat/attachments/MessageAttachments";
import { MediaGenerationSkeleton } from "./media/MediaGenerationSkeleton";
import { MessageHistoryDialog } from "./chat/message/MessageHistoryDialog";
import type { CitationSource } from "./chat/citations/InlineCitation";
import type { ToolCallProps } from "./chat/tools/ToolCall";
import type { ContextItem } from "./chat/context/MessageContext";
import { splitThinkBlocks } from "./thinkBlocks";
import type { ReasoningStatus } from "./reasoning";
import type { ChatMessage } from "@/types";
import type { OptimisticMessage } from "@/store/chat";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { useAllChatKeyModels, useChatKeys } from "@/hooks/useChatKeys";
import { Button, Textarea } from "@/components/ui/primitives";
import { fmtCost, stripTrailingZeros } from "@/lib/utils";
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
  void (async () => {
    try {
      const ok = await copyTextToClipboard(text);
      if (!ok) throw new Error("copy unavailable");
      toast.success("Copied!");
    } catch {
      toast.error("Could not copy to clipboard", {
        description: "Select the text manually to copy it.",
      });
    }
  })();
}

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const code = typeof children === "string" ? children : "";
  return (
    <div className="relative my-2 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-3 py-1.5">
        <span className="font-mono text-[10px] text-zinc-500">
          {className?.replace("language-", "") ?? "code"}
        </span>
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

/** User content is plain text or user markdown. */
function UserMarkdown({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className={isStreaming ? "streaming-cursor break-words" : "break-words"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => {
            const codeStr = extractText(children);
            const isMermaid =
              className === "language-mermaid" ||
              className?.includes("mermaid") ||
              (className?.startsWith("language-") &&
                /^\s*(graph\s+(TD|TB|BT|RL|LR)|flowchart\s+(TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap)\b/m.test(
                  codeStr,
                ));
            if (isMermaid) {
              return <MermaidBlock chart={codeStr} />;
            }
            const isBlock = className?.startsWith("language-");
            return isBlock ? (
              <CodeBlock className={className}>{children}</CodeBlock>
            ) : (
              <code
                className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800"
                {...props}
              >
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
  sources,
}: {
  content: string;
  isStreaming?: boolean;
  status: ReasoningStatus;
  thinkingMs?: number | null;
  reasoningTokens?: number | null;
  sources?: CitationSource[];
}) {
  return (
    <>
      {splitThinkBlocks(content).map((part, index) =>
        part.type === "think" ? (
          <ReasoningPanel
            content={part.content}
            durationMs={thinkingMs}
            key={index}
            status={status}
            tokens={reasoningTokens}
          />
        ) : (
          part.content.trim() && (
            <MessageResponse isStreaming={isStreaming} key={index} sources={sources}>
              {part.content}
            </MessageResponse>
          )
        ),
      )}
    </>
  );
}

export interface ChatMessageProps {
  message: MessageLike;
  isStreaming?: boolean;
  /** Real sources for this reply (derived from the turn's attachments). */
  sources?: CitationSource[];
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onBranch?: (messageId: string) => void;
  onActivateGeneration?: (messageId: string, runId: string) => void;
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

/** Total image count from "(i of N)" progress deltas; undefined when unknown. */
function mediaProgressTotal(content: string): number | undefined {
  const matches = [...content.matchAll(/\((\d+)\s+of\s+(\d+)\)/g)];
  if (matches.length === 0) return undefined;
  const total = Number(matches[matches.length - 1]?.[2]);
  return Number.isFinite(total) && total > 1 ? total : undefined;
}

/** Human generation state from the streamed progress log. */
function mediaProgressLabel(kind: "image" | "video", content: string): string {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const last = (lines[lines.length - 1] ?? "").toLowerCase();
  if (last.startsWith("uploading")) return `Uploading ${kind}…`;
  if (last.startsWith("generated")) return "Finalizing…";
  if (last.startsWith("generating")) {
    const progress = /\((\d+)\s+of\s+(\d+)\)/.exec(last);
    if (progress) return `Generating ${kind} ${progress[1]} of ${progress[2]}…`;
    return `Generating ${kind}…`;
  }
  return lines[lines.length - 1] ?? `Generating ${kind}…`;
}

function MessageHeaderMeta({
  role,
  timestamp,
  modelName,
  providerName,
  modelLoading,
  tokens,
  tokensTooltip,
  cost,
  costTooltip,
  latency,
}: {
  role: string;
  timestamp?: string;
  modelName?: string | null;
  providerName?: string | null;
  /** Streaming and the names aren't resolved yet: shimmer, never blank. */
  modelLoading?: boolean;
  tokens?: number | null;
  tokensTooltip?: string;
  cost?: string | null;
  costTooltip?: string;
  latency?: string | null;
}) {
  const isUser = role === "user";
  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div
      className={`flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 ${isUser ? "flex-row-reverse" : ""}`}
    >
      {formattedTime && (
        <time dateTime={timestamp} title={timestamp}>
          {formattedTime}
        </time>
      )}
      {!isUser && modelLoading && !modelName && !providerName ? (
        <span
          data-testid="message-model-loading"
          role="status"
          aria-label="Loading model info"
          className="inline-block h-3 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
        />
      ) : (
        !isUser &&
        (modelName || providerName) && (
          <span data-testid="message-model" title={`${providerName ?? ""} / ${modelName ?? ""}`}>
            {[modelName, providerName].filter(Boolean).join(" · ")}
          </span>
        )
      )}
      {!isUser && tokens != null && (
        <span data-testid="message-usage" title={tokensTooltip}>
          {tokens.toLocaleString()} tok
        </span>
      )}
      {!isUser && cost && (
        <span data-testid="message-cost" title={costTooltip}>
          {cost}
        </span>
      )}
      {!isUser && latency && <span>{latency}</span>}
    </div>
  );
}

function MessageViewInner({
  message,
  isStreaming,
  sources: messageSources,
  onRegenerate,
  onEdit,
  onBranch,
  onActivateGeneration,
}: ChatMessageProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [historyOpen, setHistoryOpen] = useState(false);
  const role = message.role as "user" | "assistant" | "system";
  const isUser = role === "user";
  const msg = message as ChatMessage;
  const costEstimated = msg.usage_estimated === true;
  const costAmount = formatCost(msg.total_cost ?? null);
  const costStr = costAmount ? `${costAmount}${costEstimated ? " est." : ""}` : null;
  const inCostStr = formatCost(msg.input_cost ?? null);
  const outCostStr = formatCost(msg.output_cost ?? null);
  const latencyStr = formatLatency(msg.latency_ms ?? null);
  const { data: models } = useModels(undefined, undefined, { enabled: !isUser });
  const { data: providers } = useProviders();
  const { data: chatKeys } = useChatKeys();
  const { entries: keyEntries } = useAllChatKeyModels(chatKeys);
  const modelById = useMemo(() => {
    const byId = new Map((models ?? []).map((m) => [m.id, m]));
    for (const entry of keyEntries) {
      for (const km of entry.models ?? []) {
        if (!byId.has(km.id)) byId.set(km.id, km);
      }
    }
    return byId;
  }, [models, keyEntries]);
  const modelName = !isUser && msg.model_id ? (modelById.get(msg.model_id)?.name ?? null) : null;
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

  const reasoningStatus: ReasoningStatus = isStreaming
    ? message.content.includes("<think>") && !message.content.includes("</think>")
      ? "streaming"
      : "thinking"
    : msg.status === "cancelled"
      ? "interrupted"
      : msg.status === "failed"
        ? "failed"
        : "complete";

  // Media generations stream progress text; render a skeleton instead of the
  // raw log. The label tracks the live generation state. Multi-image runs
  // stream "(i of N)" progress: one skeleton + badge, never N loaders.
  const mediaKind = /^Generating (image|video)/.exec(message.content)?.[1] as "image" | "video" | undefined;
  const progressLabel = mediaKind ? mediaProgressLabel(mediaKind, message.content) : undefined;
  const mediaTotal = mediaKind === "image" ? mediaProgressTotal(message.content) : undefined;

  const generations = msg.generations ?? [];
  const activeGenerationIndex = Math.max(
    0,
    generations.findIndex((run) => run.id === msg.active_generation_id),
  );
  // History exists only when the message has edit versions (user) or more
  // than one generation (assistant).
  const hasHistory = isUser ? (msg.versions_count ?? 0) > 1 : generations.length > 1;

  const metadata = msg.metadata;
  const sources = (metadata?.sources as CitationSource[] | undefined) ?? messageSources;
  const toolCalls = (metadata?.tool_calls as ToolCallProps[] | undefined) ?? undefined;
  const contextItems = (metadata?.context_items as ContextItem[] | undefined) ?? undefined;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={`group flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
      data-testid={`message-${role}`}
      exit={{ opacity: 0, y: -4 }}
      id={message.id}
      initial={{ opacity: 0, y: 8 }}
      layout
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {!isUser && (
        <div
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-xs font-bold text-white shadow-xs"
        >
          <Sparkles className="size-3.5" />
        </div>
      )}

      <Message className="min-w-0 flex-1" from={role}>
        <MessageHeaderMeta
          cost={costStr}
          costTooltip={costTitle}
          latency={latencyStr}
          modelName={modelName}
          modelLoading={isStreaming}
          providerName={providerName}
          role={role}
          timestamp={message.created_at}
          tokens={msg.total_tokens}
          tokensTooltip={usageTitle}
        />

        <MessageContent
          className={
            isUser
              ? "ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-zinc-100 px-3 py-2.5 dark:bg-zinc-800"
              : "w-full"
          }
        >
          <MessageAttachments
            attachments={msg.attachments}
            cost={msg.total_cost ?? null}
            costEstimated={costEstimated}
            metadata={msg.metadata}
          />
          <MessageContext contextItems={contextItems} />

          {isUser ? (
            editing ? (
              <div className="w-full space-y-2">
                <Textarea
                  className="min-h-20 w-full text-sm"
                  data-testid={`edit-input-${message.id}`}
                  onChange={(event) => setDraft(event.target.value)}
                  value={draft}
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    data-testid={`edit-cancel-${message.id}`}
                    onClick={() => {
                      setEditing(false);
                      setDraft(message.content);
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <X className="size-3.5" /> Cancel
                  </Button>
                  <Button
                    data-testid={`edit-save-${message.id}`}
                    disabled={!draft.trim() || draft.trim() === message.content.trim()}
                    onClick={() => {
                      onEdit?.(message.id, draft.trim());
                      setEditing(false);
                    }}
                    size="sm"
                    type="button"
                  >
                    <Check className="size-3.5" /> Save &amp; regenerate
                  </Button>
                </div>
              </div>
            ) : (
              <UserMarkdown content={message.content} isStreaming={isStreaming} />
            )
          ) : (
            <>
              {generations.length > 1 && (
                <div
                  className="mb-1 inline-flex w-fit items-center gap-0.5 rounded-full border border-zinc-200 bg-zinc-50 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800"
                  data-testid={`generation-nav-${message.id}`}
                >
                  <button
                    aria-label="Previous generation"
                    className="rounded-full p-0.5 text-zinc-500 hover:bg-zinc-200 disabled:opacity-40 dark:hover:bg-zinc-700"
                    data-testid="generation-prev"
                    disabled={activeGenerationIndex <= 0}
                    onClick={() => {
                      const target = generations[activeGenerationIndex - 1];
                      if (target) onActivateGeneration?.(message.id, target.id);
                    }}
                    type="button"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <span className="px-1 font-mono text-[10px] text-zinc-500 dark:text-zinc-400" data-testid="generation-page">
                    Response {activeGenerationIndex + 1} of {generations.length}
                  </span>
                  <button
                    aria-label="Next generation"
                    className="rounded-full p-0.5 text-zinc-500 hover:bg-zinc-200 disabled:opacity-40 dark:hover:bg-zinc-700"
                    data-testid="generation-next"
                    disabled={activeGenerationIndex >= generations.length - 1}
                    onClick={() => {
                      const target = generations[activeGenerationIndex + 1];
                      if (target) onActivateGeneration?.(message.id, target.id);
                    }}
                    type="button"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              )}

              {toolCalls?.map((tool, index) => <ToolCall key={index} {...tool} />)}

              {mediaKind ? (
                isStreaming ? (
                  <MediaGenerationSkeleton kind={mediaKind} label={progressLabel} total={mediaTotal} />
                ) : (msg.attachments?.length ?? 0) > 0 ? null : message.content?.trim() ? (
                  <AssistantContent
                    content={message.content}
                    isStreaming={isStreaming}
                    reasoningTokens={msg.reasoning_tokens}
                    sources={sources}
                    status={reasoningStatus}
                    thinkingMs={msg.thinking_ms}
                  />
                ) : (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                    data-testid={`media-unavailable-${message.id}`}
                    role="status"
                  >
                    <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span className="truncate">Media unavailable</span>
                    </span>
                    {onRegenerate && (
                      <button
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                        data-testid={`media-retry-${message.id}`}
                        onClick={() => onRegenerate(message.id)}
                        type="button"
                      >
                        <RotateCcw className="size-3" />
                        Retry
                      </button>
                    )}
                  </div>
                )
              ) : message.content?.trim() ? (
                <AssistantContent
                  content={message.content}
                  isStreaming={isStreaming}
                  reasoningTokens={msg.reasoning_tokens}
                  sources={sources}
                  status={reasoningStatus}
                  thinkingMs={msg.thinking_ms}
                />
              ) : isStreaming ? (
                <div
                  data-testid="typing-indicator"
                  role="status"
                  aria-label="Responding"
                  className="flex items-center gap-1 py-1 text-zinc-400 dark:text-zinc-500"
                >
                  <span className="size-1.5 animate-pulse rounded-full bg-current" />
                  <span
                    className="size-1.5 animate-pulse rounded-full bg-current"
                    style={{ animationDelay: "200ms" }}
                  />
                  <span
                    className="size-1.5 animate-pulse rounded-full bg-current"
                    style={{ animationDelay: "400ms" }}
                  />
                </div>
              ) : null}

              <Sources sources={sources} />
            </>
          )}
        </MessageContent>

        {!isUser && msg.status === "cancelled" && (
          <div
            className="flex items-center gap-1 text-[10px] text-zinc-400"
            data-testid={`stopped-${message.id}`}
          >
            <OctagonX className="size-3" />
            <span>Stopped — partial response kept</span>
          </div>
        )}
        {!isUser && msg.status === "failed" && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
            data-testid={`failed-${message.id}`}
            role="alert"
          >
            <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
              <AlertCircle className="size-3.5 shrink-0" />
              <span className="truncate">
                Generation failed{msg.error ? `: ${msg.error}` : ""}
              </span>
            </span>
            {msg.error && (
              <details className="w-full text-[11px]" data-testid={`failed-details-${message.id}`}>
                <summary className="cursor-pointer select-none text-red-600 underline-offset-2 hover:underline dark:text-red-400">
                  Show full error
                </summary>
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-red-100/60 p-2 font-mono text-[10px] break-all whitespace-pre-wrap dark:bg-red-950/40">
                  {msg.error}
                </pre>
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-0.5 text-[11px] font-medium hover:bg-red-100 dark:border-red-900/60 dark:hover:bg-red-950/40"
                  data-testid={`failed-copy-${message.id}`}
                  onClick={() => copyText(message.content ? `${msg.error}` : (msg.error ?? ""))}
                >
                  <Copy className="size-3" />
                  Copy error
                </button>
              </details>
            )}
            {onRegenerate && (
              <button
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-red-700"
                data-testid={`retry-${message.id}`}
                onClick={() => onRegenerate(message.id)}
                type="button"
              >
                <RotateCcw className="size-3" />
                Retry
              </button>
            )}
          </div>
        )}

        <MessageHistoryDialog messageId={message.id} onOpenChange={setHistoryOpen} open={historyOpen} />

        <MessageActions
          className={`opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 ${
            isUser ? "flex-row-reverse" : ""
          }`}
        >
          <MessageAction
            data-testid={message.id ? `copy-button-${message.id}` : "copy-button"}
            label="Copy"
            onClick={() => copyText(message.content)}
            tooltip="Copy"
          >
            <Copy className="size-3" />
          </MessageAction>

          {isUser && onEdit && !editing && (
            <MessageAction
              data-testid={`edit-button-${message.id}`}
              label="Edit"
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
              tooltip="Edit & regenerate"
            >
              <Pencil className="size-3" />
            </MessageAction>
          )}

          {!isUser && onRegenerate && (
            <MessageAction
              data-testid={message.id ? `regenerate-button-${message.id}` : "regenerate-button"}
              label="Regenerate"
              onClick={() => onRegenerate(message.id)}
              tooltip="Regenerate"
            >
              <RotateCcw className="size-3" />
            </MessageAction>
          )}

          {onBranch && (
            <MessageAction
              data-testid={`branch-button-${message.id}`}
              label="Branch"
              onClick={() => onBranch(message.id)}
              tooltip="Branch from here"
            >
              <GitBranch className="size-3" />
            </MessageAction>
          )}

          {hasHistory && (
            <MessageAction
              data-testid={`history-button-${message.id}`}
              label="History"
              onClick={() => setHistoryOpen(true)}
              tooltip="View version history"
            >
              <History className="size-3" />
            </MessageAction>
          )}
        </MessageActions>
      </Message>
    </motion.div>
  );
}

/**
 * Optimized memoization: unchanged messages do not re-render during streaming.
 */
export const MessageView = memo(MessageViewInner, (prev, next) => (
  prev.message === next.message &&
  prev.isStreaming === next.isStreaming &&
  prev.sources === next.sources &&
  !!prev.onRegenerate === !!next.onRegenerate &&
  !!prev.onEdit === !!next.onEdit &&
  !!prev.onBranch === !!next.onBranch &&
  !!prev.onActivateGeneration === !!next.onActivateGeneration
));
