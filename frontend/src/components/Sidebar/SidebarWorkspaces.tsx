"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, Plus, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgs } from "@/hooks/useOrgs";
import { useOrgStore } from "@/store/org";

/** Organization-management sidebar mode: Personal + every membership org,
 * active-context highlighting, and a New-organization entry. Used on
 * management pages (organizations, API keys) instead of the conversation
 * list; chat pages keep SidebarConversations. Reuses useOrgs() so no
 * duplicate fetching occurs. Switching context never touches auth state. */
export function SidebarWorkspaces() {
  const pathname = usePathname();
  const router = useRouter();
  const orgs = useOrgs();
  const context = useOrgStore((s) => s.context);
  const setContext = useOrgStore((s) => s.setContext);
  const list = orgs.data ?? [];

  function goPersonal() {
    setContext({ type: "personal" });
    router.push("/organizations");
  }

  function goOrg(id: string, name: string) {
    setContext({ type: "org", orgId: id, orgName: name });
    router.push(`/organizations/${id}`);
  }

  const itemCls = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="sidebar-workspaces">
      <p className="shrink-0 px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Organizations
      </p>
      <nav aria-label="Workspaces" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={goPersonal}
            aria-current={context.type === "personal" && pathname === "/organizations" ? "page" : undefined}
            data-testid="sidebar-context-personal"
            className={itemCls(context.type === "personal")}
          >
            <UserRound className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">Personal</span>
          </button>

          {orgs.isLoading && (
            <p className="px-2 py-1.5 text-[11px] text-zinc-400">Loading organizations…</p>
          )}
          {!orgs.isLoading && list.length === 0 && (
            <p className="px-2 py-1.5 text-[11px] text-zinc-500" data-testid="sidebar-orgs-empty">
              No organizations yet. Create one below to collaborate.
            </p>
          )}
          {list.map((o) => {
            const isActive = context.type === "org" && context.orgId === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => goOrg(o.id, o.name)}
                aria-current={isActive ? "page" : undefined}
                data-testid={`sidebar-context-org-${o.slug}`}
                title={`${o.name} (/${o.slug})`}
                className={itemCls(isActive)}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                    isActive ? "bg-white/25 text-white dark:bg-zinc-900/10 dark:text-zinc-900" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
                  )}
                >
                  {o.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-left">{o.name}</span>
                {o.is_root && (
                  <span className="shrink-0 rounded bg-zinc-200 px-1 py-px font-mono text-[9px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">
                    root
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
      <div className="shrink-0 border-t border-zinc-200 px-2 py-2 dark:border-zinc-800">
        <Link
          href="/organizations?create=1"
          data-testid="sidebar-new-organization"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <Plus className="size-3.5 shrink-0" aria-hidden />
          <span>New organization</span>
        </Link>
      </div>
    </div>
  );
}
