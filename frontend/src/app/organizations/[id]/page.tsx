"use client";

import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, LogOut, UserMinus } from "lucide-react";
import { toast } from "sonner";
import {
  Badge, Button, Card, CardContent, EmptyState, ErrorState, LoadingState, PageHeader,
} from "@/components/ui";
import { InviteModal } from "../components/InviteModal";
import { SetManager } from "../components/SetManager";
import { AssignSetsDialog, ConfirmDialog } from "../components/Dialogs";
import { OrgKeysSection } from "../components/OrgKeysSection";
import { OrgProvidersSection } from "../components/OrgProvidersSection";
import { OrgAnalyticsSection } from "../components/OrgAnalyticsSection";
import { OrgBudgetCard } from "../components/OrgBudgetCard";
import { useJoinRequests, useMembers, useOrg, useOrgAudit,
  useOrgInvitations, useOrgMutations, useOrgSets,
} from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import type { Member, Organization } from "@/types/orgs";
import type { OrgSection } from "@/components/Sidebar/SidebarOrgNav";

export default function OrgDashboardPage() {
  return (
    <Suspense>
      <OrgDashboardInner />
    </Suspense>
  );
}

function OrgDashboardInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const orgId = params.id;
  const section = (search.get("section") ?? "overview") as OrgSection;
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [assigning, setAssigning] = useState<Member | null>(null);
  const [leaving, setLeaving] = useState(false);
  const org = useOrg(orgId);
  const members = useMembers(orgId);
  const sets = useOrgSets(orgId);
  const invitations = useOrgInvitations(orgId);
  const requests = useJoinRequests(orgId);
  const audit = useOrgAudit(orgId);
  const mut = useOrgMutations(orgId);
  const data = org.data;
  const can = (code: string) => !!data && (data.is_root || data.permissions.includes(code));
  const qc = useQueryClient();

  // Section switches don't remount (same page, new searchParam), so queries
  // would otherwise keep serving the previously fetched list. Refetch the
  // governance queries on every section change: two admins acting at once
  // must always see each other's transitions.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["orgs", orgId] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, orgId]);

  async function run(p: Promise<unknown>, ok: string) {
    try {
      await p;
      toast.success(ok);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  if (org.isLoading) return <LoadingState />;
  if (org.isError || !data) return <ErrorState />;

  const titles: Record<string, string> = {
    overview: "Overview", members: "Members", sets: "Permission Sets",
    invitations: "Invitations", requests: "Join Requests", audit: "Audit Log", settings: "Settings",
    teams: "Teams", providers: "Providers", keys: "API Keys", budgets: "Budgets", analytics: "Analytics",
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="org-dashboard">
      <PageHeader
        title={data.name}
        subtitle={<span className="font-mono">/{data.slug}{data.is_root ? " · root" : ""}</span>}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => router.push("/organizations")}
              data-testid="org-back">
              <ArrowLeft className="size-3.5" aria-hidden /> All organizations
            </Button>
            {!data.is_root && (
              <Button size="sm" variant="outline" onClick={() => setLeaving(true)}
                data-testid="org-leave">
                <LogOut className="size-3.5" aria-hidden /> Leave
              </Button>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid={`org-section-${section}`}>
        <h2 className="mb-3 text-sm font-bold">{titles[section] ?? "Overview"}</h2>

        {section === "overview" && (
          <Overview org={data} memberCount={(members.data ?? []).length}
            pendingInvites={(invitations.data ?? []).filter((i) => i.status === "pending").length}
            pendingRequests={(requests.data ?? []).length} setCount={(sets.data ?? []).length} />
        )}

        {section === "members" && (
          <MembersSection members={members.data ?? []} canInvite={can("Members.Invite")}
            canRemove={can("Members.Remove")} canSuspend={can("Members.Suspend")}
            canAssign={can("PermissionSets.Assign")}
            onInvite={() => setInviteOpen(true)} onAssign={setAssigning} onRemove={setRemoving}
            onSuspend={(m) => void run(mut.suspendMember.mutateAsync(m.user_id), `${m.email} suspended.`)}
            onResume={(m) => void run(mut.resumeMember.mutateAsync(m.user_id), `${m.email} reactivated.`)} />
        )}

        {section === "invitations" && (
          <InvitationsSection orgId={orgId} canManage={can("Members.Invite")} />
        )}

        {section === "requests" && (
          <RequestsSection orgId={orgId}
            canReview={data.is_root || can("Members.Approve") || can("Members.Update")} />
        )}

        {section === "sets" && (
          <SetManager sets={sets.data ?? []} canRead={can("PermissionSets.Read")}
            canCreate={can("PermissionSets.Create")} canUpdate={can("PermissionSets.Update")}
            canDelete={can("PermissionSets.Delete")} isRoot={data.is_root}
            onCreate={(p) => mut.createSet.mutateAsync(p)}
            onUpdate={(id, payload) => mut.updateSet.mutateAsync({ setId: id, payload })}
            onDelete={(id) => mut.deleteSet.mutateAsync(id)}
            onClone={(id, name) => mut.cloneSet.mutateAsync({ setId: id, name })} />
        )}

        {section === "audit" && <AuditSection orgId={orgId} canRead={can("Audit.Read")} />}

        {section === "settings" && (
          <SettingsSection orgId={orgId} org={data} canManage={can("Organization.Settings")} />
        )}

        {section === "keys" && (
          <OrgKeysSection orgId={orgId} members={members.data ?? []}
            canCreate={can("Keys.Create")} canRead={data.is_root || can("Keys.Read")}
            canRevoke={can("Keys.Revoke") || can("Keys.Delete")} />
        )}

        {section === "providers" && (
          <OrgProvidersSection orgId={orgId}
            canManage={data.is_root || can("Providers.Create") || can("Providers.Update")}
            canRead={data.is_root || can("Providers.Read")} />
        )}

        {section === "analytics" && (
          <OrgAnalyticsSection orgId={orgId}
            canView={data.is_root || can("Analytics.ViewUsage") || can("Organization.ViewAnalytics")}
            canSeeCost={data.is_root || can("Analytics.ViewCost")}
            canReadBudget={data.is_root || can("Budgets.Read")}
            canEditBudget={data.is_root || can("Budgets.Update")} />
        )}

        {section === "budgets" && (
          <OrgBudgetCard orgId={orgId}
            canRead={data.is_root || can("Budgets.Read")}
            canEdit={data.is_root || can("Budgets.Update")} />
        )}

        {section === "teams" && (
          <EmptyState title="Teams arrives in a later phase"
            description="The navigation reserves this module so nothing needs redesigning when it lands." />
        )}
      </div>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} sets={sets.data ?? []}
        onInvite={(email, setIds) => mut.invite.mutateAsync({ email, setIds })} />

      <ConfirmDialog open={removing !== null} title={`Remove ${removing?.email}?`} destructive
        confirmLabel="Remove member" testId="org-remove-dialog"
        description="Membership and permission grants are revoked immediately. Future organization access ends. The personal account, personal assets, and historical usage events are untouched."
        onClose={() => setRemoving(null)}
        onConfirm={() => removing
          ? run(mut.removeMember.mutateAsync(removing.user_id), "Member removed.")
              .then(() => setRemoving(null))
          : Promise.resolve()} />

      <AssignSetsDialog open={assigning !== null} email={assigning?.email ?? ""}
        sets={sets.data ?? []} loading={sets.isLoading}
        assigned={(assigning && (sets.data ?? [])
          .filter((s) => assigning.permission_sets.includes(s.name)).map((s) => s.id)) ?? []}
        onClose={() => setAssigning(null)}
        onAssign={(ids) => assigning
          ? mut.assignSets.mutateAsync({ userId: assigning.user_id, setIds: ids })
              .then(() => {
                toast.success("Permission grants updated.");
                setAssigning(null);
              })
          : Promise.resolve()} />

      <ConfirmDialog open={leaving} title="Leave this organization?"
        confirmLabel="Leave organization" testId="org-leave-dialog"
        description="Your membership ends immediately. Your personal account and assets are unaffected."
        onClose={() => setLeaving(false)}
        onConfirm={() => run(
          mut.leave.mutateAsync(orgId).then(() => router.push("/organizations")),
          "You left the organization.",
        ).then(() => setLeaving(false))} />
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: number; testId?: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-3.5">
        <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function Overview({ org, memberCount, pendingInvites, pendingRequests, setCount }: {
  org: Organization; memberCount: number; pendingInvites: number; pendingRequests: number; setCount: number;
}) {
  return (
    <div data-testid="org-overview">
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Members" value={memberCount} testId="org-stat-members" />
        <Stat label="Pending invitations" value={pendingInvites} testId="org-stat-invites" />
        <Stat label="Join requests" value={pendingRequests} testId="org-stat-requests" />
        <Stat label="Permission sets" value={setCount} testId="org-stat-sets" />
      </div>
      <Card className="mt-2.5">
        <CardContent className="space-y-1 p-3.5 text-xs">
          {org.description ? <p>{org.description}</p> : <p className="text-zinc-500">No description set.</p>}
          <p className="text-zinc-500">
            {[org.industry, org.location, org.size].filter(Boolean).join(" · ") || "No profile details."}
          </p>
          <p className="font-mono text-[11px] text-zinc-400">
            visibility: {org.visibility_mode} · sharing enforced: {String(org.personal_sharing_enforced)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function MembersSection({ members, canInvite, canRemove, canSuspend, canAssign, onInvite, onAssign, onRemove, onSuspend, onResume }: {
  members: Member[]; canInvite: boolean; canRemove: boolean; canSuspend: boolean; canAssign: boolean;
  onInvite: () => void; onAssign: (m: Member) => void; onRemove: (m: Member) => void;
  onSuspend: (m: Member) => void; onResume: (m: Member) => void;
}) {
  return (
    <div className="space-y-2" data-testid="org-members">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">{members.length} member{members.length === 1 ? "" : "s"}</p>
        {canInvite && (
          <Button size="sm" onClick={onInvite} data-testid="org-invite-open">Invite user</Button>
        )}
      </div>
      {members.map((m) => (
        <Card key={m.user_id} data-testid={`org-member-${m.user_id}`}>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{m.email}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {m.is_root && <Badge>root</Badge>}
                <Badge variant="outline">{m.state}</Badge>
                {m.permission_sets.map((s) => (
                  <Badge key={s} variant="secondary">{s}</Badge>
                ))}
              </div>
            </div>
            {!m.is_root && (
              <div className="flex gap-1.5">
                {canAssign && (
                  <Button size="sm" variant="outline" onClick={() => onAssign(m)}
                    data-testid={`org-assign-${m.user_id}`}>Assign sets</Button>
                )}
                {canSuspend && m.state === "active" && (
                  <Button size="sm" variant="outline" onClick={() => onSuspend(m)}
                    data-testid={`org-suspend-${m.user_id}`}>Suspend</Button>
                )}
                {canSuspend && m.state === "suspended" && (
                  <Button size="sm" variant="outline" onClick={() => onResume(m)}
                    data-testid={`org-resume-${m.user_id}`}>Reactivate</Button>
                )}
                {canRemove && (
                  <Button size="sm" variant="outline" onClick={() => onRemove(m)}
                    data-testid={`org-remove-${m.user_id}`}>
                    <UserMinus className="size-3.5" aria-hidden /> Remove
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      {members.length === 0 && <EmptyState title="No members" description="" />}
    </div>
  );
}

function InvitationsSection({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const invitations = useOrgInvitations(orgId);
  const mut = useOrgMutations(orgId);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function run(p: Promise<unknown>, ok: string) {
    try {
      await p;
      toast.success(ok);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  return (
    <div className="space-y-2" data-testid="org-invitations">
      {(invitations.data ?? []).map((i) => (
        <Card key={i.id} data-testid={`org-inv-${i.id}`}>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{i.email}</p>
              <p className="font-mono text-[11px] text-zinc-500">
                {i.kind} · {i.status} · expires {new Date(i.expires_at).toLocaleString()}
              </p>
            </div>
            <Badge variant="outline">{i.status}</Badge>
            {i.status === "pending" && canManage && (
              <>
                <Button size="sm" variant="outline" onClick={() => void run(
                  mut.resendInvite.mutateAsync(i.id), "Invitation resent with a fresh link.")}
                  data-testid={`org-inv-resend-${i.id}`}>Resend</Button>
                <Button size="sm" variant="outline" onClick={() => setRevoking(i.id)}
                  data-testid={`org-inv-cancel-${i.id}`}>Revoke</Button>
              </>
            )}
          </CardContent>
        </Card>
      ))}
      {(invitations.data ?? []).length === 0 && <EmptyState title="No invitations" description="" />}
      <ConfirmDialog open={revoking !== null} title="Revoke this invitation?" destructive
        confirmLabel="Revoke invitation" testId="org-inv-revoke-dialog"
        description="The invitation link stops working immediately. You can invite the same address again."
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking
          ? run(mut.cancelInvite.mutateAsync(revoking), "Invitation revoked.").then(() => setRevoking(null))
          : Promise.resolve()} />
    </div>
  );
}

function RequestsSection({ orgId, canReview }: { orgId: string; canReview: boolean }) {
  const requests = useJoinRequests(orgId);
  const mut = useOrgMutations(orgId);
  const orgSets = useOrgSets(orgId);
  const [reviewing, setReviewing] = useState<{ id: string; email: string } | null>(null);

  async function run(p: Promise<unknown>, ok: string) {
    try {
      await p;
      toast.success(ok);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  if (!canReview) {
    return <EmptyState title="Join requests" description="You need request-approval permission to review." />;
  }

  return (
    <div className="space-y-2" data-testid="org-requests">
      {(requests.data ?? []).map((r) => (
        <Card key={r.id} data-testid={`org-req-${r.id}`}>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <p className="min-w-0 flex-1 truncate text-xs font-semibold">{r.email}</p>
            <Button size="sm" onClick={() => setReviewing({ id: r.id, email: r.email })}
              data-testid={`org-req-approve-${r.id}`}>Approve</Button>
            <Button size="sm" variant="outline"
              onClick={() => void run(mut.rejectRequest.mutateAsync(r.id), "Request rejected.")}
              data-testid={`org-req-reject-${r.id}`}>Reject</Button>
          </CardContent>
        </Card>
      ))}
      {(requests.data ?? []).length === 0 && <EmptyState title="No join requests" description="" />}
      <AssignSetsDialog open={reviewing !== null} email={reviewing?.email ?? ""}
        sets={orgSets.data ?? []} loading={orgSets.isLoading} assigned={[]} testId="org-approve-dialog"
        onClose={() => setReviewing(null)}
        onAssign={(ids) => reviewing
          ? mut.approveRequest.mutateAsync({ invitationId: reviewing.id, setIds: ids })
              .then(() => {
                toast.success("Request approved.");
                setReviewing(null);
              })
          : Promise.resolve()} />
    </div>
  );
}

function AuditSection({ orgId, canRead }: { orgId: string; canRead: boolean }) {
  const audit = useOrgAudit(orgId);
  if (!canRead) {
    return <EmptyState title="Audit log" description="You need audit-read permission to view." />;
  }
  return (
    <div className="space-y-1.5" data-testid="org-audit">
      {(audit.data ?? []).map((a) => (
        <Card key={a.id}>
          <CardContent className="p-2.5 font-mono text-[11px]">
            <span className="font-semibold">{a.action}</span>
            <span className="text-zinc-500"> · {new Date(a.created_at).toLocaleString()}</span>
          </CardContent>
        </Card>
      ))}
      {(audit.data ?? []).length === 0 && <EmptyState title="No audit events" description="" />}
    </div>
  );
}

function SettingsSection({ orgId, org, canManage }: { orgId: string; org: Organization; canManage: boolean }) {
  const mut = useOrgMutations(orgId);
  const [busy, setBusy] = useState(false);
  const [confirmSharing, setConfirmSharing] = useState(false);

  async function save(payload: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      await mut.updateOrg.mutateAsync(payload);
      toast.success(ok);
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-2.5" data-testid="org-settings">
      <Card>
        <CardContent className="p-4">
          <h3 className="text-xs font-bold">Privacy</h3>
          <p className="mt-0.5 text-xs text-zinc-500">Controls what the organization sees of member conversations.</p>
          <div className="mt-3 flex gap-1.5" role="radiogroup" aria-label="Conversation visibility">
            {(["metadata_only", "full_conversation_access"] as const).map((m) => (
              <Button key={m} size="sm" variant={org.visibility_mode === m ? "default" : "outline"}
                disabled={busy || !canManage}
                onClick={() => void save({ visibility_mode: m }, "Visibility mode updated. Members notified.")}
                data-testid={`org-vis-${m}`}>
                {m === "metadata_only" ? "Metadata Only" : "Full Conversation Access"}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Metadata Only shares user, model, provider, tokens, costs, and timestamps — never message content.
            Full access additionally reveals prompts, responses, and attachments, and every read is audit-logged.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold">Personal Usage Sharing</h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                Off by default. When enabled, members must share personal usage metadata. Members are notified on change.
              </p>
            </div>
            <Button size="sm" variant={org.personal_sharing_enforced ? "default" : "outline"}
              disabled={busy || !canManage}
              onClick={() => {
                if (!org.personal_sharing_enforced) {
                  setConfirmSharing(true);
                  return;
                }
                void save({ personal_sharing_enforced: false }, "Sharing enforcement disabled.");
              }} data-testid="org-enforce-toggle">
              {org.personal_sharing_enforced ? "Enforced" : "Off"}
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            </Button>
          </div>
          {!canManage && (
            <p className="mt-2 text-[11px] text-zinc-400">You need organization-settings permission to change this.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1 p-4 text-xs">
          <h3 className="text-xs font-bold">Organization Metadata</h3>
          <p><span className="text-zinc-500">Name:</span> {org.name} <span className="font-mono text-[11px] text-zinc-400">/{org.slug}</span></p>
          <p><span className="text-zinc-500">Description:</span> {org.description || "—"}</p>
          <p><span className="text-zinc-500">Industry:</span> {org.industry || "—"}</p>
          <p><span className="text-zinc-500">Website:</span> {org.website || "—"}</p>
          <p><span className="text-zinc-500">Location:</span> {org.location || "—"}</p>
        </CardContent>
      </Card>

      <Card className="border-red-200 dark:border-red-900/60">
        <CardContent className="p-4">
          <h3 className="text-xs font-bold text-red-700 dark:text-red-300">Danger Zone</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Root transfer, suspension, and deletion arrive in a later phase. These actions stay disabled until then.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled title="Available in a later phase">Transfer Root</Button>
            <Button size="sm" variant="outline" disabled title="Available in a later phase">Suspend Organization</Button>
            <Button size="sm" variant="destructive" disabled title="Available in a later phase">Delete Organization</Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog open={confirmSharing} title="Enable Personal Usage Sharing?"
        confirmLabel="Enable Sharing" testId="org-sharing-dialog"
        description="Members will be notified that personal usage metadata will be shared with this organization. Message content stays private."
        onClose={() => setConfirmSharing(false)}
        onConfirm={() => save({ personal_sharing_enforced: true }, "Sharing enforcement enabled.")
          .then(() => setConfirmSharing(false))} />
    </div>
  );
}
