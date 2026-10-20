"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Building2,
  Cpu,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  ScrollText,
  Settings,
  Settings2,
  ShieldCheck,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrg, useOrgs } from "@/hooks/useOrgs";

export type OrgSection =
  | "overview" | "chat" | "members" | "teams" | "sets" | "providers" | "operations"
  | "budgets" | "analytics" | "audit" | "settings" | "docs"
  // Legacy sections: no nav item; the page redirects them to operations+tab.
  | "keys" | "requests" | "invitations";

interface Item {
  id: OrgSection;
  label: string;
  icon: LucideIcon;
}

/** Org navigation: always-visible flat list rendered INSTEAD OF the personal
 * nav when an org is selected (never alongside it, never a separate
 * sidebar). Unified pages (Providers, API Keys, Analytics, API Docs) are
 * included here and render org-scoped data via the shared pages; the
 * remaining items are org-only and link to the org dashboard sections.
 * Unified items always show (their pages gate content); org-only items are
 * filtered by the viewer's effective permissions. */
const ITEMS: Item[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "providers", label: "Providers", icon: Cpu },
  { id: "keys", label: "API Keys", icon: KeyRound },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "docs", label: "API Docs", icon: BookOpen },
  { id: "members", label: "Members", icon: Users },
  { id: "teams", label: "Teams", icon: UsersRound },
  { id: "sets", label: "Permission Sets", icon: ShieldCheck },
  { id: "operations", label: "Operations", icon: Settings2 },
  { id: "budgets", label: "Budgets", icon: Wallet },
  { id: "audit", label: "Audit", icon: ScrollText },
  { id: "settings", label: "Settings", icon: Settings },
];

const UNIFIED_HREF: Partial<Record<OrgSection, string>> = {
  chat: "/",
  providers: "/providers",
  keys: "/api-keys",
  analytics: "/analytics",
  docs: "/docs",
};

export interface OrgNavEntry {
  id: OrgSection;
  label: string;
  icon: LucideIcon;
  href: string;
  isActive: boolean;
}

/** Permission-filtered org navigation entries with resolved hrefs and active
 * state. Shared by the expanded sidebar list and the collapsed rail. */
export function useOrgNavItems(orgId: string): OrgNavEntry[] {
  const params = useSearchParams();
  const pathname = usePathname();
  const sectionParam = params.get("section");
  // Unified items win over the section param: on a shared page (e.g.
  // /api-keys with no ?section=) only that item is active, never Overview.
  const unifiedActive = (Object.keys(UNIFIED_HREF) as OrgSection[]).find((k) => {
    const href = UNIFIED_HREF[k]!;
    if (k === "chat") return pathname === "/" || pathname.startsWith("/c/");
    return pathname === href;
  });
  const detail = useOrg(orgId, { enabled: orgId !== "" });

  const root = detail.data?.is_root ?? false;
  const perms = detail.data?.permissions ?? [];
  const can = (...codes: string[]) => root || codes.some((c) => perms.includes(c));

  let visible = ITEMS;
  if (detail.isError) {
    visible = ITEMS.filter((item) => item.id === "overview");
  } else if (detail.data) {
    // Gated items mirror the same can() checks the dashboard page content
    // uses: budgets needs Budgets.Read, settings needs Organization.Settings,
    // operations needs request/invitation readability. Visibility only — no
    // capability changes.
    visible = ITEMS.filter((item) => {
      switch (item.id) {
        case "overview":
        case "providers":
        case "keys":
        case "analytics":
        case "docs":
          return true;
        case "budgets":
          return can("Budgets.Read");
        case "settings":
          return can("Organization.Settings");
        case "members":
          return can("Members.Read");
        case "teams":
          return can("Teams.Read");
        case "sets":
          return can("PermissionSets.Read");
        case "operations":
          return can("Members.Read", "Members.Approve", "Members.Update");
        case "audit":
          return can("Audit.Read");
        default:
          return true;
      }
    });
  }

  return visible.map((item) => {
    const unified = UNIFIED_HREF[item.id];
    return {
      id: item.id,
      label: item.label,
      icon: item.icon,
      href: unified ?? (item.id === "overview"
        ? `/organizations/${orgId}`
        : `/organizations/${orgId}?section=${item.id}`),
      isActive: unified
        ? unifiedActive === item.id
        : !unifiedActive && (sectionParam ?? "overview") === item.id,
    };
  });
}

/** Org navigation: always-visible flat list rendered INSTEAD OF the personal
 * nav when an org is selected (never alongside it, never a separate
 * sidebar). Unified pages (Providers, API Keys, Analytics, API Docs, Chat)
 * are included here and render org-scoped data via the shared pages; the
 * remaining items are org-only and link to the org dashboard sections.
 * Unified items always show (their pages gate content); org-only items are
 * filtered by the viewer's effective permissions. See useOrgNavItems, which
 * owns the filtering and is shared with the collapsed rail. */
export function SidebarOrgNav({ orgId }: { orgId: string }) {
  const orgs = useOrgs();
  const org = (orgs.data ?? []).find((o) => o.id === orgId);
  const entries = useOrgNavItems(orgId);

  return (
    <div data-testid="sidebar-org-nav" className="px-2 py-2">
      <div className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left">
        <Building2 className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold text-zinc-900 dark:text-zinc-100" title={org?.name ?? "Organization"}>
            {org?.name ?? "Organization"}
          </span>
          <span className="block truncate font-mono text-[10px] text-zinc-500" title={org ? `/${org.slug}` : undefined}>
            {org ? `/${org.slug}` : "…"}
            {org?.is_root ? " · root" : ""}
          </span>
        </span>
      </div>
      <nav aria-label="Organization sections" className="mt-0.5 space-y-0.5">
          {entries.map(({ id, label, icon: Icon, href, isActive }) => (
            <Link key={id} href={href} data-testid={`sidebar-org-${id}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
              )}>
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
    </div>
  );
}
