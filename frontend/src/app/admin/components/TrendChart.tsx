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
import { ChartTooltip } from "./ChartTooltip";

export interface TrendSeries {
  key: string;
  name: string;
  color?: string;
}

interface TrendChartProps {
  data: Array<Record<string, number | string>>;
  series: TrendSeries[];
  xKey?: string;
  height?: number;
  /** Stack series into a composition (e.g. token kinds). */
  stacked?: boolean;
  valueFormat?: (value: number) => string;
  /** Axis tick label format. */
  labelFormat?: (label: string) => string;
  /** Tooltip title format (defaults to `labelFormat`). */
  tooltipLabelFormat?: (label: string) => string;
  axisFormat?: (value: number) => string;
  testId?: string;
  ariaLabel: string;
}

/** Recharts area/stacked-area trend with shared tooltip and accessible label. */
export function TrendChart({
  data,
  series,
  xKey = "bucket",
  height = 260,
  stacked = false,
  valueFormat,
  labelFormat,
  tooltipLabelFormat,
  axisFormat,
  testId,
  ariaLabel,
}: TrendChartProps) {
  const tooltipFormat = tooltipLabelFormat ?? labelFormat;
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      className="w-full text-zinc-400 dark:text-zinc-500"
    >
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
            cursor={{ stroke: "#a1a1aa", strokeDasharray: "3 3" }}
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
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stackId={stacked ? "stack" : undefined}
              stroke={s.color ?? chartColor(index)}
              fill={s.color ?? chartColor(index)}
              fillOpacity={stacked ? 0.35 : 0.16}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
