"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Building2, Check, Plus, Search, X } from "lucide-react";
import { toast } from "@/lib/notify";
import {
  Badge, Button, Card, CardContent, CardGrid, EmptyState, ErrorState, LoadingState,
} from "@/components/ui";
import { CreateOrgModal } from "./CreateOrgModal";
import { JoinModal } from "./JoinModal";
import {
  useMyInvitations, useNotifications, useOrgs, useOrgMutations,
} from "@/hooks/useOrgs";
import { useOrgStore } from "@/store/org";
import { parseApiError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Organization membership: list + switch, create, join, and inbox.
 * Lives in Settings (the /organizations list page was removed); org
 * workspaces themselves open under /organizations/[id]. */
export function OrganizationsSection() {
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const orgs = useOrgs();
  const invites = useMyInvitations();
  const notifications = useNotifications();
  const mut = useOrgMutations();
  const context = useOrgStore((s) => s.context);
  const setContext = useOrgStore((s) => s.setContext);

  function switchToPersonal() {
    setContext({ type: "personal" });
    toast.success("Switched to Personal space.");
  }

  function switchToOrg(id: string, name: string) {
    setContext({ type: "org", orgId: id, orgName: name });
    toast.success(`Switched to ${name}.`);
  }

  async function accept(token: string) {
    try {
      const org = await mut.acceptInvite.mutateAsync(token);
      toast.success(`Joined ${org.name}.`);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  async function reject(token: string) {
    try {
      await mut.rejectInvite.mutateAsync(token);
      toast.success("Invitation declined.");
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  return (
    <div className="space-y-4" data-testid="settings-organizations">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="org-create-open">
          <Plus className="size-3.5" /> New organization
        </Button>
        <Button size="sm" variant="outline" onClick={() => setJoinOpen(true)} data-testid="org-join-open">
          <Search className="size-3.5" /> Join
        </Button>
      </div>

      {orgs.isLoading && <LoadingState message="Loading organizations…" />}
      {orgs.isError && <ErrorState title="Could not load organizations" message={parseApiError(orgs.error).message} onRetry={() => void orgs.refetch()} />}
      {!orgs.isLoading && !orgs.isError && (orgs.data ?? []).length === 0 && (
        <EmptyState title="No organizations yet"
          description="Create one (you become root) or join an existing organization." />
      )}
      <CardGrid>
        <Card data-testid="org-card-personal">
          <CardContent className="p-3.5">
            <p className="truncate text-sm font-semibold">Personal space</p>
            <p className="truncate font-mono text-[11px] text-zinc-500">your private workspace</p>
            <div className="mt-3">
              <Button size="sm" variant={context.type === "personal" ? "default" : "outline"}
                onClick={switchToPersonal} data-testid="org-context-personal"
                disabled={context.type === "personal"}>
                {context.type === "personal" ? "Active" : "Switch here"}
              </Button>
            </div>
          </CardContent>
        </Card>
        {(orgs.data ?? []).map((o) => (
          <Card key={o.id} data-testid={`org-card-${o.slug}`}>
            <CardContent className="p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{o.name}</p>
                  <p className="truncate font-mono text-[11px] text-zinc-500">/{o.slug}</p>
                </div>
                {o.is_root && <Badge data-testid={`org-root-${o.slug}`}>root</Badge>}
              </div>
              {o.description && <p className="mt-1.5 line-clamp-2 text-xs text-zinc-500">{o.description}</p>}
              <div className="mt-3 flex gap-2">
                <Link href={`/organizations/${o.id}`} data-testid={`org-open-${o.slug}`}>
                  <Button size="sm" variant="outline">Open dashboard</Button>
                </Link>
                <Button size="sm" variant={context.type === "org" && context.orgId === o.id ? "default" : "ghost"}
                  onClick={() => switchToOrg(o.id, o.name)}
                  disabled={context.type === "org" && context.orgId === o.id}>
                  {context.type === "org" && context.orgId === o.id ? "Active" : "Switch here"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </CardGrid>

      <section data-testid="settings-org-inbox">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <Bell className="size-3.5" /> Inbox
        </h3>
        {(invites.data ?? []).length === 0 && (
          <p className="text-xs text-zinc-500">No pending invitations.</p>
        )}
        <div className="space-y-2">
          {(invites.data ?? []).map((inv) => (
            <Card key={inv.id} data-testid={`org-invite-${inv.id}`}>
              <CardContent className="flex flex-wrap items-center gap-2 p-3">
                <p className="min-w-0 flex-1 text-xs">
                  <span className="font-semibold">{inv.org_name || "An organization"}</span>
                  <span className="text-zinc-500"> invited you to join.</span>
                  {inv.org_slug && (
                    <span className="block font-mono text-[10px] text-zinc-400">/{inv.org_slug}</span>
                  )}
                </p>
                <Button size="sm" onClick={() => inv.token && void accept(inv.token)}
                  disabled={!inv.token} data-testid={`org-invite-accept-${inv.id}`}>
                  <Check className="size-3.5" /> Accept
                </Button>
                <Button size="sm" variant="outline" onClick={() => inv.token && void reject(inv.token)}
                  disabled={!inv.token} data-testid={`org-invite-reject-${inv.id}`}>
                  <X className="size-3.5" /> Reject
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mb-2 mt-4 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Notifications</h3>
          <Button size="sm" variant="ghost" onClick={() => void mut.markAllRead.mutateAsync()}
            data-testid="org-notif-read-all">Mark all read</Button>
        </div>
        <div className="space-y-2">
          {(notifications.data ?? []).map((n) => (
            <Card key={n.id} data-testid={`org-notif-${n.id}`}
              className={cn(!n.read_at && "border-zinc-400 dark:border-zinc-600")}>
              <CardContent className="flex items-start gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">{n.title}</p>
                  {n.body && <p className="mt-0.5 text-xs text-zinc-500">{n.body}</p>}
                  <p className="mt-1 font-mono text-[10px] text-zinc-400">{n.kind} · {new Date(n.created_at).toLocaleString()}</p>
                </div>
                {!n.read_at && (
                  <Button size="sm" variant="outline"
                    onClick={() => void mut.markRead.mutateAsync(n.id)}
                    data-testid={`org-notif-read-${n.id}`}>Mark read</Button>
                )}
              </CardContent>
            </Card>
          ))}
          {(notifications.data ?? []).length === 0 && (
            <p className="text-xs text-zinc-500">No notifications.</p>
          )}
        </div>
      </section>

      <CreateOrgModal open={createOpen} onClose={() => setCreateOpen(false)}
        onCreate={(p) => mut.createOrg.mutateAsync(p)} />
      <JoinModal open={joinOpen} onClose={() => setJoinOpen(false)}
        onRequest={(id) => mut.requestJoin.mutateAsync(id)} />
    </div>
  );
}
