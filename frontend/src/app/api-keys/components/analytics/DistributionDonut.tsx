"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { chartColor } from "@/components/charts/palette";
import { AnalyticsTooltip, EmptyHint, num } from "./shared";

export interface DonutDatum {
  name: string;
  value: number;
  hint?: string;
}

const MAX_SLICES = 7;

/** Recharts donut with an HTML legend carrying value + share; folds the tail. */
export function DistributionDonut({
  items,
  valueFormat,
  height = 210,
  testId,
  ariaLabel,
}: {
  items: DonutDatum[];
  valueFormat: (value: number) => string;
  height?: number;
  testId?: string;
  ariaLabel: string;
}) {
  const slices = useMemo(() => {
    const positive = items.filter((item) => num(item.value) > 0).sort((a, b) => num(b.value) - num(a.value));
    if (positive.length <= MAX_SLICES) return positive;
    const head = positive.slice(0, MAX_SLICES - 1);
    const rest = positive.slice(MAX_SLICES - 1);
    return [
      ...head,
      {
        name: "Other",
        value: rest.reduce((sum, item) => sum + num(item.value), 0),
        hint: `${rest.length} more`,
      },
    ];
  }, [items]);

  const total = slices.reduce((sum, item) => sum + num(item.value), 0);

  if (slices.length === 0 || total <= 0) {
    return <EmptyHint label="No data in range" testId={testId} />;
  }

  return (
    <div className="min-w-0" data-testid={testId}>
      <div
        role="img"
        aria-label={ariaLabel}
        className="w-full text-zinc-400 dark:text-zinc-500"
      >
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="55%"
              outerRadius="80%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((entry, index) => (
                <Cell key={entry.name} fill={chartColor(index)} />
              ))}
            </Pie>
            <Tooltip
              content={
                <AnalyticsTooltip valueFormat={valueFormat} />
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-1 space-y-1" data-testid={testId ? `${testId}-legend` : undefined}>
        {slices.map((slice, index) => (
          <li key={slice.name} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="flex min-w-0 items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
              <span
                className="inline-block size-2 shrink-0 rounded-sm"
                style={{ background: chartColor(index) }}
              />
              <span className="truncate" title={slice.name}>
                {slice.name}
              </span>
              {slice.hint && <span className="shrink-0 text-zinc-400">({slice.hint})</span>}
            </span>
            <span className="shrink-0 font-mono text-zinc-500 dark:text-zinc-400">
              {valueFormat(slice.value)}
              <span className="ml-1.5 text-zinc-400 dark:text-zinc-500">
                {((slice.value / total) * 100).toFixed(0)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
