"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ShieldAlert, Sparkles } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/ui";
import {
  apiKeyErrorMessage,
  getApiKey,
  getKeyAnalytics,
  getKeyInsights,
  getKeyTimeseries,
  isApiKeyStatus,
} from "@/services/apiKeys";
import { BudgetBurnRate } from "./analytics/BudgetBurnRate";
import { BudgetGauge } from "./analytics/BudgetGauge";
import { DailySpendHeatmap } from "./analytics/DailySpendHeatmap";
import { EndpointDonut } from "./analytics/EndpointDonut";
import { EndpointTable } from "./analytics/EndpointTable";
import { EndpointTrend } from "./analytics/EndpointTrend";
import { InsightList } from "./analytics/InsightList";
import { KeyHealthSection } from "./analytics/KeyHealthSection";
import { ModelCostEfficiency } from "./analytics/ModelCostEfficiency";
import { ModelTable } from "./analytics/ModelTable";
import { ModelUsageTrend } from "./analytics/ModelUsageTrend";
import { DEFAULT_RANGE, RangeSelector, type RangeValue } from "./analytics/RangeSelector";
import { RequestVolumeChart } from "./analytics/RequestVolumeChart";
import { SectionFrame, num } from "./analytics/shared";
import { SpendTrend } from "./analytics/SpendTrend";
import { TokenTrend } from "./analytics/TokenTrend";
import { TopModelsChart } from "./analytics/TopModelsChart";
import { UsageOverview } from "./analytics/UsageOverview";
import type { AnalyticsPreset, ApiKey, ApiKeyAnalyticsSummary, ApiKeyTimeseries } from "@/types/apiKeys";

function AnalyticsSkeleton() {
  return (
    <div className="space-y-4" data-testid="key-analytics-loading">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-40 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="h-72 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60 xl:col-span-2" />
        <div className="h-72 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60" />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60"
          />
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{children}</h4>
  );
}

/**
 * Read-only analytics tab for one API key: health, usage, time series, model,
 * endpoint and budget analytics plus insights. No inputs, no budget fields, no
 * model selectors, no save buttons — every series is derived in-browser from
 * the existing summary / timeseries / key queries.
 */
export function KeyAnalytics({ keyId }: { keyId: string }) {
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);

  const customReady = range.preset !== "custom" || (!!range.start && !!range.end);
  const params = useMemo(
    () => ({
      preset: range.preset,
      start: range.preset === "custom" ? range.start || undefined : undefined,
      end: range.preset === "custom" ? range.end || undefined : undefined,
    }),
    [range],
  );

  // Queries live in the panel (never the list page) and are keyed by the range.
  const summaryQuery = useQuery({
    queryKey: ["key-analytics-summary", keyId, params],
    queryFn: () => getKeyAnalytics(keyId, params),
    enabled: customReady,
    staleTime: 30_000,
  });
  // Two stacked views need two groupings of the same endpoint (no new API).
  const modelTsQuery = useQuery({
    queryKey: ["key-analytics-timeseries", keyId, params, "model"],
    queryFn: () => getKeyTimeseries(keyId, params, "model"),
    enabled: customReady,
    staleTime: 30_000,
  });
  const endpointTsQuery = useQuery({
    queryKey: ["key-analytics-timeseries", keyId, params, "endpoint"],
    queryFn: () => getKeyTimeseries(keyId, params, "endpoint"),
    enabled: customReady,
    staleTime: 30_000,
  });
  // Key identity for the read-only health section (existing key endpoint).
  const keyQuery = useQuery({
    queryKey: ["api-key-detail", keyId],
    queryFn: () => getApiKey(keyId),
    staleTime: 60_000,
  });
  // The summary carries insights; the dedicated endpoint is a fallback only.
  const insightsQuery = useQuery({
    queryKey: ["key-analytics-insights", keyId, params],
    queryFn: () => getKeyInsights(keyId, params),
    enabled: customReady && !!summaryQuery.data && (summaryQuery.data.insights?.length ?? 0) === 0,
    staleTime: 60_000,
  });

  const fetching =
    summaryQuery.isFetching ||
    modelTsQuery.isFetching ||
    endpointTsQuery.isFetching ||
    insightsQuery.isFetching;

  const refresh = () => {
    void summaryQuery.refetch();
    void modelTsQuery.refetch();
    void endpointTsQuery.refetch();
    void keyQuery.refetch();
    void insightsQuery.refetch();
  };

  const error = summaryQuery.error ?? modelTsQuery.error ?? endpointTsQuery.error;
  const loading =
    customReady &&
    (summaryQuery.isPending ||
      modelTsQuery.isPending ||
      endpointTsQuery.isPending ||
      (!summaryQuery.data && !error));

  return (
    <div className="space-y-4" data-testid="key-analytics">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Usage analytics</h3>
        <RangeSelector
          value={range}
          onChange={setRange}
          onRefresh={refresh}
          fetching={fetching}
          testIdPrefix="key-range"
        />
      </div>

      {!customReady && (
        <EmptyState
          icon={BarChart3}
          title="Pick a date range"
          description="Select both a start and end date to load analytics."
          className="py-12"
          testId="key-analytics-custom-pending"
        />
      )}

      {customReady && loading && <AnalyticsSkeleton />}

      {customReady && !loading && error && isApiKeyStatus(error, 404) && (
        <EmptyState
          icon={ShieldAlert}
          title="Key not found"
          description="This key was deleted or never existed for this account."
          className="py-12"
        />
      )}
      {customReady && !loading && error && isApiKeyStatus(error, 403) && (
        <EmptyState
          icon={ShieldAlert}
          title="Analytics not available"
          description="You do not have access to this key's analytics."
          className="py-12"
        />
      )}
      {customReady && !loading && error && !isApiKeyStatus(error, 404) && !isApiKeyStatus(error, 403) && (
        <ErrorState
          title="Could not load analytics"
          message={apiKeyErrorMessage(error)}
          onRetry={refresh}
        />
      )}

      {customReady && !loading && !error && summaryQuery.data && (
        <AnalyticsBody
          apiKey={keyQuery.data}
          keyLoading={keyQuery.isPending}
          summary={summaryQuery.data}
          modelTimeseries={modelTsQuery.data}
          endpointTimeseries={endpointTsQuery.data}
          timeseriesLoading={modelTsQuery.isPending || endpointTsQuery.isPending}
          insights={insightsQuery.data?.insights}
          insightsLoading={
            (summaryQuery.data.insights?.length ?? 0) === 0 && insightsQuery.isPending
          }
          preset={range.preset}
        />
      )}
    </div>
  );
}

function AnalyticsBody({
  apiKey,
  keyLoading,
  summary,
  modelTimeseries,
  endpointTimeseries,
  timeseriesLoading,
  insights,
  insightsLoading,
  preset,
}: {
  apiKey: ApiKey | undefined;
  keyLoading: boolean;
  summary: ApiKeyAnalyticsSummary;
  modelTimeseries: ApiKeyTimeseries | undefined;
  endpointTimeseries: ApiKeyTimeseries | undefined;
  timeseriesLoading: boolean;
  insights?: ApiKeyAnalyticsSummary["insights"];
  insightsLoading: boolean;
  preset: AnalyticsPreset;
}) {
  const totalRequests = num(summary.requests?.total);
  const hasTraffic =
    totalRequests > 0 ||
    (modelTimeseries?.points?.length ?? 0) > 0 ||
    (endpointTimeseries?.points?.length ?? 0) > 0;
  const resolvedInsights = useMemo(
    () =>
      (summary.insights?.length ?? 0) > 0
        ? summary.insights
        : (insights ?? []),
    [summary.insights, insights],
  );

  if (!hasTraffic) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No traffic in this range"
        description="Requests made with this key will appear here — totals, latency, tokens, cost and insights."
        className="py-12"
        testId="key-analytics-empty"
      />
    );
  }

  const maxBudget = apiKey?.policy?.max_budget_usd ?? null;

  return (
    <div className="space-y-5" data-testid="key-analytics-body">
      <div className="space-y-2">
        <SectionLabel>Key health</SectionLabel>
        <KeyHealthSection
          apiKey={apiKey}
          costTotal={summary.cost?.total ?? 0}
          loadingKey={keyLoading}
          loadingCost={false}
        />
      </div>

      <div className="space-y-2">
        <SectionLabel>Usage overview</SectionLabel>
        <UsageOverview summary={summary} />
      </div>

      <div className="space-y-2">
        <SectionLabel>Time series</SectionLabel>
        <RequestVolumeChart
          timeseries={modelTimeseries}
          preset={preset}
          loading={timeseriesLoading}
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <SpendTrend timeseries={modelTimeseries} preset={preset} loading={timeseriesLoading} />
          <TokenTrend
            summary={summary}
            timeseries={modelTimeseries}
            preset={preset}
            loading={timeseriesLoading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel>Model analytics</SectionLabel>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ModelUsageTrend
            timeseries={modelTimeseries}
            preset={preset}
            loading={timeseriesLoading}
          />
          <TopModelsChart summary={summary} />
        </div>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ModelCostEfficiency summary={summary} />
          <SectionFrame
            title="Models"
            description="Sortable per-model breakdown."
            testId="key-models-card"
          >
            <ModelTable summary={summary} />
          </SectionFrame>
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel>Endpoint analytics</SectionLabel>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <EndpointDonut summary={summary} />
          <EndpointTrend
            timeseries={endpointTimeseries}
            preset={preset}
            loading={timeseriesLoading}
          />
        </div>
        <SectionFrame
          title="Endpoints"
          description="Sortable per-endpoint breakdown."
          testId="key-endpoints-card"
        >
          <EndpointTable summary={summary} />
        </SectionFrame>
      </div>

      <div className="space-y-2">
        <SectionLabel>Budget analytics</SectionLabel>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <BudgetBurnRate
            maxBudget={maxBudget}
            timeseries={modelTimeseries}
            loading={timeseriesLoading || keyLoading}
          />
          <BudgetGauge
            costTotal={summary.cost?.total ?? 0}
            maxBudget={maxBudget}
            loading={keyLoading}
          />
          <DailySpendHeatmap
            timeseries={modelTimeseries}
            preset={preset}
            loading={timeseriesLoading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel>Insights</SectionLabel>
        <InsightList insights={resolvedInsights} loading={insightsLoading} />
      </div>
    </div>
  );
}
