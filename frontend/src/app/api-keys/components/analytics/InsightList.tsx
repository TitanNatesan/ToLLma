"use client";

import { useMemo } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleCheck,
  Info,
  Lightbulb,
  Minus,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartSkeleton, EmptyHint, SectionFrame, ShareBar, sharePct } from "./shared";
import type { AnalyticsInsight } from "@/types/apiKeys";

interface SeverityStyle {
  icon: typeof Info;
  iconClass: string;
  borderClass: string;
  chipClass: string;
  barClass: string;
}

function severityStyle(severity: string): SeverityStyle {
  const value = severity.toLowerCase();
  if (value.includes("crit") || value.includes("high") || value.includes("error")) {
    return {
      icon: OctagonAlert,
      iconClass: "text-red-500",
      borderClass: "border-l-red-500",
      chipClass: "border-red-200 text-red-600 dark:border-red-900/70 dark:text-red-400",
      barClass: "bg-red-500",
    };
  }
  if (value.includes("warn") || value.includes("med")) {
    return {
      icon: TriangleAlert,
      iconClass: "text-amber-500",
      borderClass: "border-l-amber-500",
      chipClass: "border-amber-200 text-amber-600 dark:border-amber-900/70 dark:text-amber-400",
      barClass: "bg-amber-500",
    };
  }
  if (value.includes("success") || value.includes("good") || value.includes("low")) {
    return {
      icon: CircleCheck,
      iconClass: "text-emerald-500",
      borderClass: "border-l-emerald-500",
      chipClass:
        "border-emerald-200 text-emerald-600 dark:border-emerald-900/70 dark:text-emerald-400",
      barClass: "bg-emerald-500",
    };
  }
  return {
    icon: Lightbulb,
    iconClass: "text-sky-500",
    borderClass: "border-l-sky-500",
    chipClass: "border-sky-200 text-sky-600 dark:border-sky-900/70 dark:text-sky-400",
    barClass: "bg-sky-500",
  };
}

function DeltaChip({ delta, className }: { delta: number | null | undefined; className: string }) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
  const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
        className,
      )}
      data-testid="key-insight-delta"
    >
      <Icon className="size-2.5" />
      {delta > 0 ? "+" : ""}
      {delta.toFixed(1)}%
    </span>
  );
}

/** Severity-ranked insight cards with delta chips and share bars. */
export function InsightList({
  insights,
  loading = false,
  testId = "key-insights",
}: {
  insights: AnalyticsInsight[];
  loading?: boolean;
  testId?: string;
}) {
  const ranked = useMemo(() => rankInsights(insights), [insights]);

  return (
    <SectionFrame
      title="Insights"
      description="Anomalies and optimisation signals from this range."
      testId={testId}
    >
      {loading ? (
        <div className="space-y-2">
          <ChartSkeleton height={54} />
          <ChartSkeleton height={54} />
        </div>
      ) : ranked.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <CircleCheck className="size-5 text-emerald-500/80" />
          <p className="text-xs text-zinc-400">No anomalies detected in this range.</p>
        </div>
      ) : (
        <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1" data-testid={`${testId}-list`}>
          {ranked.map((insight) => {
            const style = severityStyle(insight.severity ?? "info");
            const Icon = style.icon;
            const share = insight.share_pct;
            return (
              <li
                key={insight.id}
                className={cn(
                  "rounded-lg border border-zinc-200 border-l-2 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-950",
                  style.borderClass,
                )}
                data-testid={`${testId}-item`}
              >
                <div className="flex items-start gap-2">
                  <Icon className={cn("mt-0.5 size-3.5 shrink-0", style.iconClass)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                        {insight.title}
                      </p>
                      <DeltaChip delta={insight.delta_pct} className={style.chipClass} />
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {insight.detail}
                    </p>
                    {insight.metric && (
                      <p className="mt-1 font-mono text-[10px] text-zinc-400">{insight.metric}</p>
                    )}
                    {share !== null && share !== undefined && (
                      <div className="mt-2 flex items-center gap-2">
                        <ShareBar
                          fraction={parseFloat(sharePct(share)) / 100}
                          colorClass={style.barClass}
                          className="flex-1"
                        />
                        <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                          {sharePct(share)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionFrame>
  );
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  error: 1,
  warning: 2,
  medium: 2,
  warn: 2,
  info: 3,
  low: 3,
  success: 4,
  good: 4,
};

function rankInsights(insights: AnalyticsInsight[]): AnalyticsInsight[] {
  return [...(insights ?? [])].sort((a, b) => {
    const rankA = SEVERITY_RANK[String(a.severity ?? "info").toLowerCase()] ?? 3;
    const rankB = SEVERITY_RANK[String(b.severity ?? "info").toLowerCase()] ?? 3;
    if (rankA !== rankB) return rankA - rankB;
    return Math.abs(b.delta_pct ?? 0) - Math.abs(a.delta_pct ?? 0);
  });
}
