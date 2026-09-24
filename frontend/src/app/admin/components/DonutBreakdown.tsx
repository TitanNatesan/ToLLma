"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { chartColor } from "@/components/charts/palette";
import { ChartTooltip } from "./ChartTooltip";
import { fmtNumber } from "./format";

export interface DonutDatum {
  name: string;
  value: number;
  hint?: string;
}

interface DonutBreakdownProps {
  data: DonutDatum[];
  height?: number;
  valueFormat?: (value: number) => string;
  testId?: string;
  ariaLabel: string;
}

/** Donut for categorical splits (media by kind, cost by provider). */
export function DonutBreakdown({
  data,
  height = 260,
  valueFormat = fmtNumber,
  testId,
  ariaLabel,
}: DonutBreakdownProps) {
  const positive = data.filter((datum) => datum.value > 0);
  if (positive.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-zinc-400" data-testid={testId}>
        No data in range
      </p>
    );
  }
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      className="w-full text-zinc-400 dark:text-zinc-500"
    >
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={positive}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="none"
            isAnimationActive={false}
          >
            {positive.map((entry, index) => (
              <Cell key={entry.name} fill={chartColor(index)} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip valueFormat={valueFormat} />} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value) => <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
