"use client";

import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogOut, ShieldAlert, ShieldCheck, UsersRound } from "lucide-react";
import { toast } from "@/lib/notify";
import {
  Badge, Button, Card, CardContent, DetailPanel, EmptyState, ErrorState, LoadingState, PageHeader, SectionHeader,
} from "@/components/ui";
import { fmtBudgetAmount } from "@/app/api-keys/components/BudgetBar";
import { InviteModal } from "../components/InviteModal";
import { ConfirmDialog } from "../components/Dialogs";
import { OrgContextSidebar } from "../components/OrgContextSidebar";
import { SidebarPanelPortal } from "@/components/Sidebar/SidebarPanelPortal";
import { EMPTY_MEMBER_FILTERS, OrgMembersFilters, OrgMembersTable, type MemberFilters } from "../components/OrgMembersTable";
import { EMPTY_TEAM_FILTERS, OrgTeamsFilters, OrgTeamsTable } from "../components/OrgTeamsTable";
import type { TeamFilters } from "../components/OrgTeamsTable";
import { EMPTY_SET_FILTERS, OrgSetsFilters, OrgSetsTable, type SetFilters } from "../components/OrgSetsTable";
import {
  EMPTY_INVITATIONS_FILTERS, EMPTY_REQUESTS_FILTERS, OrgInvitationsFilters, OrgOperationsSection,
  OrgRequestsFilters, type InvitationsFilters, type OpsTab, type RequestsFilters,
} from "../components/OrgOperationsSection";
import { EMPTY_AUDIT_FILTERS, OrgAuditFilters, OrgAuditTable, type AuditFilters } from "../components/OrgAuditTable";
import { describeAuditEvent } from "../components/auditDescriptions";
import { OrgSettingsSection, SETTINGS_TABS, isSettingsTab } from "../components/OrgSettingsSection";
import { OrgBudgetCard } from "../components/OrgBudgetCard";
import {
  apiErrorStatus, useJoinRequests, useMembers, useOrg, useOrgAudit, useOrgBudget, useOrgInvitations,
  useOrgMutations, useOrgSets, useTeams,
} from "@/hooks/useOrgs";
import { useOrgStore } from "@/store/org";
import { parseApiError } from "@/lib/errors";
import type { Organization } from "@/types/orgs";
import type { OrgSection } from "@/components/Sidebar/SidebarOrgNav";

const LEGACY_TABS: Record<string, OpsTab> = {
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

const KNOWN_SECTIONS: ReadonlySet<string> = new Set([
  "overview",
  "members",
  "teams",
  "sets",
  "operations",
  "budgets",
  "audit",
  "settings",
  // Legacy sections: the effect below redirects them, never renders them.
  "keys",
  "requests",
  "invitations",
  "providers",
  "analytics",
]);

function OrgDashboardInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const orgId = params.id;
  const rawSection = search.get("section") ?? "overview";
  const section = (KNOWN_SECTIONS.has(rawSection) ? rawSection : "overview") as OrgSection;
  const tabParam = search.get("tab");
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const org = useOrg(orgId);
  const permData = org.data;
  const canMembers = !!permData && (permData.is_root || permData.permissions.includes("Members.Read"));
  const canSets = !!permData && (permData.is_root || permData.permissions.includes("PermissionSets.Read"));
  const canTeams = !!permData && (permData.is_root || permData.permissions.includes("Teams.Read"));
  // Operations covers membership requests + invitations only (API keys live
  // under /api-keys), so Keys.Read alone must not enable those fetches.
  const canOps = !!permData && (permData.is_root || ["Members.Read", "Members.Invite", "Members.Approve", "Members.Update"].some((c) => permData.permissions.includes(c)));
  const members = useMembers(orgId, { enabled: canMembers });
  const sets = useOrgSets(orgId, undefined, { enabled: canSets });
  const invitations = useOrgInvitations(orgId, undefined, { enabled: canOps });
  const requests = useJoinRequests(orgId, undefined, { enabled: canOps });
  const mut = useOrgMutations(orgId);
  const data = org.data;
  const can = (code: string) => !!data && (data.is_root || data.permissions.includes(code));
  const qc = useQueryClient();

  // Section filter state lives here so the same components/state render in the
  // contextual sidebar (vertical) while tables stay focused (no in-header copies).
  // All hooks stay above the early returns (rules-of-hooks).
  const [memberFilters, setMemberFilters] = useState<MemberFilters>(EMPTY_MEMBER_FILTERS);
  const [teamFilters, setTeamFilters] = useState<TeamFilters>(EMPTY_TEAM_FILTERS);
  const [teamCreateOpen, setTeamCreateOpen] = useState(false);
  const [setFilters, setSetFilters] = useState<SetFilters>(EMPTY_SET_FILTERS);
  const [setCreating, setSetCreating] = useState(false);
  const [requestsFilters, setRequestsFilters] = useState<RequestsFilters>(EMPTY_REQUESTS_FILTERS);
  const [invitationsFilters, setInvitationsFilters] = useState<InvitationsFilters>(EMPTY_INVITATIONS_FILTERS);
  const [auditFilters, setAuditFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);

  const teamsQuery = useTeams(orgId, { enabled: canTeams });
  const teamCount = (teamsQuery.data ?? []).length;
  const canAudit = !!data && (data.is_root || data.permissions.includes("Audit.Read"));
  const recentAudit = useOrgAudit(orgId, { limit: 5 }, { enabled: canAudit });
  const canBudget = !!data && (data.is_root || data.permissions.includes("Budgets.Read"));
  const budgetQuery = useOrgBudget(orgId, { enabled: canBudget });
  const setContext = useOrgStore((st) => st.setContext);
  const activeContext = useOrgStore((st) => st.context);
  const orgStatus = org.isError ? apiErrorStatus(org.error) : null;

  // Deep links/bookmarks sync into workspace state once the org resolves.
  useEffect(() => {
    if (data) setContext({ type: "org", orgId: data.id, orgName: data.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  // Reconcile-safe reset on load failure: drop the stale org context only
  // when it points at this URL — never clobber an unrelated context.
  useEffect(() => {
    if (org.isError && activeContext.type === "org" && activeContext.orgId === orgId) {
      setContext({ type: "personal" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.isError, orgId]);

  // Unauthenticated: the refresh-and-retry already failed — go sign in.
  useEffect(() => {
    if (orgStatus === 401) router.replace("/login");
  }, [orgStatus, router]);

  // Section switches don't remount (same page, new searchParam), so queries
  // would otherwise keep serving the previously fetched list. Refetch the
  // governance queries on every section change: two admins acting at once
  // must always see each other's transitions.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["orgs", orgId] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, orgId]);

  // Unknown ?section= values fall back to the overview (shareable, stable
  // testids for known sections).
  useEffect(() => {
    if (rawSection !== section) {
      router.replace(`/organizations/${orgId}?section=overview`);
    }
  }, [rawSection, section, orgId, router]);

  // Legacy ?section=keys|requests|invitations → ?section=operations&tab=…
  // Consolidation: providers, analytics, and org API keys moved to dedicated
  // pages (?section=providers → /providers, ?section=analytics → /analytics,
  // ?section=operations&tab=keys → /api-keys). Context is already org, so the
  // unified pages render org data. Never redirect on error: the error guard
  // below owns that render.
  useEffect(() => {
    if (org.isError) return;
    if (LEGACY_TABS[section]) {
      router.replace(`/organizations/${orgId}?section=operations&tab=${LEGACY_TABS[section]}`);
    } else if (section === "providers") {
      router.replace("/providers");
    } else if (section === "analytics") {
      router.replace("/analytics");
    } else if (section === "operations" && tabParam === "keys") {
      router.replace("/api-keys");
    } else if (section === "keys") {
      router.replace("/api-keys");
    }
  }, [section, tabParam, orgId, router, org.isError]);

  async function run(p: Promise<unknown>, ok: string) {
    try {
      await p;
      toast.success(ok);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  if (org.isLoading) return <LoadingState />;
  if (org.isError || !data) {
    if (orgStatus === 401) return <LoadingState message="Signing you in…" />;
    if (orgStatus === 403) {
      return (
        <div className="flex h-full flex-col items-center justify-center p-6 text-center" data-testid="org-forbidden">
          <EmptyState icon={ShieldAlert} title="You don't have access to this organization"
            description="It exists, but your account isn't a member or lacks permission to view it. Ask an organization admin for an invitation."
            action={
              <Button size="sm" variant="outline" onClick={() => router.push("/settings#organizations")}
                data-testid="org-back">
                <ArrowLeft className="size-3.5" aria-hidden /> Back to organizations
              </Button>
            } />
        </div>
      );
    }
    if (orgStatus === 404) {
      return (
        <ErrorState title="Organization not found"
          message="It may have been deleted, or the link is wrong."
          onRetry={() => void org.refetch()} />
      );
    }
    return (
      <ErrorState title="Could not load organization"
        message={org.error ? parseApiError(org.error).message : undefined}
        onRetry={() => void org.refetch()} />
    );
  }

  if (LEGACY_TABS[section]) return <LoadingState message="Opening operations…" />;
  if (section === "providers") return <LoadingState message="Opening providers…" />;
  if (section === "keys") return <LoadingState message="Opening API keys…" />;
  if (section === "operations" && tabParam === "keys") {
    return <LoadingState message="Opening API keys…" />;
  }

  const titles: Record<string, string> = {
    overview: "Overview", members: "Members", teams: "Teams", sets: "Permission Sets",
    operations: "Operations", budgets: "Budgets",
    audit: "Audit Log", settings: "Settings",
  };

  const initialTab: OpsTab =
    tabParam === "requests" || tabParam === "invitations" ? tabParam : "requests";
  const settingsTab = isSettingsTab(search.get("settingsTab")) ? search.get("settingsTab")! : "profile";

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="org-dashboard">
      <PageHeader
        title={data.name}
        subtitle={<span className="font-mono">/{data.slug}{data.is_root ? " · root" : ""}</span>}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => router.push("/settings#organizations")}
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
        <SectionHeader title={titles[section] ?? "Overview"} className="mb-3"
          action={
            section === "members" && can("Members.Invite") ? (
              <Button size="sm" onClick={() => setInviteOpen(true)} data-testid="org-invite-open">Invite user</Button>
            ) : section === "teams" && can("Teams.Create") ? (
              <Button size="sm" onClick={() => setTeamCreateOpen(true)} data-testid="org-team-create-open">
                <UsersRound className="size-3.5" aria-hidden /> New team
              </Button>
            ) : section === "sets" && can("PermissionSets.Create") ? (
              <Button size="sm" onClick={() => setSetCreating(true)} data-testid="org-set-create">
                <ShieldCheck className="size-3.5" aria-hidden /> New set
              </Button>
            ) : undefined
          } />

        <div className="mt-3 flex flex-col gap-4">
          {section !== "overview" && (
            <SidebarPanelPortal>
            <OrgContextSidebar
              bare
              heading={section === "members" ? "Member filters"
                : section === "teams" ? "Team filters"
                : section === "sets" ? "Set filters"
                : section === "operations" ? "Operations"
                : section === "audit" ? "Audit filters"
                : section === "settings" ? "Settings"
                : section === "budgets" ? "Budget summary" : section}
              testId={`org-sidebar-${section}`}
              storageKey={`org-context-sidebar-collapsed-${section}`}>
              {section === "members" && (
                <OrgMembersFilters value={memberFilters} onChange={setMemberFilters} layout="vertical" />
              )}
              {section === "teams" && (
                <OrgTeamsFilters value={teamFilters} onChange={setTeamFilters} layout="vertical" />
              )}
              {section === "sets" && (
                <OrgSetsFilters value={setFilters} onChange={setSetFilters} layout="vertical" />
              )}
              {section === "operations" && (
                <>
                  <nav aria-label="Operations" className="flex flex-col gap-1" data-testid="org-ops-tabs">
                    {([
                      { id: "requests", label: "Requests", count: (requests.data ?? []).filter((r) => r.status === "pending").length },
                      { id: "invitations", label: "Invitations", count: (invitations.data ?? []).filter((i) => i.status === "pending").length },
                    ] as const).map((t) => (
                      <Link key={t.id} href={`/organizations/${orgId}?section=operations&tab=${t.id}`}
                        id={`org-ops-tabbtn-${t.id}`} data-testid={`org-ops-tab-${t.id}`}
                        aria-current={initialTab === t.id ? "page" : undefined}
                        className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 ${initialTab === t.id
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"}`}>
                        <span>{t.label}</span>
                        <Badge variant="secondary" className="font-mono text-[10px]">{t.count}</Badge>
                      </Link>
                    ))}
                  </nav>
                  {initialTab === "requests" ? (
                    <OrgRequestsFilters value={requestsFilters} onChange={setRequestsFilters} />
                  ) : (
                    <OrgInvitationsFilters value={invitationsFilters} onChange={setInvitationsFilters} />
                  )}
                </>
              )}
              {section === "audit" && (
                <OrgAuditFilters value={auditFilters} onChange={setAuditFilters} layout="vertical" />
              )}
              {section === "settings" && (
                <nav aria-label="Organization settings" className="flex flex-col gap-1">
                  {SETTINGS_TABS.map((id) => (
                    <Link key={id} href={`/organizations/${orgId}?section=settings&settingsTab=${id}`}
                      id={`org-settings-tabbtn-${id}`} data-testid={`org-settings-tab-${id}`}
                      aria-current={settingsTab === id ? "page" : undefined}
                      className={`rounded-md px-2.5 py-2 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 ${settingsTab === id
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"}`}>
                      {id === "danger" ? "Danger zone" : id}
                    </Link>
                  ))}
                </nav>
              )}
              {section === "budgets" && <BudgetSidebar budget={budgetQuery.data} canRead={canBudget} />}
            </OrgContextSidebar>
            </SidebarPanelPortal>
          )}

          <div className="min-w-0 flex-1">
            {section === "overview" && (
              <div className="flex flex-col gap-4">
                <div className="min-w-0 flex-1">
                  <Overview org={data} memberCount={(members.data ?? []).length}
                    teamCount={teamCount}
                    pendingInvites={(invitations.data ?? []).filter((i) => i.status === "pending").length}
                    pendingRequests={(requests.data ?? []).filter((r) => r.status === "pending").length}
                    setCount={(sets.data ?? []).length} />
                </div>
                <SidebarPanelPortal>
                <OrgContextSidebar heading="Organization" testId="org-sidebar-overview" bare
                  storageKey="org-context-sidebar-collapsed-overview">
                  <nav aria-label="Quick links" className="flex flex-col gap-1">
                    {[
                      { href: `/organizations/${orgId}?section=members`, label: "Members", testId: "org-overview-link-members", show: canMembers },
                      { href: `/organizations/${orgId}?section=teams`, label: "Teams", testId: "org-overview-link-teams", show: canTeams },
                      { href: `/organizations/${orgId}?section=sets`, label: "Permission sets", testId: "org-overview-link-sets", show: canSets },
                      { href: `/organizations/${orgId}?section=operations`, label: "Operations", testId: "org-overview-link-operations", show: canOps },
                      { href: `/organizations/${orgId}?section=budgets`, label: "Budgets", testId: "org-overview-link-budgets", show: canBudget },
                      { href: `/organizations/${orgId}?section=audit`, label: "Audit log", testId: "org-overview-link-audit", show: canAudit },
                    ].filter((l) => l.show).map((l) => (
                      <Link key={l.href} href={l.href} data-testid={l.testId}
                        className="rounded-md px-2.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                        {l.label}
                      </Link>
                    ))}
                  </nav>
                  {canAudit && (
                    <div>
                      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Recent activity
                      </h3>
                      {recentAudit.isLoading ? (
                        <p className="text-xs text-zinc-500">Loading activity…</p>
                      ) : (recentAudit.data ?? []).length === 0 ? (
                        <p className="text-xs text-zinc-500">No recorded activity yet.</p>
                      ) : (
                        <ul className="flex flex-col gap-1" data-testid="org-overview-audit">
                          {(recentAudit.data ?? []).slice(0, 5).map((e) => {
                            const desc = describeAuditEvent(e.action, (e.target ?? {}) as Record<string, unknown>);
                            return (
                              <li key={e.id} className="rounded-md border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-800">
                                <p className="truncate font-medium text-zinc-900 dark:text-zinc-100" title={desc.title}>{desc.title}</p>
                                <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-400" title={e.action}>{e.action}</p>
                                <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                                  {(() => { try { return new Date(e.created_at).toLocaleString(); } catch { return e.created_at; } })()}
                                </p>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </OrgContextSidebar>
                </SidebarPanelPortal>
              </div>
            )}

            {section === "members" && (
              <OrgMembersTable orgId={orgId}
                canRead={can("Members.Read")}
                canInvite={can("Members.Invite")}
                canRemove={can("Members.Remove")} canSuspend={can("Members.Suspend")}
                canAssign={can("PermissionSets.Assign")}
                canViewUsage={data.is_root || can("Analytics.ViewUsage") || can("Organization.ViewAnalytics")}
                isRoot={data.is_root} myPermissions={data.permissions}
                onInvite={() => setInviteOpen(true)}
                filters={memberFilters} onFilters={setMemberFilters} hideFilters />
            )}

            {section === "teams" && (
              <OrgTeamsTable orgId={orgId} members={members.data ?? []} sets={sets.data ?? []}
                isRoot={data.is_root} myPermissions={data.permissions}
                canManageLogging={data.is_root || data.permissions.includes("PromptLogs.Manage")}
                canReadAudit={data.is_root || can("Audit.Read")}
                perms={{
                  canRead: can("Teams.Read"),
                  canCreate: can("Teams.Create"),
                  canUpdate: can("Teams.Update"),
                  canDelete: can("Teams.Delete"),
                  canAddMembers: can("Teams.AssignMembers"),
                  canRemoveMembers: can("Teams.RemoveMembers"),
                  canAssignSets: can("Teams.AssignPermissionSets"),
                }}
                filters={teamFilters} onFilters={setTeamFilters} hideFilters
                createOpen={teamCreateOpen} onCreateOpen={setTeamCreateOpen} />
            )}

            {section === "sets" && (
              <OrgSetsTable orgId={orgId} canRead={can("PermissionSets.Read")}
                canCreate={can("PermissionSets.Create")} canUpdate={can("PermissionSets.Update")}
                canDelete={can("PermissionSets.Delete")}
                filters={setFilters} onFilters={setSetFilters} hideFilters
                creating={setCreating} onCreating={setSetCreating} />
            )}

            {section === "operations" && (
              <OrgOperationsSection key={initialTab} orgId={orgId} members={members.data ?? []}
                initialTab={initialTab}
                perms={{
                  canCreateKeys: can("Keys.Create"),
                  canReadKeys: data.is_root || can("Keys.Read"),
                  canRevokeKeys: can("Keys.Revoke") || can("Keys.Delete"),
                  canInvite: can("Members.Invite"),
                  canReadInvitations: data.is_root || can("Members.Read"),
                  canReviewRequests: data.is_root || can("Members.Approve") || can("Members.Update"),
                }}
                requestsFilters={requestsFilters} onRequestsFilters={setRequestsFilters}
                invitationsFilters={invitationsFilters} onInvitationsFilters={setInvitationsFilters}
                hideFilters />
            )}

            {section === "audit" && (
              <OrgAuditTable orgId={orgId} canRead={can("Audit.Read")}
                filters={auditFilters} onFilters={setAuditFilters} hideFilters />
            )}

            {section === "settings" && (
              <OrgSettingsSection orgId={orgId} org={data} canManage={can("Organization.Settings")} />
            )}

            {section === "budgets" && (
              <OrgBudgetCard orgId={orgId}
                canRead={data.is_root || can("Budgets.Read")}
                canEdit={data.is_root || can("Budgets.Update")} />
            )}
          </div>
        </div>
      </div>


      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} orgId={orgId}
        sets={sets.data ?? []} myPermissions={data.permissions} isRoot={data.is_root}
        onInvite={(email, setIds) => mut.invite.mutateAsync({ email, setIds })} />

      <ConfirmDialog open={leaving} title="Leave this organization?"
        confirmLabel="Leave organization" testId="org-leave-dialog"
        description="Your membership ends immediately. Your personal account and assets are unaffected."
        onClose={() => setLeaving(false)}
        onConfirm={() => run(
          mut.leave.mutateAsync(orgId).then(() => router.push("/settings#organizations")),
          "You left the organization.",
        ).then(() => setLeaving(false))} />
    </div>
  );
}

function Stat({ label, value, testId, onOpen }: { label: string; value: number; testId?: string; onOpen?: () => void }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-3.5">
        <button type="button" onClick={onOpen} disabled={!onOpen}
          aria-label={onOpen ? `Open ${label} summary` : undefined}
          className={onOpen ? "block w-full cursor-pointer rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60" : "block w-full text-left"}>
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
          {onOpen && <p className="mt-0.5 text-[11px] text-tollma-600 dark:text-tollma-400">View summary</p>}
        </button>
      </CardContent>
    </Card>
  );
}

const STAT_COPY: Record<string, { text: string; href: (orgId: string) => string; cta: string }> = {
  Members: { text: "Active memberships, roles, and permission grants. Suspend, remove, or reassign sets from the Members section.", href: (id) => `/organizations/${id}?section=members`, cta: "Open Members" },
  "Pending invitations": { text: "Outstanding invites awaiting signup. Resend or revoke them from Operations.", href: (id) => `/organizations/${id}?section=operations`, cta: "Open Operations" },
  "Join requests": { text: "Membership requests awaiting review. Approve or reject them from Operations.", href: (id) => `/organizations/${id}?section=operations`, cta: "Open Operations" },
  Teams: { text: "Groups of members that share permission grants. Create a team or manage membership from Teams.", href: (id) => `/organizations/${id}?section=teams`, cta: "Open Teams" },
  "Permission sets": { text: "Reusable grant bundles assigned to members and teams. Clone or edit them from Permission Sets.", href: (id) => `/organizations/${id}?section=sets`, cta: "Open Permission Sets" },
};

/** Read-only budget summary for the budgets sidebar (cap editing stays in main). */
function BudgetSidebar({ budget, canRead }: {
  budget: import("@/types/orgs").OrgBudget | undefined;
  canRead: boolean;
}) {
  function money(v: number | string | null | undefined): string {
    if (v === null || v === undefined || v === "") return "—";
    const n = typeof v === "string" ? Number(v) : v;
    if (!Number.isFinite(n)) return "—";
    return fmtBudgetAmount(n);
  }
  if (!canRead) {
    return <p className="text-xs text-zinc-500">You need budget-read permission to view pools.</p>;
  }
  const cap = budget ? (budget.max_spend ?? budget.max_budget_usd ?? budget.cap) : undefined;
  return (
    <dl className="flex flex-col gap-2 text-xs" data-testid="org-budget-sidebar">
      {[
        ["Cap", money(cap ?? null)],
        ["Allocated", money(budget?.allocated ?? null)],
        ["Unallocated", money(budget?.unallocated ?? null)],
      ].map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
          <dt className="text-zinc-500">{k}</dt>
          <dd className="font-mono text-[11px]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Overview({ org, memberCount, teamCount, pendingInvites, pendingRequests, setCount }: {
  org: Organization; memberCount: number; teamCount: number; pendingInvites: number; pendingRequests: number; setCount: number;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const copy = summary ? STAT_COPY[summary] : null;
  return (
    <div data-testid="org-overview">
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Members" value={memberCount} testId="org-stat-members" onOpen={() => setSummary("Members")} />
        <Stat label="Teams" value={teamCount} testId="org-stat-teams" onOpen={() => setSummary("Teams")} />
        <Stat label="Pending invitations" value={pendingInvites} testId="org-stat-invites" onOpen={() => setSummary("Pending invitations")} />
        <Stat label="Join requests" value={pendingRequests} testId="org-stat-requests" onOpen={() => setSummary("Join requests")} />
        <Stat label="Permission sets" value={setCount} testId="org-stat-sets" onOpen={() => setSummary("Permission sets")} />
      </div>
      <DetailPanel open={summary !== null} onClose={() => setSummary(null)} testId="org-overview-summary"
        title={summary ?? "Summary"}
        actions={copy ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={copy.href(org.id)}>{copy.cta}</Link>
          </Button>
        ) : undefined}>
        {copy && <p className="text-xs text-zinc-600 dark:text-zinc-300">{copy.text}</p>}
      </DetailPanel>
      <Card className="mt-2.5">
        <CardContent className="space-y-1 p-3.5 text-xs">
          {org.description ? <p className="break-words">{org.description}</p> : <p className="text-zinc-500">No description set.</p>}
          <p className="break-words text-zinc-500">
            {[org.industry, org.location, org.size].filter(Boolean).join(" · ") || "No profile details."}
          </p>
        </CardContent>
      </Card>
      {(pendingInvites > 0 || pendingRequests > 0) && (
        <EmptyState title="Pending attention"
          description={`${pendingInvites} pending invitation${pendingInvites === 1 ? "" : "s"} · ${pendingRequests} pending request${pendingRequests === 1 ? "" : "s"}.`}
          action={
            <a href="?section=operations" className="text-xs font-medium text-tollma-600 hover:underline dark:text-tollma-400" data-testid="org-overview-ops-link">
              Review in Operations
            </a>
          } />
      )}
    </div>
  );
}
