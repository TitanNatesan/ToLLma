"use client";

import { useMemo } from "react";
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
import { fmtCompactTokens, fmtTokens } from "@/lib/utils";
import { DistributionDonut } from "./DistributionDonut";
import {
  AnalyticsTooltip,
  ChartSkeleton,
  EmptyHint,
  SectionFrame,
  bucketFullLabel,
  bucketLabel,
  num,
  sharePct,
  truncate,
} from "./shared";
import type {
  AnalyticsGroupBy,
  AnalyticsPreset,
  ApiKeyAnalyticsSummary,
  ApiKeyTimeseries,
} from "@/types/apiKeys";

const TOKEN_KINDS = [
  { key: "prompt", label: "Prompt", color: "var(--color-tollma-500)" },
  { key: "completion", label: "Completion", color: "#0891b2" },
  { key: "reasoning", label: "Reasoning", color: "#7c3aed" },
  { key: "cache_read", label: "Cache read", color: "#d97706" },
  { key: "cache_write", label: "Cache write", color: "#65a30d" },
] as const;

const GROUP_BY_OPTIONS: ReadonlyArray<{ value: AnalyticsGroupBy; label: string }> = [
  { value: "model", label: "Model" },
  { value: "provider", label: "Provider" },
  { value: "endpoint", label: "Endpoint" },
];

/** Token mix, stacked usage timeline (group-by switch) and endpoint distribution. */
export function TokenPanel({
  summary,
  timeseries,
  preset,
  groupBy,
  onGroupByChange,
  loading = false,
}: {
  summary: ApiKeyAnalyticsSummary;
  timeseries?: ApiKeyTimeseries;
  preset: AnalyticsPreset;
  groupBy: AnalyticsGroupBy;
  onGroupByChange: (value: AnalyticsGroupBy) => void;
  loading?: boolean;
}) {
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

  const stacked = useMemo(() => {
    const rows = timeseries?.stacked ?? [];
    const totals = new Map<string, number>();
    for (const row of rows) {
      for (const [rawKey, value] of Object.entries(row)) {
        if (rawKey === "bucket") continue;
        totals.set(rawKey, (totals.get(rawKey) ?? 0) + num(value));
      }
    }
    const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    const top = ordered.slice(0, 8);
    const overflow = ordered.slice(8);
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
  }, [timeseries?.stacked, preset]);

  const endpoints = useMemo(
    () =>
      (summary.endpoints ?? []).map((row) => ({
        name: row.endpoint || "unknown endpoint",
        value: num(row.requests),
        hint:
          row.share !== null && row.share !== undefined
            ? `${sharePct(row.share, 0)} share`
            : undefined,
      })),
    [summary.endpoints],
  );

  return (
    <div className="space-y-3">
      <SectionFrame
        title="Token composition"
        description="Prompt, completion, reasoning and cache usage."
        testId="key-tokens-composition"
      >
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
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
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2" data-testid="key-tokens-list">
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
          <li className="col-span-2 flex items-center justify-between gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-900">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              Total · per request
            </span>
            <span className="font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-100">
              {fmtTokens(tokenTotal)}
              <span className="ml-2 text-zinc-400">/ {fmtTokens(tokens?.per_request)}</span>
            </span>
          </li>
        </ul>
      </SectionFrame>

      <SectionFrame
        title="Usage timeline"
        description={`Tokens per ${groupBy} per bucket.`}
        testId="key-usage-timeline"
        action={
          <div
            role="group"
            aria-label="Group usage by"
            className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50/60 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/60"
          >
            {GROUP_BY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={groupBy === option.value}
                onClick={() => onGroupByChange(option.value)}
                data-testid={`key-group-by-${option.value}`}
                className={
                  groupBy === option.value
                    ? "rounded-md bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                    : "rounded-md px-2 py-0.5 text-[10px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <ChartSkeleton height={210} />
        ) : stacked.data.length === 0 || stacked.keys.length === 0 ? (
          <EmptyHint label="No grouped usage in this range" />
        ) : (
          <div
            role="img"
            aria-label={`Token usage by ${groupBy} over time`}
            className="w-full text-zinc-400 dark:text-zinc-500"
            data-testid="key-usage-chart"
          >
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={stacked.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                {stacked.keys.map((key, index) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stackId="usage"
                    stroke={key === "Other" ? "#64748b" : chartColor(index)}
                    fill={key === "Other" ? "#64748b" : chartColor(index)}
                    fillOpacity={0.35}
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

      <SectionFrame
        title="Endpoint distribution"
        description="Requests routed per gateway endpoint."
        testId="key-endpoint-distribution"
      >
        <DistributionDonut
          items={endpoints}
          valueFormat={(value) => fmtTokens(value)}
          ariaLabel="Requests by endpoint"
          testId="key-endpoints-donut"
        />
      </SectionFrame>
    </div>
  );
}
