"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Badge,
  Button,
  CapabilityBadge,
  Dialog,
  DialogContent,
  EmptyState,
  LoadingState,
  SearchInput,
} from "@/components/ui";
import {
  listRepositoryModels,
  lookupRepositoryModel,
  createModel,
  syncRepository,
} from "@/services/api";
import { useProviders } from "@/hooks/useRegistry";
import { useChatStore } from "@/store/chat";
import {
  ArrowRight,
  Bot,
  Cpu,
  Database,
  Download,
  Filter,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { RepositoryModelItem, EndpointType } from "@/types";
import { cn } from "@/lib/utils";

interface RepositoryCatalogModalProps {
  open: boolean;
  onClose: () => void;
  targetProviderId?: string | null;
}

export function RepositoryCatalogModal({
  open,
  onClose,
  targetProviderId,
}: RepositoryCatalogModalProps) {
  const queryClient = useQueryClient();
  const { data: providers = [] } = useProviders();
  const { selectedProviderId, setSelectedProviderId } = useChatStore();

  const activeProviderId = targetProviderId || selectedProviderId || (providers[0]?.id ?? null);
  const [selectedDestProviderId, setSelectedDestProviderId] = useState<string | null>(activeProviderId);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("ALL");
  const [capabilityFilter, setCapabilityFilter] = useState<string>("ALL");
  const [importingKey, setImportingKey] = useState<string | null>(null);

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: syncRepository,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["model-repository"] });
      toast.success("Model repository synced", {
        description: `${res.models_created} created, ${res.models_updated} updated`,
      });
    },
    onError: (err) => {
      toast.error("Sync failed", {
        description: err instanceof Error ? err.message : "Error",
      });
    },
  });

  // Query models from backend repository
  const { data: repoPage, isLoading, refetch } = useQuery({
    queryKey: [
      "model-repository",
      "models",
      search,
      providerFilter,
      capabilityFilter,
    ],
    queryFn: () =>
      listRepositoryModels({
        search: search.trim() || undefined,
        provider: providerFilter !== "ALL" ? providerFilter : undefined,
        capability: capabilityFilter !== "ALL" ? capabilityFilter : undefined,
        page_size: 50,
      }),
    enabled: open,
  });

  const models: RepositoryModelItem[] = repoPage?.items ?? [];

  // Import model into provider
  async function handleImport(item: RepositoryModelItem) {
    const destId = selectedDestProviderId || activeProviderId;
    if (!destId) {
      toast.error("Please select a target provider first");
      return;
    }

    setImportingKey(item.model_key);
    try {
      // Lookup canonical suggestion
      const { entry, suggested } = await lookupRepositoryModel(item.model_key);
      const str = (v: unknown, fallback = "") =>
        v === null || v === undefined ? fallback : String(v);

      const endpoint: EndpointType = (
        ["responses", "chat_completions", "messages", "converse"] as string[]
      ).includes(str(suggested.endpoint_type))
        ? (suggested.endpoint_type as EndpointType)
        : "chat_completions";

      await createModel({
        provider_id: destId,
        name: str(suggested.name, item.display_name || item.canonical_name),
        model_id: str(suggested.model_id, item.provider_model_id),
        endpoint_type: endpoint,
        input_price: str(suggested.input_price, item.input_cost || "0"),
        output_price: str(suggested.output_price, item.output_cost || "0"),
        cache_read_price: str(suggested.cache_read_price, item.cache_read_cost || "0"),
        cache_write_price: str(suggested.cache_write_price, item.cache_write_cost || "0"),
        context_window: suggested.context_window ? Number(suggested.context_window) : item.context_window,
        max_output_tokens: suggested.max_output_tokens ? Number(suggested.max_output_tokens) : item.max_output_tokens,
        description: str(suggested.description, item.description || ""),
        release_date: str(suggested.release_date, item.release_date || ""),
        repository_model_key: entry.model_key,
        supports_text: item.supports_text_input,
        supports_vision: item.supports_vision_input,
        supports_audio_input: item.supports_audio_input,
        supports_audio_output: item.supports_audio_output,
        supports_image_generation: item.supports_image_output,
        supports_tool_calling: item.supports_tool_calling,
        supports_reasoning: item.supports_reasoning,
        supports_streaming: item.supports_streaming,
      });

      queryClient.invalidateQueries({ queryKey: ["models"] });
      toast.success(`Imported ${item.display_name || item.canonical_name}`);
    } catch (e) {
      toast.error("Import failed", {
        description: e instanceof Error ? e.message : "Error creating model",
      });
    } finally {
      setImportingKey(null);
    }
  }

  const distinctProviders = Array.from(
    new Set(models.map((m) => m.provider).filter(Boolean)),
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
              <Database className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Model Intelligence Repository Catalog
              </h2>
              <p className="text-[11px] text-zinc-500">
                Explore catalog models and import them directly into your providers with curated pricing and limits
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="gap-1 text-xs"
            >
              <RefreshCw
                className={cn("size-3.5", syncMutation.isPending && "animate-spin text-blue-500")}
              />
              <span>{syncMutation.isPending ? "Syncing…" : "Sync Catalog"}</span>
            </Button>
          </div>
        </div>

        {/* Target Provider Selector & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-3 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <SearchInput
              placeholder="Search by model name, key, or family…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch("")}
              className="h-8"
            />
          </div>

          {/* Target destination provider */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500 text-[11px] shrink-0">Import into:</span>
            <select
              value={selectedDestProviderId || ""}
              onChange={(e) => {
                setSelectedDestProviderId(e.target.value);
                setSelectedProviderId(e.target.value);
              }}
              className="h-8 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 outline-none focus:border-zinc-500"
            >
              {providers.length === 0 && (
                <option value="">No providers configured</option>
              )}
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.provider_type})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Model Results List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 min-h-[350px]">
          {isLoading ? (
            <LoadingState message="Querying model repository…" />
          ) : models.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No repository models found"
              description="Try adjusting your search query or sync the repository to pull the latest catalog."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncMutation.mutate()}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw className="size-3.5" />
                  Sync Repository Now
                </Button>
              }
            />
          ) : (
            models.map((item) => {
              const isImporting = importingKey === item.model_key;
              return (
                <div
                  key={item.id}
                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3.5 transition-all hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700"
                >
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                        {item.display_name || item.canonical_name}
                      </span>
                      <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.2 text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
                        {item.model_key}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {item.provider}
                      </Badge>
                      {item.family && (
                        <span className="text-[10px] text-zinc-400">
                          Family: {item.family}
                        </span>
                      )}
                    </div>

                    {item.description && (
                      <p className="text-xs text-zinc-500 line-clamp-1">
                        {item.description}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                      {item.context_window && (
                        <span>Ctx: {(item.context_window / 1000).toFixed(0)}k</span>
                      )}
                      {item.input_cost && (
                        <span>In: ${item.input_cost}/1M</span>
                      )}
                      {item.output_cost && (
                        <span>Out: ${item.output_cost}/1M</span>
                      )}
                      {item.supports_vision_input && (
                        <CapabilityBadge capability="supports_vision" compact />
                      )}
                      {item.supports_reasoning && (
                        <CapabilityBadge capability="supports_reasoning" compact />
                      )}
                      {item.supports_tool_calling && (
                        <CapabilityBadge capability="supports_tool_calling" compact />
                      )}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleImport(item)}
                    disabled={isImporting || !providers.length}
                    className="shrink-0 gap-1.5 text-xs self-end sm:self-center"
                  >
                    <Download className={cn("size-3.5", isImporting && "animate-bounce")} />
                    <span>{isImporting ? "Importing…" : "Import"}</span>
                  </Button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-200 px-5 py-2.5 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex items-center justify-between text-xs text-zinc-500">
          <span>{repoPage?.total ?? models.length} models available in repository</span>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
