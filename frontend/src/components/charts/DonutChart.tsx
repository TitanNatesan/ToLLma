"use client";

import { useState } from "react";
import { chartColor } from "./palette";

export interface DonutSlice {
  name: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  valueFormat?: (value: number) => string;
  testId?: string;
}

/** SVG donut with hover emphasis, center total and a compact legend. */
export function DonutChart({
  slices,
  size = 180,
  thickness = 16,
  centerLabel = "Total",
  centerValue,
  valueFormat = (v: number) => v.toFixed(0),
  testId,
}: DonutChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  // Arc offsets via prefix sums (no render-time mutation).
  const arcs = slices.map((slice, i) => ({
    slice,
    index: i,
    dash: (slice.value / total) * circumference,
    offset: slices
      .slice(0, i)
      .reduce((sum, prior) => sum + (prior.value / total) * circumference, 0),
  }));

  if (total <= 0) {
    return (
      <p className="py-10 text-center text-xs text-zinc-400" data-testid={testId}>
        No data in range
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-6" data-testid={testId}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={thickness}
            className="stroke-zinc-100 dark:stroke-zinc-800"
          />
          {arcs.map(({ slice, index, dash, offset }) => {
            const gap = segmentsGap(slices.length);
            const visible = Math.max(dash - gap, 0.5);
            return (
              <circle
                key={slice.name}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color ?? chartColor(index)}
                strokeWidth={hover === index ? thickness + 4 : thickness}
                strokeDasharray={`${visible} ${circumference - visible}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                className="cursor-pointer transition-all duration-150"
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            {hover !== null ? slices[hover].name : centerLabel}
          </span>
          <span className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">
            {hover !== null ? valueFormat(slices[hover].value) : (centerValue ?? valueFormat(total))}
          </span>
          {hover !== null && (
            <span className="text-[10px] text-zinc-400">
              {((slices[hover].value / total) * 100).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      <ul className="min-w-40 space-y-1.5">
        {slices.map((slice, i) => (
          <li
            key={slice.name}
            className="flex items-center justify-between gap-4 text-xs"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex min-w-0 items-center gap-2 text-zinc-600 dark:text-zinc-400">
              <span
                className="inline-block size-2.5 shrink-0 rounded-sm"
                style={{ background: slice.color ?? chartColor(i) }}
              />
              <span className="truncate">{slice.name}</span>
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

function segmentsGap(count: number): number {
  return count > 1 ? 2 : 0;
}
