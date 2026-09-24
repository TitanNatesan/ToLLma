"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}

/** Admin section shell: small uppercase label, optional actions, card body. */
export function SectionCard({ title, description, action, children, className, testId }: SectionCardProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
      data-testid={testId}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {title}
          </h2>
          {description && <p className="mt-1 text-xs text-zinc-400">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}
