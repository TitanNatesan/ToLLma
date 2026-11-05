"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/lib/notify";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  LoadingState,
  SearchInput,
  Select,
  StatusBadge,
  Switch,
  Tooltip,
} from "@/components/ui";
import { ConfirmDialog } from "@/app/api-keys/components/ConfirmDialog";
import { parseApiError } from "@/lib/errors";
import { fmtPrice } from "@/lib/utils";
import {
  useModelMutations,
  useModels,
  useProviderMutations,
  useProviders,
} from "@/hooks/useRegistry";
import { useProviderHealthActions } from "@/hooks/useProviderHealth";
import {
  isNotFoundError,
  useOrgMutations,
  useOrgProviderModels,
  useOrgProviders,
  useOrgs,
} from "@/hooks/useOrgs";
import { useChatStore } from "@/store/chat";
import { useOrgStore } from "@/store/org";
import { ProviderWizardModal } from "./components/ProviderWizardModal";
import { ModelDetailDrawer } from "./components/ModelDetailDrawer";
import { RegisterModelDrawer } from "./components/RegisterModelDrawer";
import { CAPS, ModelForm, fromModel, toPayload } from "./components/ModelForm";
import {
  ENDPOINT_OPTIONS,
  endpointLabel,
  providerTypeLabel,
  resolveWireEndpoint,
} from "./fields";
import type { AIModel, DiscoveredModelInfo, Provider, ProviderType } from "@/types";
import { CatalogBrowserDialog } from "./components/CatalogBrowser";
import {
  CheckCircle2,
  Cpu,
  KeyRound,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CTX_OPTIONS = [
  { label: "Any context", min: 0 },
  { label: "≥ 32k", min: 32000 },
  { label: "≥ 128k", min: 128000 },
  { label: "≥ 1M", min: 1000000 },
];

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function fmtPriceShort(v: unknown): string {
  return fmtPrice(v);
}

/** Sticky filter bar shared by both model-list columns: same offset in the
 *  unified scroll container, parent-matched bg so there is no solid seam. */
const STICKY_FILTER_BAR =
  "sticky -top-4 z-10 -mx-4 bg-zinc-50/30 px-4 pt-4 pb-2 dark:bg-zinc-950/30";

const MATCH_BADGE: Record<string, string> = {
  provider_specific: "Exact match",
  global: "Repository",
  fallback: "Unmatched",
};

export default function ProvidersPage() {
  // useSearchParams (?provider= deep link) needs a Suspense boundary or the
  // production build fails.
  return (
    <Suspense fallback={<LoadingState message="Loading providers…" className="flex-1 py-16" />}>
      <ProvidersPageInner />
    </Suspense>
  );
}

function ProvidersPageInner() {
  // Scope: personal workspace behaves exactly as before; an org context
  // reuses this identical UI with org data (each scope reads its own list
  // query, so org rows never mix with personal rows and vice versa).
  const context = useOrgStore((st) => st.context);
  const isOrg = context.type === "org";
  const orgId = isOrg ? context.orgId : null;
  const orgName = isOrg ? context.orgName : null;

  // The org list carries the viewer's effective perms (is_root/permissions),
  // the same fields the org dashboard gates on — no extra detail fetch.
  const orgs = useOrgs();
  const orgEntry = orgId ? (orgs.data ?? []).find((o) => o.id === orgId) : undefined;
  const canOrg = (code: string) =>
    !!orgEntry && (orgEntry.is_root || orgEntry.permissions.includes(code));
  // Gates mirror the deleted OrgProvidersSection call site (verified before
  // delete): read needs Providers.Read; manage needs Create (Update kept —
  // the old call site granted it too, so updaters keep their Edit button).
  const canRead = !isOrg || canOrg("Providers.Read");
  const canManage = !isOrg || canOrg("Providers.Create") || canOrg("Providers.Update");

  const personalProvidersQuery = useProviders();
  const orgProvidersQuery = useOrgProviders(orgId ?? "", { enabled: isOrg && canRead });
  // The org endpoint returns the same ProviderRead shape as personal, so the
  // workspace below consumes it directly (cast only — no remap to drift).
  // Memoized so the scope-derived list keeps a stable identity for downstream
  // memos (the scope branch itself is render-time derivation, no waterfall).
  const providers: Provider[] = useMemo(
    () =>
      isOrg
        ? ((orgProvidersQuery.data ?? []) as unknown as Provider[])
        : (personalProvidersQuery.data ?? []),
    [isOrg, orgProvidersQuery.data, personalProvidersQuery.data],
  );
  const providersQuery = isOrg ? orgProvidersQuery : personalProvidersQuery;
  // Personal model endpoints 404 org rows (personal_only); org models are
  // registered atomically in the wizard — so org scope skips the list and
  // the register/edit/toggle/delete controls below stay personal-only.
  const modelsQuery = useModels(undefined, undefined, { enabled: !isOrg });
  const allModels = modelsQuery.data ?? [];
  const pm = useProviderMutations();
  const mm = useModelMutations();
  const orgMut = useOrgMutations(orgId ?? undefined);
  const orgProviderNames = useMemo(() => providers.map((pr) => pr.name), [providers]);

  const {
    selectedProviderId,
    setSelectedProviderId,
    addProviderOpen,
    setAddProviderOpen,
    catalogOpen,
    setCatalogOpen,
    catalogPrefill,
    setCatalogPrefill,
    leftSidebarOpen,
    setLeftSidebar,
  } = useChatStore();

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [discoverMsg, setDiscoverMsg] = useState<Record<string, string>>({});
  const { busy, runValidate, runDiscover, track } = useProviderHealthActions({
    onDiscovered: (id, message) => setDiscoverMsg((prev) => ({ ...prev, [id]: message })),
  });

  // Org enable/disable (the personal page has no provider toggle; the
  // deleted org section did — preserved here so the capability survives).
  async function runToggleProvider(pr: Provider, active: boolean) {
    if (!orgId) return;
    await track(`toggle:${pr.id}`, async () => {
      try {
        await orgMut.updateOrgProvider.mutateAsync({ providerId: pr.id, payload: { is_active: active } });
        toast.success(active ? `"${pr.name}" enabled.` : `"${pr.name}" disabled.`);
      } catch (e) {
        toast.error(parseApiError(e).message);
      }
    });
  }
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [drawerModel, setDrawerModel] = useState<AIModel | null>(null);
  const [registeredSearch, setRegisteredSearch] = useState("");
  const [availableSearch, setAvailableSearch] = useState("");
  const [availableCap, setAvailableCap] = useState("ALL");
  const [availableType, setAvailableType] = useState("ALL");
  const [availableCtx, setAvailableCtx] = useState(0);
  const [registerInfo, setRegisterInfo] = useState<DiscoveredModelInfo | null>(null);
  const [registerStep, setRegisterStep] = useState(0);
  const [lastRegisteredId, setLastRegisteredId] = useState<string | null>(null);
  const [deleteProviderTarget, setDeleteProviderTarget] = useState<Provider | null>(null);
  const [deleteModelTarget, setDeleteModelTarget] = useState<AIModel | null>(null);

  // Determine active provider: either from store or first available provider
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Deep link (?provider=): selecting a provider keeps the id in the URL so
  // the detail view is shareable and survives reload.
  useEffect(() => {
    const param = searchParams.get("provider");
    if (param && providers.some((pr) => pr.id === param) && param !== selectedProviderId) {
      setSelectedProviderId(param);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, providers]);
  const activeId =
    selectedProviderId && providers.some((p) => p.id === selectedProviderId)
      ? selectedProviderId
      : providers[0]?.id ?? null;
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if ((params.get("provider") ?? null) === (activeId ?? null)) return;
    if (activeId) params.set("provider", activeId);
    else params.delete("provider");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProviderId, providers]);

  const selected = providers.find((p) => p.id === activeId) ?? null;
  const orgModelsQuery = useOrgProviderModels(orgId ?? "", activeId, { enabled: isOrg && canRead });
  const selectedModels = isOrg
    ? (orgModelsQuery.data ?? [])
    : allModels.filter((m) => m.provider_id === activeId);

  // Discovery cache (written by Refresh; never registers anything by itself).
  const discovery = (() => {
    const d = selected?.metadata?.discovery as
      | { models?: unknown; last_discovery_at?: unknown }
      | undefined;
    if (!d || !Array.isArray(d.models)) return null;
    return {
      models: d.models as DiscoveredModelInfo[],
      last_discovery_at:
        typeof d.last_discovery_at === "string" ? d.last_discovery_at : null,
    };
  })();
  const registeredIds = new Set(selectedModels.map((m) => m.model_id));
  const available = (discovery?.models ?? []).filter((m) => !registeredIds.has(m.model_id));
  const filteredAvailable = available.filter((m) => {
    const q = availableSearch.trim().toLowerCase();
    if (
      q &&
      !m.name.toLowerCase().includes(q) &&
      !m.model_id.toLowerCase().includes(q) &&
      !(m.repository_model_key ?? "").toLowerCase().includes(q)
    )
      return false;
    if (availableCap !== "ALL" && (m.suggested?.[availableCap] as unknown) !== true) return false;
    if (
      availableType !== "ALL" &&
      resolveWireEndpoint(m.primary_endpoint, m.endpoint_type) !== availableType
    )
      return false;
    const ctxVal = m.context_window ?? (m.suggested?.context_window ? Number(m.suggested.context_window) : null);
    if (availableCtx > 0 && !(ctxVal && ctxVal >= availableCtx)) return false;
    return true;
  });
  const hiddenCount = available.length - filteredAvailable.length;

  const filteredRegistered = selectedModels.filter(
    (m) =>
      !registeredSearch ||
      m.name.toLowerCase().includes(registeredSearch.toLowerCase()) ||
      m.model_id.toLowerCase().includes(registeredSearch.toLowerCase()),
  );

  async function confirmDeleteProvider() {
    if (!deleteProviderTarget) return;
    if (isOrg && orgId) {
      await orgMut.deleteOrgProvider.mutateAsync(deleteProviderTarget.id);
    } else {
      await pm.remove.mutateAsync(deleteProviderTarget.id);
    }
    if (selectedProviderId === deleteProviderTarget.id) setSelectedProviderId(null);
    setDeleteProviderTarget(null);
    toast.success(isOrg ? `Provider "${deleteProviderTarget.name}" removed.` : "Provider deleted");
  }

  // Org scope without read permission mirrors the deleted section's gate.
  if (isOrg && !canRead) {
    if (orgs.isPending) {
      return (
        <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden p-8">
          <LoadingState message="Loading organization…" />
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden p-8">
        <EmptyState
          title="Providers"
          description="You need provider-read permission to view organization providers."
        />
      </div>
    );
  }

  async function confirmDeleteModel() {
    if (!deleteModelTarget) return;
    if (isOrg && orgId) {
      await orgMut.deleteOrgModel.mutateAsync(deleteModelTarget.id);
    } else {
      await mm.remove.mutateAsync(deleteModelTarget.id);
    }
    setDeleteModelTarget(null);
    toast.success("Model deleted");
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Three-Panel Workspace: Center (Details) & Right (Models) */}
      <section
        className="flex min-w-0 flex-1 flex-col overflow-y-auto divide-zinc-200 xl:flex-row xl:overflow-hidden xl:divide-x dark:divide-zinc-800"
        aria-label="Provider details"
      >
        {providersQuery.isPending ? (
          <LoadingState message="Loading providers…" className="flex-1 py-16" />
        ) : providersQuery.error ? (
          isOrg && isNotFoundError(providersQuery.error) ? (
            <EmptyState
              title="Providers aren't available yet"
              description="The organization provider service is still rolling out. Personal providers keep working."
              className="flex-1"
            />
          ) : (
            <ErrorState
              title="Could not load providers"
              message={parseApiError(providersQuery.error).message}
              onRetry={() => void providersQuery.refetch()}
              className="flex-1"
            />
          )
        ) : !selected ? (
          <div className="relative flex flex-1 items-center justify-center p-8">
            {!leftSidebarOpen && (
              <div className="absolute top-4 left-4 md:hidden">
                <Tooltip content="Show sidebar">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
                    onClick={() => setLeftSidebar(true)}
                    aria-label="Open sidebar"
                    data-testid="left-sidebar-toggle"
                  >
                    <PanelLeftOpen className="size-4" />
                    <span>Show Providers</span>
                  </Button>
                </Tooltip>
              </div>
            )}
            <Card
              className="max-w-md text-center p-6 border-zinc-200 dark:border-zinc-800 shadow-sm"
              data-testid="no-provider-selected"
            >
              <CardContent className="flex flex-col items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <Cpu className="size-6" />
                </div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Select a provider
                </h2>
                <p className="text-xs text-zinc-500">
                  Choose a provider from the sidebar to validate credentials, discover models, and register models.
                </p>
                {(!isOrg || canManage) && (
                  <Button
                    size="sm"
                    onClick={() => setAddProviderOpen(true)}
                    className="gap-1.5 text-xs mt-2"
                  >
                    <Plus className="size-3.5" />
                    Add Provider
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            {/* Center Panel: Provider Details & Health */}
            <div
              className="flex w-full flex-col bg-white dark:bg-zinc-950 min-h-[300px] xl:w-2/5 xl:min-h-0 xl:overflow-y-auto"
              data-testid="provider-detail"
            >
              {/* Header */}
              <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    {!leftSidebarOpen && (
                      <Tooltip content="Show sidebar">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-zinc-500 -ml-1 mr-1 md:hidden"
                          onClick={() => setLeftSidebar(true)}
                          aria-label="Open sidebar"
                          data-testid="left-sidebar-toggle"
                        >
                          <PanelLeftOpen className="size-4" />
                        </Button>
                      </Tooltip>
                    )}
                    <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {selected.name}
                    </h1>
                    <Badge variant="outline" className="text-xs">
                      {providerTypeLabel(selected.provider_type)}
                    </Badge>
                    {isOrg ? (
                      <Badge
                        variant="secondary"
                        className="text-xs"
                        data-testid="provider-scope-org"
                        title="Organization providers are shared with every member"
                      >
                        {orgName ?? "Organization"}
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="text-xs"
                        data-testid="provider-scope-personal"
                        title="Personal providers are visible only to you"
                      >
                        Personal
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(!isOrg || canManage) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => {
                          setEditingProvider(selected);
                          setAddProviderOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                        <span>Edit</span>
                      </Button>
                    )}
                    {isOrg && (
                      <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <Switch
                          checked={selected.is_active !== false}
                          onCheckedChange={(v) => void runToggleProvider(selected, v)}
                          disabled={busy !== null || !canManage}
                          aria-label={`Enable ${selected.name}`}
                          data-testid={`org-prov-toggle-${selected.id}`}
                        />
                        <span className="text-[10px]">{selected.is_active !== false ? "On" : "Off"}</span>
                      </label>
                    )}
                    {(!isOrg || canManage) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20"
                        onClick={() => setDeleteProviderTarget(selected)}
                        data-testid={`provider-delete-${selected.id}`}
                        title="Delete provider"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <StatusBadge
                    status={selected.validation_status}
                    label={
                      selected.validation_status === "valid"
                        ? "Valid"
                        : selected.validation_status === "invalid"
                          ? "Invalid"
                          : "Unvalidated"
                    }
                  />
                  <Badge variant="secondary" className="text-xs">
                    {selectedModels.length} models
                  </Badge>
                  {selected.last_validated_at && (
                    <span
                      className="text-xs text-zinc-500"
                      data-testid={`validation-time-${selected.id}`}
                      title={selected.validation_message ?? ""}
                    >
                      checked {new Date(selected.last_validated_at).toLocaleString()}
                    </span>
                  )}
                </div>

                {selected.validation_message && (
                  <p
                    className="mt-1.5 text-xs text-zinc-500"
                    data-testid={`validation-${selected.id}`}
                  >
                    {selected.validation_message}
                  </p>
                )}
              </div>

              {/* Provider Details Card / Testing */}
              <div className="p-4 space-y-4">
                {/* Credentials overview */}
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/30">
                  <div className="flex items-center gap-2 mb-2">
                    <KeyRound className="size-3.5 text-zinc-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Credentials
                    </span>
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {Object.entries(selected.credentials_masked).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="text-zinc-400 font-mono text-[11px]">{k}:</dt>
                        <dd className="font-mono text-[11px] truncate font-medium">{v}</dd>
                      </div>
                    ))}
                    {Object.keys(selected.credentials_masked).length === 0 && (
                      <div className="text-xs text-zinc-400">No credentials configured</div>
                    )}
                  </dl>
                </div>

                {/* Operations Toolbar: only Validate + Refresh models */}
                {(!isOrg || canManage) && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => runValidate(selected.id)}
                      disabled={busy !== null}
                      data-testid={`validate-${selected.id}`}
                    >
                      <CheckCircle2 className="size-3.5 text-tollma-500" />
                      {busy === `validate:${selected.id}` ? "Checking…" : "Validate"}
                    </Button>

                    <Button variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => runDiscover(selected.id)}
                      disabled={busy !== null}
                      data-testid={`discover-${selected.id}`}
                    >
                      <RefreshCw
                        className={cn(
                          "size-3.5 text-tollma-500",
                          busy === `discover:${selected.id}` && "animate-spin",
                        )}
                      />
                      {busy === `discover:${selected.id}` ? "Discovering…" : "Refresh models"}
                    </Button>
                  </div>
                )}

                {discoverMsg[selected.id] && (
                  <div
                    className="p-2.5 rounded-lg border border-tollma-200 bg-tollma-50 text-xs text-tollma-800 dark:border-tollma-900/40 dark:bg-tollma-950/20 dark:text-tollma-300"
                    data-testid={`discover-result-${selected.id}`}
                  >
                    {discoverMsg[selected.id]}
                  </div>
                )}

                {/* Discovery statistics */}
                <div
                  className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400"
                  data-testid="discovery-stats"
                >
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Discovery
                  </div>
                  <dl className="grid grid-cols-2 gap-2">
                    <div className="flex justify-between gap-2">
                      <dt>Available Models:</dt>
                      <dd className="font-semibold text-zinc-900 dark:text-zinc-100">{available.length}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Registered Models:</dt>
                      <dd className="font-semibold text-zinc-900 dark:text-zinc-100">{selectedModels.length}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Hidden Models:</dt>
                      <dd className="font-semibold text-zinc-900 dark:text-zinc-100">{hiddenCount}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Last Discovery:</dt>
                      <dd className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {timeAgo(discovery?.last_discovery_at ?? null)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>

            {/* Right side: Available (unregistered) + Registered panels */}
            {modelsQuery.error && !modelsQuery.isPending ? (
              <div className="flex flex-1 items-center justify-center bg-zinc-50/30 p-4 dark:bg-zinc-950/30">
                <ErrorState
                  title="Could not load models"
                  message={parseApiError(modelsQuery.error).message}
                  onRetry={() => void modelsQuery.refetch()}
                />
              </div>
            ) : (
            <div className="flex flex-1 flex-col bg-zinc-50/30 dark:bg-zinc-950/30 min-h-[300px] xl:flex-row xl:overflow-hidden">
              {/* LEFT: Available Models */}
              <div className="flex flex-1 flex-col border-b border-zinc-200 p-4 dark:border-zinc-800 xl:min-h-0 xl:overflow-y-auto xl:border-b-0 xl:border-r">
                <div className={STICKY_FILTER_BAR}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Available Models
                  </h2>
                  <Badge variant="secondary" className="text-xs">
                    {available.length}
                  </Badge>
                </div>
                <SearchInput
                  placeholder="Search name, ID, repository…"
                  value={availableSearch}
                  onChange={(e) => setAvailableSearch(e.target.value)}
                  onClear={() => setAvailableSearch("")}
                  className="h-8"
                  data-testid="available-search"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <div className="w-36">
                    <Select
                      sizeVariant="sm"
                      value={availableCap}
                      onChange={(e) => setAvailableCap(e.target.value)}
                      data-testid="available-cap"
                      aria-label="Filter by capability"
                    >
                      <option value="ALL">All capabilities</option>
                      {CAPS.map(([k, label]) => (
                        <option key={k} value={k}>{label}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-32">
                    <Select
                      sizeVariant="sm"
                      value={availableType}
                      onChange={(e) => setAvailableType(e.target.value)}
                      data-testid="available-type"
                      aria-label="Filter by model type"
                    >
                      <option value="ALL">All types</option>
                      {ENDPOINT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-32">
                    <Select
                      sizeVariant="sm"
                      value={availableCtx}
                      onChange={(e) => setAvailableCtx(Number(e.target.value))}
                      data-testid="available-ctx"
                      aria-label="Filter by context window"
                    >
                      {CTX_OPTIONS.map((o) => (
                        <option key={o.label} value={o.min}>{o.label}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                </div>

                <div className="mt-3 grid gap-2">
                  {filteredAvailable.map((m) => (
                    <div
                      key={m.model_id}
                      data-testid={`available-row-${m.model_id}`}
                      className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                            {m.name}
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {endpointLabel(m.primary_endpoint ?? m.endpoint_type)}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className="text-[9px] px-1.5 py-0"
                            data-testid={`avail-match-${m.model_id}`}
                          >
                            {MATCH_BADGE[m.match_type] ?? m.match_type}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          {m.model_id} · in {fmtPriceShort(m.suggested?.input_price)}/1M · out{" "}
                          {fmtPriceShort(m.suggested?.output_price)}/1M
                          {(() => {
                            const c = m.context_window ?? (m.suggested?.context_window ? Number(m.suggested.context_window) : null);
                            return c ? ` · ctx ${(c / 1000).toFixed(0)}k` : "";
                          })()}
                        </p>
                      </div>
                      {(!isOrg || canManage) && (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => {
                              setRegisterInfo(m);
                              setRegisterStep(2);
                            }}
                            data-testid={`register-${m.model_id}`}
                          >
                            Register
                          </Button>
                          <Button variant="outline"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => {
                              setRegisterInfo(m);
                              setRegisterStep(0);
                            }}
                            data-testid={`available-details-${m.model_id}`}
                          >
                            View Details
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {available.length === 0 && (
                    <EmptyState
                      icon={Cpu}
                      title="No available models"
                      description={
                        discovery
                          ? "All discovered models are registered."
                          : "No discovered models yet — click Refresh models to discover."
                      }
                      testId="no-available-models"
                    />
                  )}
                  {available.length > 0 && filteredAvailable.length === 0 && (
                    <EmptyState
                      icon={Search}
                      title="No matching models"
                      description="No available models match the current filters."
                      testId="no-available-match"
                    />
                  )}
                </div>
              </div>

              {/* RIGHT: Registered Models */}
              <div className="flex flex-1 flex-col p-4 xl:min-h-0 xl:overflow-y-auto">
                <div className={STICKY_FILTER_BAR}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Registered Models
                  </h2>
                  <Badge variant="secondary" className="text-xs">
                    {selectedModels.length}
                  </Badge>
                </div>
                <SearchInput
                  placeholder="Search registered…"
                  value={registeredSearch}
                  onChange={(e) => setRegisteredSearch(e.target.value)}
                  onClear={() => setRegisteredSearch("")}
                  className="h-8"
                  data-testid="registered-search"
                />
                </div>

                {/* Inline edit form (registered models only) */}
                {(!isOrg || canManage) && showEditForm && editingModel && (
                  <div className="mt-3">
                    <ModelForm
                      initial={fromModel(editingModel)}
                      onCancel={() => {
                        setShowEditForm(false);
                        setEditingModel(null);
                      }}
                      onSubmit={async (f) => {
                        try {
                          const { model_id: _omit, provider_id: _omit2, ...rest } = toPayload(
                            selected.id,
                            f,
                          );
                          if (isOrg && orgId) {
                            await orgMut.updateOrgModel.mutateAsync({
                              modelId: editingModel.id,
                              payload: rest,
                            });
                          } else {
                            await mm.update.mutateAsync({ id: editingModel.id, body: rest });
                          }
                          toast.success("Model updated");
                          setShowEditForm(false);
                          setEditingModel(null);
                        } catch (e) {
                          toast.error("Save failed", {
                            description: e instanceof Error ? e.message : "unknown error",
                          });
                        }
                      }}
                    />
                  </div>
                )}

                <div className="mt-3 grid gap-2.5">
                  {filteredRegistered.map((m) => (
                    <div
                      key={m.id}
                      data-testid={`model-row-${m.id}`}
                      onClick={() => setDrawerModel(m)}
                      className={cn(
                        "group flex flex-col xl:flex-row xl:items-center justify-between gap-2.5 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition-all hover:border-zinc-300 hover:shadow dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700 cursor-pointer",
                        !m.is_active && "opacity-60",
                        lastRegisteredId === m.id &&
                          "border-tollma-400 bg-tollma-50/60 dark:border-tollma-700 dark:bg-tollma-950/20",
                      )}
                    >
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                            {m.name}
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {endpointLabel(m.primary_endpoint ?? m.endpoint_type)}
                          </Badge>
                          {!m.is_active && (
                            <Badge variant="destructive" className="text-[9px] px-1 py-0">
                              Disabled
                            </Badge>
                          )}
                          {lastRegisteredId === m.id && (
                            <Badge className="bg-tollma-600 text-[9px] px-1.5 py-0 text-white">
                              Just registered
                            </Badge>
                          )}
                        </div>

                        <p className="text-[11px] text-zinc-500">
                          {m.model_id} · in {fmtPrice(m.input_price)}/1M · out {fmtPrice(m.output_price)}/1M
                          {m.context_window ? ` · ctx ${(m.context_window / 1000).toFixed(0)}k` : ""}
                          {m.max_output_tokens ? ` · max ${(m.max_output_tokens / 1000).toFixed(0)}k` : ""}
                        </p>

                        <div className="flex flex-wrap gap-1">
                          {CAPS.filter(([k]) => (m as unknown as Record<string, boolean>)[k]).map(
                            ([, label]) => (
                              <Badge key={label} variant="secondary" className="text-[9px] px-1.5 py-0">
                                {label}
                              </Badge>
                            ),
                          )}
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-2 shrink-0 self-end xl:self-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                          <Switch
                            checked={m.is_active}
                            disabled={isOrg && !canManage}
                            onCheckedChange={(v) => {
                              if (isOrg && orgId) {
                                orgMut.updateOrgModel.mutate({
                                  modelId: m.id,
                                  payload: { is_active: v },
                                });
                              } else {
                                mm.update.mutate({ id: m.id, body: { is_active: v } });
                              }
                            }}
                            aria-label={`Enable ${m.name}`}
                            data-testid={`model-toggle-${m.id}`}
                          />
                          <span className="text-[10px]">{m.is_active ? "On" : "Off"}</span>
                        </label>

                        {(!isOrg || canManage) && (
                          <>
                            <Button variant="outline"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                setEditingModel(m);
                                setShowEditForm(true);
                              }}
                              data-testid={`model-edit-${m.id}`}
                              title="Edit Model"
                            >
                              <Pencil className="size-3" />
                            </Button>

                            <Button variant="outline"
                              size="sm"
                              className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20"
                              onClick={() => setDeleteModelTarget(m)}
                              data-testid={`model-delete-${m.id}`}
                              title="Delete Model"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  {selectedModels.length === 0 && !showEditForm && (
                    <EmptyState
                      icon={Cpu}
                      title="No registered models"
                      description={
                        isOrg
                          ? "No registered models yet — models are added when the provider is connected."
                          : "No registered models — discover above, then Register from Available Models."
                      }
                      testId="no-registered-models"
                    />
                  )}
                </div>
              </div>
            </div>
            )}
          </>
        )}
      </section>

      {/* Model Detail Drawer (registered models) */}
      <ModelDetailDrawer
        model={drawerModel}
        provider={selected}
        open={!!drawerModel}
        onClose={() => setDrawerModel(null)}
        orgId={orgId ?? undefined}
        onEdit={(m) => {
          setDrawerModel(null);
          setEditingModel(m);
          setShowEditForm(true);
        }}
      />

      {/* Register Model Drawer (available -> registered) */}
      {registerInfo && (
        <RegisterModelDrawer
          key={`${selected?.id}:${registerInfo.model_id}:${registerStep}`}
          info={registerInfo}
          providerId={selected?.id ?? ""}
          open={!!registerInfo}
          orgId={orgId ?? undefined}
          initialStep={registerStep}
          onClose={() => setRegisterInfo(null)}
          onRegistered={(m) => {
            setLastRegisteredId(m.id);
            window.setTimeout(() => {
              setLastRegisteredId((cur) => (cur === m.id ? null : cur));
            }, 4000);
          }}
        />
      )}

      {/* Provider Wizard Modal (Add / Edit) */}
      {addProviderOpen && (
        <ProviderWizardModal
          key={editingProvider?.id ?? catalogPrefill?.slug ?? catalogPrefill?.family ?? "new"}
          open={addProviderOpen}
        onClose={() => {
          setAddProviderOpen(false);
          setEditingProvider(null);
          setCatalogPrefill(null);
        }}
        editingProvider={editingProvider}
        initialType={(catalogPrefill?.family ?? null) as ProviderType | null}
        initialName={catalogPrefill?.name ?? null}
        catalogSlug={catalogPrefill?.slug ?? null}
        initialBaseUrl={catalogPrefill?.baseUrl ?? null}
        ownership={isOrg && orgId ? { type: "org" as const, orgId } : undefined}
        orgName={isOrg ? orgName : undefined}
        existingNames={isOrg ? orgProviderNames : undefined}
        onSaved={(p, discMsg) => {
          setSelectedProviderId(p.id);
          if (discMsg) {
            setDiscoverMsg((s) => ({ ...s, [p.id]: discMsg }));
          }
        }}
        />
      )}

      {/* Models.dev provider catalog browser */}
      {catalogOpen && (
        <CatalogBrowserDialog
          open={catalogOpen}
          onClose={() => setCatalogOpen(false)}
          onConfigure={(p, family, opts) => {
            if (!family) return;
            setCatalogOpen(false);
            setEditingProvider(null);
            setCatalogPrefill({
              family,
              name: p.name,
              slug: p.slug,
              baseUrl: opts?.viaCustom ? (p.api_base_url ?? null) : null,
            });
            setAddProviderOpen(true);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteProviderTarget}
        destructive
        title={isOrg ? `Remove provider “${deleteProviderTarget?.name ?? ""}”?` : `Delete “${deleteProviderTarget?.name ?? ""}”?`}
        description={
          isOrg ? (
            "Members lose access to this shared provider immediately. Personal providers are unaffected."
          ) : (
            <>
              This permanently removes the provider
              {selectedModels.length > 0 && deleteProviderTarget?.id === selected?.id
                ? ` and its ${selectedModels.length} registered model${selectedModels.length === 1 ? "" : "s"}`
                : ""}
              . Chats using these models will need a new model. This action cannot be undone.
            </>
          )
        }
        confirmLabel={isOrg ? "Remove provider" : "Delete provider"}
        onConfirm={confirmDeleteProvider}
        onClose={() => setDeleteProviderTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteModelTarget}
        destructive
        title={`Delete “${deleteModelTarget?.name ?? ""}”?`}
        description="This permanently unregisters the model. Chats using it will need a new model. This action cannot be undone."
        confirmLabel="Delete model"
        onConfirm={confirmDeleteModel}
        onClose={() => setDeleteModelTarget(null)}
      />
    </div>
  );
}
