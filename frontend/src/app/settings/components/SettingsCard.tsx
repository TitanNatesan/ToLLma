"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Settings card shell: anchor target + heading + body. Matches analytics cards. */
export function SettingsCard({
  id,
  title,
  description,
  action,
  children,
  className,
  testId,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
      data-testid={testId ?? `settings-section-${id}`}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-zinc-400">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
