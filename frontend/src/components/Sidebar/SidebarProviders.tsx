"use client";

import { BookOpen, Cpu, Plus } from "lucide-react";
import { Badge, Button, Select } from "@/components/ui/primitives";
import { ProviderLogo } from "@/components/ui/ProviderLogo";
import { SearchInput } from "@/components/ui/SearchInput";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { useOrgProviders, useOrgs } from "@/hooks/useOrgs";
import { logoForProviderType } from "@/services/catalog";
import { useChatStore } from "@/store/chat";
import { useOrgStore } from "@/store/org";
import { PROVIDER_TYPES, providerTypeLabel } from "@/app/providers/fields";
import type { ProviderType } from "@/types";
import { cn } from "@/lib/utils";

/** Providers context: search, type filter, provider list, add action.
 * Scope-aware: org scope lists the org's providers (same UI, org data);
 * per-model counts come from the personal registry only. */
export function SidebarProviders() {
  const {
    providerSearch,
    providerTypeFilter,
    selectedProviderId,
    setProviderSearch,
    setProviderTypeFilter,
    setSelectedProviderId,
    setAddProviderOpen,
    setCatalogOpen,
  } = useChatStore();

  const context = useOrgStore((s) => s.context);
  const isOrg = context.type === "org";
  const orgId = isOrg ? context.orgId : null;
  const orgs = useOrgs();
  const orgEntry = orgId ? (orgs.data ?? []).find((o) => o.id === orgId) : undefined;
  const orgName = orgEntry?.name ?? (isOrg ? context.orgName : null);
  const canOrg = (code: string) =>
    !!orgEntry && (orgEntry.is_root || orgEntry.permissions.includes(code));
  const canRead = !isOrg || canOrg("Providers.Read");
  const canManage = !isOrg || canOrg("Providers.Create") || canOrg("Providers.Update");

  const { data: personalProviders = [], isLoading: providersLoading } = useProviders();
  const { data: allModels = [] } = useModels(undefined, undefined, { enabled: !isOrg });
  const orgProvidersQuery = useOrgProviders(orgId ?? "", { enabled: isOrg && canRead });
  // Org rows share the ProviderRead serializer shape; no remap to drift.
  const providers = (isOrg ? (orgProvidersQuery.data ?? []) : personalProviders) as typeof personalProviders;
  const loading = isOrg ? orgProvidersQuery.isLoading : providersLoading;

  const filteredProviders = providers.filter((p) => {
    const matchSearch =
      !providerSearch || p.name.toLowerCase().includes(providerSearch.toLowerCase());
    const matchType =
      providerTypeFilter === "ALL" || p.provider_type === providerTypeFilter;
    return matchSearch && matchType;
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Provider list">
      {/* Header & actions: title row, then full-width action row so the
          buttons never truncate in the narrow sidebar. */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Cpu className="size-3.5 text-zinc-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Providers
          </span>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {providers.length}
          </Badge>
          {isOrg && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]" data-testid="provider-list-org-scope" title="Showing organization providers">
              {orgName ?? "Organization"}
            </Badge>
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCatalogOpen(true)}
          data-testid="browse-catalog"
          className="h-7 gap-1 px-2 text-xs"
          title="Browse the Models.dev provider catalog"
        >
          <BookOpen className="size-3" aria-hidden />
          <span>Catalog</span>
        </Button>
        {canManage && (
        <Button
          size="sm"
          onClick={() => setAddProviderOpen(true)}
          data-testid="add-provider"
          className="h-7 gap-1 px-2 text-xs"
        >
          <Plus className="size-3" />
          <span>Add</span>
        </Button>
        )}
        </div>
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
          aria-label="Filter by provider type"
          data-testid="provider-type-filter"
          sizeVariant="sm"
          className="w-full text-xs"
        >
          <option value="ALL" data-testid="type-filter-ALL">All provider types</option>
          {PROVIDER_TYPES.map((t) => (
            <option key={t} value={t} data-testid={`type-filter-${t}`}>
              {providerTypeLabel(t)}
            </option>
          ))}
        </Select>
      </div>

      {/* Providers list */}
      <div className="flex-1 overflow-y-auto p-2 pt-0 space-y-1.5 min-h-[300px]">
        {loading && (
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
                <span className="flex min-w-0 items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  <ProviderLogo logoUrl={logoForProviderType(p.provider_type)} name={p.name} size="sm" />
                  <span className="truncate">{p.name}</span>
                </span>
                <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                  {providerTypeLabel(p.provider_type)}
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
                {!isOrg && (
                <span data-testid={`model-count-${p.id}`} className="font-mono">
                  {count} model{count === 1 ? "" : "s"}
                </span>
                )}
              </div>
            </div>
          );
        })}

        {filteredProviders.length === 0 && !loading && (
          <div className="py-8 text-center text-xs text-zinc-400">
            {isOrg && !canRead ? "You need provider-read permission to view organization providers." : "No providers found"}
          </div>
        )}
      </div>
    </section>
  );
}
