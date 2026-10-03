"use client";

import { useQuery } from "@tanstack/react-query";
import { ProviderLogo } from "@/components/ui/ProviderLogo";
import { getCatalogStats, listCatalogProviders } from "@/services/catalog";
import { KpiCard } from "./KpiCard";
import { SectionCard } from "./SectionCard";

/** Catalog tab: models.dev-sourced provider catalog health + top providers.
 * Global discovery metadata; credential connections live under Providers. */
export function CatalogSection() {
  const stats = useQuery({ queryKey: ["admin", "catalog-stats"], queryFn: getCatalogStats });
  const top = useQuery({
    queryKey: ["admin", "catalog-top"],
    queryFn: () => listCatalogProviders({ page_size: 10 }),
  });
  const s = stats.data;

  return (
    <div className="space-y-4" data-testid="admin-catalog">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <KpiCard label="Catalog providers" value={String(s?.active_providers ?? "—")} testId="admin-catalog-active" />
        <KpiCard label="Gateway supported" value={String(s?.gateway_supported_providers ?? "—")} testId="admin-catalog-supported" />
        <KpiCard label="Catalog only" value={String(s?.catalog_only_providers ?? "—")} testId="admin-catalog-only" />
        <KpiCard
          label="Last sync"
          value={s?.last_sync_status ?? "—"}
          sub={s?.last_sync_at ? new Date(s.last_sync_at).toLocaleString() : undefined}
          testId="admin-catalog-sync"
        />
      </div>
      <SectionCard
        title="Largest catalog providers"
        description={`${s?.total_models ?? "—"} models across ${s?.total_providers ?? "—"} providers · sources: ${(s?.sources ?? []).join(", ")}`}
        testId="admin-catalog-top"
      >
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {(top.data?.items ?? [])
            .slice()
            .sort((a, b) => b.model_count - a.model_count)
            .slice(0, 10)
            .map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2" data-testid={`admin-catalog-${p.slug}`}>
                <ProviderLogo logoUrl={p.logo_url} name={p.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{p.name}</p>
                  <p className="font-mono text-[10px] text-zinc-500">
                    /{p.slug} · {p.gateway_supported ? `gateway: ${p.gateway_family}` : "catalog only"}
                  </p>
                </div>
                <span className="font-mono text-[11px] text-zinc-500">{p.model_count} models</span>
              </li>
            ))}
        </ul>
      </SectionCard>
    </div>
  );
}
