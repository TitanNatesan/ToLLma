"use client";

import { useMemo } from "react";
import { Database, Layers, Sparkles, TrendingDown, Wallet, Zap } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { KpiCard } from "./KpiCard";
import { HBarChart } from "./HBarChart";
import { CacheTable } from "./tables";
import { fmtCompact, fmtMoney, fmtNumber, fmtRate, toNumber } from "./format";
import type { AdminCache } from "@/types/admin";

/** Cache tab: prompt-cache volume, savings and provider hit rates. */
export function CacheSection({ data }: { data: AdminCache }) {
  const savingsBars = useMemo(
    () =>
      data.by_provider.map((row) => ({
        name: row.name,
        value: toNumber(row.savings),
        hint: `hit ${fmtRate(row.hit_rate)}`,
      })),
    [data.by_provider],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="admin-cache-kpis">
        <KpiCard
          label="Cached tokens"
          value={fmtCompact(data.cached_tokens)}
          sub="Prompt tokens served from cache"
          icon={<Database className="size-4" />}
          testId="admin-cache-read-tokens"
        />
        <KpiCard
          label="Cache writes"
          value={fmtCompact(data.cache_write_tokens)}
          icon={<Layers className="size-4" />}
          testId="admin-cache-write-tokens"
        />
        <KpiCard
          label="Savings"
          value={fmtMoney(data.savings)}
          sub="Versus full input price"
          icon={<Sparkles className="size-4" />}
          testId="admin-cache-savings"
        />
        <KpiCard
          label="Hit rate"
          value={fmtRate(data.hit_rate)}
          sub={`${fmtNumber(data.providers_with_cache)} providers with caching`}
          icon={<Zap className="size-4" />}
          testId="admin-cache-hit-rate"
        />
        <KpiCard
          label="Cache read cost"
          value={fmtMoney(data.cache_read_cost)}
          icon={<TrendingDown className="size-4" />}
          testId="admin-cache-read-cost"
        />
        <KpiCard
          label="Cache write cost"
          value={fmtMoney(data.cache_write_cost)}
          icon={<Wallet className="size-4" />}
          testId="admin-cache-write-cost"
        />
      </div>

      <SectionCard
        title="Savings by provider"
        description="Estimated prompt-cache savings per provider."
        testId="admin-cache-chart"
      >
        <HBarChart
          data={savingsBars}
          valueFormat={fmtMoney}
          valueName="Savings"
          ariaLabel="Horizontal bars of prompt-cache savings by provider"
          testId="admin-cache-bars"
        />
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          title="By provider"
          description="Cache usage and hit rate per provider."
          testId="admin-cache-providers"
        >
          <CacheTable rows={data.by_provider} testId="admin-cache-providers-table" />
        </SectionCard>
        <SectionCard
          title="By model"
          description="Cache usage and hit rate per model."
          testId="admin-cache-models"
        >
          <CacheTable rows={data.by_model} testId="admin-cache-models-table" />
        </SectionCard>
      </div>
    </div>
  );
}
