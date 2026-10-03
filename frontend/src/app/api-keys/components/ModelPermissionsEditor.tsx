"use client";

import { useMemo, useState } from "react";
import { Boxes, Search, Trash2 } from "lucide-react";
import { Button, Checkbox, EmptyState, Input, LoadingState, ProviderLogo, Switch } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { logoForProviderType } from "@/services/catalog";
import { NumberField } from "./NumberField";
import { asNumber } from "./StatusPill";
import type { AIModel } from "@/types";
import type { ApiKeyModelPermission, ApiKeyModelPermissionInput } from "@/types/apiKeys";

const permKey = (providerId: string | null | undefined, modelId: string | null | undefined) =>
  `${providerId ?? ""}::${modelId ?? ""}`;

/** Existing permissions -> editable inputs (Decimal max_budget coerced). */
export function modelPermissionsToInput(
  permissions: ApiKeyModelPermission[],
): ApiKeyModelPermissionInput[] {
  return permissions.map((permission) => ({
    provider_id: permission.provider_id,
    model_id: permission.model_id,
    enabled: permission.enabled,
    max_budget: asNumber(permission.max_budget),
    rpm: permission.rpm,
    tpm: permission.tpm,
  }));
}

interface ModelPermissionsEditorProps {
  value: ApiKeyModelPermissionInput[];
  onChange: (value: ApiKeyModelPermissionInput[]) => void;
  disabled?: boolean;
}

/**
 * Multi-select of the workspace's registered models. Selected models get an
 * enabled toggle plus optional per-model budget/RPM/TPM. Provider-wide rules
 * (`model_id` null) returned by the API are preserved and editable too.
 */
export function ModelPermissionsEditor({ value, onChange, disabled }: ModelPermissionsEditorProps) {
  const { data: models = [], isPending } = useModels();
  const { data: providers = [] } = useProviders();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const providerName = (id: string | null | undefined) =>
    providers.find((provider) => provider.id === id)?.name ?? "Other provider";

  const providerFamily = (id: string | null | undefined) =>
    providers.find((provider) => provider.id === id)?.provider_type ?? null;

  const familyLabel = (family: string | null) =>
    family
      ? family.split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ")
      : "Other providers";

  const providerWide = value.filter((permission) => !permission.model_id);
  const unlisted = value.filter(
    (permission) => permission.model_id && !models.some((model) => model.id === permission.model_id),
  );

  const { grouped, visibleCount } = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = models.filter((model) => {
      if (!term) return true;
      return (
        model.name.toLowerCase().includes(term) ||
        model.model_id.toLowerCase().includes(term) ||
        providerName(model.provider_id).toLowerCase().includes(term)
      );
    });
    // Group by canonical provider family (gateway semantics), not by raw
    // connection id: the same family stays together even across connections.
    // Identity per row is still (provider_id, model.id) — distinct routes.
    const map = new Map<string, AIModel[]>();
    for (const model of filtered) {
      const family = providerFamily(model.provider_id) ?? `unknown:${model.provider_id}`;
      const list = map.get(family) ?? [];
      list.push(model);
      map.set(family, list);
    }
    const ordered = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    return { grouped: ordered, visibleCount: filtered.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, search, providers]);

  function updateAt(index: number, patch: Partial<ApiKeyModelPermissionInput>) {
    onChange(value.map((permission, i) => (i === index ? { ...permission, ...patch } : permission)));
  }

  function toggleModel(model: AIModel) {
    const key = permKey(model.provider_id, model.id);
    const exists = value.some((permission) => permKey(permission.provider_id, permission.model_id) === key);
    if (exists) {
      onChange(value.filter((permission) => permKey(permission.provider_id, permission.model_id) !== key));
      return;
    }
    onChange([
      ...value,
      {
        provider_id: model.provider_id,
        model_id: model.id,
        enabled: true,
        max_budget: null,
        rpm: null,
        tpm: null,
      },
    ]);
  }

  if (isPending) return <LoadingState message="Loading models…" className="p-4" />;

  if (models.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="No models registered"
        description="Register providers and models first, then grant this key access to specific models. An empty selection allows every enabled model."
        className="py-6"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter models…"
          className="h-8 pl-8 text-xs"
          data-testid="model-permissions-search"
        />
      </div>

      <p className="text-[10px] text-zinc-400">
        {value.filter((permission) => permission.model_id && models.some((model) => model.id === permission.model_id)).length}{" "}
        of {models.length} models selected. Leave empty to allow all models.
      </p>

      <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
        {grouped.length === 0 && (
          <p className="py-4 text-center text-xs text-zinc-400">No models match “{search}”.</p>
        )}
        {grouped.map(([family, providerModels]) => {
          const known = !family.startsWith("unknown:");
          return (
          <div key={family} className="space-y-1" data-testid={`model-group-${family}`}>
            <p className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              <ProviderLogo
                logoUrl={known ? logoForProviderType(family) : null}
                name={known ? familyLabel(family) : "Other providers"}
                size="sm"
                className="size-4 rounded"
              />
              {known ? familyLabel(family) : "Other providers"}
            </p>
            {providerModels.map((model) => {
              const key = permKey(model.provider_id, model.id);
              const index = value.findIndex(
                (permission) => permKey(permission.provider_id, permission.model_id) === key,
              );
              const selected = index >= 0;
              const permission = selected ? value[index] : null;
              const isExpanded = expanded === key;
              return (
                <div
                  key={key}
                  className={cn(
                    "rounded-md border px-2 py-1.5 transition-colors",
                    selected
                      ? "border-tollma-200 bg-tollma-50/40 dark:border-tollma-900/60 dark:bg-tollma-950/20"
                      : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900/60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selected}
                      disabled={disabled}
                      onChange={() => toggleModel(model)}
                      aria-label={`Grant access to ${model.name}`}
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleModel(model)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {model.name}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-zinc-400">
                        {model.model_id} · {providerName(model.provider_id)}
                      </span>
                    </button>
                    {selected && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Switch
                          checked={permission?.enabled !== false}
                          disabled={disabled}
                          onCheckedChange={(checked) => updateAt(index, { enabled: checked })}
                          aria-label={`Enable ${model.name}`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() => setExpanded(isExpanded ? null : key)}
                          className="h-6 px-2 text-[10px] text-zinc-500"
                        >
                          {isExpanded ? "Hide" : "Limits"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {selected && isExpanded && (
                    <div className="mt-2 grid gap-2 border-t border-zinc-200 pt-2 sm:grid-cols-3 dark:border-zinc-800">
                      <NumberField
                        label="Max budget"
                        suffix="USD"
                        step={0.01}
                        value={permission?.max_budget ?? null}
                        onChange={(max_budget) => updateAt(index, { max_budget })}
                        disabled={disabled}
                      />
                      <NumberField
                        label="RPM"
                        value={permission?.rpm ?? null}
                        onChange={(rpm) => updateAt(index, { rpm })}
                        disabled={disabled}
                      />
                      <NumberField
                        label="TPM"
                        value={permission?.tpm ?? null}
                        onChange={(tpm) => updateAt(index, { tpm })}
                        disabled={disabled}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
        })}
      </div>

      {providerWide.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-900/60 dark:bg-amber-950/20">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Provider-wide rules from the API
          </p>
          {providerWide.map((permission) => {
            const index = value.indexOf(permission);
            return (
              <div key={`wide-${permission.provider_id}`} className="flex items-center gap-2 px-1">
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-300">
                  {providerName(permission.provider_id)}
                  <span className="ml-1.5 text-[10px] text-zinc-400">all models</span>
                </span>
                <Switch
                  checked={permission.enabled !== false}
                  disabled={disabled}
                  onCheckedChange={(checked) => updateAt(index, { enabled: checked })}
                  aria-label="Enable provider-wide rule"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((p, i) => i !== index))}
                  aria-label="Remove provider-wide rule"
                >
                  <Trash2 className="size-3.5 text-zinc-400" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {unlisted.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-zinc-300 bg-zinc-50/60 p-2 dark:border-zinc-700 dark:bg-zinc-900/40">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Permissions for removed models
          </p>
          <p className="px-1 text-[10px] text-zinc-400">
            These rules stay until removed; the models are no longer in the registry.
          </p>
          {unlisted.map((permission) => {
            const index = value.indexOf(permission);
            return (
              <div key={`unlisted-${permission.model_id}`} className="flex items-center gap-2 px-1">
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                  {permission.model_id}
                </span>
                <Switch
                  checked={permission.enabled !== false}
                  disabled={disabled}
                  onCheckedChange={(checked) => updateAt(index, { enabled: checked })}
                  aria-label="Enable permission for removed model"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((p, i) => i !== index))}
                  aria-label="Remove permission for removed model"
                >
                  <Trash2 className="size-3.5 text-zinc-400" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {visibleCount === 0 && search && (
        <p className="text-[10px] text-zinc-400">No models match the filter.</p>
      )}
    </div>
  );
}
