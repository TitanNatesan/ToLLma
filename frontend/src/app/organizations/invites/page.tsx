"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardContent, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { useMyInvitations, useOrgMutations } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";

/** Landing target for email invitation links (/organizations/invites?token=…). */
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

  const match = (invites.data ?? []).find((i) => i.token === token);

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="org-invites-page">
      <PageHeader title="Invitation" subtitle="Review and respond to your organization invitation." />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {invites.isLoading && <LoadingState />}
        {!invites.isLoading && !match && (
          <EmptyState title="Invitation not found"
            description="It may have expired, been revoked, or belong to a different account." />
        )}
        {match && (
          <Card data-testid="org-invite-landing">
            <CardContent className="flex flex-wrap items-center gap-2 p-4">
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{match.org_name}</span>
                {match.org_slug && (
                  <span className="font-mono text-[11px] text-zinc-500"> /{match.org_slug}</span>
                )}
                <span className="text-zinc-500"> invited you ({match.email}) to join.</span>
              </p>
              <Button size="sm" onClick={() => match.token && void accept(match.token, match.org_name)}
                data-testid="org-invite-landing-accept">
                <Check className="size-3.5" /> Accept
              </Button>
              <Button size="sm" variant="outline" onClick={() => match.token && void reject(match.token)}
                data-testid="org-invite-landing-reject">
                <X className="size-3.5" /> Reject
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
