"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  apiKeyErrorMessage,
  createApiKey,
  deleteApiKey,
  getApiKeyAnalytics,
  isApiKeyStatus,
  listApiKeys,
  rotateApiKey,
  updateApiKey,
} from "@/services/apiKeys";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { KeyDetailsPanel } from "./components/KeyDetailsPanel";
import { KeyEditDrawer } from "./components/KeyEditDrawer";
import { KeyForm, type KeyFormResult } from "./components/KeyForm";
import { KeyTable } from "./components/KeyTable";
import { RawKeyDialog } from "./components/RawKeyDialog";
import type { ApiKey } from "@/types/apiKeys";

/** Rolling window used to compare spend against `policy.max_budget_usd`. */
const BUDGET_PRESET = "last_30d" as const;

interface RawKeyState {
  rawKey: string;
  apiKey: ApiKey;
  reason: "create" | "rotate";
}

/** User API keys: list, create/edit, rotate, enable/disable, delete, analytics. */
export default function ApiKeysPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editKeyId, setEditKeyId] = useState<string | null>(null);
  const [detailsKeyId, setDetailsKeyId] = useState<string | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ApiKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [secret, setSecret] = useState<RawKeyState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const keysQuery = useQuery({ queryKey: ["api-keys"], queryFn: listApiKeys });
  const keys = useMemo(() => keysQuery.data ?? [], [keysQuery.data]);

  // Only budgeted keys need a spend lookup; each row's 30d cost feeds the bar.
  const budgetedKeys = useMemo(
    () => keys.filter((key) => key.policy?.max_budget_usd !== null && key.policy?.max_budget_usd !== undefined),
    [keys],
  );
  const budgetQueries = useQueries({
    queries: budgetedKeys.map((key) => ({
      queryKey: ["api-key-analytics", key.id, BUDGET_PRESET],
      queryFn: () => getApiKeyAnalytics(key.id, BUDGET_PRESET),
      staleTime: 60_000,
    })),
  });
  const budgetCost = useMemo(() => {
    const map: Record<string, number> = {};
    budgetedKeys.forEach((key, index) => {
      const result = budgetQueries[index];
      if (result?.data) map[key.id] = Number(result.data.cost);
    });
    return map;
  }, [budgetedKeys, budgetQueries]);
  const budgetLoading = budgetQueries.some((query) => query.isPending);

  const detailsKey = useMemo(
    () => keys.find((key) => key.id === detailsKeyId) ?? null,
    [keys, detailsKeyId],
  );
  const editKey = useMemo(
    () => keys.find((key) => key.id === editKeyId) ?? null,
    [keys, editKeyId],
  );

  const openCreate = useCallback(() => setCreateOpen(true), []);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const closeDetails = useCallback(() => setDetailsKeyId(null), []);
  const openDetails = useCallback((apiKey: ApiKey) => setDetailsKeyId(apiKey.id), []);
  const openEdit = useCallback((apiKey: ApiKey) => setEditKeyId(apiKey.id), []);
  const closeEdit = useCallback(() => setEditKeyId(null), []);

  async function handleCreate(result: KeyFormResult) {
    // The create endpoint accepts the full configuration in one request:
    // policy, IP rules and model permissions are applied atomically.
    const created = await createApiKey({
      name: result.name,
      description: result.description,
      expires_at: result.expires_at,
      policy: result.policy,
      ip_rules: result.ipRules,
      model_permissions: result.modelPermissions,
    });

    await qc.invalidateQueries({ queryKey: ["api-keys"] });
    setCreateOpen(false);
    setSecret({ rawKey: created.raw_key, apiKey: created.key, reason: "create" });
    toast.success("API key created");
  }

  const handleToggle = useCallback(
    async (apiKey: ApiKey) => {
      setBusyId(apiKey.id);
      try {
        await updateApiKey(apiKey.id, { enabled: !apiKey.enabled });
        await qc.invalidateQueries({ queryKey: ["api-keys"] });
        toast.success(apiKey.enabled ? "Key disabled" : "Key enabled");
      } catch (error) {
        toast.error("Could not update the key", { description: apiKeyErrorMessage(error) });
      } finally {
        setBusyId(null);
      }
    },
    [qc],
  );

  async function handleRotate() {
    if (!rotateTarget) return;
    const rotated = await rotateApiKey(rotateTarget.id);
    await qc.invalidateQueries({ queryKey: ["api-keys"] });
    await qc.invalidateQueries({ queryKey: ["api-key-analytics", rotateTarget.id] });
    setRotateTarget(null);
    setSecret({ rawKey: rotated.raw_key, apiKey: rotated.key, reason: "rotate" });
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteApiKey(deleteTarget.id);
    await qc.invalidateQueries({ queryKey: ["api-keys"] });
    if (detailsKeyId === deleteTarget.id) setDetailsKeyId(null);
    if (editKeyId === deleteTarget.id) setEditKeyId(null);
    setDeleteTarget(null);
    toast.success("API key deleted");
  }
  const closeRotate = useCallback(() => setRotateTarget(null), []);
  const closeDelete = useCallback(() => setDeleteTarget(null), []);

  return (
    <main
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white dark:bg-zinc-950"
      data-testid="api-keys-page"
    >
      <PageHeader
        title="API Keys"
        subtitle="Programmatic access to the ToLLma gateway — scoped, rate-limited and auditable."
        badges={
          keys.length > 0 ? (
            <Badge variant="secondary" className="text-[10px]">
              {keys.length}
            </Badge>
          ) : undefined
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void keysQuery.refetch()}
              disabled={keysQuery.isFetching}
            >
              <RefreshCw className={cn("size-3.5", keysQuery.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" onClick={openCreate} data-testid="create-key-button">
              <Plus className="size-3.5" />
              Create key
            </Button>
          </>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        {keysQuery.isPending && <LoadingState message="Loading API keys…" className="py-16" />}

        {!keysQuery.isPending && keysQuery.error && isApiKeyStatus(keysQuery.error, 403) && (
          <EmptyState
            icon={ShieldAlert}
            title="API keys unavailable"
            description="Your account does not have permission to manage API keys. Contact a workspace administrator."
            className="py-16"
            testId="keys-forbidden"
          />
        )}
        {!keysQuery.isPending &&
          keysQuery.error &&
          isApiKeyStatus(keysQuery.error, 404) && (
            <EmptyState
              icon={KeyRound}
              title="API keys are not enabled"
              description="This deployment does not expose the key management API."
              className="py-16"
              testId="keys-not-found"
            />
          )}
        {!keysQuery.isPending &&
          keysQuery.error &&
          !isApiKeyStatus(keysQuery.error, 403) &&
          !isApiKeyStatus(keysQuery.error, 404) && (
            <ErrorState
              title="Could not load API keys"
              message={apiKeyErrorMessage(keysQuery.error)}
              onRetry={() => void keysQuery.refetch()}
            />
          )}

        {!keysQuery.isPending && !keysQuery.error && (
          <KeyTable
            keys={keys}
            budgetCost={budgetCost}
            budgetLoading={budgetLoading}
            busyId={busyId}
            onCreate={openCreate}
            onEdit={openEdit}
            onRotate={setRotateTarget}
            onDelete={setDeleteTarget}
            onToggle={handleToggle}
            onOpenDetails={openDetails}
          />
        )}
      </div>

      {createOpen && (
        <KeyForm mode="create" onClose={closeCreate} onCreate={handleCreate} />
      )}

      <ConfirmDialog
        open={!!rotateTarget}
        title={`Rotate “${rotateTarget?.name ?? ""}”?`}
        description="A new secret is generated and the current key is invalidated immediately. Update every deployment that uses it."
        confirmLabel="Rotate key"
        onConfirm={handleRotate}
        onClose={closeRotate}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        title={`Delete “${deleteTarget?.name ?? ""}”?`}
        description="This permanently removes the key. Requests using it will fail immediately and the action cannot be undone."
        confirmLabel="Delete key"
        onConfirm={handleDelete}
        onClose={closeDelete}
      />

      <KeyDetailsPanel
        apiKey={detailsKey}
        open={!!detailsKey}
        onClose={closeDetails}
        onEdit={openEdit}
      />

      <KeyEditDrawer
        apiKey={editKey}
        open={!!editKey}
        onClose={closeEdit}
        onSaved={closeEdit}
      />

      {secret && (
        <RawKeyDialog
          open
          rawKey={secret.rawKey}
          keyName={secret.apiKey.name}
          reason={secret.reason}
          onClose={() => setSecret(null)}
        />
      )}
    </main>
  );
}
