"use client";

import { Activity, ArrowDown, ArrowUp, Cpu } from "lucide-react";
import { Card, CardContent } from "./primitives";
import { cn } from "@/lib/utils";

export interface UsageCardProps {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  reasoningTokens?: number | null;
  cacheReadTokens?: number | null;
  latencyMs?: number | null;
  compact?: boolean;
  className?: string;
}

export function UsageCard({
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = 0,
  reasoningTokens,
  cacheReadTokens,
  latencyMs,
  compact = false,
  className,
}: UsageCardProps) {
  const tot = totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0);

  if (compact) {
    return (
      <div className={cn("flex items-center gap-3 text-xs text-zinc-500", className)}>
        <span className="flex items-center gap-1">
          <Activity className="size-3 text-zinc-400" />
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {tot.toLocaleString()}
          </span>{" "}
          tokens
        </span>
        {latencyMs != null && (
          <span>
            {latencyMs < 1000 ? `${Math.round(latencyMs)}ms` : `${(latencyMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>
    );
  }

  return (
    <Card className={cn("overflow-hidden border-zinc-200 dark:border-zinc-800", className)}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Cpu className="size-3" />
            Token Telemetry
          </span>
          {latencyMs != null && (
            <span className="text-[10px] text-zinc-400 font-mono">
              {latencyMs < 1000 ? `${Math.round(latencyMs)}ms` : `${(latencyMs / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded bg-zinc-50 p-1.5 dark:bg-zinc-900/50">
            <div className="flex items-center justify-center gap-0.5 text-[10px] text-zinc-400">
              <ArrowDown className="size-2.5" /> Prompt
            </div>
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              {(promptTokens ?? 0).toLocaleString()}
            </p>
          </div>

          <div className="rounded bg-zinc-50 p-1.5 dark:bg-zinc-900/50">
            <div className="flex items-center justify-center gap-0.5 text-[10px] text-zinc-400">
              <ArrowUp className="size-2.5" /> Completion
            </div>
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              {(completionTokens ?? 0).toLocaleString()}
            </p>
          </div>

          <div className="rounded bg-zinc-100 p-1.5 dark:bg-zinc-800/60">
            <div className="text-[10px] text-zinc-500 dark:text-zinc-400">Total</div>
            <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
              {tot.toLocaleString()}
            </p>
          </div>
        </div>

        {(reasoningTokens || cacheReadTokens) && (
          <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2 text-[10px] text-zinc-500 dark:border-zinc-800/60">
            {reasoningTokens ? (
              <span>Reasoning: {reasoningTokens.toLocaleString()} tok</span>
            ) : null}
            {cacheReadTokens ? (
              <span>Cache Read: {cacheReadTokens.toLocaleString()} tok</span>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
