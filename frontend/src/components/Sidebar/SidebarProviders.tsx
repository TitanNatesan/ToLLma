"use client";

import { Cpu, Plus } from "lucide-react";
import { Badge, Button, Select } from "@/components/ui/primitives";
import { SearchInput } from "@/components/ui/SearchInput";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { useChatStore } from "@/store/chat";
import { PROVIDER_TYPES } from "@/app/providers/fields";
import type { ProviderType } from "@/types";
import { cn } from "@/lib/utils";

const PROVIDER_TYPE_NAMES: Record<ProviderType, string> = {
  OPENAI_RESPONSES: "OpenAI Responses",
  OPENAI_CHAT: "OpenAI Chat",
  ANTHROPIC_MESSAGES: "Anthropic Messages",
  GEMINI: "Google Gemini",
  VERTEX_AI: "Google Vertex AI",
  BEDROCK_CONVERSE: "AWS Bedrock",
  CUSTOM: "Custom Gateway",
};

/** Providers context: search, type filter, provider list, add action. */
export function SidebarProviders() {
  const {
    providerSearch,
    providerTypeFilter,
    selectedProviderId,
    setProviderSearch,
    setProviderTypeFilter,
    setSelectedProviderId,
    setAddProviderOpen,
  } = useChatStore();

  const { data: providers = [], isLoading: providersLoading } = useProviders();
  const { data: allModels = [] } = useModels();

  const filteredProviders = providers.filter((p) => {
    const matchSearch =
      !providerSearch || p.name.toLowerCase().includes(providerSearch.toLowerCase());
    const matchType =
      providerTypeFilter === "ALL" || p.provider_type === providerTypeFilter;
    return matchSearch && matchType;
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Provider list">
      {/* Header & Add Provider Action */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Cpu className="size-3.5 text-zinc-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Providers
          </span>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {providers.length}
          </Badge>
        </div>
        <Button
          size="sm"
          onClick={() => setAddProviderOpen(true)}
          data-testid="add-provider"
          className="h-7 gap-1 px-2 text-xs"
        >
          <Plus className="size-3" />
          <span>Add</span>
        </Button>
      </div>

      {/* Search & Provider Type Dropdown */}
      <div className="flex flex-col gap-2 px-2.5 pb-2">
        <SearchInput
          placeholder="Search providers…"
          value={providerSearch}
          onChange={(e) => setProviderSearch(e.target.value)}
          onClear={() => setProviderSearch("")}
          aria-label="Search providers"
          data-testid="provider-search"
        />

        <Select
          value={providerTypeFilter}
          onChange={(e) => setProviderTypeFilter(e.target.value as ProviderType | "ALL")}
          data-testid="provider-type-filter"
          sizeVariant="sm"
          className="w-full text-xs"
        >
          <option value="ALL" data-testid="type-filter-ALL">All provider types</option>
          {PROVIDER_TYPES.map((t) => (
            <option key={t} value={t} data-testid={`type-filter-${t}`}>
              {PROVIDER_TYPE_NAMES[t] ?? t}
            </option>
          ))}
        </Select>
      </div>

      {/* Providers list */}
      <div className="flex-1 overflow-y-auto p-2 pt-0 space-y-1.5 min-h-[300px]">
        {providersLoading && (
          <p className="p-4 text-center text-xs text-zinc-400">Loading providers…</p>
        )}

        {filteredProviders.map((p) => {
          const count = allModels.filter((m) => m.provider_id === p.id).length;
          const isSelected = selectedProviderId === p.id;

          return (
            <div
              key={p.id}
              data-testid={`provider-card-${p.id}`}
              onClick={() => setSelectedProviderId(p.id)}
              className={cn(
                "group cursor-pointer rounded-lg border p-2.5 transition-all text-xs",
                isSelected
                  ? "border-tollma-500 bg-tollma-50/50 shadow-sm ring-1 ring-tollma-500 dark:border-tollma-600 dark:bg-tollma-950/40"
                  : "border-zinc-200 bg-white/70 hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
              )}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {p.name}
                </span>
                <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                  {p.provider_type}
                </Badge>
              </div>

              <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
                <StatusBadge
                  status={p.validation_status}
                  label={
                    p.validation_status === "valid"
                      ? "Valid"
                      : p.validation_status === "invalid"
                        ? "Invalid"
                        : "Unvalidated"
                  }
                />
                <span data-testid={`model-count-${p.id}`} className="font-mono">
                  {count} model{count === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          );
        })}

        {filteredProviders.length === 0 && !providersLoading && (
          <div className="py-8 text-center text-xs text-zinc-400">
            No providers found
          </div>
        )}
      </div>
    </section>
  );
}
