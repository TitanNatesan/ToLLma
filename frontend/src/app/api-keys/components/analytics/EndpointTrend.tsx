"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartColor } from "@/components/charts/palette";
import { fmtTokens } from "@/lib/utils";
import { AnalyticsTooltip, ChartSkeleton, EmptyHint, SectionFrame, truncate } from "./shared";
import { useStackedSeries } from "./stacked";
import type { AnalyticsPreset, ApiKeyTimeseries } from "@/types/apiKeys";

/** Endpoint Trend: stacked timeline of requests per endpoint. */
export function EndpointTrend({
  timeseries,
  preset,
  loading = false,
}: {
  timeseries?: ApiKeyTimeseries;
  preset: AnalyticsPreset;
  loading?: boolean;
}) {
  const series = useStackedSeries(timeseries?.stacked, preset, 6);

  return (
    <SectionFrame
      title="Endpoint trend"
      description="Requests per bucket, stacked by endpoint."
      testId="key-endpoint-trend"
    >
      {loading ? (
        <ChartSkeleton height={230} />
      ) : series.data.length === 0 || series.keys.length === 0 ? (
        <EmptyHint label="No per-endpoint usage in this range" />
      ) : (
        <div
          role="img"
          aria-label="Requests over time per endpoint"
          className="w-full text-zinc-400 dark:text-zinc-500"
          data-testid="key-endpoint-trend-chart"
        >
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={series.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {truncate(String(value), 18)}
                  </span>
                )}
              />
              {series.keys.map((key, index) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={key}
                  stackId="endpoints"
                  stroke={key === "Other" ? "#64748b" : chartColor(index)}
                  fill={key === "Other" ? "#64748b" : chartColor(index)}
                  fillOpacity={0.32}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionFrame>
  );
}
