"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Badge, Button, DataTable, type DataTableColumn,
  DetailPanel,
  EmptyState, ErrorState, LoadingState, SearchInput, Select,
} from "@/components/ui";
import { AssignSetsDialog, ConfirmDialog } from "./Dialogs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  useJoinRequests, useOrgInvitations, useOrgMutations, useOrgSets,
} from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import { ApiError } from "@/services/api";
import type { Invitation, Member } from "@/types/orgs";

/** Operations tabs. The legacy keys tab now lives on /api-keys (scope-aware);
 * a stray tab=keys deep link falls back to "requests" (see below). */
export type OpsTab = "requests" | "invitations";

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

export interface OpsPerms {
  canCreateKeys: boolean;
  canReadKeys: boolean;
  canRevokeKeys: boolean;
  canInvite: boolean;
  canReadInvitations: boolean;
  canReviewRequests: boolean;
}

/** Operations: requests | invitations under ?section=operations.
 * Legacy ?section=keys|requests|invitations redirect here (see page);
 * keys moved to the scope-aware /api-keys page. */
// members stays in the prop contract (the [id] page passes it); keys moved to /api-keys.
export function OrgOperationsSection({ orgId, perms, initialTab }: {
  orgId: string;
  members: Member[];
  perms: OpsPerms;
  initialTab: OpsTab;
}) {
  // Tab lives in ?tab= so it is shareable and survives back/forward; a
  // legacy tab=keys deep link lands on requests (the [id] page redirects
  // keys-tab links to /api-keys, but never trust the caller).
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramTab = searchParams.get("tab");
  const tab: OpsTab =
    paramTab === "requests" || paramTab === "invitations" ? paramTab : initialTab;
  function setTab(next: OpsTab) {
    router.replace(`/organizations/${orgId}?section=operations&tab=${next}`);
  }

  const invitations = useOrgInvitations(orgId);
  const requests = useJoinRequests(orgId);
  const pendingInvites = (invitations.data ?? []).filter((i) => i.status === "pending").length;
  const pendingRequests = (requests.data ?? []).filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-2.5" data-testid="org-operations">
      <div className="flex gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800" role="tablist"
        aria-label="Operations" data-testid="org-ops-tabs">
        {([
          { id: "requests", label: "Requests", count: pendingRequests },
          { id: "invitations", label: "Invitations", count: pendingInvites },
        ] as const).map((t) => (
          <button key={t.id} type="button" role="tab" id={`org-ops-tabbtn-${t.id}`} aria-selected={tab === t.id} aria-controls={`org-ops-panel-${t.id}`}
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

      {tab === "requests" && (
        <div role="tabpanel" id="org-ops-panel-requests" aria-labelledby="org-ops-tabbtn-requests">
          <RequestsTab orgId={orgId} canReview={perms.canReviewRequests} />
        </div>
      )}
      {tab === "invitations" && (
        <div role="tabpanel" id="org-ops-panel-invitations" aria-labelledby="org-ops-tabbtn-invitations">
          <InvitationsTab orgId={orgId} canManage={perms.canInvite} canRead={perms.canReadInvitations} />
        </div>
      )}
    </div>
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
      render: (r) => <span className="truncate font-medium text-zinc-900 dark:text-zinc-100" data-testid={`org-req-${r.id}`} title={requesterOf(r)}>{requesterOf(r)}</span>,
    },
    { key: "resource", header: "Resource", render: (r) => <span className="truncate" title={resourceOf(r)}>{resourceOf(r)}</span> },
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
    { key: "reviewer", header: "Reviewer", render: (r) => <span className="truncate" title={reviewerOf(r)}>{reviewerOf(r)}</span> },
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

function InvitationsTab({ orgId, canManage, canRead }: { orgId: string; canManage: boolean; canRead: boolean }) {
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

  if (!canRead) {
    return <EmptyState title="Invitations" description="You need the Members.Read permission to view invitations." testId="org-invitations-forbidden" />;
  }

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
      render: (i) => <span className="truncate font-medium text-zinc-900 dark:text-zinc-100" data-testid={`org-inv-${i.id}`} title={i.email}>{i.email}</span>,
    },
    {
      key: "status", header: "Status",
      render: (i) => (
        <Badge variant={i.status === "pending" ? "warning" : i.status === "accepted" ? "success" : "outline"}>
          {i.status}
        </Badge>
      ),
    },
    { key: "sets", header: "Sets", render: (i) => <span className="truncate" title={inviteSets(i).join(", ") || "—"}>{inviteSets(i).join(", ") || "—"}</span> },
    { key: "invitedBy", header: "Invited by", render: (i) => <span className="truncate" title={inviterOf(i) ?? undefined}>{inviterOf(i)}</span> },
    { key: "created", header: "Created", render: (i) => <span className="whitespace-nowrap">{dateLabel(i.created_at)}</span> },
    { key: "expiry", header: "Expiry", render: (i) => <span className="whitespace-nowrap">{dateLabel(i.expires_at)}</span> },
    { key: "delivery", header: "Delivery", render: (i) => <span className="truncate" title={deliveryOf(i)}>{deliveryOf(i)}</span> },
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
      {invitations.isError && isNotFound(invitations.error) && (
        <ErrorState title="Invitations not found"
          message={parseApiError(invitations.error).message}
          onRetry={() => void invitations.refetch()} />
      )}
      {invitations.isError && !isNotFound(invitations.error) && (
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
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Invited by</dt><dd className="break-words">{inviterOf(inspecting)}</dd></div>
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
