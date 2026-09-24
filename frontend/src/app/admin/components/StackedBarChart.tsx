"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartColor } from "@/components/charts/palette";
import { ChartTooltip } from "./ChartTooltip";
import type { TrendSeries } from "./TrendChart";

interface StackedBarChartProps {
  data: Array<Record<string, number | string>>;
  series: TrendSeries[];
  xKey?: string;
  height?: number;
  valueFormat?: (value: number) => string;
  labelFormat?: (label: string) => string;
  /** Tooltip title format (defaults to `labelFormat`). */
  tooltipLabelFormat?: (label: string) => string;
  axisFormat?: (value: number) => string;
  testId?: string;
  ariaLabel: string;
}

/** Recharts stacked bar for token/cost composition over time. */
export function StackedBarChart({
  data,
  series,
  xKey = "bucket",
  height = 260,
  valueFormat,
  labelFormat,
  tooltipLabelFormat,
  axisFormat,
  testId,
  ariaLabel,
}: StackedBarChartProps) {
  const tooltipFormat = tooltipLabelFormat ?? labelFormat;
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      className="w-full text-zinc-400 dark:text-zinc-500"
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
          <XAxis
            dataKey={xKey}
            tick={{ fill: "currentColor", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tickFormatter={labelFormat}
          />
          <YAxis
            tick={{ fill: "currentColor", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={axisFormat}
          />
          <Tooltip
            content={
              <ChartTooltip
                valueFormat={valueFormat}
                labelFormat={tooltipFormat ? (value) => tooltipFormat(String(value)) : undefined}
              />
            }
            cursor={{ fill: "rgba(113,113,122,0.08)" }}
          />
          {series.length > 0 && (
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11 }}
              formatter={(value) => <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{value}</span>}
            />
          )}
          {series.map((s, index) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="stack"
              fill={s.color ?? chartColor(index)}
              stroke="none"
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
