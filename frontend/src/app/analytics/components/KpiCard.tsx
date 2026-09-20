"use client";

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  changePct?: number | null;
  changeLabel?: string;
  icon?: ReactNode;
  spark?: ReactNode;
  testId?: string;
  className?: string;
}

/** Analytics KPI tile: label, prominent value, optional period-over-period change. */
export function KpiCard({
  label,
  value,
  sub,
  changePct,
  changeLabel = "vs previous period",
  icon,
  spark,
  testId,
  className,
}: KpiCardProps) {
  const trend = changePct === null || changePct === undefined ? "flat" : changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  return (
    <div
      className={cn(
        "group flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-4 transition-all",
        "hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700",
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">{label}</span>
        {icon && <span className="text-zinc-300 transition-colors group-hover:text-tollma-500 dark:text-zinc-600">{icon}</span>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{value}</p>
          {sub && <p className="mt-0.5 truncate text-[11px] text-zinc-400">{sub}</p>}
        </div>
        {spark && <div className="shrink-0 opacity-80">{spark}</div>}
      </div>
      {changePct !== undefined && (
        <p
          className={cn(
            "mt-2 flex items-center gap-1 text-[11px] font-medium",
            trend === "up" && "text-emerald-600 dark:text-emerald-400",
            trend === "down" && "text-red-600 dark:text-red-400",
            trend === "flat" && "text-zinc-400",
          )}
          data-testid={testId ? `${testId}-change` : undefined}
        >
          <TrendIcon className="size-3" />
          {changePct === null ? "No prior data" : `${Math.abs(changePct).toFixed(1)}%`}
          <span className="font-normal text-zinc-400">{changeLabel}</span>
        </p>
      )}
    </div>
  );
}

interface SectionCardProps {
  id?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}

/** Consistent analytics section shell (anchor target + header + body). */
export function SectionCard({ id, title, description, action, children, className, testId }: SectionCardProps) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
      data-testid={testId}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-zinc-400">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}
