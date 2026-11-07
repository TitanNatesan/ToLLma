"use client";

import type { ComponentType, ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
}

export function EmptyState({
  icon: Icon = Sparkles,
  title,
  description,
  action,
  className,
  testId,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "m-auto flex max-w-sm flex-col items-center justify-center p-6 text-center",
        className,
      )}
      data-testid={testId}
    >
      <div className="flex size-12 items-center justify-center rounded-[var(--radius-lg,20px)] bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 mb-3 shadow-inner">
        <Icon className="size-6" />
      </div>
      <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
        {title}
      </h3>
      {description && (
        <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
