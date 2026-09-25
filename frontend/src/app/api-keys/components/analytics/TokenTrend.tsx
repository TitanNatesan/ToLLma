"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompactTokens, fmtTokens } from "@/lib/utils";
import {
  AnalyticsTooltip,
  ChartSkeleton,
  EmptyHint,
  SectionFrame,
  bucketLabel,
  num,
} from "./shared";
import type { AnalyticsPreset, ApiKeyAnalyticsSummary, ApiKeyTimeseries } from "@/types/apiKeys";

const TOKEN_KINDS = [
  { key: "prompt", label: "Prompt", color: "var(--color-tollma-500)" },
  { key: "completion", label: "Completion", color: "#0891b2" },
  { key: "reasoning", label: "Reasoning", color: "#7c3aed" },
  { key: "cache_read", label: "Cache read", color: "#d97706" },
  { key: "cache_write", label: "Cache write", color: "#65a30d" },
] as const;

/**
 * Token Usage Over Time: total tokens per bucket (area) plus the range
 * composition bar. The timeseries payload only carries per-bucket token
 * totals (`dual[].tokens`) — per-kind history (prompt/completion/…) is not
 * exposed by the existing endpoint, so the kind split comes from the
 * summary totals for the same range.
 */
export function TokenTrend({
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
        tokens: num(point.tokens),
      })),
    [timeseries?.dual, preset],
  );

  const tokens = summary.tokens;
  const tokenTotal = num(tokens?.total);
  const kinds = useMemo(
    () =>
      TOKEN_KINDS.map((kind) => ({
        ...kind,
        value: num(tokens?.[kind.key]),
      })),
    [tokens],
  );

  return (
    <SectionFrame
      title="Token usage over time"
      description="Total tokens per bucket; kind mix below is the range total."
      testId="key-token-trend"
    >
      {loading ? (
        <ChartSkeleton height={210} />
      ) : points.length === 0 ? (
        <EmptyHint label="No token usage in this range" />
      ) : (
        <div
          role="img"
          aria-label="Token usage over time"
          className="w-full text-zinc-400 dark:text-zinc-500"
          data-testid="key-token-trend-chart"
        >
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                width={46}
                tickFormatter={(value: number) => fmtCompactTokens(value)}
              />
              <Tooltip
                content={<AnalyticsTooltip valueFormat={(value: number) => fmtTokens(value)} />}
                cursor={{ stroke: "#a1a1aa", strokeDasharray: "3 3" }}
              />
              <Area
                type="monotone"
                dataKey="tokens"
                name="Tokens"
                stroke="#0891b2"
                fill="#0891b2"
                fillOpacity={0.18}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {kinds.map((kind) => (
          <div
            key={kind.key}
            style={{
              width: tokenTotal > 0 ? `${(kind.value / tokenTotal) * 100}%` : "0%",
              background: kind.color,
            }}
            title={`${kind.label}: ${fmtTokens(kind.value)}`}
          />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3" data-testid="key-token-kinds">
        {kinds.map((kind) => (
          <li key={kind.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
              <span
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ background: kind.color }}
              />
              <span className="truncate">{kind.label}</span>
            </span>
            <span className="shrink-0 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
              {fmtTokens(kind.value)}
            </span>
          </li>
        ))}
      </ul>
    </SectionFrame>
  );
}
