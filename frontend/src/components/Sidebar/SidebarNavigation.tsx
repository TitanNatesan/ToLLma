"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, BookOpen, Cpu, KeyRound, LogOut, MessageSquare, Settings, ShieldCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/services/api";
import { useAuthStore } from "@/store/auth";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Personal-scope links: the workspace-level pages. The current page stays
 * listed with an active highlight. Exported for the collapsed rail. */
export const PERSONAL_NAV: NavItem[] = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/providers", label: "Providers", icon: Cpu },
  { href: "/api-keys", label: "API Keys", icon: KeyRound },
  { href: "/guardrails", label: "Guardrails", icon: ShieldCheck },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/docs", label: "API Docs", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function isActivePath(pathname: string, href: string) {
  // "/" is the Chat entry: exact plus the conversation route ("/" has no
  // trailing-slash children, so the generic prefix check would never match).
  if (href === "/") return pathname === "/" || pathname.startsWith("/c/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      key={item.href}
      href={item.href}
      aria-current={active ? "page" : undefined}
      data-testid={`sidebar-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
      )}
    >
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      <span>{item.label}</span>
    </Link>
  );
}
export function SidebarPersonalNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Personal navigation" data-testid="sidebar-personal-nav" className="px-2 py-2">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Personal
      </p>
      <div className="space-y-0.5">
        {PERSONAL_NAV.map((item) => (
          <NavRow key={item.href} item={item} active={isActivePath(pathname, item.href)} />
        ))}
      </div>
    </nav>
  );
}

/** Log out nav row — rendered last in the bottom-anchored navigation. */
export function SidebarLogoutNav() {
  const router = useRouter();
  const reset = useAuthStore((s) => s.reset);
  const email = useAuthStore((s) => s.user?.email ?? "user@example.com");

  async function onLogout() {
    try {
      await logout();
    } finally {
      reset();
      router.push("/");
    }
  }

  return (
    <div className="px-2 py-2">
      <button
        type="button"
        onClick={() => void onLogout()}
        title={`Log out (${email})`}
        aria-label="Log out"
        data-testid="logout-btn"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
          "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        )}
      >
        <LogOut className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span>Log out</span>
      </button>
    </div>
  );
}
