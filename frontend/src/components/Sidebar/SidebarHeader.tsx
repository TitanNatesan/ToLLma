"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Command as CommandIcon, Moon, PanelLeftClose, Sun } from "lucide-react";
import { Button, Tooltip } from "@/components/ui/primitives";
import { ToLLmaMark } from "@/components/ui/Logo";
import { useChatStore } from "@/store/chat";
import { useGlassStore } from "@/store/glass";
import { useUnreadCount } from "@/hooks/useOrgs";

const iconBtn =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

/** Top row of the sidebar: collapse, logo, command palette + theme utilities. */
export function SidebarHeader({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
  const setLeftSidebar = useChatStore((s) => s.setLeftSidebar);
  const sidebarWidth = useChatStore((s) => s.sidebarWidth);
  const router = useRouter();
  const unread = useUnreadCount();
  const unreadCount = unread.data?.unread ?? 0;
  // Single source of truth: the glass engine owns appearance. The toggle
  // flips light<->dark through the store so CSS vars, classes, persistence,
  // and Theme Studio all stay in sync (black is studio-only; toggling from
  // black lands on light).
  const appearance = useGlassStore((s) => s.config.appearance);
  const updateGlass = useGlassStore((s) => s.update);
  const isDark = appearance !== "light";

  // Narrow sidebars can't fit brand + all utilities in one row (200px min).
  // Below ~300px the header wraps to two rows so nothing is ever clipped:
  // brand row on top, utility actions below. The kbd hint only shows when
  // there is room for it.
  const compact = sidebarWidth < 300;

  const collapseBtn = (
    <Tooltip content="Hide sidebar">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 shrink-0 p-0 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        onClick={() => setLeftSidebar(false)}
        aria-label="Collapse sidebar"
        data-testid="left-sidebar-toggle"
      >
        <PanelLeftClose className="size-3.5" />
      </Button>
    </Tooltip>
  );

  // Brand keeps its natural width (never truncated).
  const brand = (
    <Link
      href="/"
      className="group flex w-auto min-w-0 shrink-0 items-center gap-2 rounded-md py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60"
      data-testid="app-logo"
      title="ToLLma home"
    >
      <ToLLmaMark size="sm" />
      <span className="whitespace-nowrap text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
        ToLLma
      </span>
    </Link>
  );

  const paletteBtn = (
    <Tooltip content="Open Command Palette (Ctrl+K)">
      <button
        onClick={onOpenCommandPalette}
        className={iconBtn}
        data-testid="sidebar-command-palette-btn"
        aria-label="Open command palette"
      >
        <CommandIcon className="size-3.5" aria-hidden />
      </button>
    </Tooltip>
  );

  const notificationsBtn = (
    <Tooltip content={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}>
      <button
        onClick={() => router.push("/notifications")}
        className={`${iconBtn} relative`}
        data-testid="sidebar-notifications-btn"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
      >
        <Bell className="size-3.5" />
        {unreadCount > 0 && (
          <span
            data-testid="sidebar-notifications-badge"
            className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    </Tooltip>
  );

  const themeBtn = (
    <Tooltip content={isDark ? "Switch to light mode" : "Switch to dark mode"}>
      <button
        onClick={() => updateGlass({ appearance: isDark ? "light" : "dark" })}
        className={iconBtn}
        data-testid="theme-toggle-btn"
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {isDark ? (
          <Sun className="size-3.5" />
        ) : (
          <Moon className="size-3.5" />
        )}
      </button>
    </Tooltip>
  );

  const kbdHint = (
    <kbd className="hidden items-center gap-0.5 rounded border border-zinc-200 bg-zinc-100 px-1 text-[9px] font-mono text-zinc-500 xl:inline-flex dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400">
      <CommandIcon className="size-2.5" /> K
    </kbd>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-1 border-b border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-1.5">
          {collapseBtn}
          {brand}
        </div>
        <div className="flex items-center gap-1.5">
          {paletteBtn}
          {notificationsBtn}
          {themeBtn}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 overflow-hidden border-b border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
      {collapseBtn}
      {brand}
      {paletteBtn}
      {notificationsBtn}
      {themeBtn}
      {kbdHint}
    </div>
  );
}
