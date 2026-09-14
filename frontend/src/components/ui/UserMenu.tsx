"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { logout } from "@/services/api";
import { useAuthStore } from "@/store/auth";

export function UserMenu() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const reset = useAuthStore((s) => s.reset);

  async function onLogout() {
    try {
      await logout();
    } finally {
      reset();
      router.push("/login");
    }
  }

  if (!user) return null;
  const initial = (user.email?.[0] ?? "?").toUpperCase();

  return (
    <div className="flex items-center gap-2" data-testid="user-menu">
      <span
        className="flex size-7 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        title={user.email}
        data-testid="user-avatar"
      >
        {initial}
      </span>
      <button
        onClick={onLogout}
        className="flex size-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        title={`Log out (${user.email})`}
        data-testid="logout-btn"
        aria-label="Log out"
      >
        <LogOut className="size-3.5" />
      </button>
    </div>
  );
}
