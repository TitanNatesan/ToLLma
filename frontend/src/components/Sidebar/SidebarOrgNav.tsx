"use client";

import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  Building2,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  Ticket,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgs } from "@/hooks/useOrgs";

export type OrgSection =
  | "overview" | "members" | "teams" | "sets" | "providers" | "keys"
  | "budgets" | "requests" | "invitations" | "analytics" | "audit" | "settings";

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
  { id: "teams", label: "Teams", icon: UsersRound, phase: "B" },
  { id: "sets", label: "Permission Sets", icon: ShieldCheck },
  { id: "providers", label: "Providers", icon: Building2, phase: "B" },
  { id: "keys", label: "Keys", icon: KeyRound, phase: "B" },
  { id: "budgets", label: "Budgets", icon: Wallet, phase: "B" },
  { id: "requests", label: "Requests", icon: Inbox },
  { id: "invitations", label: "Invitations", icon: Ticket },
  { id: "analytics", label: "Analytics", icon: BarChart3, phase: "B" },
  { id: "audit", label: "Audit", icon: ScrollText },
  { id: "settings", label: "Settings", icon: Settings },
];

/** Nested enterprise navigation for an organization workspace. Replaces all
 * horizontal org tabs; Phase B modules appear disabled so the tree never
 * needs a redesign when they land. */
export function SidebarOrgNav({ orgId }: { orgId: string }) {
  const params = useSearchParams();
  const active = (params.get("section") ?? "overview") as OrgSection;
  const orgs = useOrgs();
  const org = (orgs.data ?? []).find((o) => o.id === orgId);

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
          {ITEMS.map((item) => {
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

/** Personal space + organization switcher block above the section tree. */
export function SidebarOrgSwitcher() {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const orgs = useOrgs();
  const list = orgs.data ?? [];

  return (
    <div className="shrink-0 border-b border-zinc-200 px-2 py-2 dark:border-zinc-800" data-testid="sidebar-org-switcher">
      <Link href="/organizations" data-testid="sidebar-org-personal"
        className={cn(
          "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
          pathname === "/organizations"
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
        )}>
        <Building2 className="size-3.5 shrink-0" aria-hidden />
        <span>Organizations</span>
      </Link>
      {list.slice(0, 8).map((o) => {
        const isActive = params.id === o.id;
        return (
          <Link key={o.id} href={`/organizations/${o.id}`} data-testid={`sidebar-org-${o.slug}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "mt-0.5 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}>
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-zinc-200 text-[10px] font-bold dark:bg-zinc-700">
              {o.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">{o.name}</span>
          </Link>
        );
      })}
    </div>
  );
}
