"use client";

import { useState } from "react";
import { useElementSize } from "./useElementSize";
import { useChartHeight } from "./useChartHeight";
import { chartColor, compactNumber, niceMax } from "./palette";
import { cn } from "@/lib/utils";

interface BarChartProps {
  labels: string[];
  values: number[];
  height?: number;
  color?: string;
  valueFormat?: (value: number) => string;
  highlightIndex?: number | null;
  testId?: string;
  className?: string;
}

/** Vertical bars with hover tooltip; one series, accent-colored by default. */
export function BarChart({
  labels,
  values,
  height: heightProp,
  color = chartColor(0),
  valueFormat = compactNumber,
  highlightIndex = null,
  testId,
  className,
}: BarChartProps) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const responsiveHeight = useChartHeight(200);
  const height = heightProp ?? responsiveHeight;
  const [hover, setHover] = useState<number | null>(null);
  const pad = { left: 44, right: 10, top: 12, bottom: 24 };
  const innerWidth = Math.max(10, width - pad.left - pad.right);
  const innerHeight = Math.max(10, height - pad.top - pad.bottom);
  const maxValue = niceMax(Math.max(...values, 0));
  const slot = innerWidth / Math.max(1, values.length);
  const barWidth = Math.max(3, Math.min(28, slot * 0.62));
  const active = hover ?? highlightIndex;

  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height }} data-testid={testId}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const index = Math.floor((e.clientX - rect.left - pad.left) / slot);
            setHover(index >= 0 && index < values.length ? index : null);
          }}
        >
          {[0, 0.5, 1].map((frac) => {
            const y = pad.top + innerHeight * frac;
            return (
              <g key={frac}>
                <line
                  x1={pad.left}
                  x2={pad.left + innerWidth}
                  y1={y}
                  y2={y}
                  className="stroke-zinc-200 dark:stroke-zinc-800"
                  strokeDasharray="3 4"
                />
                <text x={pad.left - 6} y={y + 3} textAnchor="end" className="fill-zinc-400 text-[10px]">
                  {valueFormat(maxValue * (1 - frac))}
                </text>
              </g>
            );
          })}

          {values.map((value, i) => {
            const h = maxValue === 0 ? 0 : (value / maxValue) * innerHeight;
            const x = pad.left + i * slot + (slot - barWidth) / 2;
            const y = pad.top + innerHeight - h;
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(h, value > 0 ? 2 : 0)}
                  rx={3}
                  fill={color}
                  opacity={active === null || active === i ? 1 : 0.35}
                  className="transition-opacity"
                  data-testid={testId ? `${testId}-bar-${i}` : undefined}
                />
              </g>
            );
          })}

          {labels.map((label, i) => {
            const every = labels.length > 16 ? 4 : labels.length > 10 ? 2 : 1;
            if (i % every !== 0) return null;
            return (
              <text
                key={i}
                x={pad.left + i * slot + slot / 2}
                y={height - 6}
                textAnchor="middle"
                className="fill-zinc-400 text-[10px]"
              >
                {label}
              </text>
            );
          })}
        </svg>
      )}
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95"
          style={{ left: Math.min(Math.max(pad.left + hover * slot - 30, 4), Math.max(4, width - 120)) }}
        >
          <p className="font-medium text-zinc-600 dark:text-zinc-300">{labels[hover]}</p>
          <p className="font-mono text-zinc-800 dark:text-zinc-100">{valueFormat(values[hover] ?? 0)}</p>
        </div>
      )}
    </div>
  );
}

interface BarListProps {
  items: Array<{ name: string; value: number; hint?: string; color?: string }>;
  valueFormat?: (value: number) => string;
  maxItems?: number;
  testId?: string;
}

/** Horizontal ranked bars (models, providers, latency): HTML for crisp labels. */
export function BarList({ items, valueFormat = compactNumber, maxItems = 8, testId }: BarListProps) {
  const visible = items.slice(0, maxItems);
  const max = Math.max(...visible.map((i) => i.value), 0.000001);
  return (
    <div className="space-y-2.5" data-testid={testId}>
      {visible.map((item, i) => (
        <div key={`${item.name}-${i}`} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">{item.name}</span>
            <span className="shrink-0 font-mono text-zinc-500 dark:text-zinc-400">
              {valueFormat(item.value)}
              {item.hint ? <span className="ml-2 text-zinc-400 dark:text-zinc-500">{item.hint}</span> : null}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%`, background: item.color ?? chartColor(0) }}
            />
          </div>
        </div>
      ))}
      {visible.length === 0 && <p className="py-4 text-center text-xs text-zinc-400">No data in range</p>}
    </div>
  );
}
