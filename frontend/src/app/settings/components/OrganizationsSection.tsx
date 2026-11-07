"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { toast } from "@/lib/notify";
import {
  Badge, Button, Card, CardContent, CardGrid, EmptyState, ErrorState, LoadingState,
} from "@/components/ui";
import { CreateOrgModal } from "./CreateOrgModal";
import { JoinModal } from "./JoinModal";
import { useOrgs, useOrgMutations } from "@/hooks/useOrgs";
import { useOrgStore } from "@/store/org";
import { parseApiError } from "@/lib/errors";

/** Organization membership: list + switch, create, and join. Invites live
 *  under /organizations/invites and notifications under /notifications.
 * Lives in Settings (the /organizations list page was removed); org
 * workspaces themselves open under /organizations/[id]. */
export function OrganizationsSection() {
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const orgs = useOrgs();
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

      <CreateOrgModal open={createOpen} onClose={() => setCreateOpen(false)}
        onCreate={(p) => mut.createOrg.mutateAsync(p)} />
      <JoinModal open={joinOpen} onClose={() => setJoinOpen(false)}
        onRequest={(id) => mut.requestJoin.mutateAsync(id)} />
    </div>
  );
}
