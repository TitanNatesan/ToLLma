"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, Building2, Cpu, KeyRound, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const ALL_NAV: NavItem[] = [
  { href: "/providers", label: "Providers", icon: Cpu },
  { href: "/organizations", label: "Organizations", icon: Building2 },
  { href: "/api-keys", label: "API Keys", icon: KeyRound },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/docs", label: "API Docs", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Personal-scope links: the workspace-level pages minus Organizations
 * (workspaces live in the switcher above). Rendered directly, no toggle. */
const PERSONAL_NAV: NavItem[] = ALL_NAV.filter((item) => item.href !== "/organizations");

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavRow({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      key={item.href}
      href={item.href}
      data-testid={`sidebar-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
        "dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
      )}
    >
      <Icon className="size-3.5 shrink-0 text-zinc-400" />
      <span>{item.label}</span>
    </Link>
  );
}

/** App navigation links, revealed only via the profile settings toggle.
 * The active page is excluded (its context fills the sidebar). */
export function SidebarNavigation({ open }: { open: boolean }) {
  const pathname = usePathname();
  const items = ALL_NAV.filter((item) => !isActivePath(pathname, item.href));
  if (!open || items.length === 0) return null;

  return (
    <nav
      aria-label="Application navigation"
      className="border-t border-zinc-200 px-2 py-2 dark:border-zinc-800"
      data-testid="sidebar-navigation"
    >
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavRow key={item.href} item={item} />
        ))}
      </div>
    </nav>
  );
}

/** Personal-scope navigation: always visible (no gear toggle) while the
 * active workspace is Personal. The active page is excluded. */
export function SidebarPersonalNav() {
  const pathname = usePathname();
  const items = PERSONAL_NAV.filter((item) => !isActivePath(pathname, item.href));
  if (items.length === 0) return null;

  return (
    <nav aria-label="Personal navigation" data-testid="sidebar-personal-nav" className="px-2 py-2">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Personal
      </p>
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavRow key={item.href} item={item} />
        ))}
      </div>
    </nav>
  );
}
