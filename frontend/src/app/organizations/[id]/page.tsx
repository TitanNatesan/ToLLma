"use client";

import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, LogOut } from "lucide-react";
import { toast } from "sonner";
import {
  Button, Card, CardContent, EmptyState, ErrorState, LoadingState, PageHeader, SectionHeader,
} from "@/components/ui";
import { InviteModal } from "../components/InviteModal";
import { ConfirmDialog } from "../components/Dialogs";
import { OrgMembersTable } from "../components/OrgMembersTable";
import { OrgTeamsTable } from "../components/OrgTeamsTable";
import { OrgSetsTable } from "../components/OrgSetsTable";
import { OrgOperationsSection, type OpsTab } from "../components/OrgOperationsSection";
import { OrgProvidersSection } from "../components/OrgProvidersSection";
import { OrgAnalyticsDashboard } from "../components/OrgAnalyticsDashboard";
import { OrgAuditTable } from "../components/OrgAuditTable";
import { OrgSettingsSection } from "../components/OrgSettingsSection";
import { OrgBudgetCard } from "../components/OrgBudgetCard";
import { useJoinRequests, useMembers, useOrg, useOrgInvitations, useOrgMutations, useOrgSets } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import type { Organization } from "@/types/orgs";
import type { OrgSection } from "@/components/Sidebar/SidebarOrgNav";

const LEGACY_TABS: Record<string, OpsTab> = {
  keys: "keys",
  requests: "requests",
  invitations: "invitations",
};

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
  const tabParam = search.get("tab");
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const org = useOrg(orgId);
  const members = useMembers(orgId);
  const sets = useOrgSets(orgId);
  const invitations = useOrgInvitations(orgId);
  const requests = useJoinRequests(orgId);
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

  // Legacy ?section=keys|requests|invitations → ?section=operations&tab=…
  useEffect(() => {
    if (LEGACY_TABS[section]) {
      router.replace(`/organizations/${orgId}?section=operations&tab=${LEGACY_TABS[section]}`);
    }
  }, [section, orgId, router]);

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

  if (LEGACY_TABS[section]) return <LoadingState message="Opening operations…" />;

  const titles: Record<string, string> = {
    overview: "Overview", members: "Members", teams: "Teams", sets: "Permission Sets",
    providers: "Providers", operations: "Operations", budgets: "Budgets",
    analytics: "Analytics", audit: "Audit Log", settings: "Settings",
  };

  const initialTab: OpsTab =
    tabParam === "requests" || tabParam === "invitations" || tabParam === "keys" ? tabParam : "keys";

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
        <SectionHeader title={titles[section] ?? "Overview"} className="mb-3" />

        {section === "overview" && (
          <Overview org={data} memberCount={(members.data ?? []).length}
            pendingInvites={(invitations.data ?? []).filter((i) => i.status === "pending").length}
            pendingRequests={(requests.data ?? []).filter((r) => r.status === "pending").length}
            setCount={(sets.data ?? []).length} />
        )}

        {section === "members" && (
          <OrgMembersTable orgId={orgId}
            canRead={can("Members.Read")}
            canInvite={can("Members.Invite")}
            canRemove={can("Members.Remove")} canSuspend={can("Members.Suspend")}
            canAssign={can("PermissionSets.Assign")}
            canViewUsage={data.is_root || can("Analytics.ViewUsage") || can("Organization.ViewAnalytics")}
            isRoot={data.is_root} myPermissions={data.permissions}
            onInvite={() => setInviteOpen(true)} />
        )}

        {section === "teams" && (
          <OrgTeamsTable orgId={orgId} members={members.data ?? []} sets={sets.data ?? []}
            isRoot={data.is_root} myPermissions={data.permissions}
            canReadAudit={data.is_root || can("Audit.Read")}
            perms={{
              canRead: can("Teams.Read"),
              canCreate: can("Teams.Create"),
              canUpdate: can("Teams.Update"),
              canDelete: can("Teams.Delete"),
              canAddMembers: can("Teams.AssignMembers"),
              canRemoveMembers: can("Teams.RemoveMembers"),
              canAssignSets: can("Teams.AssignPermissionSets"),
            }} />
        )}

        {section === "sets" && (
          <OrgSetsTable orgId={orgId} canRead={can("PermissionSets.Read")}
            canCreate={can("PermissionSets.Create")} canUpdate={can("PermissionSets.Update")}
            canDelete={can("PermissionSets.Delete")} />
        )}

        {section === "operations" && (
          <OrgOperationsSection key={initialTab} orgId={orgId} members={members.data ?? []}
            initialTab={initialTab}
            perms={{
              canCreateKeys: can("Keys.Create"),
              canReadKeys: data.is_root || can("Keys.Read"),
              canRevokeKeys: can("Keys.Revoke") || can("Keys.Delete"),
              canInvite: can("Members.Invite"),
              canReviewRequests: data.is_root || can("Members.Approve") || can("Members.Update"),
            }} />
        )}

        {section === "audit" && <OrgAuditTable orgId={orgId} canRead={can("Audit.Read")} />}

        {section === "settings" && (
          <OrgSettingsSection orgId={orgId} org={data} canManage={can("Organization.Settings")} />
        )}

        {section === "providers" && (
          <OrgProvidersSection orgId={orgId} orgName={data.name}
            canManage={data.is_root || can("Providers.Create") || can("Providers.Update")}
            canRead={data.is_root || can("Providers.Read")} />
        )}

        {section === "analytics" && (
          <OrgAnalyticsDashboard orgId={orgId}
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
      </div>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} orgId={orgId}
        sets={sets.data ?? []} myPermissions={data.permissions} isRoot={data.is_root}
        onInvite={(email, setIds) => mut.invite.mutateAsync({ email, setIds })} />

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
      {(pendingInvites > 0 || pendingRequests > 0) && (
        <EmptyState title="Pending attention"
          description={`${pendingInvites} pending invitation${pendingInvites === 1 ? "" : "s"} · ${pendingRequests} pending request${pendingRequests === 1 ? "" : "s"}. Review them under Operations.`} />
      )}
    </div>
  );
}
