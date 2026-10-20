"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowUpDown, Loader2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import {
  Badge, Button, Card, CardContent, Checkbox, DataTable, type DataTableColumn,
  DetailPanel, Dialog, DialogContent, DialogDescription, DialogTitle,
  EmptyState, ErrorState, Field, Input, LoadingState, SearchInput, Select,
} from "@/components/ui";
import { ConfirmDialog } from "./Dialogs";
import { PermissionSetPicker, PickerReview } from "./PermissionSetPicker";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { isForbiddenError, useOrgAudit, useOrgMutations, usePermissionCatalog, useTeam, useTeamMutations, useTeams } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import { ApiError } from "@/services/api";
import { PERMISSION_GROUPS, type Member, type PermissionSet, type Team } from "@/types/orgs";

const PAGE_SIZE = 15;

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

function isForbidden(e: unknown): boolean {
  return isForbiddenError(e);
}

function dateLabel(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
}

/** code → human label from the server catalog (local fallback); unknown codes render as-is. */
function useLabelMap(): Map<string, string> {
  const catalog = usePermissionCatalog();
  const groups = catalog.data ?? PERMISSION_GROUPS;
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const p of g.permissions) m.set(p.code, p.label);
    return m;
  }, [groups]);
}

/** Compact permission summary: human labels first, codes never invented. Summary counts + expand, never badge walls. */
function PermissionSummary({ codes, labels }: { codes: string[]; labels: Map<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  if (codes.length === 0) return <span className="text-[11px] text-zinc-400">no permissions</span>;
  const shown = expanded ? codes : codes.slice(0, 3);
  return (
    <span>
      <span className="flex flex-wrap gap-1">
        {shown.map((c) => (
          <Badge key={c} variant="outline" className="text-[10px]" title={c}>
            {labels.get(c) ?? c}
          </Badge>
        ))}
      </span>
      {codes.length > 3 && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] font-medium text-zinc-500 underline-offset-2 hover:underline">
          {expanded ? "show less" : `+${codes.length - 3} more (${codes.length} total)`}
        </button>
      )}
    </span>
  );
}

export interface TeamPerms {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canAddMembers: boolean;
  canRemoveMembers: boolean;
  canAssignSets: boolean;
}

type SortKey = "name" | "members" | "created";

export function OrgTeamsTable({ orgId, members, sets, perms, isRoot, myPermissions, canReadAudit }: {
  orgId: string;
  members: Member[];
  sets: PermissionSet[];
  perms: TeamPerms;
  isRoot: boolean;
  myPermissions: string[];
  canReadAudit: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [managing, setManaging] = useState<string | null>(null);

  const debounced = useDebouncedValue(search.trim(), 300);
  const teams = useTeams(orgId, {
    enabled: perms.canRead,
    params: { include: "members,sets", search: debounced || undefined, limit: 200 },
  });
  const labels = useLabelMap();

  const rows = useMemo(() => {
    const list = [...(teams.data ?? [])];
    list.sort((a, b) => {
      const d = sortDir;
      if (sortKey === "members") return (a.member_count - b.member_count) * d;
      if (sortKey === "created") return ((a.created_at < b.created_at ? -1 : 1)) * d;
      return a.name.localeCompare(b.name) * d;
    });
    return list;
  }, [teams.data, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (!perms.canRead) {
    return <EmptyState title="Teams" description="You need team-view permission to see organization teams." />;
  }

  const columns: DataTableColumn<Team>[] = [
    {
      key: "name", header: "Name",
      render: (t) => (
        <span className="min-w-0">
          <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100" data-testid={`org-team-${t.id}`} title={t.name}>{t.name}</span>
          {t.description && <span className="block truncate text-[11px] text-zinc-400" title={t.description ?? undefined}>{t.description}</span>}
        </span>
      ),
    },
    { key: "members", header: "Members", align: "right", render: (t) => String(t.member_count) },
    {
      key: "sets", header: "Sets", align: "right",
      render: (t) => String(t.sets?.length ?? t.set_count ?? "—"),
    },
    { key: "created", header: "Created", render: (t) => <span className="whitespace-nowrap">{dateLabel(t.created_at)}</span> },
    { key: "updated", header: "Updated", render: (t) => <span className="whitespace-nowrap">{dateLabel(t.updated_at)}</span> },
    {
      key: "actions", header: "Actions", align: "right",
      render: (t) => (
        <Button size="sm" variant="outline" onClick={() => setManaging(t.id)}
          data-testid={`org-team-manage-${t.id}`}>Manage</Button>
      ),
    },
  ];

  return (
    <div className="space-y-2.5" data-testid="org-teams">
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
        <div className="min-w-44 flex-1">
          <SearchInput value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            onClear={() => setSearch("")} placeholder="Search teams…" aria-label="Search teams"
            data-testid="org-teams-search" />
        </div>
        <Select value={sortKey} onChange={(e) => { setSortKey(e.target.value as SortKey); setPage(0); }} sizeVariant="sm"
          className="w-32" aria-label="Sort teams" data-testid="org-teams-sort">
          <option value="name">Name</option>
          <option value="members">Members</option>
          <option value="created">Created</option>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setSortDir((d) => (d === 1 ? -1 : 1))}
          aria-label={sortDir === 1 ? "Sort descending" : "Sort ascending"}>
          <ArrowUpDown className="size-3.5" aria-hidden />
        </Button>
        {perms.canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="org-team-create-open">
            <UsersRound className="size-3.5" aria-hidden /> New team
          </Button>
        )}
      </div>

      {teams.isLoading && <LoadingState message="Loading teams…" />}
      {teams.isError && isForbidden(teams.error) && (
        <EmptyState title="Teams unavailable" testId="org-teams-forbidden"
          description="You need Teams.Read permission to view organization teams. Members and settings are unaffected." />
      )}
      {teams.isError && isNotFound(teams.error) && (
        <div data-testid="org-teams-unavailable">
          <ErrorState title="Teams not found"
            message={parseApiError(teams.error).message}
            onRetry={() => void teams.refetch()} />
        </div>
      )}
      {teams.isError && !isNotFound(teams.error) && !isForbidden(teams.error) && (
        <ErrorState title="Could not load teams"
          message={parseApiError(teams.error).message}
          onRetry={() => void teams.refetch()} />
      )}
      {!teams.isLoading && !teams.isError && rows.length === 0 && (
        <EmptyState title="No teams" testId="org-teams-empty"
          description={debounced ? "No teams match this search." : "Create a team to group members and grant permission sets together."}
          action={perms.canCreate && !debounced ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="org-team-create-open-empty">
              Create team
            </Button>
          ) : undefined} />
      )}
      {rows.length > 0 && (
        <>
          <p className="text-xs text-zinc-500">
            {rows.length} team{rows.length === 1 ? "" : "s"}
            {pageCount > 1 && ` · page ${safePage + 1} of ${pageCount}`}
          </p>
          <DataTable columns={columns} rows={visible} rowKey={(t) => t.id} testId="org-teams-table" />
          {pageCount > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      {createOpen && (
        <TeamCreateDialog orgId={orgId} sets={sets} canAssignSets={perms.canAssignSets}
          isRoot={isRoot} myPermissions={myPermissions}
          onClose={() => setCreateOpen(false)} />
      )}

      <TeamDetailDrawer orgId={orgId} teamId={managing} members={members} sets={sets}
        perms={perms} labels={labels} isRoot={isRoot} myPermissions={myPermissions}
        canReadAudit={canReadAudit} onClose={() => setManaging(null)} />
    </div>
  );
}

function TeamCreateDialog({ orgId, sets, canAssignSets, isRoot, myPermissions, onClose }: {
  orgId: string;
  sets: PermissionSet[];
  canAssignSets: boolean;
  isRoot: boolean;
  myPermissions: string[];
  onClose: () => void;
}) {
  const mut = useTeamMutations(orgId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await mut.createTeam.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        setIds: canAssignSets && picked.length > 0 ? picked : undefined,
      });
      toast.success(`Team "${name.trim()}" created.`);
      onClose();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(n) => { if (!n && !busy) onClose(); }}>
      <DialogContent className="max-w-md p-4" data-testid="org-team-dialog">
        <DialogTitle className="text-sm font-semibold">New team</DialogTitle>
        <DialogDescription>Group members and grant permission sets together.</DialogDescription>
        <div className="mt-3 space-y-3">
          {!reviewing ? (
            <>
              <Field label="Team name">
                <Input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. On-call" maxLength={80} data-testid="org-team-name" />
              </Field>
              <Field label="Description (optional)">
                <Input value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this team for?" maxLength={300} data-testid="org-team-description" />
              </Field>
              {canAssignSets && (
                <Field label="Permission sets">
                  <PermissionSetPicker orgId={orgId} sets={sets} selected={picked}
                    onChange={setPicked} myPermissions={myPermissions} isRoot={isRoot}
                    testIdPrefix="org-team" />
                </Field>
              )}
              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button size="sm" onClick={() => setReviewing(true)} disabled={busy || name.trim().length < 2}
                  data-testid="org-team-review">
                  Review team
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2 text-xs">
                <p><span className="text-zinc-500">Name:</span> <strong>{name.trim()}</strong></p>
                {description.trim() && <p><span className="text-zinc-500">Description:</span> {description.trim()}</p>}
                <PickerReview sets={sets} selected={picked} />
              </div>
              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setReviewing(false)} disabled={busy}>
                  <ArrowLeft className="size-3.5" aria-hidden /> Back
                </Button>
                <Button size="sm" onClick={() => void submit()} disabled={busy}
                  data-testid="org-team-submit">
                  {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Create team
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TeamDetailDrawer({ orgId, teamId, members, sets, perms, labels, isRoot, myPermissions, canReadAudit, onClose }: {
  orgId: string;
  teamId: string | null;
  members: Member[];
  sets: PermissionSet[];
  perms: TeamPerms;
  labels: Map<string, string>;
  isRoot: boolean;
  myPermissions: string[];
  canReadAudit: boolean;
  onClose: () => void;
}) {
  const open = teamId !== null;
  const detail = useTeam(orgId, teamId ?? "", { enabled: open });

  return (
    <DetailPanel open={open} onClose={onClose} testId="org-team-detail" width={440}
      title={detail.data?.name ?? "Team"}
      subtitle={detail.data ? `${detail.data.member_count} member${detail.data.member_count === 1 ? "" : "s"}` : undefined}>
      {detail.isLoading && <LoadingState message="Loading team…" />}
      {detail.isError && isForbidden(detail.error) && (
        <EmptyState title="Team unavailable"
          description="You need Teams.Read permission to view this team." />
      )}
      {detail.isError && isNotFound(detail.error) && (
        <ErrorState title="Team not found"
          message={parseApiError(detail.error).message}
          onRetry={() => void detail.refetch()} />
      )}
      {detail.isError && !isNotFound(detail.error) && !isForbidden(detail.error) && (
        <ErrorState title="Could not load team"
          message={parseApiError(detail.error).message}
          onRetry={() => void detail.refetch()} />
      )}
      {detail.data && (
        <TeamDetailBody key={detail.data.id} orgId={orgId} team={detail.data}
          members={members} sets={sets} perms={perms} labels={labels}
          isRoot={isRoot} myPermissions={myPermissions} canReadAudit={canReadAudit} />
      )}
    </DetailPanel>
  );
}

function TeamDetailBody({ orgId, team, members, sets, perms, labels, isRoot, myPermissions, canReadAudit }: {
  orgId: string;
  team: Team;
  members: Member[];
  sets: PermissionSet[];
  perms: TeamPerms;
  labels: Map<string, string>;
  isRoot: boolean;
  myPermissions: string[];
  canReadAudit: boolean;
}) {
  const mut = useTeamMutations(orgId);
  const audit = useOrgAudit(orgId, canReadAudit ? { limit: 100 } : undefined);
  const teamMembers = team.members ?? [];
  const assignedIds = useMemo(() => new Set((team.sets ?? []).map((s) => s.id)), [team.sets]);

  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState("");
  const [removing, setRemoving] = useState<{ user_id: string; email: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([...assignedIds]);
  const [savingSets, setSavingSets] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const mine = useMemo(() => new Set(myPermissions), [myPermissions]);
  const delegable = useMemo(
    () => (isRoot ? sets : sets.filter((s) => s.permissions.every((c) => mine.has(c)))),
    [isRoot, sets, mine],
  );
  const activity = useMemo(() => {
    if (!canReadAudit || !audit.data) return null;
    const needle = [team.id, team.name.toLowerCase()];
    return audit.data.filter((a) => {
      const hay = `${a.action} ${JSON.stringify(a.target ?? {}).toLowerCase()}`;
      return needle.some((n) => n && hay.includes(n.toLowerCase()));
    }).slice(0, 8);
  }, [canReadAudit, audit.data, team.id, team.name]);

  const candidates = members.filter((m) => !teamMembers.some((t) => t.user_id === m.user_id));
  const dirty = name.trim() !== team.name || (description.trim() || "") !== (team.description ?? "");
  const setsDirty = picked.length !== assignedIds.size || picked.some((id) => !assignedIds.has(id));

  async function save() {
    setSaving(true);
    try {
      await mut.updateTeam.mutateAsync({
        teamId: team.id,
        payload: { name: name.trim(), description: description.trim() || null },
      });
      toast.success("Team updated.");
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    if (!adding) return;
    try {
      await mut.addMember.mutateAsync({ teamId: team.id, userId: adding });
      toast.success("Member added to team.");
      setAdding("");
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  async function saveSets() {
    setSavingSets(true);
    try {
      await mut.replaceSets.mutateAsync({ teamId: team.id, setIds: picked });
      toast.success("Team permission sets updated.");
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setSavingSets(false);
    }
  }

  return (
    <div className="space-y-5 text-xs">
      <section>
        <h3 className="mb-1.5 text-xs font-bold">Overview</h3>
        {perms.canUpdate ? (
          <div className="space-y-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)}
                maxLength={80} data-testid="org-team-edit-name" />
            </Field>
            <Field label="Description">
              <Input value={description} onChange={(e) => setDescription(e.target.value)}
                maxLength={300} data-testid="org-team-edit-description" />
            </Field>
            <div className="flex items-center gap-3 text-[11px] text-zinc-500">
              <span>Created {dateLabel(team.created_at)}</span>
              <span>Updated {dateLabel(team.updated_at)}</span>
            </div>
            <Button size="sm" onClick={() => void save()}
              disabled={saving || !dirty || name.trim().length < 2}
              data-testid="org-team-edit-save">
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save changes
            </Button>
          </div>
        ) : (
          <>
            <p className="text-zinc-500">{team.description || "No description set."}</p>
            <p className="mt-1 text-[11px] text-zinc-400">
              Created {dateLabel(team.created_at)} · Updated {dateLabel(team.updated_at)}
            </p>
          </>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-bold">Members ({teamMembers.length})</h3>
        {perms.canAddMembers && (
          <div className="mb-2 flex gap-2">
            <Select value={adding} onChange={(e) => setAdding(e.target.value)}
              data-testid="org-team-member-select" aria-label="Add org member to team">
              <option value="">Select an org member…</option>
              {candidates.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.email}</option>
              ))}
            </Select>
            <Button size="sm" onClick={() => void add()} disabled={!adding}
              data-testid="org-team-member-add">
              Add
            </Button>
          </div>
        )}
        {teamMembers.length === 0 && <p className="text-zinc-500">No members in this team yet.</p>}
        {teamMembers.map((m) => (
          <Card key={m.user_id} data-testid={`org-team-member-${m.user_id}`} className="mb-1.5">
            <CardContent className="flex flex-wrap items-center gap-2 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold" title={m.email}>{m.email}</p>
                <Badge variant="outline" className="mt-0.5">{m.state}</Badge>
              </div>
              {perms.canRemoveMembers && (
                <Button size="sm" variant="outline"
                  onClick={() => setRemoving({ user_id: m.user_id, email: m.email })}
                  data-testid={`org-team-member-remove-${m.user_id}`}>
                  Remove
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-bold">Permission sets</h3>
        <p className="mb-1.5 text-[11px] text-zinc-400">
          Team sets grant every member at once. Direct member grants are managed from the member drawer.
        </p>
        {perms.canAssignSets ? (
          <>
            <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
              {delegable.map((s) => (
                <label key={s.id} data-testid={`org-team-set-assign-${s.id}`}
                  className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={picked.includes(s.id)}
                    onChange={() => setPicked((v) =>
                      v.includes(s.id) ? v.filter((x) => x !== s.id) : [...v, s.id])} />
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-400">{s.permissions.length}</span>
                </label>
              ))}
              {delegable.length === 0 && <p className="text-zinc-500">No sets available.</p>}
            </div>
            <Button size="sm" className="mt-2" onClick={() => void saveSets()}
              disabled={savingSets || !setsDirty} data-testid="org-team-sets-save">
              {savingSets && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Save sets ({picked.length})
            </Button>
          </>
        ) : (
          <div className="flex flex-wrap gap-1">
            {(team.sets ?? []).map((s) => <Badge key={s.id} variant="secondary">{s.name}</Badge>)}
            {(team.sets ?? []).length === 0 && <p className="text-zinc-500">No permission sets assigned.</p>}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-bold">Effective permissions</h3>
        {(team.sets ?? []).length > 0 ? (
          <div className="space-y-1.5">
            {team.sets!.map((s) => (
              <div key={s.id} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <p className="font-medium">{s.name} <span className="font-mono font-normal text-zinc-400">({s.codes.length})</span></p>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                  {s.codes.slice(0, 6).join(", ")}{s.codes.length > 6 ? ` +${s.codes.length - 6} more` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <PermissionSummary codes={team.codes ?? []} labels={labels} />
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-bold">Activity</h3>
        {!canReadAudit ? (
          <p className="text-zinc-500">You need audit-read permission to view team activity.</p>
        ) : audit.isLoading ? (
          <p className="text-zinc-500">Loading activity…</p>
        ) : !activity || activity.length === 0 ? (
          <p className="text-zinc-500">No recorded activity for this team.</p>
        ) : (
          <ul className="space-y-1">
            {activity.map((a) => (
              <li key={a.id} className="rounded-md border border-zinc-200 p-2 font-mono text-[11px] dark:border-zinc-800">
                <span className="font-semibold">{a.action}</span>
                <span className="text-zinc-500"> · {dateLabel(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {perms.canDelete && (
        <section className="rounded-md border border-red-200 p-2.5 dark:border-red-900/60">
          <h3 className="text-xs font-bold text-red-700 dark:text-red-300">Danger zone</h3>
          <p className="mt-0.5 text-zinc-500">
            Deleting removes the team and its grants immediately. Members keep their organization membership.
          </p>
          <Button size="sm" variant="destructive" className="mt-2"
            onClick={() => setDeleting(true)} data-testid="org-team-delete">
            Delete team
          </Button>
        </section>
      )}

      <ConfirmDialog open={removing !== null} title={`Remove ${removing?.email} from this team?`}
        confirmLabel="Remove from team" testId="org-team-member-remove-dialog"
        description="The member loses this team's grants immediately. Their organization membership is unaffected."
        onClose={() => setRemoving(null)}
        onConfirm={() => removing
          ? mut.removeMember.mutateAsync({ teamId: team.id, userId: removing.user_id }).then(() => {
            toast.success("Member removed from team.");
            setRemoving(null);
          })
          : Promise.resolve()} />

      <ConfirmDialog open={deleting} title={`Delete team "${team.name}"?`} destructive
        confirmLabel="Delete team" testId="org-team-delete-dialog"
        description="The team and its permission grants are removed immediately. Members keep their organization membership. This cannot be undone."
        onClose={() => setDeleting(false)}
        onConfirm={() => mut.deleteTeam.mutateAsync(team.id).then(() => {
          toast.success("Team deleted.");
          setDeleting(false);
        })} />
    </div>
  );
}
