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
  ShareBar,
  bucketLabel,
  fmtMs,
  num,
  truncate,
} from "./shared";
import type { AnalyticsPreset, ApiKeyAnalyticsSummary, ApiKeyTimeseries } from "@/types/apiKeys";

const LATENCY_BUCKETS = [
  { max: 0.2, className: "bg-emerald-500/85" },
  { max: 0.4, className: "bg-emerald-400/80" },
  { max: 0.6, className: "bg-amber-400/85" },
  { max: 0.8, className: "bg-orange-500/85" },
  { max: 1.01, className: "bg-red-500/85" },
] as const;

/** Latency percentiles, history and the provider × model heatmap. */
export function LatencyPanel({
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
  const performance = summary.performance;

  const points = useMemo(
    () =>
      (timeseries?.latency ?? []).map((point) => ({
        label: bucketLabel(point.bucket, preset),
        avg: point.avg_latency_ms === null ? 0 : num(point.avg_latency_ms),
        p95: point.p95_ms === null ? 0 : num(point.p95_ms),
      })),
    [timeseries?.latency, preset],
  );

  const percentiles = useMemo(() => {
    const rows = [
      { label: "p50", value: performance?.p50_ms },
      { label: "p90", value: performance?.p90_ms },
      { label: "p95", value: performance?.p95_ms },
      { label: "p99", value: performance?.p99_ms },
    ];
    const max = Math.max(...rows.map((row) => num(row.value)), 1);
    return rows.map((row) => ({ ...row, fraction: num(row.value) / max }));
  }, [performance]);

  const heatmap = useMemo(() => buildHeatmap(summary), [summary]);

  return (
    <div className="space-y-3">
      <SectionFrame
        title="Latency"
        description="Average and p95 per bucket, plus tail percentiles."
        testId="key-analytics-latency"
      >
        {loading ? (
          <ChartSkeleton height={190} />
        ) : points.length === 0 ? (
          <EmptyHint label="No latency samples in this range" />
        ) : (
          <div
            role="img"
            aria-label="Average and p95 latency over time"
            className="w-full text-zinc-400 dark:text-zinc-500"
            data-testid="key-latency-series"
          >
            <ResponsiveContainer width="100%" height={190}>
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
                  width={48}
                  tickFormatter={(value: number) => fmtMs(value)}
                />
                <Tooltip
                  content={
                    <AnalyticsTooltip
                      valueFormat={(value: number) => fmtMs(value)}
                      labelFormat={(value) => String(value)}
                    />
                  }
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
                  dataKey="avg"
                  name="Average"
                  stroke="var(--color-tollma-500)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="p95"
                  name="p95"
                  stroke="#d97706"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <ul className="mt-3 space-y-2" data-testid="key-latency-percentiles">
          {percentiles.map((row) => (
            <li key={row.label} className="grid grid-cols-[32px_1fr_64px] items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                {row.label}
              </span>
              <ShareBar fraction={row.fraction} colorClass="bg-gradient-to-r from-tollma-500/70 to-tollma-500" />
              <span className="text-right font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                {fmtMs(row.value)}
              </span>
            </li>
          ))}
        </ul>
      </SectionFrame>

      <SectionFrame
        title="Latency heatmap"
        description="Average latency by provider × model — green is fast, red is slow."
        testId="key-analytics-heatmap"
      >
        {heatmap.rows.length === 0 || heatmap.columns.length === 0 ? (
          <EmptyHint label="Not enough provider/model data for a heatmap" />
        ) : (
          <HeatmapGrid heatmap={heatmap} />
        )}
      </SectionFrame>
    </div>
  );
}

interface HeatmapModel {
  min: number;
  max: number;
  rows: Array<{
    provider: string;
    cells: Array<{ model: string; latency: number | null; requests: number; intensity: number }>;
  }>;
  columns: string[];
}

function buildHeatmap(summary: ApiKeyAnalyticsSummary): HeatmapModel {
  const models = summary.models ?? [];
  const providers = summary.providers ?? [];
  const topModels = [...models]
    .sort((a, b) => num(b.requests) - num(a.requests))
    .slice(0, 6)
    .map((row) => row.model)
    .filter((model): model is string => Boolean(model));
  const byProvider = new Map<string, Map<string, { latency: number | null; requests: number }>>();
  for (const row of models) {
    const provider = row.provider || "unknown";
    if (!byProvider.has(provider)) byProvider.set(provider, new Map());
    byProvider.get(provider)?.set(row.model, {
      latency: row.avg_latency_ms === null ? null : num(row.avg_latency_ms),
      requests: num(row.requests),
    });
  }
  const providerOrder = [...byProvider.keys()].sort((a, b) => {
    const aReq = providers.find((row) => row.provider === a)?.requests ?? 0;
    const bReq = providers.find((row) => row.provider === b)?.requests ?? 0;
    return num(bReq) - num(aReq);
  });
  const latencies = models
    .map((row) => (row.avg_latency_ms === null ? null : num(row.avg_latency_ms)))
    .filter((value): value is number => value !== null && value > 0);
  const min = latencies.length > 0 ? Math.min(...latencies) : 0;
  const max = latencies.length > 0 ? Math.max(...latencies) : 1;
  const span = max - min || 1;

  return {
    min,
    max,
    columns: topModels,
    rows: providerOrder.slice(0, 6).map((provider) => ({
      provider,
      cells: topModels.map((model) => {
        const cell = byProvider.get(provider)?.get(model) ?? null;
        const latency = cell?.latency ?? null;
        return {
          model,
          latency,
          requests: cell?.requests ?? 0,
          intensity: latency === null ? 0 : (latency - min) / span,
        };
      }),
    })),
  };
}

function HeatmapGrid({ heatmap }: { heatmap: HeatmapModel }) {
  const bucketFor = (intensity: number) =>
    LATENCY_BUCKETS.find((bucket) => intensity < bucket.max) ?? LATENCY_BUCKETS[4];
  return (
    <div className="min-w-0 overflow-x-auto">
      <div
        className="grid min-w-[420px] gap-1"
        style={{ gridTemplateColumns: `96px repeat(${heatmap.columns.length}, minmax(0, 1fr))` }}
        role="img"
        aria-label="Average latency by provider and model"
      >
        <span />
        {heatmap.columns.map((model) => (
          <span
            key={model}
            className="truncate pb-1 text-center text-[9px] text-zinc-400"
            title={model}
          >
            {truncate(model, 14)}
          </span>
        ))}
        {heatmap.rows.map((row) => (
          <HeatmapRow key={row.provider} row={row} bucketFor={bucketFor} />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2 text-[9px] text-zinc-400">
        <span>fast {fmtMs(heatmap.min)}</span>
        <span className="flex items-center gap-0.5">
          {LATENCY_BUCKETS.map((bucket) => (
            <span key={bucket.className} className={`inline-block size-2 rounded-sm ${bucket.className}`} />
          ))}
        </span>
        <span>
          slow {fmtMs(heatmap.max)}
        </span>
      </div>
    </div>
  );
}

function HeatmapRow({
  row,
  bucketFor,
}: {
  row: HeatmapModel["rows"][number];
  bucketFor: (intensity: number) => (typeof LATENCY_BUCKETS)[number];
}) {
  return (
    <>
      <span className="truncate pr-1 text-[10px] text-zinc-500" title={row.provider}>
        {truncate(row.provider, 14)}
      </span>
      {row.cells.map((cell) => (
        <div
          key={`${row.provider}-${cell.model}`}
          title={
            cell.latency === null
              ? `${row.provider} · ${cell.model}: no data`
              : `${row.provider} · ${cell.model}: ${fmtMs(cell.latency)} (${fmtTokens(cell.requests)} req)`
          }
          aria-label={cell.model ? `${cell.model} on ${row.provider}` : undefined}
          className={`h-7 rounded-md ${
            cell.latency === null ? "bg-zinc-100 dark:bg-zinc-900" : bucketFor(cell.intensity).className
          }`}
        />
      ))}
    </>
  );
}
