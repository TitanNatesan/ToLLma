"use client";

import { useMemo } from "react";
import { bucketFullLabel, bucketLabel, num } from "./shared";
import type { AnalyticsPreset, ApiKeyTimeseriesStackedPoint } from "@/types/apiKeys";

export interface StackedSeries {
  keys: string[];
  data: Array<Record<string, string | number>>;
}

/**
 * Shared stacked-series builder for per-group timelines (model / endpoint).
 * Keeps the top N groups as areas and folds the tail into "Other" so charts
 * stay readable. Pure mapping over the existing timeseries payload.
 */
export function useStackedSeries(
  stacked: ApiKeyTimeseriesStackedPoint[] | undefined,
  preset: AnalyticsPreset,
  topN = 6,
): StackedSeries {
  return useMemo(() => {
    const rows = stacked ?? [];
    const totals = new Map<string, number>();
    for (const row of rows) {
      for (const [rawKey, value] of Object.entries(row)) {
        if (rawKey === "bucket") continue;
        totals.set(rawKey, (totals.get(rawKey) ?? 0) + num(value));
      }
    }
    const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    const top = ordered.slice(0, topN);
    const overflow = ordered.slice(topN);
    const data = rows.map((row) => {
      const point: Record<string, string | number> = {
        label: bucketLabel(row.bucket, preset),
        fullLabel: bucketFullLabel(row.bucket, preset),
      };
      for (const key of top) point[key] = num(row[key]);
      if (overflow.length > 0) {
        point.Other = overflow.reduce((sum, key) => sum + num(row[key]), 0);
      }
      return point;
    });
    return { keys: overflow.length > 0 ? [...top, "Other"] : top, data };
  }, [stacked, preset, topN]);
}
