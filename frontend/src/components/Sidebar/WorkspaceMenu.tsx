"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, UserRound } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui";
import { useAuthStore } from "@/store/auth";
import { useOrgs } from "@/hooks/useOrgs";
import { useOrgStore } from "@/store/org";

/** Shared workspace-menu body: identity header, Personal + org list with
 * active checks, inline New/Join organization actions. Rendered inside a
 * DropdownMenuContent by both the sidebar profile trigger and the collapsed
 * rail avatar. */
export function WorkspaceMenuContent() {
  const router = useRouter();
  const orgs = useOrgs();
  const setContext = useOrgStore((s) => s.setContext);
  const active = useOrgStore((s) => s.context);
  const list = orgs.data ?? [];

  function goPersonal() {
    setContext({ type: "personal" });
    router.push("/");
  }

  function goOrg(id: string, name: string) {
    setContext({ type: "org", orgId: id, orgName: name });
    router.push(`/organizations/${id}`);
  }

  return (
    <>
      <div className="flex items-center gap-2.5 rounded-lg bg-zinc-100/70 px-2.5 py-2 dark:bg-zinc-800/60">
        <WorkspaceMenuIdentity />
      </div>

      <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        Workspaces
      </p>
      <DropdownMenuItem onSelect={goPersonal} data-testid="workspace-menu-personal"
        className={active.type === "personal" ? "bg-zinc-100 dark:bg-zinc-800" : undefined}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300" aria-hidden>
          <UserRound className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">Personal</span>
          <span className="block truncate text-[11px] text-zinc-500">Private to you</span>
        </span>
        {active.type === "personal" && <Check className="size-3.5 shrink-0 text-tollma-600 dark:text-tollma-400" aria-hidden />}
      </DropdownMenuItem>
      {orgs.isLoading && (
        <>
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-md px-2 py-2" aria-hidden>
              <span className="size-7 shrink-0 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800" />
              <span className="h-3 flex-1 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ))}
        </>
      )}
      {list.map((o) => {
        const isActive = active.type === "org" && active.orgId === o.id;
        return (
          <DropdownMenuItem
            key={o.id}
            onSelect={() => goOrg(o.id, o.name)}
            data-testid={`workspace-menu-org-${o.slug}`}
            className={isActive ? "bg-zinc-100 dark:bg-zinc-800" : undefined}
          >
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-tollma-100 text-[11px] font-bold text-tollma-700 dark:bg-tollma-950 dark:text-tollma-300"
            >
              {o.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{o.name}</span>
              <span className="block truncate font-mono text-[10px] text-zinc-500">/{o.slug}{o.is_root ? " · root" : ""}</span>
            </span>
            {isActive && <Check className="size-3.5 shrink-0 text-tollma-600 dark:text-tollma-400" aria-hidden />}
          </DropdownMenuItem>
        );
      })}
      {orgs.isError && (
        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <p className="text-[11px] text-zinc-500">Couldn’t load organizations.</p>
          <button
            type="button"
            onClick={() => void orgs.refetch()}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-tollma-600 hover:bg-tollma-50 dark:text-tollma-400 dark:hover:bg-tollma-950"
          >
            Retry
          </button>
        </div>
      )}
      <DropdownMenuSeparator />
      <div className="p-1">
        <DropdownMenuItem
          asChild
          data-testid="workspace-menu-new-org"
        >
          <Link href="/settings#organizations">
            <Plus className="size-3.5 shrink-0 text-tollma-600 dark:text-tollma-400" aria-hidden />
            <span className="text-xs font-medium">New organization</span>
          </Link>
        </DropdownMenuItem>
      </div>
    </>
  );
}

function WorkspaceMenuIdentity() {
  const user = useAuthStore((s) => s.user);
  const displayName = user?.full_name?.trim() || "User";
  const email = user?.email || "user@example.com";
  const initial = (email[0] ?? "?").toUpperCase();
  return (
    <>
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
      >
        {initial}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {displayName}
        </span>
        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={email}>
          {email}
        </span>
      </span>
    </>
  );
}
