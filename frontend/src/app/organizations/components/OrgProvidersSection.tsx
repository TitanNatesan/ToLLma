"use client";

import { useMemo, useState } from "react";
import { Building2, CheckCircle2, Loader2, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Badge, Button, Card, CardContent, Dialog, DialogContent,
  DialogDescription, DialogTitle, EmptyState, ErrorState, Field, Input,
  LoadingState, Switch, Textarea,
} from "@/components/ui";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ConfirmDialog } from "./Dialogs";
import { useOrgMutations, useOrgProviders } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import { ApiError, discoverProviderModels, validateProvider } from "@/services/api";
import { CREDENTIAL_FIELDS, providerTypeLabel } from "@/app/providers/fields";
import { CatalogBrowserDialog } from "@/app/providers/components/CatalogBrowser";
import { ProviderWizardModal } from "@/app/providers/components/ProviderWizardModal";
import type { ProviderType } from "@/types";
import type { OrgProvider } from "@/types/orgs";

function typeLabel(p: OrgProvider): string {
  const raw = p.provider_type ?? p.type ?? "";
  return providerTypeLabel(raw) || raw || "Unknown";
}

function statusLabel(p: OrgProvider): string {
  const raw = (p.validation_status ?? p.status ?? "unknown").toLowerCase();
  if (raw === "valid") return "Valid";
  if (raw === "invalid") return "Invalid";
  return "Unvalidated";
}

function statusValue(p: OrgProvider): string {
  return (p.validation_status ?? p.status ?? "unknown").toLowerCase();
}

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

/** Credential rotation needs Providers.Update + Providers.RotateCredentials. */
function isRotatePermError(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 403) return false;
  try {
    return JSON.stringify(e.data).toLowerCase().includes("rotate");
  } catch {
    return false;
  }
}

const ROTATE_PERM_COPY =
  "Credential rotation also requires the Providers.RotateCredentials permission. Ask an organization admin to grant it.";

export function OrgProvidersSection({ orgId, orgName, canManage, canRead }: {
  orgId: string;
  orgName?: string | null;
  canManage: boolean;
  canRead: boolean;
}) {
  const providers = useOrgProviders(orgId, { enabled: canRead });
  const mut = useOrgMutations(orgId);
  const [createOpen, setCreateOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogPrefill, setCatalogPrefill] = useState<{
    family: ProviderType;
    name: string;
    slug: string;
    baseUrl: string | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<OrgProvider | null>(null);
  const [editing, setEditing] = useState<OrgProvider | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const orgProviderNames = useMemo(() => (providers.data ?? []).map((p) => p.name), [providers.data]);

  async function remove() {
    if (!deleting) return;
    try {
      await mut.deleteOrgProvider.mutateAsync(deleting.id);
      toast.success(`Provider "${deleting.name}" removed.`);
    } catch (e) {
      toast.error(parseApiError(e).message);
      throw e;
    }
  }

  // Validate / refresh reuse the provider endpoints: the backend resolves org
  // rows through them for members of an active org (no org-specific route).
  async function runValidate(p: OrgProvider) {
    setBusy(`validate:${p.id}`);
    try {
      const r = await validateProvider(p.id);
      r.valid
        ? toast.success("Credentials valid", { description: `${r.latency_ms.toFixed(0)}ms` })
        : toast.error("Credentials invalid", { description: r.message });
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setBusy(null);
    }
  }

  async function runRefresh(p: OrgProvider) {
    setBusy(`refresh:${p.id}`);
    try {
      const d = await discoverProviderModels(p.id);
      toast.success("Model discovery finished", { description: d.message });
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setBusy(null);
    }
  }

  async function runToggle(p: OrgProvider, active: boolean) {
    setBusy(`toggle:${p.id}`);
    try {
      await mut.updateOrgProvider.mutateAsync({ providerId: p.id, payload: { is_active: active } });
      toast.success(active ? `"${p.name}" enabled.` : `"${p.name}" disabled.`);
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setBusy(null);
    }
  }

  if (!canRead) {
    return <EmptyState title="Providers" description="You need provider-read permission to view organization providers." />;
  }

  return (
    <div className="space-y-2" data-testid="org-providers">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          {providers.data ? `${providers.data.length} provider${providers.data.length === 1 ? "" : "s"}` : "Organization providers"}
        </p>
        {canManage && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setCatalogOpen(true)} data-testid="org-prov-browse-catalog">
              Browse catalog
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="org-prov-create-open">
              <Building2 className="size-3.5" aria-hidden /> New provider
            </Button>
          </div>
        )}
      </div>

      {providers.isLoading && <LoadingState message="Loading providers…" />}
      {providers.isError && isNotFound(providers.error) && (
        <EmptyState title="Providers aren't available yet"
          description="The organization provider service is still rolling out. Personal providers keep working." />
      )}
      {providers.isError && !isNotFound(providers.error) && (
        <ErrorState title="Could not load providers"
          message={parseApiError(providers.error).message}
          onRetry={() => void providers.refetch()} />
      )}
      {!providers.isLoading && !providers.isError && (providers.data ?? []).length === 0 && (
        <EmptyState title="No organization providers"
          description="Connect a shared provider so every member bills against one pool."
          action={canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="org-prov-create-open-empty">
              Add provider
            </Button>
          ) : undefined} />
      )}
      {(providers.data ?? []).map((p) => {
        const masked = p.credentials_masked ?? p.credentials;
        const active = p.is_active !== false;
        return (
          <Card key={p.id} data-testid={`org-prov-${p.id}`}>
            <CardContent className="flex flex-wrap items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{p.name}</p>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{typeLabel(p)}</p>
                {masked && Object.keys(masked).length > 0 && (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">
                    {Object.entries(masked).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                  </p>
                )}
                {(p.validation_message ?? p.message) ? (
                  <p className="mt-0.5 truncate text-[11px] text-zinc-400">{p.validation_message ?? p.message}</p>
                ) : null}
              </div>
              <StatusBadge status={statusValue(p)} label={statusLabel(p)} />
              <Badge variant="outline">{typeLabel(p)}</Badge>
              {!active && <Badge variant="destructive">Disabled</Badge>}
              {canManage && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => void runValidate(p)}
                    disabled={busy !== null} data-testid={`org-prov-validate-${p.id}`}
                    title="Validate credentials">
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    {busy === `validate:${p.id}` ? "…" : "Validate"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void runRefresh(p)}
                    disabled={busy !== null} data-testid={`org-prov-refresh-${p.id}`}
                    title="Refresh discovered models">
                    <RefreshCw className="size-3.5" aria-hidden />
                    {busy === `refresh:${p.id}` ? "…" : "Refresh"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}
                    data-testid={`org-prov-edit-${p.id}`} title="Edit provider">
                    <Pencil className="size-3.5" aria-hidden /> Edit
                  </Button>
                  <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <Switch
                      checked={active}
                      onCheckedChange={(v) => void runToggle(p, v)}
                      disabled={busy !== null}
                      aria-label={`Enable ${p.name}`}
                      data-testid={`org-prov-toggle-${p.id}`}
                    />
                    <span className="text-[10px]">{active ? "On" : "Off"}</span>
                  </label>
                  <Button size="sm" variant="outline" onClick={() => setDeleting(p)}
                    data-testid={`org-prov-delete-${p.id}`}>
                    Remove
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {createOpen && (
        <ProviderWizardModal
          key={catalogPrefill?.slug ?? catalogPrefill?.family ?? "new"}
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            setCatalogPrefill(null);
          }}
          ownership={{ type: "org", orgId }}
          orgName={orgName}
          existingNames={orgProviderNames}
          initialType={catalogPrefill?.family ?? null}
          initialName={catalogPrefill?.name ?? null}
          catalogSlug={catalogPrefill?.slug ?? null}
          initialBaseUrl={catalogPrefill?.baseUrl ?? null}
        />
      )}

      {catalogOpen && (
        <CatalogBrowserDialog
          open={catalogOpen}
          onClose={() => setCatalogOpen(false)}
          onConfigure={(p, family, opts) => {
            if (!family) return;
            setCatalogOpen(false);
            setCatalogPrefill({
              family,
              name: p.name,
              slug: p.slug,
              baseUrl: opts?.viaCustom ? (p.api_base_url ?? null) : null,
            });
            setCreateOpen(true);
          }}
        />
      )}

      {editing && (
        <OrgProviderEditDialog orgId={orgId} provider={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)} />
      )}

      <ConfirmDialog open={deleting !== null} title={`Remove provider "${deleting?.name}"?`} destructive
        confirmLabel="Remove provider" testId="org-prov-delete-dialog"
        description="Members lose access to this shared provider immediately. Personal providers are unaffected."
        onClose={() => setDeleting(null)}
        onConfirm={() => remove().then(() => setDeleting(null))} />
    </div>
  );
}

function OrgProviderEditDialog({ orgId, provider, onClose, onSaved }: {
  orgId: string;
  provider: OrgProvider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const mut = useOrgMutations(orgId);
  const [name, setName] = useState(provider.name);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = (provider.provider_type ?? provider.type ?? "OPENAI") as ProviderType;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const credentials = Object.fromEntries(Object.entries(creds).filter(([, v]) => v !== ""));
      await mut.updateOrgProvider.mutateAsync({
        providerId: provider.id,
        payload: {
          name: name.trim(),
          ...(Object.keys(credentials).length ? { credentials } : {}),
        },
      });
      toast.success(`Provider "${name.trim()}" updated.`);
      onSaved();
    } catch (e) {
      setError(isRotatePermError(e) ? ROTATE_PERM_COPY : parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(n) => { if (!n && !busy) onClose(); }}>
      <DialogContent className="max-w-md p-4" data-testid="org-prov-edit-dialog">
        <DialogTitle className="text-sm font-semibold">Edit organization provider</DialogTitle>
        <DialogDescription>
          Leave credential fields empty to keep the stored values.
        </DialogDescription>
        <div className="mt-3 space-y-3">
          <Field label="Provider name">
            <Input value={name} onChange={(e) => setName(e.target.value)}
              maxLength={80} data-testid="org-prov-edit-name" />
          </Field>
          {(CREDENTIAL_FIELDS[type] ?? []).map(([key, spec]) => (
            <Field key={key} label={`${spec.label} (unchanged if empty)`}>
              {spec.multiline ? (
                <Textarea rows={3} value={creds[key] ?? ""}
                  onChange={(e) => setCreds((p) => ({ ...p, [key]: e.target.value }))}
                  data-testid={`org-prov-edit-cred-${key}`}
                  placeholder={spec.secret ? "••••••••••••••••" : ""} />
              ) : (
                <Input type={spec.secret ? "password" : "text"} value={creds[key] ?? ""}
                  onChange={(e) => setCreds((p) => ({ ...p, [key]: e.target.value }))}
                  data-testid={`org-prov-edit-cred-${key}`}
                  placeholder={spec.secret ? "••••••••••••••••" : ""} />
              )}
            </Field>
          ))}
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => void submit()}
              disabled={name.trim().length < 2 || busy} data-testid="org-prov-edit-submit">
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
