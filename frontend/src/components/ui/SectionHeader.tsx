"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Canonical section header: title + optional description, badge and action.
 * `title` tone matches card headers (analytics / settings / docs);
 * `label` tone matches the small uppercase admin card headers.
 */
export function SectionHeader({
  title,
  description,
  badge,
  action,
  tone = "title",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  tone?: "title" | "label";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2
            className={
              tone === "label"
                ? "text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                : "text-sm font-semibold text-zinc-900 dark:text-zinc-100"
            }
          >
            {title}
          </h2>
          {badge}
        </div>
        {description && (
          <p className={tone === "label" ? "mt-1 text-xs text-zinc-400" : "mt-0.5 text-xs text-zinc-400"}>
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
