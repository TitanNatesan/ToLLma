"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Cpu, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const ALL_NAV = [
  { href: "/providers", label: "Providers", icon: Cpu },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** App navigation links, revealed only via the profile settings toggle.
 * The active page is excluded (its context fills the sidebar). */
export function SidebarNavigation({ open }: { open: boolean }) {
  const pathname = usePathname();
  const items = ALL_NAV.filter((item) => pathname !== item.href && !pathname.startsWith(`${item.href}/`));
  if (!open || items.length === 0) return null;

  return (
    <nav
      aria-label="Application navigation"
      className="border-t border-zinc-200 px-2 py-2 dark:border-zinc-800"
      data-testid="sidebar-navigation"
    >
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`sidebar-nav-${item.label.toLowerCase()}`}
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
        })}
      </div>
    </nav>
  );
}
