"use client";

import { useMemo } from "react";
import { fmtCost } from "@/lib/utils";
import { ChartSkeleton, EmptyHint, SectionFrame, bucketFullLabel, num, parseBucket } from "./shared";
import type { AnalyticsPreset, ApiKeyTimeseries } from "@/types/apiKeys";

function intensityClass(fraction: number): string {
  if (fraction <= 0) return "bg-zinc-100 dark:bg-zinc-900";
  if (fraction < 0.2) return "bg-tollma-100 dark:bg-tollma-950";
  if (fraction < 0.4) return "bg-tollma-200 dark:bg-tollma-900";
  if (fraction < 0.6) return "bg-tollma-300 dark:bg-tollma-800";
  if (fraction < 0.8) return "bg-tollma-400 dark:bg-tollma-700";
  return "bg-tollma-500 dark:bg-tollma-500";
}

/**
 * Daily Spend Heatmap: one cell per cost bucket, intensity = share of the
 * range maximum. Derived from the existing dual cost series.
 */
export function DailySpendHeatmap({
  timeseries,
  preset,
  loading = false,
}: {
  timeseries?: ApiKeyTimeseries;
  preset: AnalyticsPreset;
  loading?: boolean;
}) {
  const cells = useMemo(() => {
    const rows = (timeseries?.dual ?? []).map((point) => ({
      bucket: point.bucket,
      label: bucketFullLabel(point.bucket, preset),
      cost: num(point.cost),
    }));
    const max = Math.max(...rows.map((row) => row.cost), 0);
    return rows.map((row) => ({ ...row, fraction: max > 0 ? row.cost / max : 0, max }));
  }, [timeseries?.dual, preset]);

  const monthLabel = useMemo(() => {
    if (cells.length === 0) return "";
    const first = parseBucket(cells[0].bucket);
    if (isNaN(first.getTime())) return "";
    return first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }, [cells]);

  return (
    <SectionFrame
      title="Daily spend heatmap"
      description={monthLabel ? `Spend intensity per bucket · ${monthLabel}` : "Spend intensity per bucket."}
      testId="key-spend-heatmap"
    >
      {loading ? (
        <ChartSkeleton height={120} />
      ) : cells.length === 0 || cells.every((cell) => cell.cost <= 0) ? (
        <EmptyHint label="No spend in this range" />
      ) : (
        <div data-testid="key-spend-heatmap-body">
          <div className="flex flex-wrap gap-1.5" role="img" aria-label="Daily spend intensity">
            {cells.map((cell) => (
              <div
                key={cell.bucket}
                title={`${cell.label}: ${fmtCost(cell.cost)}`}
                aria-label={`${cell.label}: ${fmtCost(cell.cost)}`}
                className={`size-6 rounded-md border border-black/5 transition-transform hover:scale-110 dark:border-white/5 ${intensityClass(cell.fraction)}`}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-end gap-1.5 text-[9px] text-zinc-400">
            <span>less</span>
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
              <span key={fraction} className={`inline-block size-2.5 rounded-sm ${intensityClass(fraction)}`} />
            ))}
            <span>more · max {fmtCost(cells[0]?.max ?? 0)}</span>
          </div>
        </div>
      )}
    </SectionFrame>
  );
}
