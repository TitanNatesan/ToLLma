"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import {
  Badge, Button, DataTable, type DataTableColumn,
  EmptyState, ErrorState, LoadingState, SearchInput,
} from "@/components/ui";
import { RawKeyDialog } from "./RawKeyDialog";
import { ConfirmDialog } from "@/app/organizations/components/Dialogs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useOrgKeys, useOrgModels, useOrgMutations, useOrgProviders } from "@/hooks/useOrgs";
import { KeyForm, type KeyFormResult } from "./KeyForm";
import { parseApiError } from "@/lib/errors";
import { ApiError } from "@/services/api";
import type { Member, OrgKey } from "@/types/orgs";

/** Key gates for the org view. Mirrors the old operations-tab derivation:
 * read needs root or Keys.Read, create needs Keys.Create,
 * revoke accepts Keys.Revoke or Keys.Delete. */
export interface OrgKeysPerms {
  canCreateKeys: boolean;
  canReadKeys: boolean;
  canRevokeKeys: boolean;
}

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

function assigneeEmail(k: OrgKey): string {
  return (
    k.assignee_email ??
    k.user_email ??
    k.email ??
    k.issued_by_email ??
    k.issuer_email ??
    (typeof k.issued_by === "string" ? k.issued_by : null) ??
    "—"
  );
}

/** Issuer display when it differs from the assignee (who created the key). */
function issuedByEmail(k: OrgKey): string | null {
  const issuer =
    k.issued_by_email ??
    k.issuer_email ??
    (typeof k.issued_by === "string" ? k.issued_by : null);
  const assignee = assigneeEmail(k);
  if (!issuer || issuer === assignee || issuer === "—") return null;
  return issuer;
}

/** Only members that can receive a key: active (or stateless legacy rows). */
export function eligibleAssignees(members: Member[]): Member[] {
  return members.filter((m) => !m.state || m.state === "active");
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

/** Organization key inventory. Same table/flows as the old operations tab —
 * hosted here so /api-keys serves org scope with identical UI and org data.
 * Personal rows never reach this tree (separate query keys + remount per scope). */
export function OrgKeysPanel({ orgId, members, perms }: { orgId: string; members: Member[]; perms: OrgKeysPerms }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<OrgKey | null>(null);
  const [created, setCreated] = useState<{ rawKey: string; name: string } | null>(null);

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
    {
      key: "owner", header: "Owner",
      render: (k) => {
        const issuer = issuedByEmail(k);
        return (
          <span className="block min-w-0">
            <span className="block truncate" data-testid={`org-key-assignee-${k.id}`}>{assigneeEmail(k)}</span>
            {issuer && (
              <span className="block truncate text-[11px] text-zinc-400" data-testid={`org-key-issued-by-${k.id}`}>
                Issued by {issuer}
              </span>
            )}
          </span>
        );
      },
    },
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
          onCreated={(raw, name) => {
            setCreateOpen(false);
            setCreated({ rawKey: raw, name });
          }} />
      )}

      <ConfirmDialog open={revoking !== null} title={`Revoke key "${revoking?.name}"?`} destructive
        confirmLabel="Revoke key" testId="org-key-revoke-dialog"
        description="The key stops working immediately. Applications using it will be rejected. This cannot be undone."
        onClose={() => setRevoking(null)}
        onConfirm={() => revoke().then(() => setRevoking(null))} />

      {created && (
        <RawKeyDialog
          open
          rawKey={created.rawKey}
          keyName={created.name}
          reason="create"
          onClose={() => setCreated(null)}
        />
      )}
    </div>
  );
}

function OrgKeyCreateDialog({ orgId, members, onClose, onCreated }: {
  orgId: string;
  members: Member[];
  onClose: () => void;
  onCreated: (rawKey: string, keyName: string) => void;
}) {
  const mut = useOrgMutations(orgId);
  const providersQuery = useOrgProviders(orgId);
  const modelsQuery = useOrgModels(orgId);
  const orgProviders = (providersQuery.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    provider_type: p.provider_type ?? p.type ?? "custom",
  }));

  async function handleCreate(result: KeyFormResult) {
    if (!result.assigneeUserId) {
      throw new Error("Choose the member this key is assigned to.");
    }
    const res = await mut.createKey.mutateAsync({
      name: result.name,
      assignee_user_id: result.assigneeUserId,
      description: result.description ?? undefined,
      expires_at: result.expires_at,
      policy: result.policy ?? undefined,
      ip_rules: result.ipRules.map((r) => ({ type: r.type, cidr: r.cidr })),
      model_permissions: result.modelPermissions.map((p) => ({
        model_id: p.model_id as string,
        ...(p.provider_id ? { provider_id: p.provider_id as string } : {}),
        enabled: p.enabled ?? true,
        ...(p.max_budget != null ? { max_budget: p.max_budget } : {}),
        ...(p.rpm != null ? { rpm: p.rpm } : {}),
        ...(p.tpm != null ? { tpm: p.tpm } : {}),
      })),
    });
    const raw = extractRawKey(res);
    if (!raw) {
      throw new Error("The server did not return a key secret. The key may still have been created — check the list.");
    }
    toast.success(`Key "${result.name}" created.`);
    onCreated(raw, result.name);
  }

  return (
    <KeyForm
      mode="create"
      scope="org"
      assignees={eligibleAssignees(members).map((m) => ({ id: m.user_id, email: m.email }))}
      models={modelsQuery.data ?? []}
      providers={orgProviders}
      configureHref={`/organizations/${orgId}?section=providers`}
      onCreate={handleCreate}
      onClose={onClose}
    />
  );
}
