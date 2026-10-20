"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SettingItemProps {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SettingItem({
  label,
  description,
  children,
  className,
}: SettingItemProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 py-2.5 border-b border-zinc-100 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:border-zinc-800/60",
        className,
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
          {label}
        </span>
        {description && (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {description}
          </span>
        )}
      </div>
      <div className="w-full sm:w-auto sm:shrink-0">{children}</div>
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 py-2", className)}>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        {description && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}
