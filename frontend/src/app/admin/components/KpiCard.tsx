"use client";

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtPct } from "./format";

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  changePct?: number | null;
  changeLabel?: string;
  /** Which direction is healthy (error rate inverts: down is good). */
  goodDirection?: "up" | "down";
  icon?: ReactNode;
  testId?: string;
  className?: string;
}

/** KPI tile: label, prominent value, optional preceding-period change. */
export function KpiCard({
  label,
  value,
  sub,
  changePct,
  changeLabel = "vs prev",
  goodDirection = "up",
  icon,
  testId,
  className,
}: KpiCardProps) {
  const direction =
    changePct === null || changePct === undefined || changePct === 0
      ? "flat"
      : changePct > 0
        ? "up"
        : "down";
  const good =
    direction === "flat" ? "flat" : (direction === "up") === (goodDirection === "up") ? "good" : "bad";
  const TrendIcon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

  return (
    <div
      className={cn(
        "group flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-4 transition-colors",
        "hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700",
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">{label}</span>
        {icon && (
          <span className="text-zinc-300 transition-colors group-hover:text-tollma-500 dark:text-zinc-600">
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-zinc-400">{sub}</p>}
      {changePct !== undefined && (
        <p
          className={cn(
            "mt-2 flex items-center gap-1 text-[11px] font-medium",
            good === "good" && "text-emerald-600 dark:text-emerald-400",
            good === "bad" && "text-red-600 dark:text-red-400",
            good === "flat" && "text-zinc-400",
          )}
          data-testid={testId ? `${testId}-change` : undefined}
        >
          <TrendIcon className="size-3" />
          {changePct === null ? "No prior data" : fmtPct(changePct)}
          <span className="font-normal text-zinc-400">{changeLabel}</span>
        </p>
      )}
    </div>
  );
}
