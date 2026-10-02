"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, Building2, Check, Plus, Search, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import {
  Badge, Button, Card, CardContent, EmptyState, LoadingState, ErrorState, PageHeader,
} from "@/components/ui";
import { CreateOrgModal } from "./components/CreateOrgModal";
import { JoinModal } from "./components/JoinModal";
import {
  useMyInvitations, useNotifications, useOrgs, useOrgMutations, useUnreadCount,
} from "@/hooks/useOrgs";
import { useOrgStore } from "@/store/org";
import { parseApiError } from "@/lib/errors";
import { cn } from "@/lib/utils";

export default function OrganizationsPage() {
  return (
    <Suspense>
      <OrganizationsInner />
    </Suspense>
  );
}

function OrganizationsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<"orgs" | "inbox">(params.get("view") === "inbox" ? "inbox" : "orgs");
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const orgs = useOrgs();
  const invites = useMyInvitations();
  const notifications = useNotifications();
  const unread = useUnreadCount();
  const mut = useOrgMutations();
  const context = useOrgStore((s) => s.context);
  const setContext = useOrgStore((s) => s.setContext);
  const reconcile = useOrgStore((s) => s.reconcile);

  useEffect(() => {
    if (orgs.data) reconcile(orgs.data.map((o) => o.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs.data]);

  function switchToPersonal() {
    setContext({ type: "personal" });
    toast.success("Switched to Personal space.");
  }

  function switchToOrg(id: string, name: string) {
    setContext({ type: "org", orgId: id, orgName: name });
    router.push(`/organizations/${id}`);
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
    <div className="flex h-full flex-col overflow-hidden" data-testid="organizations-page">
      <PageHeader
        title="Organizations"
        subtitle="Personal space plus every organization you belong to."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setJoinOpen(true)} data-testid="org-join-open">
              <Search className="size-3.5" /> Join
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="org-create-open">
              <Plus className="size-3.5" /> New organization
            </Button>
          </div>
        }
      />
      <div className="flex gap-1 border-b border-zinc-200 px-4 dark:border-zinc-800">
        {(["orgs", "inbox"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} data-testid={`org-tab-${v}`}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium",
              view === v
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400",
            )}>
            {v === "inbox" ? <Bell className="size-3.5" /> : <Building2 className="size-3.5" />}
            {v === "inbox" ? "Inbox" : "My organizations"}
            {v === "inbox" && (unread.data?.unread ?? 0) > 0 && (
              <Badge variant="secondary" data-testid="org-unread-badge">{unread.data?.unread}</Badge>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {view === "orgs" && (
          <div className="space-y-3">
            <Card data-testid="org-context-card">
              <CardContent className="flex flex-wrap items-center gap-2 p-3">
                <span className="text-xs font-medium text-zinc-500">Active context:</span>
                <Button size="sm" variant={context.type === "personal" ? "default" : "outline"}
                  onClick={switchToPersonal} data-testid="org-context-personal">
                  <UserRound className="size-3.5" /> Personal
                </Button>
                {(orgs.data ?? []).map((o) => (
                  <Button key={o.id} size="sm"
                    variant={context.type === "org" && context.orgId === o.id ? "default" : "outline"}
                    onClick={() => switchToOrg(o.id, o.name)} data-testid={`org-context-${o.slug}`}>
                    {o.name}
                  </Button>
                ))}
              </CardContent>
            </Card>

            {orgs.isLoading && <LoadingState />}
            {orgs.isError && <ErrorState />}
            {orgs.data?.length === 0 && (
              <EmptyState title="No organizations yet"
                description="Create one (you become root) or join an existing organization." />
            )}
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
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
                      <Button size="sm" variant="ghost"
                        onClick={() => switchToOrg(o.id, o.name)}>Switch here</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {view === "inbox" && (
          <div className="space-y-4" data-testid="org-inbox">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Pending invitations
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
            </section>
            <section>
              <div className="mb-2 flex items-center justify-between">
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
          </div>
        )}
      </div>

      <CreateOrgModal open={createOpen} onClose={() => setCreateOpen(false)}
        onCreate={(p) => mut.createOrg.mutateAsync(p)} />
      <JoinModal open={joinOpen} onClose={() => setJoinOpen(false)}
        onRequest={(id) => mut.requestJoin.mutateAsync(id)} />
    </div>
  );
}
