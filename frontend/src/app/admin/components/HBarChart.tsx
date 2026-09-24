"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColor } from "@/components/charts/palette";
import { ChartTooltip } from "./ChartTooltip";
import { fmtCompact, truncateLabel } from "./format";

export interface HBarDatum {
  name: string;
  value: number;
  /** Extra context rendered beside the value inside the tooltip. */
  hint?: string;
}

interface HBarChartProps {
  data: HBarDatum[];
  /** Minimum height; grows with the number of rows. */
  height?: number;
  valueFormat?: (value: number) => string;
  valueName?: string;
  /** Palette index for the bar fill (default: brand accent). */
  colorIndex?: number;
  testId?: string;
  ariaLabel: string;
}

/** Ranked horizontal bars for top models/providers. */
export function HBarChart({
  data,
  height = 240,
  valueFormat = fmtCompact,
  valueName = "Value",
  colorIndex = 0,
  testId,
  ariaLabel,
}: HBarChartProps) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-zinc-400" data-testid={testId}>
        No data in range
      </p>
    );
  }
  const chartHeight = Math.max(height, data.length * 34 + 24);
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      className="w-full text-zinc-400 dark:text-zinc-500"
    >
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={152}
            tick={{ fill: "currentColor", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: string) => truncateLabel(String(value), 22)}
          />
          <Tooltip
            content={<ChartTooltip valueFormat={valueFormat} />}
            cursor={{ fill: "rgba(113,113,122,0.08)" }}
          />
          <Bar
            dataKey="value"
            name={valueName}
            fill={chartColor(colorIndex)}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="value"
              position="right"
              formatter={(value: unknown) => valueFormat(Number(value))}
              className="fill-zinc-500 dark:fill-zinc-400"
              style={{ fontSize: 10 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
