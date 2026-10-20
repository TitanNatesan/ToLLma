"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, PanelLeftOpen, Search } from "lucide-react";
import { useChatStore } from "@/store/chat";
import { useAuthStore } from "@/store/auth";
import { useOrgStore } from "@/store/org";
import { useUnreadCount } from "@/hooks/useOrgs";
import { Button, Tooltip } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui";
import { PERSONAL_NAV, isActivePath } from "./SidebarNavigation";
import { useOrgNavItems } from "./SidebarOrgNav";
import { WorkspaceMenuContent } from "./WorkspaceMenu";

function RailButton({
  testId,
  title,
  ariaLabel,
  ariaExpanded,
  onClick,
  href,
  children,
  active,
}: {
  testId?: string;
  title: string;
  ariaLabel: string;
  ariaExpanded?: boolean;
  onClick?: () => void;
  href?: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  const cls =
    "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors " +
    (active
      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100");
  const inner = <span className="inline-flex">{children}</span>;
  if (href) {
    return (
      <Tooltip content={title} side="right">
        <Link href={href} aria-label={ariaLabel} aria-current={active ? "page" : undefined} data-testid={testId} className={cls}>
          {inner}
        </Link>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={title} side="right">
      <Button size="sm" variant="ghost" onClick={onClick} aria-label={ariaLabel} aria-expanded={ariaExpanded} data-testid={testId} className={cn("h-8 w-8 p-0", cls)}>
        {inner}
      </Button>
    </Tooltip>
  );
}

/**
 * Collapsed-sidebar icon rail (desktop). Top: reveal control, command
 * palette search, notifications. Middle (scrollable): scope-aware
 * navigation icons with tooltips, always visible. Bottom: profile avatar
 * opening the workspace menu. The show/hide chevron lives only in the
 * expanded sidebar footer; the rail never hides its navigation.
 */
export function SidebarReveal({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
  const router = useRouter();
  const setLeftSidebar = useChatStore((s) => s.setLeftSidebar);
  const user = useAuthStore((s) => s.user);
  const context = useOrgStore((s) => s.context);
  const pathname = usePathname();
  const unread = useUnreadCount();
  const unreadCount = unread.data?.unread ?? 0;
  const orgEntries = useOrgNavItems(context.type === "org" ? context.orgId : "");
  const isOrg = context.type === "org";
  const email = user?.email ?? "user@example.com";
  const initial = (email[0] ?? "?").toUpperCase();

  return (
    <div
      className="hidden w-12 shrink-0 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto border-r border-zinc-200 bg-zinc-50 py-2 md:flex dark:border-zinc-800 dark:bg-zinc-900"
      data-testid="sidebar-reveal-rail"
    >
      <RailButton testId="rail-expand" title="Show sidebar" ariaLabel="Expand sidebar" onClick={() => setLeftSidebar(true)}>
        <PanelLeftOpen className="size-4" aria-hidden />
      </RailButton>
      <RailButton testId="rail-command-palette" title="Search or jump to… (Ctrl+K)" ariaLabel="Open command palette" onClick={() => onOpenCommandPalette?.()}>
        <Search className="size-4" aria-hidden />
      </RailButton>
      <RailButton
        testId="rail-notifications"
        title={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        ariaLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        onClick={() => router.push("/notifications")}
      >
        <span className="relative inline-flex">
          <Bell className="size-4" aria-hidden />
          {unreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-600 px-0.5 text-[8px] font-bold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </span>
      </RailButton>

      <div className="my-1 h-px w-6 shrink-0 bg-zinc-200 dark:bg-zinc-800" aria-hidden />

      <nav aria-label={isOrg ? "Organization sections" : "Personal navigation"} className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {!isOrg &&
          PERSONAL_NAV.map((item) => (
            <RailButton
              key={item.href}
              testId={`rail-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              title={item.label}
              ariaLabel={item.label}
              href={item.href}
              active={isActivePath(pathname, item.href)}
            >
              <item.icon className="size-4" aria-hidden />
            </RailButton>
          ))}
        {isOrg &&
          orgEntries.map((entry) => (
            <RailButton
              key={entry.id}
              testId={`rail-org-${entry.id}`}
              title={entry.label}
              ariaLabel={entry.label}
              href={entry.href}
              active={entry.isActive}
            >
              <entry.icon className="size-4" aria-hidden />
            </RailButton>
          ))}
      </nav>

      <div className="my-1 h-px w-6 shrink-0 bg-zinc-200 dark:bg-zinc-800" aria-hidden />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <span className="inline-flex">
            <Tooltip content={`Workspaces — signed in as ${email}`} side="right">
              <button
                type="button"
                aria-label={`Workspace menu, signed in as ${email}`}
                data-testid="rail-profile-menu"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                <span aria-hidden>{initial}</span>
              </button>
            </Tooltip>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" collisionPadding={12} className="w-64 p-1.5" data-testid="workspace-menu">
          <WorkspaceMenuContent />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
