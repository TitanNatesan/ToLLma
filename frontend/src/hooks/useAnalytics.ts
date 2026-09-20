"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAnalyticsBreakdown,
  getAnalyticsConversations,
  getAnalyticsHeatmap,
  getAnalyticsModels,
  getAnalyticsPerformance,
  getAnalyticsSummary,
  getAnalyticsTimeseries,
} from "@/services/api";
import type { AnalyticsGranularity, AnalyticsRangeParams, ModelSort } from "@/types";

/** The user's browser timezone drives every backend range/bucket calculation. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function analyticsKey(kind: string, params: AnalyticsRangeParams, extra?: string) {
  return [
    "analytics",
    kind,
    params.preset,
    params.tz,
    params.start ?? "",
    params.end ?? "",
    extra ?? "",
  ] as const;
}

export function useAnalyticsSummary(params: AnalyticsRangeParams) {
  return useQuery({
    queryKey: analyticsKey("summary", params),
    queryFn: () => getAnalyticsSummary(params),
  });
}

export function useAnalyticsTimeseries(params: AnalyticsRangeParams, granularity?: AnalyticsGranularity) {
  return useQuery({
    queryKey: analyticsKey("timeseries", params, granularity ?? "auto"),
    queryFn: () => getAnalyticsTimeseries(params, granularity),
  });
}

export function useAnalyticsBreakdown(params: AnalyticsRangeParams) {
  return useQuery({
    queryKey: analyticsKey("breakdown", params),
    queryFn: () => getAnalyticsBreakdown(params),
  });
}

export function useAnalyticsModels(params: AnalyticsRangeParams, sort: ModelSort) {
  return useQuery({
    queryKey: analyticsKey("models", params, sort),
    queryFn: () => getAnalyticsModels(params, sort),
  });
}

export function useAnalyticsHeatmap(params: AnalyticsRangeParams) {
  return useQuery({
    queryKey: analyticsKey("heatmap", params),
    queryFn: () => getAnalyticsHeatmap(params),
  });
}

export function useAnalyticsPerformance(params: AnalyticsRangeParams) {
  return useQuery({
    queryKey: analyticsKey("performance", params),
    queryFn: () => getAnalyticsPerformance(params),
  });
}

export function useAnalyticsConversations(params: AnalyticsRangeParams) {
  return useQuery({
    queryKey: analyticsKey("conversations", params),
    queryFn: () => getAnalyticsConversations(params),
  });
}

export function useAnalyticsRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["analytics"] });
}
