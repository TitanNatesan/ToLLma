"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCost } from "@/lib/utils";
import {
  AnalyticsTooltip,
  ChartSkeleton,
  EmptyHint,
  SectionFrame,
  bucketLabel,
  num,
} from "./shared";
import type { AnalyticsPreset, ApiKeyTimeseries } from "@/types/apiKeys";

/** Spend Over Time: range cost per bucket from the existing dual series. */
export function SpendTrend({
  timeseries,
  preset,
  loading = false,
}: {
  timeseries?: ApiKeyTimeseries;
  preset: AnalyticsPreset;
  loading?: boolean;
}) {
  const points = useMemo(
    () =>
      (timeseries?.dual ?? []).map((point) => ({
        label: bucketLabel(point.bucket, preset),
        cost: num(point.cost),
      })),
    [timeseries?.dual, preset],
  );

  return (
    <SectionFrame
      title="Spend over time"
      description="Cost per bucket across the range."
      testId="key-spend-trend"
    >
      {loading ? (
        <ChartSkeleton height={210} />
      ) : points.length === 0 ? (
        <EmptyHint label="No spend in this range" />
      ) : (
        <div
          role="img"
          aria-label="Spend over time"
          className="w-full text-zinc-400 dark:text-zinc-500"
          data-testid="key-spend-trend-chart"
        >
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                className="stroke-zinc-200 dark:stroke-zinc-800"
              />
              <XAxis
                dataKey="label"
                tick={{ fill: "currentColor", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
              />
              <YAxis
                tick={{ fill: "currentColor", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(value: number) => fmtCost(value)}
              />
              <Tooltip
                content={<AnalyticsTooltip valueFormat={(value: number) => fmtCost(value)} />}
                cursor={{ stroke: "#a1a1aa", strokeDasharray: "3 3" }}
              />
              <Line
                type="monotone"
                dataKey="cost"
                name="Spend"
                stroke="var(--color-tollma-500)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionFrame>
  );
}
