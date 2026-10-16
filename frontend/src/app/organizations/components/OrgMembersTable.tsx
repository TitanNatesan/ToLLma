"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import {
  Badge, Button, DataTable, type DataTableColumn, DetailPanel, EmptyState,
  ErrorState, LoadingState, SearchInput, Select,
} from "@/components/ui";
import { AssignSetsDialog, ConfirmDialog } from "./Dialogs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMembers, useOrgAnalyticsOverview, useOrgMutations, useOrgSets } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import type { Member } from "@/types/orgs";

const PAGE_SIZE = 15;

function teamNames(m: Member): string[] {
  if (m.teams?.length) return m.teams.map((t) => t.name);
  if (m.team_names?.length) return m.team_names;
  return [];
}

function joinedLabel(m: Member): string {
  const iso = m.joined_at ?? m.created_at;
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
}

function CountList({ items, empty }: { items: string[]; empty?: string }) {
  if (items.length === 0) return <span className="text-zinc-400">{empty ?? "—"}</span>;
  const shown = items.slice(0, 2);
  return (
    <span title={items.join(", ")}>
      {shown.join(", ")}
      {items.length > shown.length && (
        <span className="text-zinc-400"> +{items.length - shown.length} more</span>
      )}
    </span>
  );
}

type SortKey = "email" | "joined" | "keys" | "state";

export function OrgMembersTable({ orgId, canRead, canInvite, canRemove, canSuspend, canAssign, canViewUsage, isRoot, myPermissions, onInvite }: {
  orgId: string;
  canRead: boolean;
  canInvite: boolean;
  canRemove: boolean;
  canSuspend: boolean;
  canAssign: boolean;
  canViewUsage: boolean;
  isRoot: boolean;
  myPermissions: string[];
  onInvite: () => void;
}) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("email");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);
  const [viewing, setViewing] = useState<Member | null>(null);

  const debounced = useDebouncedValue(search.trim(), 300);
  const members = useMembers(orgId, {
    search: debounced || undefined,
    state: state || undefined,
    limit: 200,
    enabled: canRead,
  });

  const rows = useMemo(() => {
    const list = [...(members.data ?? [])];
    const dir = sortDir;
    list.sort((a, b) => {
      if (sortKey === "keys") return ((a.key_count ?? -1) - (b.key_count ?? -1)) * dir;
      if (sortKey === "joined") {
        const ta = a.joined_at ?? a.created_at ?? "";
        const tb = b.joined_at ?? b.created_at ?? "";
        return (ta < tb ? -1 : ta > tb ? 1 : 0) * dir;
      }
      if (sortKey === "state") return a.state.localeCompare(b.state) * dir;
      return a.email.localeCompare(b.email) * dir;
    });
    return list;
  }, [members.data, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  void isRoot;
  void myPermissions;

  if (!canRead) {
    return <EmptyState title="Members" description="You need member-view permission to see organization members." />;
  }

  const columns: DataTableColumn<Member>[] = [
    {
      key: "member", header: "Member",
      render: (m) => (
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-zinc-900 dark:text-zinc-100" data-testid={`org-member-${m.user_id}`}>
            {m.email}
          </span>
          {m.is_root && <Badge>root</Badge>}
        </span>
      ),
    },
    {
      key: "status", header: "Status",
      render: (m) => <Badge variant={m.state === "active" ? "success" : m.state === "suspended" ? "warning" : "outline"}>{m.state}</Badge>,
    },
    { key: "sets", header: "Sets", render: (m) => <CountList items={m.permission_sets} empty="no sets" /> },
    { key: "teams", header: "Teams", render: (m) => <CountList items={teamNames(m)} /> },
    { key: "joined", header: "Joined", render: (m) => <span className="whitespace-nowrap">{joinedLabel(m)}</span> },
    {
      key: "keys", header: "Keys", align: "right",
      render: (m) => (m.key_count === null || m.key_count === undefined ? "—" : String(m.key_count)),
    },
    {
      key: "actions", header: "Actions", align: "right",
      render: (m) => (
        <span className="flex justify-end gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setViewing(m)}
            data-testid={`org-view-${m.user_id}`}>View</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-2.5" data-testid="org-members">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-44 flex-1">
          <SearchInput value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            onClear={() => setSearch("")} placeholder="Search members…" aria-label="Search members"
            data-testid="org-members-search" />
        </div>
        <Select value={state} onChange={(e) => { setState(e.target.value); setPage(0); }} sizeVariant="sm"
          className="w-32" aria-label="Filter by state" data-testid="org-members-state">
          <option value="">All states</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
        <Select value={sortKey} onChange={(e) => { setSortKey(e.target.value as SortKey); setPage(0); }} sizeVariant="sm"
          className="w-32" aria-label="Sort members" data-testid="org-members-sort">
          <option value="email">Email</option>
          <option value="joined">Joined</option>
          <option value="keys">Keys</option>
          <option value="state">Status</option>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setSortDir((d) => (d === 1 ? -1 : 1))}
          aria-label={sortDir === 1 ? "Sort descending" : "Sort ascending"}
          data-testid="org-members-sort-dir">
          <ArrowUpDown className="size-3.5" aria-hidden />
        </Button>
        {canInvite && (
          <Button size="sm" onClick={onInvite} data-testid="org-invite-open">Invite user</Button>
        )}
      </div>

      {members.isLoading && <LoadingState message="Loading members…" />}
      {members.isError && (
        <ErrorState title="Could not load members"
          message={parseApiError(members.error).message}
          onRetry={() => void members.refetch()} />
      )}
      {!members.isLoading && !members.isError && (
        <>
          <p className="text-xs text-zinc-500" data-testid="org-members-count">
            {rows.length} member{rows.length === 1 ? "" : "s"}
            {pageCount > 1 && ` · page ${safePage + 1} of ${pageCount}`}
          </p>
          {rows.length === 0 ? (
            <EmptyState title="No members" description={debounced || state ? "No members match these filters." : ""} />
          ) : (
            <DataTable columns={columns} rows={visible} rowKey={(m) => m.user_id}
              testId="org-members-table" emptyMessage="No members" />
          )}
          {pageCount > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)} data-testid="org-members-prev">Previous</Button>
              <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)} data-testid="org-members-next">Next</Button>
            </div>
          )}
        </>
      )}

      <MemberDetailDrawer orgId={orgId} member={viewing} onClose={() => setViewing(null)}
        canRemove={canRemove} canSuspend={canSuspend} canAssign={canAssign} canViewUsage={canViewUsage} />
    </div>
  );
}

function MemberDetailDrawer({ orgId, member, onClose, canRemove, canSuspend, canAssign, canViewUsage }: {
  orgId: string;
  member: Member | null;
  onClose: () => void;
  canRemove: boolean;
  canSuspend: boolean;
  canAssign: boolean;
  canViewUsage: boolean;
}) {
  const mut = useOrgMutations(orgId);
  const orgSets = useOrgSets(orgId, { limit: 200 });
  const analytics = useOrgAnalyticsOverview(orgId, { enabled: canViewUsage && member !== null });
  const [assigning, setAssigning] = useState(false);
  const [confirm, setConfirm] = useState<"suspend" | "resume" | "remove" | null>(null);

  const open = member !== null;
  const usage = useMemo(() => {
    const rows = analytics.data ? (analytics.data.by_user ?? analytics.data.users ?? analytics.data.by_member ?? analytics.data.members ?? []) : [];
    return rows.find((r) => (r.email ?? r.user_email) === member?.email) ?? null;
  }, [analytics.data, member?.email]);
  const assignedIds = useMemo(() => {
    const names = new Set(member?.permission_sets ?? []);
    return (orgSets.data ?? []).filter((s) => names.has(s.name)).map((s) => s.id);
  }, [orgSets.data, member]);

  async function run(p: Promise<unknown>, ok: string) {
    try {
      await p;
      toast.success(ok);
      onClose();
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  const CONFIRM_COPY = {
    suspend: {
      title: `Suspend ${member?.email}?`,
      label: "Suspend member",
      desc: "They lose access immediately but keep their membership record. Usage history is preserved. You can reactivate them later.",
    },
    resume: {
      title: `Reactivate ${member?.email}?`,
      label: "Reactivate member",
      desc: "Access is restored immediately with their existing permission grants.",
    },
    remove: {
      title: `Remove ${member?.email}?`,
      label: "Remove member",
      desc: "Membership and permission grants are revoked immediately. Future organization access ends. The personal account, personal assets, and historical usage events are untouched.",
    },
  } as const;

  return (
    <>
      <DetailPanel open={open} onClose={onClose} testId="org-member-detail"
        title={member?.email ?? "Member"}
        subtitle={member ? `${member.state}${member.is_root ? " · root" : ""}` : undefined}>
        {member && (
          <div className="space-y-4 text-xs">
            <section>
              <h3 className="mb-1.5 text-xs font-bold">Profile</h3>
              <dl className="space-y-1 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
                <div className="flex justify-between gap-2"><dt className="text-zinc-500">Email</dt><dd className="truncate font-medium">{member.email}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-zinc-500">Status</dt><dd><Badge variant="outline">{member.state}</Badge></dd></div>
                <div className="flex justify-between gap-2"><dt className="text-zinc-500">Joined</dt><dd>{joinedLabel(member)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-zinc-500">API keys</dt><dd className="font-mono">{member.key_count ?? "—"}</dd></div>
              </dl>
            </section>

            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-xs font-bold">Permission sets</h3>
                {canAssign && !member.is_root && (
                  <Button size="sm" variant="outline" onClick={() => setAssigning(true)}
                    data-testid={`org-assign-${member.user_id}`}>Assign sets</Button>
                )}
              </div>
              {member.permission_sets.length === 0 ? (
                <p className="text-zinc-500">No sets assigned.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {member.permission_sets.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-1.5 text-xs font-bold">Teams</h3>
              {teamNames(member).length === 0 ? (
                <p className="text-zinc-500">Not in any team.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {teamNames(member).map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-1.5 text-xs font-bold">Usage</h3>
              {!canViewUsage ? (
                <p className="text-zinc-500">You need analytics permission to view usage.</p>
              ) : analytics.isLoading ? (
                <p className="text-zinc-500">Loading usage…</p>
              ) : usage ? (
                <dl className="space-y-1 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
                  <div className="flex justify-between gap-2"><dt className="text-zinc-500">Requests</dt><dd className="font-mono">{String(usage.requests ?? usage.total_requests ?? "—")}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-zinc-500">Tokens</dt><dd className="font-mono">{String(usage.tokens ?? usage.total_tokens ?? "—")}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-zinc-500">Cost</dt><dd className="font-mono">{String(usage.cost ?? usage.total_cost ?? usage.spend ?? "—")}</dd></div>
                </dl>
              ) : (
                <p className="text-zinc-500">No usage recorded for this member in range.</p>
              )}
            </section>

            {!member.is_root && (
              <section className="rounded-md border border-red-200 p-2.5 dark:border-red-900/60">
                <h3 className="text-xs font-bold text-red-700 dark:text-red-300">Membership actions</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {canSuspend && member.state === "active" && (
                    <Button size="sm" variant="outline" onClick={() => setConfirm("suspend")}
                      data-testid={`org-suspend-${member.user_id}`}>Suspend</Button>
                  )}
                  {canSuspend && member.state === "suspended" && (
                    <Button size="sm" variant="outline" onClick={() => setConfirm("resume")}
                      data-testid={`org-resume-${member.user_id}`}>Reactivate</Button>
                  )}
                  {canRemove && (
                    <Button size="sm" variant="outline" onClick={() => setConfirm("remove")}
                      data-testid={`org-remove-${member.user_id}`}>Remove</Button>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </DetailPanel>

      {member && (
        <AssignSetsDialog open={assigning} email={member.email} sets={orgSets.data ?? []}
          loading={orgSets.isLoading} assigned={assignedIds}
          onClose={() => setAssigning(false)}
          onAssign={(ids) => mut.assignSets.mutateAsync({ userId: member.user_id, setIds: ids })
            .then(() => {
              toast.success("Permission grants updated.");
              setAssigning(false);
            })} />
      )}

      <ConfirmDialog open={confirm !== null} destructive
        title={confirm ? CONFIRM_COPY[confirm].title : ""}
        confirmLabel={confirm ? CONFIRM_COPY[confirm].label : ""}
        testId="org-member-action-dialog"
        description={confirm ? CONFIRM_COPY[confirm].desc : ""}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!member || !confirm) return Promise.resolve();
          const op = confirm === "suspend"
            ? run(mut.suspendMember.mutateAsync(member.user_id), `${member.email} suspended.`)
            : confirm === "resume"
              ? run(mut.resumeMember.mutateAsync(member.user_id), `${member.email} reactivated.`)
              : run(mut.removeMember.mutateAsync(member.user_id), "Member removed.");
          return op.then(() => setConfirm(null));
        }} />
    </>
  );
}
