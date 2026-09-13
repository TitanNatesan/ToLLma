"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionHeader({
  title,
  badge,
  action,
  className,
}: {
  title: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2 py-1", className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 tracking-tight">
          {title}
        </h3>
        {badge}
      </div>
      {action && <div className="flex items-center gap-1.5">{action}</div>}
    </div>
  );
}
