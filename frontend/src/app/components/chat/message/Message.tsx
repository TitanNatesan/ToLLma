"use client";

import { memo, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Copy, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface MessageRootProps {
  role: "user" | "assistant" | "system";
  children: ReactNode;
  className?: string;
  id?: string;
}

export function MessageRoot({ role, children, className, id }: MessageRootProps) {
  const isUser = role === "user";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("group flex gap-3", isUser && "flex-row-reverse", className)}
      data-testid={`message-${role}`}
      id={id}
    >
      {children}
    </motion.div>
  );
}

export interface MessageAvatarProps {
  role: "user" | "assistant" | "system";
  className?: string;
}

export function MessageAvatar({ role, className }: MessageAvatarProps) {
  if (role === "user") return null;
  return (
    <div
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-xs font-bold text-white shadow-xs",
        className,
      )}
      aria-hidden="true"
    >
      <Sparkles className="size-3.5" />
    </div>
  );
}

export interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  children: ReactNode;
  className?: string;
}

export function MessageBubble({ role, children, className }: MessageBubbleProps) {
  const isUser = role === "user";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1",
        isUser ? "max-w-[70%] items-end max-sm:max-w-[85%]" : "max-w-[75%] max-sm:max-w-[92%]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface MessageHeaderProps {
  role: "user" | "assistant" | "system";
  timestamp?: string;
  modelName?: string | null;
  providerName?: string | null;
  tokens?: number | null;
  tokensTooltip?: string;
  cost?: string | null;
  costTooltip?: string;
  latency?: string | null;
  className?: string;
}

export function MessageHeader({
  role,
  timestamp,
  modelName,
  providerName,
  tokens,
  tokensTooltip,
  cost,
  costTooltip,
  latency,
  className,
}: MessageHeaderProps) {
  const isUser = role === "user";
  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-[10px] text-zinc-400",
        isUser && "flex-row-reverse",
        className,
      )}
    >
      <span className="font-semibold uppercase tracking-wide">
        {isUser ? "You" : "Assistant"}
      </span>
      {formattedTime && (
        <time dateTime={timestamp} title={timestamp}>
          {formattedTime}
        </time>
      )}
      {!isUser && (modelName || providerName) && (
        <span data-testid="message-model" title={`${providerName ?? ""} / ${modelName ?? ""}`}>
          {[modelName, providerName].filter(Boolean).join(" · ")}
        </span>
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

export interface MessageBodyContainerProps {
  role: "user" | "assistant" | "system";
  children: ReactNode;
  className?: string;
}

export function MessageBodyContainer({ role, children, className }: MessageBodyContainerProps) {
  const isUser = role === "user";
  return (
    <div
      className={cn(
        "rounded-2xl px-3 py-2.5 text-sm",
        isUser
          ? "rounded-tr-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
          : "rounded-tl-sm border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface MessageActionsProps {
  role: "user" | "assistant" | "system";
  contentToCopy: string;
  onRegenerate?: () => void;
  onDelete?: () => void;
  id?: string;
  className?: string;
}

export function MessageActions({
  role,
  contentToCopy,
  onRegenerate,
  onDelete,
  id,
  className,
}: MessageActionsProps) {
  const isUser = role === "user";

  function copyText() {
    void navigator.clipboard
      .writeText(contentToCopy)
      .then(() => toast.success("Copied to clipboard!"))
      .catch(() => {});
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        isUser && "flex-row-reverse",
        className,
      )}
    >
      <button
        type="button"
        className="flex items-center gap-1 rounded p-1 text-[10px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        onClick={copyText}
        title="Copy"
        data-testid={id ? `copy-button-${id}` : "copy-button"}
      >
        <Copy className="size-3" />
        <span>Copy</span>
      </button>

      {!isUser && onRegenerate && (
        <button
          type="button"
          className="flex items-center gap-1 rounded p-1 text-[10px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          onClick={onRegenerate}
          title="Regenerate"
          data-testid={id ? `regenerate-button-${id}` : "regenerate-button"}
        >
          <RotateCcw className="size-3" />
          <span>Regenerate</span>
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          className="rounded p-1 text-[10px] text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
          onClick={onDelete}
          title="Delete"
          data-testid={id ? `delete-message-${id}` : "delete-message"}
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}
