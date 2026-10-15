"use client";

import { useMemo, useState } from "react";
import { Loader2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import {
  Badge, Button, Card, CardContent, Checkbox, Dialog, DialogContent,
  DialogDescription, DialogTitle, EmptyState, ErrorState, Field, Input,
  LoadingState, Select,
} from "@/components/ui";
import { ConfirmDialog } from "./Dialogs";
import { usePermissionCatalog, useTeam, useTeamMutations, useTeams } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import { ApiError } from "@/services/api";
import { PERMISSION_GROUPS, type Member, type PermissionSet, type Team } from "@/types/orgs";

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

function createdLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
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

/** Compact permission summary: human labels first, codes never invented. */
function PermissionSummary({ codes, labels }: { codes: string[]; labels: Map<string, string> }) {
  if (codes.length === 0) return <span className="text-[11px] text-zinc-400">no permissions</span>;
  const shown = codes.slice(0, 5);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((c) => (
        <Badge key={c} variant="outline" className="text-[10px]" title={c}>
          {labels.get(c) ?? c}
        </Badge>
      ))}
      {codes.length > shown.length && (
        <Badge variant="secondary" className="text-[10px]">+{codes.length - shown.length} more</Badge>
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

export function OrgTeamsSection({ orgId, members, sets, perms, isRoot, myPermissions }: {
  orgId: string;
  /** Org member list source (useMembers) — team adds come from here only. */
  members: Member[];
  sets: PermissionSet[];
  perms: TeamPerms;
  isRoot: boolean;
  /** Caller's effective permission codes; sets granting more are hidden (backend re-validates). */
  myPermissions: string[];
}) {
  const teams = useTeams(orgId, { enabled: perms.canRead });
  const mut = useTeamMutations(orgId);
  const labels = useLabelMap();
  const [createOpen, setCreateOpen] = useState(false);
  const [managing, setManaging] = useState<string | null>(null);

  // Sets the caller may delegate: every granted code must be within their own.
  const mine = useMemo(() => new Set(myPermissions), [myPermissions]);
  const delegable = useMemo(
    () => (isRoot ? sets : sets.filter((s) => s.permissions.every((c) => mine.has(c)))),
    [isRoot, sets, mine],
  );
  const hiddenCount = sets.length - delegable.length;

  if (!perms.canRead) {
    return <EmptyState title="Teams" description="You need team-view permission to see organization teams." />;
  }

  return (
    <div className="space-y-2" data-testid="org-teams">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          {teams.data ? `${teams.data.length} team${teams.data.length === 1 ? "" : "s"}` : "Organization teams"}
        </p>
        {perms.canCreate && (
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="org-team-create-open">
            <UsersRound className="size-3.5" aria-hidden /> New team
          </Button>
        )}
      </div>

      {teams.isLoading && <LoadingState message="Loading teams…" />}
      {teams.isError && isNotFound(teams.error) && (
        <EmptyState title="Teams aren't available" testId="org-teams-unavailable"
          description="This may mean you don't have team access, or the teams service is still rolling out. Members and settings are unaffected." />
      )}
      {teams.isError && !isNotFound(teams.error) && (
        <ErrorState title="Could not load teams"
          message={parseApiError(teams.error).message}
          onRetry={() => void teams.refetch()} />
      )}
      {!teams.isLoading && !teams.isError && (teams.data ?? []).length === 0 && (
        <EmptyState title="No teams" testId="org-teams-empty"
          description="Create a team to group members and grant permission sets together."
          action={perms.canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="org-team-create-open-empty">
              Create team
            </Button>
          ) : undefined} />
      )}
      {(teams.data ?? []).map((t) => (
        <Card key={t.id} data-testid={`org-team-${t.id}`}>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{t.name}</p>
              {t.description ? (
                <p className="mt-0.5 truncate text-[11px] text-zinc-400">{t.description}</p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {t.member_count} member{t.member_count === 1 ? "" : "s"} · created {createdLabel(t.created_at)}
              </p>
              <div className="mt-1.5">
                <PermissionSummary codes={t.codes ?? []} labels={labels} />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setManaging(t.id)}
              data-testid={`org-team-manage-${t.id}`}>
              Manage
            </Button>
          </CardContent>
        </Card>
      ))}

      {createOpen && (
        <TeamCreateDialog
          delegable={delegable} hiddenCount={hiddenCount} canAssignSets={perms.canAssignSets}
          onClose={() => setCreateOpen(false)}
          onCreate={async (p) => {
            await mut.createTeam.mutateAsync(p);
            toast.success(`Team "${p.name}" created.`);
            setCreateOpen(false);
          }} />
      )}

      <TeamDetailDialog
        orgId={orgId} teamId={managing} members={members}
        delegable={delegable} hiddenCount={hiddenCount}
        perms={perms} labels={labels}
        onClose={() => setManaging(null)} />
    </div>
  );
}

function TeamCreateDialog({ delegable, hiddenCount, canAssignSets, onClose, onCreate }: {
  delegable: PermissionSet[];
  hiddenCount: number;
  canAssignSets: boolean;
  onClose: () => void;
  onCreate: (p: { name: string; description?: string; setIds?: string[] }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        setIds: canAssignSets && picked.length > 0 ? picked : undefined,
      });
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
          <Field label="Team name">
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. On-call" maxLength={80} data-testid="org-team-name" />
          </Field>
          <Field label="Description (optional)">
            <Input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this team for?" maxLength={300} data-testid="org-team-description" />
          </Field>
          {canAssignSets && (
            <Field label="Permission sets (optional — replace-all later from Manage)">
              <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
                {delegable.map((s) => (
                  <label key={s.id} data-testid={`org-team-set-opt-${s.id}`}
                    className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-400">{s.permissions.length}</span>
                  </label>
                ))}
                {delegable.length === 0 && <p className="text-xs text-zinc-500">No sets available.</p>}
              </div>
              {hiddenCount > 0 && (
                <p className="mt-1 text-[11px] text-zinc-400">
                  {hiddenCount} set{hiddenCount === 1 ? "" : "s"} hidden — {hiddenCount === 1 ? "it grants" : "they grant"} permissions beyond yours.
                </p>
              )}
            </Field>
          )}
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => void submit()} disabled={busy || name.trim().length < 2}
              data-testid="org-team-submit">
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Create team
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TeamDetailDialog({ orgId, teamId, members, delegable, hiddenCount, perms, labels, onClose }: {
  orgId: string;
  teamId: string | null;
  members: Member[];
  delegable: PermissionSet[];
  hiddenCount: number;
  perms: TeamPerms;
  labels: Map<string, string>;
  onClose: () => void;
}) {
  const open = teamId !== null;
  const detail = useTeam(orgId, teamId ?? "", { enabled: open });

  if (!open) return null;

  return (
    <Dialog open onOpenChange={(n) => { if (!n) onClose(); }}>
      <DialogContent className="max-w-lg p-4" data-testid="org-team-detail">
        {detail.isLoading && <LoadingState message="Loading team…" />}
        {detail.isError && isNotFound(detail.error) && (
          <EmptyState title="Team isn't available"
            description="It may have been deleted, you may not have team access, or the teams service is still rolling out." />
        )}
        {detail.isError && !isNotFound(detail.error) && (
          <ErrorState title="Could not load team"
            message={parseApiError(detail.error).message}
            onRetry={() => void detail.refetch()} />
        )}
        {detail.data && (
          <TeamDetailBody key={detail.data.id} orgId={orgId} team={detail.data}
            members={members} delegable={delegable} hiddenCount={hiddenCount}
            perms={perms} labels={labels} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TeamDetailBody({ orgId, team, members, delegable, hiddenCount, perms, labels }: {
  orgId: string;
  team: Team;
  members: Member[];
  delegable: PermissionSet[];
  hiddenCount: number;
  perms: TeamPerms;
  labels: Map<string, string>;
}) {
  const mut = useTeamMutations(orgId);
  const teamMembers = team.members ?? [];
  const assignedIds = useMemo(
    () => new Set((team.sets ?? []).map((s) => s.id)),
    [team.sets],
  );

  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState("");
  const [removing, setRemoving] = useState<{ user_id: string; email: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([...assignedIds]);
  const [savingSets, setSavingSets] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    <div>
      <DialogTitle className="text-sm font-semibold">{team.name}</DialogTitle>
      <DialogDescription>
        {team.member_count} member{team.member_count === 1 ? "" : "s"} · created {createdLabel(team.created_at)}
      </DialogDescription>

      {/* Overview */}
      <div className="mt-3 space-y-2.5">
        <h3 className="text-xs font-bold">Overview</h3>
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
            <Button size="sm" onClick={() => void save()}
              disabled={saving || !dirty || name.trim().length < 2}
              data-testid="org-team-edit-save">
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save changes
            </Button>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">{team.description || "No description set."}</p>
        )}
        <div>
          <PermissionSummary codes={team.codes ?? []} labels={labels} />
        </div>
      </div>

      {/* Members — org members only */}
      <div className="mt-4 space-y-2">
        <h3 className="text-xs font-bold">Members</h3>
        {perms.canAddMembers && (
          <div className="flex gap-2">
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
        {teamMembers.length === 0 && (
          <p className="text-xs text-zinc-500">No members in this team yet.</p>
        )}
        {teamMembers.map((m) => (
          <Card key={m.user_id} data-testid={`org-team-member-${m.user_id}`}>
            <CardContent className="flex flex-wrap items-center gap-2 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{m.email}</p>
                <div className="mt-0.5 flex gap-1">
                  <Badge variant="outline">{m.state}</Badge>
                </div>
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
      </div>

      {/* Permission sets — replace-all, delegable only */}
      <div className="mt-4 space-y-2">
        <h3 className="text-xs font-bold">Permission sets</h3>
        {(team.sets ?? []).length === 0 && (team.codes ?? []).length > 0 && (
          <p className="text-[11px] text-zinc-400">Set breakdown unavailable — effective permissions shown above.</p>
        )}
        {(team.sets ?? []).length === 0 && (team.codes ?? []).length === 0 && (
          <p className="text-xs text-zinc-500">No permission sets assigned.</p>
        )}
        {perms.canAssignSets ? (
          <>
            <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
              {delegable.map((s) => (
                <label key={s.id} data-testid={`org-team-set-assign-${s.id}`}
                  className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    checked={picked.includes(s.id)}
                    onChange={() => setPicked((p) =>
                      p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id])} />
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-400">{s.permissions.length}</span>
                </label>
              ))}
              {delegable.length === 0 && <p className="text-xs text-zinc-500">No sets available.</p>}
            </div>
            {hiddenCount > 0 && (
              <p className="text-[11px] text-zinc-400">
                {hiddenCount} set{hiddenCount === 1 ? "" : "s"} hidden — {hiddenCount === 1 ? "it grants" : "they grant"} permissions beyond yours.
              </p>
            )}
            <Button size="sm" onClick={() => void saveSets()}
              disabled={savingSets || !setsDirty} data-testid="org-team-sets-save">
              {savingSets && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              Save sets ({picked.length})
            </Button>
          </>
        ) : (
          <div className="flex flex-wrap gap-1">
            {(team.sets ?? []).map((s) => (
              <Badge key={s.id} variant="secondary">{s.name}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Danger zone */}
      {perms.canDelete && (
        <Card className="mt-4 border-red-200 dark:border-red-900/60">
          <CardContent className="p-3.5">
            <h3 className="text-xs font-bold text-red-700 dark:text-red-300">Danger zone</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Deleting removes the team and its grants immediately. Members keep their organization membership.
            </p>
            <Button size="sm" variant="destructive" className="mt-2.5"
              onClick={() => setDeleting(true)} data-testid="org-team-delete">
              Delete team
            </Button>
          </CardContent>
        </Card>
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
