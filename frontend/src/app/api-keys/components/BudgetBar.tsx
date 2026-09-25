"use client";

import { Infinity as InfinityIcon, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { asNumber } from "./StatusPill";
import type { Numeric } from "@/types/apiKeys";

/** Percent with enough precision for micro-spend: 2.41e-5 / $1 -> "0.0024". */
export function fmtPercentUsed(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0";
  if (pct < 0.0001) return "<0.0001";
  if (pct >= 1000) return Math.round(pct).toLocaleString("en-US");
  if (pct >= 100) return pct.toFixed(0);
  if (pct >= 10) return pct.toFixed(1);
  if (pct >= 1) return pct.toFixed(2);
  if (pct >= 0.01) return pct.toFixed(3);
  return pct.toFixed(4);
}

/** Currency that keeps sub-cent precision up to 6 decimals: "$0.999976". */
export function fmtBudgetAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs === 0) return "$0";
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits })}`;
}

type Tone = "ok" | "warning" | "danger";

function toneFor(pct: number): Tone {
  if (pct >= 100) return "danger";
  if (pct >= 80) return "warning";
  return "ok";
}

const BAR_TONE: Record<Tone, string> = {
  ok: "bg-tollma-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

const TEXT_TONE: Record<Tone, string> = {
  ok: "text-zinc-600 dark:text-zinc-300",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "font-medium text-red-600 dark:text-red-400",
};

interface BudgetBarProps {
  /** Spend in the current reset window (Decimal string or number). */
  cost: Numeric | null | undefined;
  /** `policy.max_budget_usd`; `null` means unlimited. */
  maxBudget: Numeric | null | undefined;
  /** Analytics still loading and no cost value is known yet. */
  loading?: boolean;
  /** Label of the comparison window rendered in the title. */
  windowLabel?: string;
  size?: "sm" | "md";
  className?: string;
  testId?: string;
}

/**
 * Budget usage meter: progress bar plus "X% used" and "$Y remaining".
 * Handles unlimited budgets, a zero budget ("Blocked"), and overspend (red).
 */
export function BudgetBar({
  cost,
  maxBudget,
  loading = false,
  windowLabel = "30d",
  size = "sm",
  className,
  testId = "budget-bar",
}: BudgetBarProps) {
  const budget = asNumber(maxBudget);
  const spent = asNumber(cost);

  if (budget === null) {
    return (
      <div className={cn("flex items-center gap-1.5 text-[11px] text-zinc-400", className)} data-testid={testId}>
        <InfinityIcon className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
        <span className="font-medium text-zinc-500 dark:text-zinc-400">Unlimited</span>
        <span className="hidden text-[10px] text-zinc-400 sm:inline">· no cap</span>
      </div>
    );
  }

  if (budget <= 0) {
    return (
      <div className={cn("flex items-center gap-1.5", className)} data-testid={testId}>
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
          <MinusCircle className="size-3" aria-hidden="true" />
          Blocked
        </span>
        <span className="text-[10px] text-zinc-400">$0 budget rejects requests</span>
      </div>
    );
  }

  if (loading && spent === null) {
    return (
      <div className={cn("w-32 space-y-1.5", className)} data-testid={testId} aria-busy="true">
        <div className="h-2.5 w-24 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-1.5 w-full animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
      </div>
    );
  }

  if (spent === null) {
    return (
      <div className={cn("space-y-0.5", className)} data-testid={testId}>
        <span className="text-[10px] text-zinc-400">Spend unavailable</span>
        <span className="block text-[10px] text-zinc-400">{fmtBudgetAmount(budget)} budget</span>
      </div>
    );
  }

  const pct = (spent / budget) * 100;
  const remaining = Math.max(0, budget - spent);
  const tone = toneFor(pct);
  const width = pct > 0 ? Math.max(2, Math.min(100, pct)) : 0;

  return (
    <div
      className={cn("w-32 space-y-1", size === "md" && "w-44", className)}
      data-testid={testId}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(pct))}
      aria-valuetext={`${fmtPercentUsed(pct)}% used, ${fmtBudgetAmount(remaining)} remaining`}
      title={`${fmtBudgetAmount(spent)} of ${fmtBudgetAmount(budget)} spent (${windowLabel})`}
    >
      <div className="flex items-baseline justify-between gap-2 text-[10px] tabular-nums">
        <span className={cn("font-mono", TEXT_TONE[tone])}>{fmtPercentUsed(pct)}% used</span>
        <span className="font-mono text-zinc-400">{fmtBudgetAmount(remaining)} remaining</span>
      </div>
      <div className={cn("overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800", size === "md" ? "h-2" : "h-1.5")}>
        <div
          className={cn("h-full rounded-full transition-all", BAR_TONE[tone])}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}
