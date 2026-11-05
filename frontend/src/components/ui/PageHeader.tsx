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
  sticky,
  hideMenu,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Pin to the top of the scroll container (admin keeps this on). */
  sticky?: boolean;
  /** Suppress the sidebar toggle (bare public pages have no sidebar). */
  hideMenu?: boolean;
}) {
  const setLeftSidebar = useChatStore((s) => s.setLeftSidebar);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm",
        sticky && "sticky top-0 z-20 -mx-4 px-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {!hideMenu && (
            <button
              type="button"
              onClick={() => setLeftSidebar(true)}
              aria-label="Open sidebar"
              data-testid="page-header-menu"
              className="-ml-1 flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 md:hidden dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <Menu className="size-4" />
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </h1>
          {badges}
        </div>
        {subtitle && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</div>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
