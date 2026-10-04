"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Badge, Button, Card, CardContent, Checkbox, Dialog, DialogContent,
  DialogDescription, DialogTitle, EmptyState, ErrorState, Field, Input,
  LoadingState, Select,
} from "@/components/ui";
import { ConfirmDialog } from "./Dialogs";
import { useOrgKeys, useOrgMutations } from "@/hooks/useOrgs";
import { useModels } from "@/hooks/useRegistry";
import { copyWithToast } from "@/lib/clipboard";
import { parseApiError } from "@/lib/errors";
import { ApiError } from "@/services/api";
import type { Member, OrgKey } from "@/types/orgs";

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

function modelCount(k: OrgKey): number {
  if (typeof k.model_count === "number") return k.model_count;
  const perms = k.model_permissions;
  if (Array.isArray(perms)) return perms.length;
  if (Array.isArray(k.model_ids)) return k.model_ids.length;
  if (Array.isArray(k.models)) return k.models.length;
  return 0;
}

function createdLabel(k: OrgKey): string {
  try {
    return new Date(k.created_at).toLocaleString();
  } catch {
    return k.created_at;
  }
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

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

export function OrgKeysSection({ orgId, members, canCreate, canRead, canRevoke }: {
  orgId: string;
  members: Member[];
  canCreate: boolean;
  canRead: boolean;
  canRevoke: boolean;
}) {
  const keys = useOrgKeys(orgId, { enabled: canRead });
  const mut = useOrgMutations(orgId);
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<OrgKey | null>(null);
  const [rawKey, setRawKey] = useState<string | null>(null);

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

  if (!canRead) {
    return <EmptyState title="API keys" description="You need key-read permission to view organization keys." />;
  }

  return (
    <div className="space-y-2" data-testid="org-keys">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          {keys.data ? `${keys.data.length} key${keys.data.length === 1 ? "" : "s"}` : "Organization API keys"}
        </p>
        {canCreate && (
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
      {!keys.isLoading && !keys.isError && (keys.data ?? []).length === 0 && (
        <EmptyState title="No API keys"
          description="Create a key to grant programmatic access scoped to this organization."
          action={canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="org-key-create-open-empty">
              Create key
            </Button>
          ) : undefined} />
      )}
      {(keys.data ?? []).map((k) => (
        <Card key={k.id} data-testid={`org-key-${k.id}`}>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{k.name}</p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                {assigneeEmail(k)} · budget {budgetLabel(k)} · {modelCount(k)} model{modelCount(k) === 1 ? "" : "s"} · created {createdLabel(k)}
              </p>
              {k.description ? (
                <p className="mt-0.5 truncate text-[11px] text-zinc-400">{k.description}</p>
              ) : null}
            </div>
            {k.revoked ? (
              <Badge variant="outline">revoked</Badge>
            ) : canRevoke ? (
              <Button size="sm" variant="outline" onClick={() => setRevoking(k)}
                data-testid={`org-key-revoke-${k.id}`}>
                Revoke
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ))}

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
    setPickedModels((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
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
