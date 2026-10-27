"use client";

import { useState, type ReactNode } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Reusable narrow contextual column for org dashboard sections.
 * Collapse persists in localStorage (mirrors the chat store persist pattern);
 * below md it becomes a toggleable drawer so tables keep full width.
 */
export function OrgContextSidebar({
  heading,
  children,
  testId,
  storageKey = "org-context-sidebar-collapsed",
  /** Rendered inside the main layout sidebar via SidebarPanelPortal: no
   *  mobile toggle/drawer (the sidebar itself drawers on mobile), fluid
   *  width, collapse toggle always visible. */
  bare = false,
}: {
  heading: string;
  children: ReactNode;
  testId?: string;
  storageKey?: string;
  bare?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggle() {
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // storage unavailable
      }
      return next;
    });
  }

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {heading}
        </h2>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? `Expand ${heading} sidebar` : `Collapse ${heading} sidebar`}
          aria-expanded={!collapsed}
          data-testid={testId ? `${testId}-collapse` : undefined}
          className={bare
            ? "rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            : "hidden rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 md:block dark:hover:bg-zinc-800 dark:hover:text-zinc-200"}
        >
          {collapsed ? <ChevronsRight className="size-3.5" aria-hidden /> : <ChevronsLeft className="size-3.5" aria-hidden />}
        </button>
      </div>
      {!collapsed && <div className="flex flex-col gap-3">{children}</div>}
    </div>
  );

  if (bare) {
    return (
      <aside aria-label={heading} data-testid={testId} className="w-full">
        {body}
      </aside>
    );
  }

  return (
    <>
      {/* Mobile toggle */}
      <div className="mb-2 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? `Hide ${heading} panel` : `Show ${heading} panel`}
          data-testid={testId ? `${testId}-drawer-toggle` : undefined}
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:border-zinc-800 dark:text-zinc-300"
        >
          {mobileOpen ? "Hide filters" : "Show filters"}
        </button>
      </div>
      {mobileOpen && (
        <aside
          aria-label={heading}
          data-testid={testId}
          className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 md:hidden dark:border-zinc-800 dark:bg-zinc-900/40"
        >
          {body}
        </aside>
      )}
      <aside
        aria-label={heading}
        data-testid={testId}
        className={cn(
          "hidden shrink-0 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 md:block dark:border-zinc-800 dark:bg-zinc-900/40",
          collapsed ? "w-12" : "w-60",
        )}
      >
        {body}
      </aside>
    </>
  );
}
