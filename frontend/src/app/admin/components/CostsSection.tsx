"use client";

import { useMemo } from "react";
import { CalendarClock, Coins, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { KpiCard } from "./KpiCard";
import { StackedBarChart } from "./StackedBarChart";
import { DonutBreakdown } from "./DonutBreakdown";
import { ModelsTable, ProvidersTable, UsersTable } from "./tables";
import { fmtBucket, fmtBucketFull, fmtCompact, fmtMoney, fmtNumber, fmtRate, toNumber } from "./format";
import type { AdminCosts } from "@/types/admin";

const COST_SERIES = [
  { key: "input", name: "Input" },
  { key: "output", name: "Output" },
  { key: "cacheRead", name: "Cache read" },
  { key: "cacheWrite", name: "Cache write" },
  { key: "reasoning", name: "Reasoning" },
];

/** Costs tab: spend composition, projection, per-provider/model/user splits. */
export function CostsSection({ data }: { data: AdminCosts }) {
  const series = useMemo(
    () =>
      data.series.map((point) => ({
        bucket: point.bucket,
        input: toNumber(point.input_cost),
        output: toNumber(point.output_cost),
        cacheRead: toNumber(point.cache_read_cost),
        cacheWrite: toNumber(point.cache_write_cost),
        reasoning: toNumber(point.reasoning_cost),
      })),
    [data.series],
  );

  const providerSlices = useMemo(
    () =>
      data.by_provider.map((row) => ({
        name: row.provider_name,
        value: toNumber(row.total_cost),
      })),
    [data.by_provider],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="admin-costs-kpis">
        <KpiCard
          label="Total spend"
          value={fmtMoney(data.total_cost)}
          sub={`${fmtMoney(data.previous_cost)} previous period`}
          changePct={data.change_pct}
          goodDirection="down"
          icon={<Wallet className="size-4" />}
          testId="admin-costs-total"
        />
        <KpiCard
          label="Run-rate projection"
          value={fmtMoney(data.run_rate_projection ?? data.projected_month_cost)}
          sub="Run-rate, not a prediction · based on the current pace"
          icon={<TrendingUp className="size-4" />}
          testId="admin-costs-projected"
        />
        <KpiCard
          label="Cache savings"
          value={fmtMoney(data.cache_savings)}
          icon={<Sparkles className="size-4" />}
          testId="admin-costs-cache-savings"
        />
        <KpiCard
          label="Estimated share"
          value={fmtRate(data.estimated_share)}
          sub="Cost estimated rather than provider-reported"
          icon={<CalendarClock className="size-4" />}
          testId="admin-costs-estimated-share"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Input", value: data.input_cost, testId: "admin-costs-input" },
          { label: "Output", value: data.output_cost, testId: "admin-costs-output" },
          { label: "Cache", value: data.cache_cost, testId: "admin-costs-cache" },
          { label: "Reasoning", value: data.reasoning_cost, testId: "admin-costs-reasoning" },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            data-testid={item.testId}
          >
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">{item.label}</p>
            <p className="mt-1 font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {fmtMoney(item.value)}
            </p>
          </div>
        ))}
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-zinc-200 p-3 text-[11px] text-zinc-400 dark:border-zinc-800">
          <Coins className="size-3.5 shrink-0" />
          Cost is computed per request from registered pricing.
        </div>
      </div>

      <SectionCard
        title="Cost composition"
        description="Input, output, cache and reasoning cost per day."
        testId="admin-costs-series"
      >
        <StackedBarChart
          data={series}
          series={COST_SERIES}
          valueFormat={fmtMoney}
          labelFormat={(label) => fmtBucket(String(label))}
          tooltipLabelFormat={(label) => fmtBucketFull(String(label))}
          axisFormat={(value) => `$${fmtCompact(value)}`}
          ariaLabel="Stacked bar chart of cost composition over the selected period"
          testId="admin-cost-composition-chart"
        />
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title="Cost by provider"
          description={`${fmtNumber(data.by_provider.length)} providers with usage.`}
          testId="admin-costs-by-provider"
        >
          <DonutBreakdown
            data={providerSlices}
            valueFormat={fmtMoney}
            ariaLabel="Donut chart of cost distribution by provider"
            testId="admin-cost-provider-donut"
          />
        </SectionCard>
        <SectionCard
          title="By provider"
          description="Spend and reliability per provider."
          className="xl:col-span-2"
          testId="admin-costs-providers"
        >
          <ProvidersTable rows={data.by_provider} testId="admin-costs-providers-table" />
        </SectionCard>
      </div>

      <SectionCard title="By model" description="Spend and reliability per model." testId="admin-costs-models">
        <ModelsTable rows={data.by_model} testId="admin-costs-models-table" />
      </SectionCard>

      <SectionCard title="Top spenders" description="Users ranked by spend." testId="admin-costs-users">
        <UsersTable rows={data.top_users} testId="admin-costs-users-table" />
      </SectionCard>
    </div>
  );
}
