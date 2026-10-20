"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Command as CmdIcon, Moon, PanelLeftClose, Search, Sun } from "lucide-react";
import { Button, Tooltip } from "@/components/ui/primitives";
import { useChatStore } from "@/store/chat";
import { useUnreadCount } from "@/hooks/useOrgs";

/** Top row of the sidebar: collapse, logo, command palette + theme utilities. */
export function SidebarHeader({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
  const setLeftSidebar = useChatStore((s) => s.setLeftSidebar);
  const router = useRouter();
  const unread = useUnreadCount();
  const unreadCount = unread.data?.unread ?? 0;
  const [isDark, setIsDark] = useState<boolean>(true);
  // Hydration guard: deterministic first render, then sync the client-only theme class.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsDark(document.documentElement.classList.contains("dark"));
    } catch {
      // non-DOM environment: keep default
    }
  }, []);

  const toggleTheme = () => {
    const nextIsDark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", nextIsDark);
    try {
      localStorage.setItem("theme", nextIsDark ? "dark" : "light");
    } catch {
      // storage unavailable
    }
    setIsDark(nextIsDark);
  };

  return (
    <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
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
      <Link
        href="/"
        className="group flex min-w-0 flex-1 items-center gap-2 py-0.5"
        data-testid="app-logo"
        title="ToLLma home"
      >
        <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-[11px] font-black text-white shadow-sm transition-transform group-hover:scale-105 dark:bg-zinc-100 dark:text-zinc-900">
          T
        </div>
        <span className="truncate text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          ToLLma
        </span>
      </Link>
      <Tooltip content="Open Command Palette (Ctrl+K)">
        <button
          onClick={onOpenCommandPalette}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          data-testid="sidebar-command-palette-btn"
          aria-label="Open command palette"
        >
          <Search className="size-3.5" />
        </button>
      </Tooltip>
      <Tooltip content={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}>
        <button
          onClick={() => router.push("/notifications")}
          className="relative flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
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
      <Tooltip content={isDark ? "Switch to light mode" : "Switch to dark mode"}>
        <button
          onClick={toggleTheme}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
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
      <kbd className="hidden items-center gap-0.5 rounded border border-zinc-200 bg-zinc-100 px-1 text-[9px] font-mono text-zinc-500 xl:inline-flex dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400">
        <CmdIcon className="size-2.5" /> K
      </kbd>
    </div>
  );
}
