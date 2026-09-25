"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ShieldAlert, Sparkles } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/ui";
import {
  apiKeyErrorMessage,
  getKeyAnalytics,
  getKeyInsights,
  getKeyTimeseries,
  isApiKeyStatus,
} from "@/services/apiKeys";
import { CacheSavingsCard } from "./analytics/CacheSavingsCard";
import { CostPanel } from "./analytics/CostPanel";
import { EndpointTable } from "./analytics/EndpointTable";
import { InsightList } from "./analytics/InsightList";
import { LatencyPanel } from "./analytics/LatencyPanel";
import { MetricGrid } from "./analytics/MetricGrid";
import { ModelTable } from "./analytics/ModelTable";
import { ProviderTable } from "./analytics/ProviderTable";
import { DEFAULT_RANGE, RangeSelector, type RangeValue } from "./analytics/RangeSelector";
import { RequestBreakdown } from "./analytics/RequestBreakdown";
import { RequestVolumeChart } from "./analytics/RequestVolumeChart";
import { SectionFrame, num } from "./analytics/shared";
import { TokenPanel } from "./analytics/TokenPanel";
import { TopConsumers } from "./analytics/TopConsumers";
import type {
  AnalyticsGroupBy,
  ApiKeyAnalyticsSummary,
  ApiKeyTimeseries,
} from "@/types/apiKeys";

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

/**
 * Developer-grade observability for one API key: metric groups, eight charts,
 * insights, breakdown tables and cache savings, all keyed by the range filter.
 */
export function KeyAnalytics({ keyId }: { keyId: string }) {
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const [groupBy, setGroupBy] = useState<AnalyticsGroupBy>("model");

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
  const timeseriesQuery = useQuery({
    queryKey: ["key-analytics-timeseries", keyId, params, groupBy],
    queryFn: () => getKeyTimeseries(keyId, params, groupBy),
    enabled: customReady,
    staleTime: 30_000,
  });
  // The summary carries insights; the dedicated endpoint is a fallback only.
  const insightsQuery = useQuery({
    queryKey: ["key-analytics-insights", keyId, params],
    queryFn: () => getKeyInsights(keyId, params),
    enabled: customReady && !!summaryQuery.data && (summaryQuery.data.insights?.length ?? 0) === 0,
    staleTime: 60_000,
  });

  const fetching =
    summaryQuery.isFetching || timeseriesQuery.isFetching || insightsQuery.isFetching;

  const refresh = () => {
    void summaryQuery.refetch();
    void timeseriesQuery.refetch();
    void insightsQuery.refetch();
  };

  const error = summaryQuery.error ?? timeseriesQuery.error;
  const loading =
    customReady &&
    (summaryQuery.isPending || timeseriesQuery.isPending || (!summaryQuery.data && !error));

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
          summary={summaryQuery.data}
          timeseries={timeseriesQuery.data}
          timeseriesLoading={timeseriesQuery.isPending}
          insights={insightsQuery.data?.insights}
          insightsLoading={
            (summaryQuery.data.insights?.length ?? 0) === 0 && insightsQuery.isPending
          }
          preset={range.preset}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
        />
      )}
    </div>
  );
}

function AnalyticsBody({
  summary,
  timeseries,
  timeseriesLoading,
  insights,
  insightsLoading,
  preset,
  groupBy,
  onGroupByChange,
}: {
  summary: ApiKeyAnalyticsSummary;
  timeseries: ApiKeyTimeseries | undefined;
  timeseriesLoading: boolean;
  insights?: ApiKeyAnalyticsSummary["insights"];
  insightsLoading: boolean;
  preset: RangeValue["preset"];
  groupBy: AnalyticsGroupBy;
  onGroupByChange: (value: AnalyticsGroupBy) => void;
}) {
  const totalRequests = num(summary.requests?.total);
  const hasTraffic = totalRequests > 0 || (timeseries?.points?.length ?? 0) > 0;
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

  return (
    <div className="space-y-4" data-testid="key-analytics-body">
      <MetricGrid summary={summary} />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <RequestVolumeChart timeseries={timeseries} preset={preset} loading={timeseriesLoading} />
        <InsightList insights={resolvedInsights} loading={insightsLoading} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <CostPanel summary={summary} timeseries={timeseries} preset={preset} loading={timeseriesLoading} />
        <TokenPanel
          summary={summary}
          timeseries={timeseries}
          preset={preset}
          groupBy={groupBy}
          onGroupByChange={onGroupByChange}
          loading={timeseriesLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <LatencyPanel summary={summary} timeseries={timeseries} preset={preset} loading={timeseriesLoading} />
        <RequestBreakdown summary={summary} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <CacheSavingsCard summary={summary} />
        <div className="xl:col-span-2">
          <TopConsumers summary={summary} />
        </div>
      </div>

      <SectionFrame title="Providers" description="Sortable per-provider breakdown." testId="key-providers-card">
        <ProviderTable summary={summary} />
      </SectionFrame>
      <SectionFrame title="Models" description="Sortable per-model breakdown." testId="key-models-card">
        <ModelTable summary={summary} />
      </SectionFrame>
      <SectionFrame title="Endpoints" description="Sortable per-endpoint breakdown." testId="key-endpoints-card">
        <EndpointTable summary={summary} />
      </SectionFrame>
    </div>
  );
}
