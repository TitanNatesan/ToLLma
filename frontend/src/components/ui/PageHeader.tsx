"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  badges,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </h1>
          {badges}
        </div>
        {subtitle && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
