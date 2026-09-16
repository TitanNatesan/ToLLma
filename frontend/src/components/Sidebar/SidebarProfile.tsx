"use client";

import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import { logout } from "@/services/api";
import { useAuthStore } from "@/store/auth";
import { cn } from "@/lib/utils";

/** Persistent profile card: avatar, name, email, nav-toggle + logout actions. */
export function SidebarProfile({
  navOpen,
  onToggleNav,
}: {
  navOpen: boolean;
  onToggleNav: () => void;
}) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const reset = useAuthStore((s) => s.reset);

  async function onLogout() {
    try {
      await logout();
    } finally {
      reset();
      router.push("/");
    }
  }

  if (!user) return null;
  const displayName = user.full_name?.trim() || "User";
  const email = user.email || "user@example.com";
  const initial = (email[0] ?? "?").toUpperCase();

  return (
    <div className="flex items-center gap-2.5" data-testid="sidebar-profile">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        title={email}
        data-testid="user-avatar"
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {displayName}
        </span>
        <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={email}>
          {email}
        </span>
      </span>
      <button
        onClick={onToggleNav}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
          navOpen
            ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        )}
        title={navOpen ? "Hide navigation" : "Show navigation"}
        aria-label={navOpen ? "Hide navigation" : "Show navigation"}
        aria-expanded={navOpen}
        data-testid="profile-settings-btn"
      >
        <Settings className="size-3.5" />
      </button>
      <button
        onClick={onLogout}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        title={`Log out (${email})`}
        data-testid="logout-btn"
        aria-label="Log out"
      >
        <LogOut className="size-3.5" />
      </button>
    </div>
  );
}
