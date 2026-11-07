"use client";

import { DollarSign, TrendingUp } from "lucide-react";
import { Card, CardContent } from "./primitives";
import { cn, fmtCost } from "@/lib/utils";

export interface CostCardProps {
  totalCost?: string | null;
  inputCost?: string | null;
  outputCost?: string | null;
  cacheReadCost?: string | null;
  cacheWriteCost?: string | null;
  reasoningCost?: string | null;
  compact?: boolean;
  className?: string;
}

function fmt(val?: string | null): string {
  return fmtCost(val);
}

export function CostCard({
  totalCost,
  inputCost,
  outputCost,
  cacheReadCost,
  cacheWriteCost,
  reasoningCost,
  compact = false,
  className,
}: CostCardProps) {
  const tot = fmt(totalCost);

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-zinc-500", className)}>
        <DollarSign className="size-3 text-tollma-500" />
        <span className="font-semibold text-tollma-600 dark:text-tollma-400">{tot}</span>
      </div>
    );
  }

  return (
    <Card className={cn("overflow-hidden border-zinc-200 dark:border-zinc-800", className)}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <TrendingUp className="size-3 text-tollma-500" />
            Cost Analysis
          </span>
          <span className="text-xs font-bold text-tollma-600 dark:text-tollma-400 font-mono">
            {tot}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center text-xs">
          <div className="rounded-[var(--radius-sm,10px)] bg-zinc-50 p-1.5 dark:bg-zinc-900">
            <div className="text-[10px] text-zinc-400">Input</div>
            <div className="font-medium text-zinc-700 dark:text-zinc-300 font-mono">
              {fmt(inputCost)}
            </div>
          </div>

          <div className="rounded-[var(--radius-sm,10px)] bg-zinc-50 p-1.5 dark:bg-zinc-900">
            <div className="text-[10px] text-zinc-400">Output</div>
            <div className="font-medium text-zinc-700 dark:text-zinc-300 font-mono">
              {fmt(outputCost)}
            </div>
          </div>
        </div>

        {(cacheReadCost || cacheWriteCost || reasoningCost) && (
          <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2 text-[10px] text-zinc-400 dark:border-zinc-800/60 font-mono">
            {cacheReadCost ? <span>Cache: {fmt(cacheReadCost)}</span> : null}
            {reasoningCost ? <span>Reasoning: {fmt(reasoningCost)}</span> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
