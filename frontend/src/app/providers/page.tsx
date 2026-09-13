"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  GhostButton,
  Input,
  SearchInput,
  Select,
  StatusBadge,
  Switch,
} from "@/components/ui";
import {
  useModelMutations,
  useModels,
  useProviderMutations,
  useProviders,
} from "@/hooks/useRegistry";
import { lookupRepositoryModel, resyncModel } from "@/services/api";
import { useChatStore } from "@/store/chat";
import { ProviderWizardModal } from "./components/ProviderWizardModal";
import { ModelDetailDrawer } from "./components/ModelDetailDrawer";
import { RepositoryCatalogModal } from "./components/RepositoryCatalogModal";
import { CAPS, EMPTY_MODEL_FORM, ModelForm, fromModel, toPayload } from "./components/ModelForm";
import type { AIModel, EndpointType, Provider } from "@/types";
import {
  CheckCircle2,
  Cpu,
  Database,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";


export default function ProvidersPage() {
  const { data: providers = [] } = useProviders();
  const { data: allModels = [] } = useModels();
  const pm = useProviderMutations();
  const mm = useModelMutations();

  const {
    selectedProviderId,
    setSelectedProviderId,
    addProviderOpen,
    setAddProviderOpen,
  } = useChatStore();

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [discoverMsg, setDiscoverMsg] = useState<Record<string, string>>({});
  const [showModelForm, setShowModelForm] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);
  const [drawerModel, setDrawerModel] = useState<AIModel | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);

  // Determine active provider: either from store or first available provider
  const activeId =
    selectedProviderId && providers.some((p) => p.id === selectedProviderId)
      ? selectedProviderId
      : providers[0]?.id ?? null;

  const selected = providers.find((p) => p.id === activeId) ?? null;
  const selectedModels = allModels.filter((m) => m.provider_id === activeId);

  const filteredModels = selectedModels.filter(
    (m) =>
      !modelSearch ||
      m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.model_id.toLowerCase().includes(modelSearch.toLowerCase()),
  );

  async function runValidate(id: string) {
    setBusy(`validate:${id}`);
    try {
      const r = await pm.validate.mutateAsync(id);
      r.valid
        ? toast.success("Credentials valid", { description: `${r.latency_ms.toFixed(0)}ms` })
        : toast.error("Credentials invalid", { description: r.message });
    } finally {
      setBusy(null);
    }
  }

  async function runDiscover(id: string) {
    setBusy(`discover:${id}`);
    try {
      const d = await pm.discover.mutateAsync(id);
      setDiscoverMsg((s) => ({ ...s, [id]: d.message }));
      toast.success("Model discovery finished", { description: d.message });
    } finally {
      setBusy(null);
    }
  }

  async function runSyncModels(id: string) {
    setBusy(`sync:${id}`);
    try {
      const linked = (allModels ?? []).filter((m) => m.provider_id === id && m.repository_model_key);
      let updated = 0;
      for (const m of linked) {
        const res = await resyncModel(m.id, false);
        updated += Object.keys(res.applied).length;
      }
      toast.success(
        linked.length === 0 ? "No repository-linked models to sync" : `Synced ${linked.length} models (${updated} fields updated)`,
      );
    } catch (e) {
      toast.error("Sync failed", { description: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Three-Panel Workspace: Center (Details) & Right (Models) */}
      <section
        className="flex min-w-0 flex-1 overflow-hidden divide-x divide-zinc-200 dark:divide-zinc-800"
        aria-label="Provider details"
      >
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8">
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
                  Choose a provider from the sidebar to manage credentials, test validation, and register models.
                </p>
                <Button
                  size="sm"
                  onClick={() => setAddProviderOpen(true)}
                  className="gap-1.5 text-xs mt-2"
                >
                  <Plus className="size-3.5" />
                  Add Provider
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            {/* Center Panel: Provider Details & Health */}
            <div
              className="flex w-full lg:w-2/5 flex-col overflow-y-auto bg-white dark:bg-zinc-950 min-h-[300px]"
              data-testid="provider-detail"
            >
              {/* Header */}
              <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {selected.name}
                    </h1>
                    <Badge variant="outline" className="font-mono text-xs">
                      {selected.provider_type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
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
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20"
                      onClick={() => {
                        pm.remove.mutate(selected.id);
                        setSelectedProviderId(null);
                        toast.success("Provider deleted");
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
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

                {/* Operations Toolbar */}
                <div className="flex flex-wrap gap-2">
                  <GhostButton
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => runValidate(selected.id)}
                    disabled={busy !== null}
                    data-testid={`validate-${selected.id}`}
                  >
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                    {busy === `validate:${selected.id}` ? "Checking…" : "Validate"}
                  </GhostButton>

                  <GhostButton
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => runDiscover(selected.id)}
                    disabled={busy !== null}
                    data-testid={`discover-${selected.id}`}
                  >
                    <RefreshCw
                      className={cn(
                        "size-3.5 text-blue-500",
                        busy === `discover:${selected.id}` && "animate-spin",
                      )}
                    />
                    {busy === `discover:${selected.id}` ? "Discovering…" : "Refresh models"}
                  </GhostButton>

                  <GhostButton
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setCatalogModalOpen(true)}
                  >
                    <Database className="size-3.5 text-purple-500" />
                    <span>Catalog Import</span>
                  </GhostButton>

                  <GhostButton
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => void runSyncModels(selected.id)}
                    disabled={busy !== null}
                    data-testid={`sync-models-${selected.id}`}
                  >
                    <RefreshCw
                      className={cn(
                        "size-3.5 text-amber-500",
                        busy === `sync:${selected.id}` && "animate-spin",
                      )}
                    />
                    {busy === `sync:${selected.id}` ? "Syncing…" : "Sync models"}
                  </GhostButton>
                </div>

                {discoverMsg[selected.id] && (
                  <div
                    className="p-2.5 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300"
                    data-testid={`discover-result-${selected.id}`}
                  >
                    {discoverMsg[selected.id]}
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Models Management & Table */}
            <div className="flex flex-1 flex-col overflow-y-auto bg-zinc-50/30 p-4 dark:bg-zinc-950/30 min-h-[300px]">
              {/* Models Header & Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Models
                  </h2>
                  <Badge variant="secondary" className="text-xs">
                    {selectedModels.length}
                  </Badge>
                </div>

                <div className="flex items-center gap-2">
                  <SearchInput
                    placeholder="Filter models…"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    onClear={() => setModelSearch("")}
                    className="w-48 h-8"
                  />
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs h-8"
                    onClick={() => {
                      setEditingModel(null);
                      setShowModelForm(true);
                    }}
                    data-testid="add-model"
                  >
                    <Plus className="size-3.5" />
                    <span>Add model</span>
                  </Button>
                </div>
              </div>

              {/* Inline Model Create/Edit Form */}
              {showModelForm && (
                <div className="mb-4">
                  <ModelForm
                    initial={editingModel ? fromModel(editingModel) : EMPTY_MODEL_FORM}
                    onCancel={() => {
                      setShowModelForm(false);
                      setEditingModel(null);
                    }}
                    onSubmit={async (f) => {
                      try {
                        if (editingModel) {
                          const { model_id: _omit, provider_id: _omit2, ...rest } = toPayload(
                            selected.id,
                            f,
                          );
                          await mm.update.mutateAsync({ id: editingModel.id, body: rest });
                          toast.success("Model updated");
                        } else {
                          await mm.create.mutateAsync(toPayload(selected.id, f));
                          toast.success("Model created");
                        }
                        setShowModelForm(false);
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

              {/* Models Table / Cards */}
              <div className="grid gap-2.5">
                {filteredModels.map((m) => (
                  <div
                    key={m.id}
                    data-testid={`model-row-${m.id}`}
                    onClick={() => setDrawerModel(m)}
                    className={cn(
                      "group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition-all hover:border-zinc-300 hover:shadow dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700 cursor-pointer",
                      !m.is_active && "opacity-60",
                    )}
                  >
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                          {m.name}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">
                          {m.endpoint_type}
                        </Badge>
                        {!m.is_active && (
                          <Badge variant="destructive" className="text-[9px] px-1 py-0">
                            Disabled
                          </Badge>
                        )}
                        {m.repository_model_key && (
                          <span className="text-[10px] text-zinc-400 font-mono hidden md:inline">
                            repo: {m.repository_model_key}
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-zinc-500">
                        {m.model_id} · in ${m.input_price}/1M · out ${m.output_price}/1M
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
                      className="flex items-center gap-2 shrink-0 self-end sm:self-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <Switch
                          checked={m.is_active}
                          onCheckedChange={(v) => mm.update.mutate({ id: m.id, body: { is_active: v } })}
                          aria-label={`Enable ${m.name}`}
                          data-testid={`model-toggle-${m.id}`}
                        />
                        <span className="text-[10px]">{m.is_active ? "On" : "Off"}</span>
                      </label>

                      <GhostButton
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => {
                          setEditingModel(m);
                          setShowModelForm(true);
                        }}
                        data-testid={`model-edit-${m.id}`}
                        title="Edit Model"
                      >
                        <Pencil className="size-3" />
                      </GhostButton>

                      <GhostButton
                        size="sm"
                        className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20"
                        onClick={() => mm.remove.mutate(m.id)}
                        data-testid={`model-delete-${m.id}`}
                        title="Delete Model"
                      >
                        <Trash2 className="size-3" />
                      </GhostButton>
                    </div>
                  </div>
                ))}

                {selectedModels.length === 0 && !showModelForm && (
                  <p className="text-xs text-zinc-400 py-8 text-center" data-testid="no-models">
                    No models yet — refresh to discover, or add one manually.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Model Detail Drawer */}
      <ModelDetailDrawer
        model={drawerModel}
        provider={selected}
        open={!!drawerModel}
        onClose={() => setDrawerModel(null)}
        onEdit={(m) => {
          setDrawerModel(null);
          setEditingModel(m);
          setShowModelForm(true);
        }}
      />

      {/* Provider Wizard Modal (Add / Edit) */}
      {addProviderOpen && (
        <ProviderWizardModal
          key={editingProvider?.id ?? "new"}
          open={addProviderOpen}
        onClose={() => {
          setAddProviderOpen(false);
          setEditingProvider(null);
        }}
        editingProvider={editingProvider}
        onSaved={(p, discMsg) => {
          setSelectedProviderId(p.id);
          if (discMsg) {
            setDiscoverMsg((s) => ({ ...s, [p.id]: discMsg }));
          }
        }}
        />
      )}

      {/* Repository Catalog Modal */}
      <RepositoryCatalogModal
        open={catalogModalOpen}
        onClose={() => setCatalogModalOpen(false)}
        targetProviderId={selected?.id}
      />
    </div>
  );
}
