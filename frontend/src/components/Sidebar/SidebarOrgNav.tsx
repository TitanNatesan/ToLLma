"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BarChart3,
  Building2,
  LayoutDashboard,
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
  | "overview" | "members" | "teams" | "sets" | "providers" | "operations"
  | "budgets" | "analytics" | "audit" | "settings"
  // Legacy sections: no nav item; the page redirects them to operations+tab.
  | "keys" | "requests" | "invitations";

interface Item {
  id: OrgSection;
  label: string;
  icon: LucideIcon;
  /** Phase B modules render disabled with a badge instead of linking. */
  phase?: "A" | "B";
}

const ITEMS: Item[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "members", label: "Members", icon: Users },
  { id: "teams", label: "Teams", icon: UsersRound },
  { id: "sets", label: "Permission Sets", icon: ShieldCheck },
  { id: "providers", label: "Providers", icon: Building2 },
  { id: "operations", label: "Operations", icon: Settings2 },
  { id: "budgets", label: "Budgets", icon: Wallet },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "audit", label: "Audit", icon: ScrollText },
  { id: "settings", label: "Settings", icon: Settings },
];

/** Nested enterprise navigation for an organization workspace, filtered by
 * the viewer's effective permissions (`useOrg` detail: `{is_root,
 * permissions[]}`). Codes mirror the org detail page: root sees everything;
 * Budgets/Settings show for any member (content gates itself); Overview is
 * always visible. Loading fails open (backend still 404s non-members);
 * error (non-member oracle) collapses to Overview — reconcile() flips the
 * scope to Personal right after. */
export function SidebarOrgNav({ orgId }: { orgId: string }) {
  const params = useSearchParams();
  const active = (params.get("section") ?? "overview") as OrgSection;
  const orgs = useOrgs();
  const org = (orgs.data ?? []).find((o) => o.id === orgId);
  const detail = useOrg(orgId);

  const root = detail.data?.is_root ?? false;
  const perms = detail.data?.permissions ?? [];
  const can = (...codes: string[]) => root || codes.some((c) => perms.includes(c));

  let visible = ITEMS;
  if (detail.isError) {
    visible = ITEMS.filter((item) => item.id === "overview");
  } else if (detail.data) {
    visible = ITEMS.filter((item) => {
      switch (item.id) {
        case "overview":
        case "budgets":
        case "settings":
          return true;
        case "analytics":
          return can("Analytics.ViewUsage", "Organization.ViewAnalytics");
        case "members":
          return can("Members.Read");
        case "teams":
          return can("Teams.Read");
        case "sets":
          return can("PermissionSets.Read");
        case "providers":
          return can("Providers.Read");
        case "operations":
          return can("Keys.Read", "Members.Read", "Members.Invite", "Members.Approve", "Members.Update");
        case "audit":
          return can("Audit.Read");
        default:
          return true;
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="sidebar-org-nav">
      <div className="shrink-0 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <p className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">
          {org?.name ?? "Organization"}
        </p>
        <p className="truncate font-mono text-[10px] text-zinc-500">
          {org ? `/${org.slug}` : "…"}
          {org?.is_root ? " · root" : ""}
        </p>
      </div>
      <nav aria-label="Organization sections" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-0.5">
          {visible.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            const href = `/organizations/${orgId}?section=${item.id}`;
            const cls = cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            );
            const badge = item.phase === "B" ? (
              <span className="ml-auto rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                soon
              </span>
            ) : null;
            if (item.phase === "B") {
              return (
                <span key={item.id} aria-disabled="true" title="Available in a later phase"
                  data-testid={`sidebar-org-${item.id}`}
                  className={cn(cls, "cursor-not-allowed opacity-50")}>
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span>{item.label}</span>
                  {badge}
                </span>
              );
            }
            return (
              <Link key={item.id} href={href} data-testid={`sidebar-org-${item.id}`}
                aria-current={isActive ? "page" : undefined} className={cls}>
                <Icon className="size-3.5 shrink-0" aria-hidden />
                <span>{item.label}</span>
                {badge}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
