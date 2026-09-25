"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtTokens } from "@/lib/utils";
import {
  AnalyticsTooltip,
  ChartSkeleton,
  EmptyHint,
  SectionFrame,
  bucketLabel,
  num,
} from "./shared";
import type { AnalyticsPreset, ApiKeyTimeseries } from "@/types/apiKeys";

/** Success / failure / cancellation lines per bucket. */
export function RequestVolumeChart({
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
      (timeseries?.points ?? []).map((point) => ({
        label: bucketLabel(point.bucket, preset),
        success: num(point.success),
        failed: num(point.failed),
        cancelled: num(point.cancelled),
      })),
    [timeseries?.points, preset],
  );

  return (
    <SectionFrame
      title="Request volume"
      description="Success, failure and cancellation per bucket."
      testId="key-request-volume"
      className="xl:col-span-2"
    >
      {loading ? (
        <ChartSkeleton height={250} />
      ) : points.length === 0 ? (
        <EmptyHint label="No requests in this range" />
      ) : (
        <div
          role="img"
          aria-label="Request volume over time by outcome"
          className="w-full text-zinc-400 dark:text-zinc-500"
          data-testid="key-request-volume-chart"
        >
          <ResponsiveContainer width="100%" height={250}>
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
                allowDecimals={false}
                tick={{ fill: "currentColor", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(value: number) => fmtTokens(value)}
              />
              <Tooltip
                content={<AnalyticsTooltip valueFormat={(value: number) => fmtTokens(value)} />}
                cursor={{ stroke: "#a1a1aa", strokeDasharray: "3 3" }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value) => (
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{value}</span>
                )}
              />
              <Line
                type="monotone"
                dataKey="success"
                name="Success"
                stroke="var(--color-tollma-500)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="failed"
                name="Failure"
                stroke="#dc2626"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="cancelled"
                name="Cancelled"
                stroke="#a1a1aa"
                strokeWidth={2}
                strokeDasharray="4 3"
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
