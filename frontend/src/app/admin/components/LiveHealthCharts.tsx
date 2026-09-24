"use client";

import { memo, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColor, compactNumber } from "@/components/charts/palette";
import { ChartTooltip } from "./ChartTooltip";
import { fmtNumber } from "./format";
import type { LiveHealthSample } from "@/types/admin";

interface LiveChartPoint {
  time: string;
  value: number;
}

interface LiveMetricChartProps {
  title: string;
  data: LiveChartPoint[];
  color: string;
  /** Percent metrics pin the y-axis to 0..100. */
  percent?: boolean;
  testId: string;
  ariaLabel: string;
}

/** UTC clock labels — the console pins UTC for deterministic reads. */
function fmtClock(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

/** Single live metric: area chart over the rolling 60-sample window. */
const LiveMetricChart = memo(function LiveMetricChart({
  title,
  data,
  color,
  percent = false,
  testId,
  ariaLabel,
}: LiveMetricChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex h-[190px] items-center justify-center rounded-lg border border-dashed border-zinc-200 text-[11px] text-zinc-400 dark:border-zinc-800"
        data-testid={`${testId}-empty`}
      >
        Waiting for live samples…
      </div>
    );
  }
  return (
    <div role="img" aria-label={ariaLabel} data-testid={testId} className="w-full text-zinc-400 dark:text-zinc-500">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400">{title}</p>
      <ResponsiveContainer width="100%" height={170}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
          <XAxis
            dataKey="time"
            tick={{ fill: "currentColor", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            minTickGap={44}
            tickFormatter={(value) => fmtClock(String(value))}
          />
          <YAxis
            tick={{ fill: "currentColor", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={44}
            domain={percent ? [0, 100] : [0, "auto"]}
            tickFormatter={(value) => (percent ? `${value}%` : compactNumber(Number(value)))}
          />
          <Tooltip
            content={
              <ChartTooltip
                valueFormat={percent ? (value) => `${value.toFixed(1)}%` : fmtNumber}
                labelFormat={(label) => fmtClock(String(label))}
              />
            }
            cursor={{ stroke: "#a1a1aa", strokeDasharray: "3 3" }}
          />
          <Area
            type="monotone"
            dataKey="value"
            name={title}
            stroke={color}
            fill={color}
            fillOpacity={0.18}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

/**
 * Live health charts: CPU %, memory %, active requests and active generations
 * over the rolling sample window. Slices are memoized per metric so a new SSE
 * event only re-renders this section.
 */
export function LiveHealthCharts({ samples }: { samples: LiveHealthSample[] }) {
  const cpu = useMemo(
    () => samples.map((sample) => ({ time: sample.timestamp, value: sample.server.cpu_percent })),
    [samples],
  );
  const memory = useMemo(
    () => samples.map((sample) => ({ time: sample.timestamp, value: sample.server.memory_percent })),
    [samples],
  );
  const requests = useMemo(
    () => samples.map((sample) => ({ time: sample.timestamp, value: sample.process.active_requests })),
    [samples],
  );
  const generations = useMemo(
    () => samples.map((sample) => ({ time: sample.timestamp, value: sample.process.active_generations })),
    [samples],
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <LiveMetricChart
        title="CPU %"
        data={cpu}
        color={chartColor(0)}
        percent
        testId="admin-health-chart-cpu"
        ariaLabel="Area chart of live backend CPU utilisation over the last 60 samples"
      />
      <LiveMetricChart
        title="Memory %"
        data={memory}
        color={chartColor(1)}
        percent
        testId="admin-health-chart-memory"
        ariaLabel="Area chart of live backend memory utilisation over the last 60 samples"
      />
      <LiveMetricChart
        title="Active requests"
        data={requests}
        color={chartColor(2)}
        testId="admin-health-chart-requests"
        ariaLabel="Area chart of live active requests over the last 60 samples"
      />
      <LiveMetricChart
        title="Active generations"
        data={generations}
        color={chartColor(3)}
        testId="admin-health-chart-generations"
        ariaLabel="Area chart of live active generations over the last 60 samples"
      />
    </div>
  );
}
