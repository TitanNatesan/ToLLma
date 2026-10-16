"use client";

import { useMemo, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Badge, Button, Card, CardContent, Checkbox, DataTable, type DataTableColumn,
  DetailPanel, Dialog, DialogContent, DialogDescription, DialogTitle,
  EmptyState, ErrorState, Field, Input, LoadingState, SearchInput, Select,
} from "@/components/ui";
import { AssignSetsDialog, ConfirmDialog } from "./Dialogs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useJoinRequests, useOrgInvitations, useOrgKeys, useOrgMutations, useOrgSets,
} from "@/hooks/useOrgs";
import { useModels } from "@/hooks/useRegistry";
import { copyWithToast } from "@/lib/clipboard";
import { parseApiError } from "@/lib/errors";
import { ApiError } from "@/services/api";
import type { Invitation, Member, OrgKey } from "@/types/orgs";

export type OpsTab = "keys" | "requests" | "invitations";

const PAGE_SIZE = 15;

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

function dateLabel(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
}

function money(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  if (n !== 0 && Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export interface OpsPerms {
  canCreateKeys: boolean;
  canReadKeys: boolean;
  canRevokeKeys: boolean;
  canInvite: boolean;
  canReviewRequests: boolean;
}

/** Operations: keys | requests | invitations under ?section=operations.
 * Legacy ?section=keys|requests|invitations redirect here (see page). */
export function OrgOperationsSection({ orgId, members, perms, initialTab }: {
  orgId: string;
  members: Member[];
  perms: OpsPerms;
  initialTab: OpsTab;
}) {
  const [tab, setTab] = useState<OpsTab>(initialTab);

  const invitations = useOrgInvitations(orgId);
  const requests = useJoinRequests(orgId);
  const keys = useOrgKeys(orgId);
  const pendingInvites = (invitations.data ?? []).filter((i) => i.status === "pending").length;
  const pendingRequests = (requests.data ?? []).filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-2.5" data-testid="org-operations">
      <div className="flex gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800" role="tablist"
        aria-label="Operations" data-testid="org-ops-tabs">
        {([
          { id: "keys", label: "Keys", count: keys.data?.length },
          { id: "requests", label: "Requests", count: pendingRequests },
          { id: "invitations", label: "Invitations", count: pendingInvites },
        ] as const).map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            onClick={() => setTab(t.id)} data-testid={`org-ops-tab-${t.id}`}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors ${tab === t.id
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
            {t.label}
            {t.count !== undefined && (
              <span className="rounded-full bg-zinc-200 px-1.5 font-mono text-[10px] dark:bg-zinc-700">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "keys" && (
        <KeysTab orgId={orgId} members={members} perms={perms} />
      )}
      {tab === "requests" && (
        <RequestsTab orgId={orgId} canReview={perms.canReviewRequests} />
      )}
      {tab === "invitations" && (
        <InvitationsTab orgId={orgId} canManage={perms.canInvite} />
      )}
    </div>
  );
}

/* ------------------------------- keys tab ------------------------------- */

function assigneeEmail(k: OrgKey): string {
  return k.assignee_email ?? k.user_email ?? k.email ?? "—";
}

function budgetLabel(k: OrgKey): string {
  const policy = (k as { policy?: { max_budget_usd?: number | string | null } | null }).policy;
  const raw = k.max_budget_usd ?? k.max_budget ?? k.budget_usd ?? k.budget ?? policy?.max_budget_usd;
  if (raw === null || raw === undefined || raw === "") return "Unlimited";
  const n = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(n) ? `$${n}` : "Unlimited";
}

function spendLabel(k: OrgKey): string {
  return money(k.spend_usd ?? k.spend ?? k.total_spend_usd);
}

function modelCount(k: OrgKey): number {
  if (typeof k.model_count === "number") return k.model_count;
  const perms = k.model_permissions;
  if (Array.isArray(perms)) return perms.length;
  if (Array.isArray(k.model_ids)) return k.model_ids.length;
  if (Array.isArray(k.models)) return k.models.length;
  return 0;
}

function keyStatus(k: OrgKey): string {
  if (k.revoked) return "revoked";
  return k.status ?? "active";
}

function extractRawKey(res: unknown): string | null {
  if (!res || typeof res !== "object") return null;
  const r = res as Record<string, unknown>;
  if (typeof r.raw_key === "string" && r.raw_key) return r.raw_key;
  if (typeof r.rawKey === "string" && r.rawKey) return r.rawKey;
  const nested = r.key;
  if (nested && typeof nested === "object") {
    const n = nested as Record<string, unknown>;
    if (typeof n.raw_key === "string" && n.raw_key) return n.raw_key;
    if (typeof n.rawKey === "string" && n.rawKey) return n.rawKey;
  }
  return null;
}

function KeysTab({ orgId, members, perms }: { orgId: string; members: Member[]; perms: OpsPerms }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<OrgKey | null>(null);
  const [rawKey, setRawKey] = useState<string | null>(null);

  const debounced = useDebouncedValue(search.trim(), 300);
  const keys = useOrgKeys(orgId, {
    enabled: perms.canReadKeys,
    params: { search: debounced || undefined, limit: 200 },
  });
  const mut = useOrgMutations(orgId);

  const rows = keys.data ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  async function revoke() {
    if (!revoking) return;
    try {
      await mut.revokeKey.mutateAsync(revoking.id);
      toast.success(`Key "${revoking.name}" revoked.`);
    } catch (e) {
      toast.error(parseApiError(e).message);
      throw e;
    }
  }

  if (!perms.canReadKeys) {
    return <EmptyState title="API keys" description="You need key-read permission to view organization keys." />;
  }

  const columns: DataTableColumn<OrgKey>[] = [
    {
      key: "name", header: "Name",
      render: (k) => (
        <span className="min-w-0">
          <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100" data-testid={`org-key-${k.id}`}>{k.name}</span>
          {k.description && <span className="block truncate text-[11px] text-zinc-400">{k.description}</span>}
        </span>
      ),
    },
    { key: "owner", header: "Owner", render: (k) => <span className="truncate">{assigneeEmail(k)}</span> },
    { key: "team", header: "Team", render: (k) => (k.team_name ? <span className="truncate">{k.team_name}</span> : <span className="text-zinc-400">—</span>) },
    {
      key: "status", header: "Status",
      render: (k) => {
        const s = keyStatus(k);
        return <Badge variant={s === "active" ? "success" : "outline"}>{s}</Badge>;
      },
    },
    { key: "models", header: "Models", align: "right", render: (k) => String(modelCount(k)) },
    { key: "budget", header: "Budget", align: "right", render: (k) => <span className="font-mono">{budgetLabel(k)}</span> },
    { key: "spend", header: "Spend", align: "right", render: (k) => <span className="font-mono">{spendLabel(k)}</span> },
    { key: "created", header: "Created", render: (k) => <span className="whitespace-nowrap">{dateLabel(k.created_at)}</span> },
    { key: "used", header: "Last used", render: (k) => <span className="whitespace-nowrap">{dateLabel(k.last_used_at ?? k.used_at)}</span> },
    {
      key: "actions", header: "Actions", align: "right",
      render: (k) => (!k.revoked && perms.canRevokeKeys ? (
        <Button size="sm" variant="outline" onClick={() => setRevoking(k)}
          data-testid={`org-key-revoke-${k.id}`}>Revoke</Button>
      ) : null),
    },
  ];

  return (
    <div className="space-y-2" data-testid="org-keys">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-44 flex-1">
          <SearchInput value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            onClear={() => { setSearch(""); setPage(0); }} placeholder="Search keys…" aria-label="Search API keys"
            data-testid="org-keys-search" />
        </div>
        <span className="text-xs text-zinc-500">{rows.length} key{rows.length === 1 ? "" : "s"}</span>
        {perms.canCreateKeys && (
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="org-key-create-open">
            <KeyRound className="size-3.5" aria-hidden /> New key
          </Button>
        )}
      </div>

      {keys.isLoading && <LoadingState message="Loading API keys…" />}
      {keys.isError && isNotFound(keys.error) && (
        <EmptyState title="API keys aren't available yet"
          description="The organization key service is still rolling out. Existing members and settings are unaffected." />
      )}
      {keys.isError && !isNotFound(keys.error) && (
        <ErrorState title="Could not load API keys"
          message={parseApiError(keys.error).message}
          onRetry={() => void keys.refetch()} />
      )}
      {!keys.isLoading && !keys.isError && rows.length === 0 && (
        <EmptyState title="No API keys"
          description={debounced ? "No keys match this search." : "Create a key to grant programmatic access scoped to this organization."}
          action={perms.canCreateKeys && !debounced ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="org-key-create-open-empty">
              Create key
            </Button>
          ) : undefined} />
      )}
      {rows.length > 0 && (
        <>
          <DataTable columns={columns} rows={visible} rowKey={(k) => k.id} testId="org-keys-table" />
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
        <OrgKeyCreateDialog orgId={orgId} members={members}
          onClose={() => setCreateOpen(false)}
          onCreated={(raw) => {
            setCreateOpen(false);
            setRawKey(raw);
          }} />
      )}

      <ConfirmDialog open={revoking !== null} title={`Revoke key "${revoking?.name}"?`} destructive
        confirmLabel="Revoke key" testId="org-key-revoke-dialog"
        description="The key stops working immediately. Applications using it will be rejected. This cannot be undone."
        onClose={() => setRevoking(null)}
        onConfirm={() => revoke().then(() => setRevoking(null))} />

      <Dialog open={rawKey !== null} onOpenChange={(n) => { if (!n) setRawKey(null); }}>
        <DialogContent className="max-w-md p-4" data-testid="org-key-raw">
          <DialogTitle className="text-sm font-semibold">Copy your key now</DialogTitle>
          <DialogDescription>
            This secret is shown <strong>exactly once</strong> and can never be retrieved again.
            Copy it now and store it somewhere safe.
          </DialogDescription>
          <div className="mt-3 flex items-center gap-2">
            <Input readOnly value={rawKey ?? ""} data-testid="org-key-raw-value"
              className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button size="sm" variant="outline"
              onClick={() => void copyWithToast(rawKey ?? "", "Key copied to clipboard.")}
              data-testid="org-key-raw-copy">
              Copy
            </Button>
          </div>
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => setRawKey(null)} data-testid="org-key-raw-done">
              I saved it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrgKeyCreateDialog({ orgId, members, onClose, onCreated }: {
  orgId: string;
  members: Member[];
  onClose: () => void;
  onCreated: (rawKey: string) => void;
}) {
  const mut = useOrgMutations(orgId);
  const models = useModels();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [budget, setBudget] = useState("");
  const [pickedModels, setPickedModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleModel(id: string) {
    setPickedModels((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  }

  const budgetValue = budget.trim() === "" ? null : Number(budget);
  const budgetValid = budget.trim() === "" || (Number.isFinite(budgetValue) && (budgetValue as number) >= 0);
  const valid = name.trim().length >= 2 && assignee !== "" && budgetValid && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await mut.createKey.mutateAsync({
        name: name.trim(),
        assignee_user_id: assignee,
        description: description.trim() || undefined,
        max_budget_usd: budget.trim() === "" ? null : Number(budget),
        model_permissions: pickedModels.length > 0 ? pickedModels.map((id) => ({ model_id: id })) : undefined,
      });
      const raw = extractRawKey(res);
      if (!raw) {
        throw new Error("The server did not return a key secret. The key may still have been created — check the list.");
      }
      toast.success(`Key "${name.trim()}" created.`);
      onCreated(raw);
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(n) => { if (!n && !busy) onClose(); }}>
      <DialogContent className="max-w-md p-4" data-testid="org-key-dialog">
        <DialogTitle className="text-sm font-semibold">Create organization API key</DialogTitle>
        <DialogDescription>
          Keys are scoped to this organization and inherit its governance. The secret is shown once after creation.
        </DialogDescription>
        <div className="mt-3 space-y-3">
          <Field label="Key name">
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CI deploy key" maxLength={80} data-testid="org-key-name" />
          </Field>
          <Field label="Assignee (member)">
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}
              data-testid="org-key-assignee">
              <option value="">Select a member…</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.email}</option>
              ))}
            </Select>
          </Field>
          <Field label="Budget cap in USD (optional)">
            <Input value={budget} onChange={(e) => setBudget(e.target.value)}
              placeholder="e.g. 25" inputMode="decimal" data-testid="org-key-budget" />
          </Field>
          <Field label="Model access (optional — empty means all org-visible models)">
            <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800"
              data-testid="org-key-models">
              {models.isLoading && <p className="text-xs text-zinc-500">Loading models…</p>}
              {models.isError && <p className="text-xs text-zinc-500">Models unavailable — the key will allow all models.</p>}
              {(models.data ?? []).map((m) => (
                <label key={m.id} data-testid={`org-key-model-${m.id}`}
                  className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox checked={pickedModels.includes(m.id)} onChange={() => toggleModel(m.id)} />
                  <span className="truncate font-medium">{m.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-400">{m.model_id}</span>
                </label>
              ))}
              {!models.isLoading && !models.isError && (models.data ?? []).length === 0 && (
                <p className="text-xs text-zinc-500">No models registered.</p>
              )}
            </div>
          </Field>
          <Field label="Description (optional)">
            <Input value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this key for?" maxLength={300} data-testid="org-key-description" />
          </Field>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => void submit()} disabled={!valid} data-testid="org-key-submit">
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Create key
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- requests tab ----------------------------- */

function requesterOf(r: Invitation): string {
  return r.email;
}

function resourceOf(r: Invitation): string {
  const names = r.set_names ?? [];
  return names.length > 0 ? names.join(", ") : r.org_name ? `Membership · ${r.org_name}` : "Membership";
}

function reviewerOf(r: Invitation): string {
  if (typeof r.reviewed_by === "string") return r.reviewed_by;
  return r.reviewer_name ?? r.reviewer_email ?? r.reviewed_by?.name ?? r.reviewed_by?.email ?? "—";
}

type ReqStatus = "pending" | "all" | "accepted" | "rejected" | "expired" | "closed";

function RequestsTab({ orgId, canReview }: { orgId: string; canReview: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ReqStatus>("pending");
  const [page, setPage] = useState(0);
  const [reviewing, setReviewing] = useState<{ id: string; email: string } | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; email: string } | null>(null);

  const debounced = useDebouncedValue(search.trim(), 300);
  const requests = useJoinRequests(orgId, {
    status: status === "all" ? undefined : status,
    search: debounced || undefined,
    limit: 200,
  });
  const mut = useOrgMutations(orgId);
  const orgSets = useOrgSets(orgId);

  const rows = requests.data ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

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

  const columns: DataTableColumn<Invitation>[] = [
    { key: "type", header: "Type", render: (r) => <Badge variant="outline">{r.kind}</Badge> },
    {
      key: "requester", header: "Requester",
      render: (r) => <span className="truncate font-medium text-zinc-900 dark:text-zinc-100" data-testid={`org-req-${r.id}`}>{requesterOf(r)}</span>,
    },
    { key: "resource", header: "Resource", render: (r) => <span className="truncate">{resourceOf(r)}</span> },
    {
      key: "status", header: "Status",
      render: (r) => (
        <Badge variant={r.status === "pending" ? "warning" : r.status === "accepted" ? "success" : "outline"}>
          {r.status}
        </Badge>
      ),
    },
    { key: "submitted", header: "Submitted", render: (r) => <span className="whitespace-nowrap">{dateLabel(r.created_at)}</span> },
    { key: "updated", header: "Updated", render: (r) => <span className="whitespace-nowrap">{dateLabel(r.updated_at)}</span> },
    { key: "reviewer", header: "Reviewer", render: (r) => <span className="truncate">{reviewerOf(r)}</span> },
    {
      key: "actions", header: "Actions", align: "right",
      render: (r) => (r.status === "pending" ? (
        <span className="flex justify-end gap-1.5">
          <Button size="sm" onClick={() => setReviewing({ id: r.id, email: r.email })}
            data-testid={`org-req-approve-${r.id}`}>Approve</Button>
          <Button size="sm" variant="outline" onClick={() => setRejecting({ id: r.id, email: r.email })}
            data-testid={`org-req-reject-${r.id}`}>Reject</Button>
        </span>
      ) : null),
    },
  ];

  return (
    <div className="space-y-2" data-testid="org-requests">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-44 flex-1">
          <SearchInput value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            onClear={() => { setSearch(""); setPage(0); }} placeholder="Search requests…" aria-label="Search join requests"
            data-testid="org-requests-search" />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value as ReqStatus); setPage(0); }} sizeVariant="sm"
          className="w-32" aria-label="Filter by status" data-testid="org-requests-status">
          <option value="pending">Pending</option>
          <option value="all">All</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
          <option value="closed">Closed</option>
        </Select>
        <span className="text-xs text-zinc-500">{rows.length} request{rows.length === 1 ? "" : "s"}</span>
      </div>

      {requests.isLoading && <LoadingState message="Loading join requests…" />}
      {requests.isError && (
        <ErrorState title="Could not load join requests"
          message={parseApiError(requests.error).message}
          onRetry={() => void requests.refetch()} />
      )}
      {!requests.isLoading && !requests.isError && rows.length === 0 && (
        <EmptyState title="No join requests"
          description={status === "pending" && !debounced ? "New membership requests will appear here." : "No requests match these filters."} />
      )}
      {rows.length > 0 && (
        <>
          <DataTable columns={columns} rows={visible} rowKey={(r) => r.id} testId="org-requests-table" />
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

      <ConfirmDialog open={rejecting !== null} title={`Reject the request from ${rejecting?.email}?`}
        confirmLabel="Reject request" testId="org-req-reject-dialog"
        description="The requester is notified of the rejection. They may request to join again later."
        onClose={() => setRejecting(null)}
        onConfirm={() => rejecting
          ? run(mut.rejectRequest.mutateAsync(rejecting.id), "Request rejected.").then(() => setRejecting(null))
          : Promise.resolve()} />
    </div>
  );
}

/* ---------------------------- invitations tab ---------------------------- */

function inviterOf(i: Invitation): string {
  if (typeof i.invited_by === "string") {
    return i.invited_by_email ?? i.invited_by_name ?? i.inviter?.email ?? i.inviter?.name ?? i.invited_by;
  }
  return i.invited_by?.email ?? i.invited_by?.name
    ?? i.invited_by_email ?? i.invited_by_name
    ?? i.inviter?.email ?? i.inviter?.name ?? "—";
}

function inviteSets(i: Invitation): string[] {
  if (i.set_names?.length) return i.set_names;
  const fromDetails = (i.set_details ?? []).map((d) => d.name);
  if (fromDetails.length) return fromDetails;
  const fromPerms = (i.permission_sets ?? []).map((p) => (typeof p === "string" ? p : p.name));
  if (fromPerms.length) return fromPerms;
  return i.set_ids ?? [];
}

function deliveryOf(i: Invitation): string {
  if (i.delivery_status) return i.delivery_status;
  return i.last_sent_at ? `last sent ${dateLabel(i.last_sent_at)}` : "—";
}

type InvStatus = "all" | "pending" | "accepted" | "rejected" | "expired" | "closed";

function InvitationsTab({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<InvStatus>("all");
  const [page, setPage] = useState(0);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<Invitation | null>(null);

  const debounced = useDebouncedValue(search.trim(), 300);
  const invitations = useOrgInvitations(orgId, {
    status: status === "all" ? undefined : status,
    search: debounced || undefined,
    limit: 200,
  });
  const mut = useOrgMutations(orgId);

  const rows = invitations.data ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  async function run(p: Promise<unknown>, ok: string) {
    try {
      await p;
      toast.success(ok);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  }

  const columns: DataTableColumn<Invitation>[] = [
    {
      key: "email", header: "Email",
      render: (i) => <span className="truncate font-medium text-zinc-900 dark:text-zinc-100" data-testid={`org-inv-${i.id}`}>{i.email}</span>,
    },
    {
      key: "status", header: "Status",
      render: (i) => (
        <Badge variant={i.status === "pending" ? "warning" : i.status === "accepted" ? "success" : "outline"}>
          {i.status}
        </Badge>
      ),
    },
    { key: "sets", header: "Sets", render: (i) => <span className="truncate">{inviteSets(i).join(", ") || "—"}</span> },
    { key: "invitedBy", header: "Invited by", render: (i) => <span className="truncate">{inviterOf(i)}</span> },
    { key: "created", header: "Created", render: (i) => <span className="whitespace-nowrap">{dateLabel(i.created_at)}</span> },
    { key: "expiry", header: "Expiry", render: (i) => <span className="whitespace-nowrap">{dateLabel(i.expires_at)}</span> },
    { key: "delivery", header: "Delivery", render: (i) => <span className="truncate">{deliveryOf(i)}</span> },
    {
      key: "actions", header: "Actions", align: "right",
      render: (i) => (
        <span className="flex justify-end gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setInspecting(i)}
            data-testid={`org-inv-inspect-${i.id}`}>Inspect</Button>
          {i.status === "pending" && canManage && (
            <>
              <Button size="sm" variant="outline" onClick={() => void run(
                mut.resendInvite.mutateAsync(i.id), "Invitation resent with a fresh link.")}
                data-testid={`org-inv-resend-${i.id}`}>Resend</Button>
              <Button size="sm" variant="outline" onClick={() => setRevoking(i.id)}
                data-testid={`org-inv-cancel-${i.id}`}>Revoke</Button>
            </>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-2" data-testid="org-invitations">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-44 flex-1">
          <SearchInput value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            onClear={() => { setSearch(""); setPage(0); }} placeholder="Search invitations…" aria-label="Search invitations"
            data-testid="org-invitations-search" />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value as InvStatus); setPage(0); }} sizeVariant="sm"
          className="w-32" aria-label="Filter by status" data-testid="org-invitations-status">
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
          <option value="closed">Closed</option>
        </Select>
        <span className="text-xs text-zinc-500">{rows.length} invitation{rows.length === 1 ? "" : "s"}</span>
      </div>

      {invitations.isLoading && <LoadingState message="Loading invitations…" />}
      {invitations.isError && (
        <ErrorState title="Could not load invitations"
          message={parseApiError(invitations.error).message}
          onRetry={() => void invitations.refetch()} />
      )}
      {!invitations.isLoading && !invitations.isError && rows.length === 0 && (
        <EmptyState title="No invitations" description="No invitations match these filters." />
      )}
      {rows.length > 0 && (
        <>
          <DataTable columns={columns} rows={visible} rowKey={(i) => i.id} testId="org-invitations-table" />
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

      <ConfirmDialog open={revoking !== null} title="Revoke this invitation?" destructive
        confirmLabel="Revoke invitation" testId="org-inv-revoke-dialog"
        description="The invitation link stops working immediately. You can invite the same address again."
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking
          ? run(mut.cancelInvite.mutateAsync(revoking), "Invitation revoked.").then(() => setRevoking(null))
          : Promise.resolve()} />

      <DetailPanel open={inspecting !== null} onClose={() => setInspecting(null)}
        testId="org-inv-detail" title={inspecting?.email ?? "Invitation"}>
        {inspecting && (
          <div className="space-y-3 text-xs">
            <dl className="space-y-1 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Status</dt><dd><Badge variant="outline">{inspecting.status}</Badge></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Kind</dt><dd>{inspecting.kind}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Invited by</dt><dd className="truncate">{inviterOf(inspecting)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Created</dt><dd>{dateLabel(inspecting.created_at)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Expires</dt><dd>{dateLabel(inspecting.expires_at)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Delivery</dt><dd>{deliveryOf(inspecting)}</dd></div>
            </dl>
            <div>
              <h3 className="mb-1.5 text-xs font-bold">Granted sets</h3>
              {inviteSets(inspecting).length === 0
                ? <p className="text-zinc-500">No sets — base membership only.</p>
                : (
                  <div className="flex flex-wrap gap-1">
                    {inviteSets(inspecting).map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
                  </div>
                )}
            </div>
            <p className="text-[11px] text-zinc-400">The invitation secret is never displayed here — it lives only in the recipient&apos;s link.</p>
          </div>
        )}
      </DetailPanel>
    </div>
  );
}
