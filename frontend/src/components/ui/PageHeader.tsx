"use client";

import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chat";

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
  const setLeftSidebar = useChatStore((s) => s.setLeftSidebar);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLeftSidebar(true)}
            aria-label="Open sidebar"
            data-testid="page-header-menu"
            className="-ml-1 flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 md:hidden dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <Menu className="size-4" />
          </button>
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
