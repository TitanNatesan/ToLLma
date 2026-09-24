"use client";

import { useMemo } from "react";
import { Brain, Database, FileInput, FileOutput, Hash, Layers } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { KpiCard } from "./KpiCard";
import { StackedBarChart } from "./StackedBarChart";
import { TrendChart } from "./TrendChart";
import { ModelsTable } from "./tables";
import { fmtBucket, fmtBucketFull, fmtCompact, fmtNumber, fmtRate } from "./format";
import type { AdminTokens } from "@/types/admin";

const TOKEN_SERIES = [
  { key: "prompt", name: "Prompt" },
  { key: "completion", name: "Completion" },
  { key: "cacheRead", name: "Cache read" },
  { key: "cacheWrite", name: "Cache write" },
  { key: "reasoning", name: "Reasoning" },
];

/** Tokens tab: composition, cache share and per-model token flow. */
export function TokensSection({ data }: { data: AdminTokens }) {
  const series = useMemo(
    () =>
      data.series.map((point) => ({
        bucket: point.bucket,
        prompt: point.prompt_tokens,
        completion: point.completion_tokens,
        cacheRead: point.cache_read_tokens,
        cacheWrite: point.cache_write_tokens,
        reasoning: point.reasoning_tokens,
        total: point.total_tokens,
      })),
    [data.series],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="admin-tokens-kpis">
        <KpiCard
          label="Total tokens"
          value={fmtCompact(data.total_tokens)}
          sub={`${fmtNumber(data.total_tokens)} total`}
          icon={<Hash className="size-4" />}
          testId="admin-tokens-total"
        />
        <KpiCard
          label="Prompt"
          value={fmtCompact(data.prompt_tokens)}
          icon={<FileInput className="size-4" />}
          testId="admin-tokens-prompt"
        />
        <KpiCard
          label="Completion"
          value={fmtCompact(data.completion_tokens)}
          icon={<FileOutput className="size-4" />}
          testId="admin-tokens-completion"
        />
        <KpiCard
          label="Reasoning"
          value={fmtCompact(data.reasoning_tokens)}
          icon={<Brain className="size-4" />}
          testId="admin-tokens-reasoning"
        />
        <KpiCard
          label="Cache read"
          value={fmtCompact(data.cache_read_tokens)}
          icon={<Database className="size-4" />}
          testId="admin-tokens-cache-read"
        />
        <KpiCard
          label="Cache write"
          value={fmtCompact(data.cache_write_tokens)}
          icon={<Layers className="size-4" />}
          testId="admin-tokens-cache-write"
        />
        <KpiCard
          label="Cached share"
          value={fmtRate(data.cached_share)}
          sub="Share of prompt tokens served from cache"
          icon={<Database className="size-4" />}
          testId="admin-tokens-cached-share"
        />
      </div>

      <SectionCard
        title="Token volume"
        description="Total tokens per day."
        testId="admin-tokens-volume"
      >
        <TrendChart
          data={series}
          series={[{ key: "total", name: "Total tokens" }]}
          valueFormat={fmtCompact}
          labelFormat={(label) => fmtBucket(String(label))}
          tooltipLabelFormat={(label) => fmtBucketFull(String(label))}
          axisFormat={fmtCompact}
          ariaLabel="Area chart of total token volume over the selected period"
          testId="admin-tokens-volume-chart"
        />
      </SectionCard>

      <SectionCard
        title="Token composition"
        description="Prompt, completion, cache and reasoning tokens per day."
        testId="admin-tokens-series"
      >
        <StackedBarChart
          data={series}
          series={TOKEN_SERIES}
          valueFormat={fmtCompact}
          labelFormat={(label) => fmtBucket(String(label))}
          tooltipLabelFormat={(label) => fmtBucketFull(String(label))}
          axisFormat={fmtCompact}
          ariaLabel="Stacked bar chart of token composition over the selected period"
          testId="admin-tokens-composition-chart"
        />
      </SectionCard>

      <SectionCard
        title="By model"
        description="Token flow and cache usage per model."
        testId="admin-tokens-models"
      >
        <ModelsTable rows={data.by_model} testId="admin-tokens-models-table" />
      </SectionCard>
    </div>
  );
}
