"use client";

import { useMemo } from "react";
import { Flame } from "lucide-react";
import { asNumber } from "../StatusPill";
import { ChartSkeleton, EmptyHint, SectionFrame, num, parseBucket } from "./shared";
import type { ApiKeyTimeseries, Numeric } from "@/types/apiKeys";

function fmtDay(iso: string): string {
  const date = parseBucket(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Budget Burn Rate: daily spend pace from the existing cost timeline plus a
 * projected depletion date against the key's budget cap. Read-only.
 */
export function BudgetBurnRate({
  maxBudget,
  timeseries,
  loading = false,
}: {
  maxBudget: Numeric | null | undefined;
  timeseries?: ApiKeyTimeseries;
  loading?: boolean;
}) {
  const burn = useMemo(() => {
    const budget = asNumber(maxBudget);
    if (budget === null) return { state: "unlimited" as const };
    const points = (timeseries?.dual ?? [])
      .map((point) => ({ at: parseBucket(point.bucket).getTime(), cost: num(point.cost) }))
      .filter((point) => Number.isFinite(point.at));
    const spent = points.reduce((sum, point) => sum + point.cost, 0);
    if (points.length === 0 || spent <= 0) {
      return { state: "idle" as const, budget, spent };
    }
    const first = Math.min(...points.map((point) => point.at));
    const last = Math.max(...points.map((point) => point.at));
    const elapsedDays = Math.max(1, Math.round((last - first) / 86_400_000) + 1);
    const pace = spent / elapsedDays;
    const remaining = budget - spent;
    if (budget <= 0) return { state: "blocked" as const, budget, spent, pace, elapsedDays };
    if (pace <= 0 || remaining <= 0) {
      return { state: "exhausted" as const, budget, spent, pace, elapsedDays, remaining };
    }
    const daysLeft = remaining / pace;
    return { state: "paced" as const, budget, spent, pace, elapsedDays, remaining, daysLeft };
  }, [maxBudget, timeseries?.dual]);

  return (
    <SectionFrame
      title="Budget burn rate"
      description="Daily pace and projected depletion from range spend."
      testId="key-budget-burn"
    >
      {loading ? (
        <ChartSkeleton height={120} />
      ) : burn.state === "unlimited" ? (
        <EmptyHint label="No budget cap — nothing to burn down" />
      ) : burn.state === "idle" ? (
        <EmptyHint label="No spend in this range — budget untouched" />
      ) : burn.state === "blocked" ? (
        <p className="py-6 text-center text-xs font-medium text-red-600 dark:text-red-400">
          $0 budget — every request is rejected.
        </p>
      ) : burn.state === "exhausted" ? (
        <p className="py-6 text-center text-xs font-medium text-red-600 dark:text-red-400">
          Budget exhausted in this range — the key is blocked until reset.
        </p>
      ) : (
        <div className="space-y-3" data-testid="key-budget-burn-body">
          <div className="flex items-center gap-2">
            <Flame className="size-4 shrink-0 text-amber-500" />
            <p className="font-mono text-lg font-semibold text-zinc-900 tabular-nums dark:text-zinc-50">
              ${burn.pace.toLocaleString("en-US", { maximumFractionDigits: 4 })}
              <span className="ml-1 text-xs font-normal text-zinc-400">/ day</span>
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-zinc-100 p-2 dark:border-zinc-900">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                Spent · {burn.elapsedDays}d
              </dt>
              <dd className="mt-0.5 font-mono text-zinc-700 dark:text-zinc-200">
                ${burn.spent.toLocaleString("en-US", { maximumFractionDigits: 4 })}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-100 p-2 dark:border-zinc-900">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                Remaining
              </dt>
              <dd className="mt-0.5 font-mono text-zinc-700 dark:text-zinc-200">
                ${burn.remaining.toLocaleString("en-US", { maximumFractionDigits: 4 })}
              </dd>
            </div>
          </dl>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Budget exhausted in{" "}
            <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">
              {Math.ceil(burn.daysLeft)} day{Math.ceil(burn.daysLeft) === 1 ? "" : "s"}
            </span>{" "}
            at this pace.
          </p>
          <p className="text-[10px] text-zinc-400">Range spend through {fmtDayRange(timeseries)}.</p>
        </div>
      )}
    </SectionFrame>
  );
}

function fmtDayRange(timeseries?: ApiKeyTimeseries): string {
  const buckets = (timeseries?.dual ?? []).map((point) => point.bucket).filter(Boolean);
  if (buckets.length === 0) return "—";
  return `${fmtDay(buckets[0])} → ${fmtDay(buckets[buckets.length - 1])}`;
}
