"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { useMyInvitations, useOrgMutations } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import type { Invitation } from "@/types/orgs";

function inviterOf(i: Invitation): string | null {
  const by = i.invited_by;
  if (by && typeof by === "object") return by.name || by.email || null;
  if (typeof by === "string" && by) return i.invited_by_name || i.invited_by_email || by;
  if (i.inviter && typeof i.inviter === "object") return i.inviter.name || i.inviter.email || null;
  return i.invited_by_name || i.invited_by_email || null;
}

function setsOf(i: Invitation): Array<{ name: string; codes: string[] }> {
  const from = i.permission_sets ?? i.set_details;
  if (Array.isArray(from) && from.length > 0) {
    return from.map((s) =>
      typeof s === "string"
        ? { name: s, codes: [] }
        : { name: s.name, codes: s.codes ?? ("permissions" in s && Array.isArray((s as { permissions?: unknown }).permissions)
          ? (s as { permissions: string[] }).permissions : []) },
    );
  }
  if (Array.isArray(i.set_names) && i.set_names.length > 0) {
    return i.set_names.map((n) => ({ name: n, codes: [] }));
  }
  return [];
}

function expiryOf(i: Invitation): string {
  try {
    return new Date(i.expires_at).toLocaleString();
  } catch {
    return i.expires_at;
  }
}

/** Authenticated landing target after login/signup with ?invite= (email links go to /invite/[token]). */
export default function InvitesPage() {
  return (
    <Suspense>
      <InvitesInner />
    </Suspense>
  );
}

function InvitesInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const invites = useMyInvitations();
  const mut = useOrgMutations();

  async function accept(t: string, name: string) {
    try {
      const org = await mut.acceptInvite.mutateAsync(t);
      toast.success(`Joined ${org.name || name}.`);
      router.push(`/organizations/${org.id}`);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  async function reject(t: string) {
    try {
      await mut.rejectInvite.mutateAsync(t);
      toast.success("Invitation declined.");
      router.push("/organizations");
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  const list = invites.data ?? [];
  const match = token ? list.find((i) => i.token === token) : undefined;
  const others = token ? list.filter((i) => i.token !== token && i.status === "pending") : list;

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="org-invites-page">
      <PageHeader title="Invitation" subtitle="Review and respond to your organization invitation." />
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
        {invites.isLoading && <LoadingState />}
        {!invites.isLoading && token && !match && (
          <EmptyState title="Invitation not found"
            description="It may have expired, been revoked, or belong to a different account." />
        )}
        {!invites.isLoading && !token && list.length === 0 && (
          <EmptyState title="No invitations"
            description="You have no pending organization invitations." />
        )}
        {match && (
          <InviteCard invite={match} highlight
            onAccept={() => match.token && void accept(match.token, match.org_name)}
            onReject={() => match.token && void reject(match.token)} />
        )}
        {!invites.isLoading && others.length > 0 && (
          <div className="space-y-2">
            {token && <h2 className="text-xs font-bold text-zinc-500">Other pending invitations</h2>}
            {others.map((i) => (
              <InviteCard key={i.id} invite={i}
                onAccept={() => i.token && void accept(i.token, i.org_name)}
                onReject={() => i.token && void reject(i.token)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InviteCard({ invite, highlight, onAccept, onReject }: {
  invite: Invitation;
  highlight?: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const inviter = inviterOf(invite);
  const sets = setsOf(invite);
  return (
    <Card data-testid={highlight ? "org-invite-landing" : `org-invite-${invite.id}`}>
      <CardContent className="space-y-2.5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{invite.org_name}</span>
            {invite.org_slug && (
              <span className="font-mono text-[11px] text-zinc-500"> /{invite.org_slug}</span>
            )}
            <span className="text-zinc-500"> invited you ({invite.email}) to join.</span>
          </p>
          <Button size="sm" onClick={onAccept} disabled={!invite.token}
            data-testid={highlight ? "org-invite-landing-accept" : `org-invite-accept-${invite.id}`}>
            <Check className="size-3.5" /> Accept
          </Button>
          <Button size="sm" variant="outline" onClick={onReject} disabled={!invite.token}
            data-testid={highlight ? "org-invite-landing-reject" : `org-invite-reject-${invite.id}`}>
            <X className="size-3.5" /> Reject
          </Button>
        </div>
        <dl className="space-y-1 text-xs text-zinc-500">
          {inviter && (
            <div className="flex gap-1.5" data-testid={highlight ? "org-invite-landing-inviter" : `org-invite-inviter-${invite.id}`}>
              <dt className="shrink-0 font-medium">Invited by:</dt>
              <dd>{inviter}</dd>
            </div>
          )}
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium">Expires:</dt>
            <dd className="font-mono text-[11px]"
              data-testid={highlight ? "org-invite-landing-expiry" : `org-invite-expiry-${invite.id}`}>
              {expiryOf(invite)}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium">Status:</dt>
            <dd><Badge variant="outline">{invite.status}</Badge></dd>
          </div>
        </dl>
        <div data-testid={highlight ? "org-invite-landing-sets" : `org-invite-sets-${invite.id}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Permission sets</p>
          {sets.length === 0 ? (
            <p className="mt-1 text-xs text-zinc-500">Default member access — no sets listed.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {sets.map((s) => (
                <li key={s.name} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                  <p className="text-xs font-semibold">{s.name}</p>
                  {s.codes.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.codes.map((c) => (
                        <Badge key={c} variant="secondary" className="font-mono text-[10px]">{c}</Badge>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
