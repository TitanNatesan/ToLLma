"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompactTokens, fmtCost } from "@/lib/utils";
import { DistributionDonut } from "./DistributionDonut";
import {
  AnalyticsTooltip,
  ChartSkeleton,
  EmptyHint,
  SectionFrame,
  bucketLabel,
  num,
} from "./shared";
import type { AnalyticsPreset, ApiKeyAnalyticsSummary, ApiKeyTimeseries } from "@/types/apiKeys";

/** Cost over time against token throughput + provider spend split. */
export function CostPanel({
  summary,
  timeseries,
  preset,
  loading = false,
}: {
  summary: ApiKeyAnalyticsSummary;
  timeseries?: ApiKeyTimeseries;
  preset: AnalyticsPreset;
  loading?: boolean;
}) {
  const points = useMemo(
    () =>
      (timeseries?.dual ?? []).map((point) => ({
        label: bucketLabel(point.bucket, preset),
        cost: num(point.cost),
        tokens: num(point.tokens),
      })),
    [timeseries?.dual, preset],
  );

  const providers = useMemo(
    () =>
      (summary.providers ?? []).map((row) => ({
        name: row.provider || "unknown provider",
        value: num(row.spend),
        hint: `${fmtCompactTokens(num(row.tokens))} tokens`,
      })),
    [summary.providers],
  );

  const expensive = summary.cost?.most_expensive_request;
  const expensiveDetail =
    expensive !== null && expensive !== undefined && typeof expensive === "object"
      ? [expensive.model, expensive.endpoint].filter(Boolean).join(" · ")
      : "";

  return (
    <div className="space-y-3">
      <SectionFrame
        title="Cost vs token usage"
        description="Spend (left) against tokens (right) per bucket."
        testId="key-cost-usage"
      >
        {loading ? (
          <ChartSkeleton height={210} />
        ) : points.length === 0 ? (
          <EmptyHint label="No cost data in this range" />
        ) : (
          <div
            role="img"
            aria-label="Cost and token usage over time"
            className="w-full text-zinc-400 dark:text-zinc-500"
            data-testid="key-cost-chart"
          >
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
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
                  yAxisId="cost"
                  tick={{ fill: "currentColor", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(value: number) => fmtCost(value)}
                />
                <YAxis
                  yAxisId="tokens"
                  orientation="right"
                  tick={{ fill: "currentColor", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                  tickFormatter={(value: number) => fmtCompactTokens(value)}
                />
                <Tooltip
                  content={
                    <AnalyticsTooltip
                      valueFormats={{
                        cost: (value: number) => fmtCost(value),
                        tokens: (value: number) => fmtCompactTokens(value),
                      }}
                    />
                  }
                  cursor={{ stroke: "#a1a1aa", strokeDasharray: "3 3" }}
                />
                <Area
                  yAxisId="tokens"
                  type="monotone"
                  dataKey="tokens"
                  name="Tokens"
                  stroke="#0891b2"
                  fill="#0891b2"
                  fillOpacity={0.16}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="cost"
                  type="monotone"
                  dataKey="cost"
                  name="Cost"
                  stroke="var(--color-tollma-500)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        {expensiveValue(summary) && (
          <p className="mt-2 border-t border-zinc-100 pt-2 text-[11px] text-zinc-400 dark:border-zinc-900">
            Most expensive request:{" "}
            <span className="font-mono text-zinc-600 dark:text-zinc-300">
              {expensiveValue(summary)}
            </span>
            {expensiveDetail && <span className="ml-1.5">· {expensiveDetail}</span>}
          </p>
        )}
      </SectionFrame>

      <SectionFrame
        title="Provider spend"
        description="Share of total spend per provider."
        testId="key-cost-provider-split"
      >
        <DistributionDonut
          items={providers}
          valueFormat={fmtCost}
          ariaLabel="Spend by provider"
          testId="key-providers-donut"
        />
      </SectionFrame>
    </div>
  );
}

function expensiveValue(summary: ApiKeyAnalyticsSummary): string | null {
  const expensive = summary.cost?.most_expensive_request;
  if (expensive === null || expensive === undefined) return null;
  if (typeof expensive === "object") {
    const value = num(expensive.cost);
    return value > 0 ? fmtCost(value) : null;
  }
  return fmtCost(expensive);
}
