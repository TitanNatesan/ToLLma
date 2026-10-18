"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Plus, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgs } from "@/hooks/useOrgs";
import { useOrgStore } from "@/store/org";

/** Global workspace switcher: Personal + collapsible org list, mounted above
 * the route body on every route. Selecting a workspace writes the active
 * context (persisted to localStorage, scope caches invalidated) and navigates
 * to its home (Personal → `/`, org → `/organizations/{id}`). Links preserve
 * native navigation semantics (middle-click, Cmd+click, screen readers). */
export function SidebarWorkspaceSwitcher() {
  const orgs = useOrgs();
  const context = useOrgStore((s) => s.context);
  const setContext = useOrgStore((s) => s.setContext);
  const [orgsOpen, setOrgsOpen] = useState(context.type === "org");
  const list = orgs.data ?? [];
  // Remounted on scope change (key in Sidebar), so the initial open state
  // always matches the active scope; the toggle stays user-controlled after.

  const itemCls = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
    );

  return (
    <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800" data-testid="sidebar-workspace-switcher">
      <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Workspace
      </p>
      <div className="px-2 pb-2">
        <Link
          href="/"
          onClick={() => setContext({ type: "personal" })}
          aria-current={context.type === "personal" ? "page" : undefined}
          data-testid="sidebar-ws-personal"
          className={itemCls(context.type === "personal")}
        >
          <UserRound className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">Personal</span>
        </Link>

        <button
          type="button"
          onClick={() => setOrgsOpen((v) => !v)}
          aria-expanded={orgsOpen}
          aria-controls="sidebar-ws-orgs-group"
          data-testid="sidebar-ws-orgs-toggle"
          className={cn(itemCls(false), "mt-0.5")}
        >
          <ChevronDown
            className={cn("size-3.5 shrink-0 transition-transform", !orgsOpen && "-rotate-90")}
            aria-hidden
          />
          <span className="truncate">Organizations</span>
          {!orgs.isLoading && list.length > 0 && (
            <span className="ml-auto shrink-0 rounded bg-zinc-200 px-1 py-px font-mono text-[9px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">
              {list.length}
            </span>
          )}
        </button>

        {orgsOpen && (
          <div className="mt-0.5 space-y-0.5" id="sidebar-ws-orgs-group" role="group" aria-label="Organizations" data-testid="sidebar-ws-orgs">
            {orgs.isLoading && (
              <p className="px-2 py-1.5 text-[11px] text-zinc-400">Loading organizations…</p>
            )}
            {orgs.isError && (
              <p className="px-2 py-1.5 text-[11px] text-zinc-500">Couldn’t load organizations.</p>
            )}
            {!orgs.isLoading && !orgs.isError && list.length === 0 && (
              <p className="px-2 py-1.5 text-[11px] text-zinc-500" data-testid="sidebar-ws-orgs-empty">
                No organizations yet.
              </p>
            )}
            {list.map((o) => {
              const isActive = context.type === "org" && context.orgId === o.id;
              return (
                <Link
                  key={o.id}
                  href={`/organizations/${o.id}`}
                  onClick={() => setContext({ type: "org", orgId: o.id, orgName: o.name })}
                  aria-current={isActive ? "page" : undefined}
                  data-testid={`sidebar-ws-org-${o.slug}`}
                  title={`${o.name} (/${o.slug})`}
                  className={itemCls(isActive)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                      isActive
                        ? "bg-white/25 text-white dark:bg-zinc-900/10 dark:text-zinc-900"
                        : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
                    )}
                  >
                    {o.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left">{o.name}</span>
                </Link>
              );
            })}
            <Link
              href="/organizations"
              data-testid="sidebar-ws-new-organization"
              className={cn(itemCls(false), "mt-0.5 text-zinc-500 dark:text-zinc-400")}
            >
              <Plus className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">New organization</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
