"use client";

import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Hash,
  Image as ImageIcon,
  Sparkles,
  Video,
  Users,
  Wallet,
} from "lucide-react";
import { SectionCard } from "./SectionCard";
import { KpiCard } from "./KpiCard";
import { TrendChart } from "./TrendChart";
import { StackedBarChart } from "./StackedBarChart";
import { HBarChart } from "./HBarChart";
import { HealthOverviewCard } from "./HealthPanel";
import { ErrorsTable } from "./tables";
import { fmtBucket, fmtBucketFull, fmtCompact, fmtMoney, fmtNumber, fmtPercent, toNumber } from "./format";
import type { AdminDashboard } from "@/types/admin";

const TOKEN_SERIES = [
  { key: "prompt", name: "Prompt" },
  { key: "completion", name: "Completion" },
  { key: "cacheRead", name: "Cache read" },
  { key: "cacheWrite", name: "Cache write" },
  { key: "reasoning", name: "Reasoning" },
];

/** Overview tab: platform KPIs, trends, top models/providers, health. */
export function OverviewSection({ data }: { data: AdminDashboard }) {
  const spendData = useMemo(
    () =>
      data.spend_series.map((point) => ({
        bucket: point.bucket,
        cost: toNumber(point.total_cost),
      })),
    [data.spend_series],
  );

  const tokenData = useMemo(
    () =>
      data.token_series.map((point) => ({
        bucket: point.bucket,
        prompt: point.prompt_tokens,
        completion: point.completion_tokens,
        cacheRead: point.cache_read_tokens,
        cacheWrite: point.cache_write_tokens,
        reasoning: point.reasoning_tokens,
      })),
    [data.token_series],
  );

  const modelBars = useMemo(
    () =>
      data.top_models.map((row) => ({
        name: row.model_name,
        value: row.requests,
        hint: fmtMoney(row.total_cost),
      })),
    [data.top_models],
  );

  const providerBars = useMemo(
    () =>
      data.top_providers.map((row) => ({
        name: row.provider_name,
        value: row.requests,
        hint: fmtMoney(row.total_cost),
      })),
    [data.top_providers],
  );

  return (
    <div className="space-y-4">
      {toNumber(data.requests.value) === 0 && (
        <p
          className="rounded-xl border border-dashed border-zinc-200 p-3 text-center text-xs text-zinc-400 dark:border-zinc-800"
          data-testid="admin-overview-empty"
        >
          No activity in this range — platform health is still shown below.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="admin-overview-kpis">
        <KpiCard
          label="Requests"
          value={fmtNumber(data.requests.value)}
          sub={`${fmtNumber(data.requests.previous)} previous period`}
          changePct={data.requests.change_pct}
          icon={<Activity className="size-4" />}
          testId="admin-kpi-requests"
        />
        <KpiCard
          label="Active users"
          value={fmtNumber(data.active_users.value)}
          changePct={data.active_users.change_pct}
          icon={<Users className="size-4" />}
          testId="admin-kpi-users"
        />
        <KpiCard
          label="Tokens"
          value={fmtCompact(data.total_tokens.value)}
          sub={`${fmtNumber(data.total_tokens.value)} total`}
          changePct={data.total_tokens.change_pct}
          icon={<Hash className="size-4" />}
          testId="admin-kpi-tokens"
        />
        <KpiCard
          label="Spend"
          value={fmtMoney(data.total_cost.value)}
          sub={`${fmtMoney(data.total_cost.previous)} previous period`}
          changePct={data.total_cost.change_pct}
          goodDirection="down"
          icon={<Wallet className="size-4" />}
          testId="admin-kpi-cost"
        />
        <KpiCard
          label="Cache savings"
          value={fmtMoney(data.cache_savings.value)}
          changePct={data.cache_savings.change_pct}
          icon={<Sparkles className="size-4" />}
          testId="admin-kpi-cache-savings"
        />
        <KpiCard
          label="Error rate"
          value={fmtPercent(toNumber(data.error_rate.value))}
          changePct={data.error_rate.change_pct}
          goodDirection="down"
          icon={<AlertTriangle className="size-4" />}
          testId="admin-kpi-error-rate"
        />
        <KpiCard
          label="Images"
          value={fmtNumber(data.images.value)}
          changePct={data.images.change_pct}
          icon={<ImageIcon className="size-4" />}
          testId="admin-kpi-images"
        />
        <KpiCard
          label="Videos"
          value={fmtNumber(data.videos.value)}
          changePct={data.videos.change_pct}
          icon={<Video className="size-4" />}
          testId="admin-kpi-videos"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title="Spend over time"
          description="Total cost per day across all providers."
          className="xl:col-span-2"
          testId="admin-overview-spend"
        >
          <TrendChart
            data={spendData}
            series={[{ key: "cost", name: "Spend" }]}
            valueFormat={fmtMoney}
            labelFormat={(label) => fmtBucket(String(label))}
            tooltipLabelFormat={(label) => fmtBucketFull(String(label))}
            axisFormat={(value) => `$${fmtCompact(value)}`}
            ariaLabel="Area chart of platform spend over the selected period"
            testId="admin-spend-chart"
          />
        </SectionCard>

        <SectionCard
          title="Platform health"
          description="Live backend status."
          testId="admin-overview-health"
        >
          <HealthOverviewCard health={data.health} />
        </SectionCard>
      </div>

      <SectionCard
        title="Token composition"
        description="Prompt, completion, cache and reasoning tokens per day."
        testId="admin-overview-tokens"
      >
        <StackedBarChart
          data={tokenData}
          series={TOKEN_SERIES}
          valueFormat={fmtCompact}
          labelFormat={(label) => fmtBucket(String(label))}
          tooltipLabelFormat={(label) => fmtBucketFull(String(label))}
          axisFormat={fmtCompact}
          ariaLabel="Stacked bar chart of token composition over the selected period"
          testId="admin-token-composition-chart"
        />
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Top models" description="Ranked by requests." testId="admin-overview-top-models">
          <HBarChart
            data={modelBars}
            valueName="Requests"
            ariaLabel="Horizontal bars of the top models by requests"
            testId="admin-top-models-chart"
          />
        </SectionCard>
        <SectionCard title="Top providers" description="Ranked by requests." testId="admin-overview-top-providers">
          <HBarChart
            data={providerBars}
            valueName="Requests"
            ariaLabel="Horizontal bars of the top providers by requests"
            testId="admin-top-providers-chart"
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Recent errors"
        description="Latest failures grouped by code and status."
        testId="admin-overview-errors"
      >
        <ErrorsTable rows={data.recent_errors} testId="admin-recent-errors-table" />
      </SectionCard>
    </div>
  );
}
