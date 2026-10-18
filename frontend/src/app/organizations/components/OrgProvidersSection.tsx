"use client";

import { useMemo, useState } from "react";
import { Building2, CheckCircle2, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Badge, Button, Card, CardContent,
  EmptyState, ErrorState,
  LoadingState, Switch,
} from "@/components/ui";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ConfirmDialog } from "./Dialogs";
import { useOrgMutations, useOrgProviders } from "@/hooks/useOrgs";
import { useProviderHealthActions } from "@/hooks/useProviderHealth";
import { parseApiError } from "@/lib/errors";
import { ApiError } from "@/services/api";
import { providerTypeLabel } from "@/app/providers/fields";
import { CatalogBrowserDialog } from "@/app/providers/components/CatalogBrowser";
import { ProviderWizardModal } from "@/app/providers/components/ProviderWizardModal";
import type { Provider, ProviderType } from "@/types";
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
  // Validate/refresh share the provider health hook with the personal page.
  const { busy, runValidate, runDiscover, track } = useProviderHealthActions();

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

  async function runToggle(p: OrgProvider, active: boolean) {
    await track(`toggle:${p.id}`, async () => {
      try {
        await mut.updateOrgProvider.mutateAsync({ providerId: p.id, payload: { is_active: active } });
        toast.success(active ? `"${p.name}" enabled.` : `"${p.name}" disabled.`);
      } catch (e) {
        toast.error(parseApiError(e).message);
      }
    });
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
                  <Button size="sm" variant="outline" onClick={() => void runValidate(p.id)}
                    disabled={busy !== null} data-testid={`org-prov-validate-${p.id}`}
                    title="Validate credentials">
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    {busy === `validate:${p.id}` ? "…" : "Validate"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void runDiscover(p.id)}
                    disabled={busy !== null} data-testid={`org-prov-refresh-${p.id}`}
                    title="Refresh discovered models">
                    <RefreshCw className="size-3.5" aria-hidden />
                    {busy === `discover:${p.id}` ? "…" : "Refresh"}
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
        <ProviderWizardModal
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          editingProvider={editing as unknown as Provider}
          ownership={{ type: "org", orgId }}
          orgName={orgName}
          existingNames={orgProviderNames}
          onSaved={() => setEditing(null)}
        />
      )}

      <ConfirmDialog open={deleting !== null} title={`Remove provider "${deleting?.name}"?`} destructive
        confirmLabel="Remove provider" testId="org-prov-delete-dialog"
        description="Members lose access to this shared provider immediately. Personal providers are unaffected."
        onClose={() => setDeleting(null)}
        onConfirm={() => remove().then(() => setDeleting(null))} />
    </div>
  );
}
