"use client";

import { memo, useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToolStatus = "running" | "completed" | "failed";

export interface ToolCallProps {
  name: string;
  args?: Record<string, unknown> | string;
  result?: unknown;
  status: ToolStatus;
  durationMs?: number;
  error?: string;
  className?: string;
}

/**
 * AI SDK Elements Tool Component.
 *
 * Renders tool calls and executions with running, completed, and failed states,
 * input arguments preview, and collapsible JSON or formatted result display.
 */
function ToolCallInner({
  name,
  args,
  result,
  status,
  durationMs,
  error,
  className,
}: ToolCallProps) {
  const [open, setOpen] = useState(false);

  const formattedArgs = typeof args === "string" ? args : args ? JSON.stringify(args, null, 2) : null;
  const formattedResult = result ? (typeof result === "string" ? result : JSON.stringify(result, null, 2)) : null;

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-xl border text-xs transition-colors",
        status === "running"
          ? "border-sky-200 bg-sky-50/50 dark:border-sky-900/40 dark:bg-sky-950/20"
          : status === "failed"
            ? "border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-950/20"
            : "border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/60",
        className,
      )}
      data-testid="tool-call-block"
      data-tool-status={status}
    >
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          {status === "running" ? (
            <Loader2 className="size-3.5 animate-spin text-sky-600 dark:text-sky-400" />
          ) : status === "failed" ? (
            <AlertCircle className="size-3.5 text-red-500" />
          ) : (
            <CheckCircle2 className="size-3.5 text-tollma-600 dark:text-tollma-400" />
          )}

          <div className="flex items-center gap-1.5">
            <Wrench className="size-3 text-zinc-400" />
            <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">{name}</span>
          </div>

          <span
            className={cn(
              "rounded-full px-2 py-0.2 text-[10px] font-medium capitalize",
              status === "running"
                ? "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300"
                : status === "failed"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300"
                  : "bg-zinc-200/70 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
            )}
          >
            {status}
          </span>

          {durationMs != null && (
            <span className="font-mono text-[10px] text-zinc-400">
              {durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-[11px] text-zinc-400">
          <span>{open ? "Hide" : "Details"}</span>
          {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </div>
      </button>

      {/* Expandable Details (Args & Output) */}
      {open && (
        <div className="border-t border-zinc-200/70 p-3 space-y-2 dark:border-zinc-800">
          {formattedArgs && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Arguments
              </span>
              <pre className="mt-1 overflow-x-auto rounded bg-zinc-100 p-2 font-mono text-[11px] text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                {formattedArgs}
              </pre>
            </div>
          )}

          {error ? (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
                Error
              </span>
              <div className="mt-1 rounded bg-red-100/60 p-2 text-[11px] text-red-800 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            </div>
          ) : formattedResult ? (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Result
              </span>
              <pre className="mt-1 max-h-48 overflow-x-auto rounded bg-zinc-100 p-2 font-mono text-[11px] text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                {formattedResult}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export const ToolCall = memo(ToolCallInner);
