"use client";

import { useMemo, useRef, useState } from "react";
import { useElementSize } from "./useElementSize";
import { chartColor, compactNumber, niceMax } from "./palette";
import { cn } from "@/lib/utils";

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}

interface AreaChartProps {
  labels: string[];
  series: ChartSeries[];
  height?: number;
  valueFormat?: (value: number) => string;
  labelFormat?: (label: string, index: number) => string;
  showLegend?: boolean;
  /** Drag-to-zoom: receives an inclusive index range when the user brushes. */
  onZoom?: (from: number, to: number) => void;
  testId?: string;
  className?: string;
}

const PAD = { left: 52, right: 14, top: 14, bottom: 26 };

export function AreaChart({
  labels,
  series,
  height = 240,
  valueFormat = compactNumber,
  labelFormat,
  showLegend = true,
  onZoom,
  testId,
  className,
}: AreaChartProps) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [brush, setBrush] = useState<{ from: number; to: number } | null>(null);
  const dragStart = useRef<number | null>(null);
  const pointCount = Math.max(...series.map((s) => s.values.length), labels.length, 0);
  const innerWidth = Math.max(10, width - PAD.left - PAD.right);
  const innerHeight = Math.max(10, height - PAD.top - PAD.bottom);
  const maxValue = useMemo(
    () => niceMax(Math.max(...series.flatMap((s) => s.values), 0)),
    [series],
  );

  const xAt = (index: number) =>
    PAD.left + (pointCount <= 1 ? innerWidth / 2 : (index / (pointCount - 1)) * innerWidth);
  const yAt = (value: number) => PAD.top + innerHeight - (value / maxValue) * innerHeight;

  const paths = useMemo(
    () =>
      series.map((s, seriesIndex) => {
        const color = s.color ?? chartColor(seriesIndex);
        if (s.values.length === 0) return { color, line: "", area: "" };
        const line = s.values
          .map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
          .join(" ");
        const area = `${line} L${xAt(s.values.length - 1).toFixed(1)},${(PAD.top + innerHeight).toFixed(1)} L${xAt(0).toFixed(1)},${(PAD.top + innerHeight).toFixed(1)} Z`;
        return { color, line, area };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, maxValue, innerWidth, innerHeight],
  );

  const xTicks = useMemo(() => {
    if (pointCount === 0) return [] as number[];
    const count = Math.min(pointCount, width < 480 ? 4 : 6);
    return Array.from({ length: count }, (_, i) =>
      Math.round((i / Math.max(1, count - 1)) * (pointCount - 1)),
    ).filter((v, i, arr) => arr.indexOf(v) === i);
  }, [pointCount, width]);

  function indexFromX(clientX: number, target: HTMLDivElement): number {
    const rect = target.getBoundingClientRect();
    const x = clientX - rect.left - PAD.left;
    if (pointCount <= 1) return 0;
    return Math.max(0, Math.min(pointCount - 1, Math.round((x / innerWidth) * (pointCount - 1))));
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className={cn("w-full", className)} data-testid={testId}>
      <div
        ref={ref}
        className={cn("relative w-full select-none", onZoom && "cursor-crosshair")}
        style={{ height }}
        onMouseMove={(e) => {
          if (pointCount === 0) return;
          setHover(indexFromX(e.clientX, e.currentTarget));
        }}
        onMouseLeave={() => {
          setHover(null);
          setBrush(null);
          dragStart.current = null;
        }}
        onMouseDown={(e) => {
          if (!onZoom || pointCount < 2) return;
          dragStart.current = indexFromX(e.clientX, e.currentTarget);
          setBrush({ from: dragStart.current, to: dragStart.current });
        }}
        onMouseUp={() => {
          if (dragStart.current === null) return;
          const current = brush;
          dragStart.current = null;
          if (current && Math.abs(current.to - current.from) >= 1) {
            onZoom?.(Math.min(current.from, current.to), Math.max(current.from, current.to));
          }
          setBrush(null);
        }}
      >
        {width > 0 && (
          <svg width={width} height={height} className="overflow-visible">
            <defs>
              {paths.map((p, i) => (
                <linearGradient key={i} id={`area-grad-${testId ?? "chart"}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={p.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={p.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>

            {gridLines.map((frac) => {
              const y = PAD.top + innerHeight * frac;
              const value = maxValue * (1 - frac);
              return (
                <g key={frac}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + innerWidth}
                    y1={y}
                    y2={y}
                    className="stroke-zinc-200 dark:stroke-zinc-800"
                    strokeDasharray="3 4"
                  />
                  <text x={PAD.left - 8} y={y + 3} textAnchor="end" className="fill-zinc-400 text-[10px]">
                    {valueFormat(value)}
                  </text>
                </g>
              );
            })}

            {paths.map((p, i) =>
              series[i].values.length === 1 ? (
                <circle
                  key={i}
                  cx={xAt(0)}
                  cy={yAt(series[i].values[0])}
                  r={4}
                  fill={p.color}
                  className="stroke-white dark:stroke-zinc-950"
                  strokeWidth={2}
                />
              ) : (
                <g key={i}>
                  <path d={p.area} fill={`url(#area-grad-${testId ?? "chart"}-${i})`} />
                  <path d={p.line} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" />
                </g>
              ),
            )}

            {xTicks.map((index) => (
              <text
                key={index}
                x={xAt(index)}
                y={height - 6}
                textAnchor="middle"
                className="fill-zinc-400 text-[10px]"
              >
                {labelFormat ? labelFormat(labels[index] ?? "", index) : (labels[index] ?? "")}
              </text>
            ))}

            {brush && Math.abs(brush.to - brush.from) >= 0 && (
              <rect
                x={Math.min(xAt(brush.from), xAt(brush.to))}
                y={PAD.top}
                width={Math.abs(xAt(brush.to) - xAt(brush.from))}
                height={innerHeight}
                className="fill-tollma-500/10 stroke-tollma-500/40"
              />
            )}

            {hover !== null && hover < pointCount && (
              <g>
                <line
                  x1={xAt(hover)}
                  x2={xAt(hover)}
                  y1={PAD.top}
                  y2={PAD.top + innerHeight}
                  className="stroke-zinc-400 dark:stroke-zinc-600"
                />
                {series.map((s, i) =>
                  s.values[hover] === undefined ? null : (
                    <circle
                      key={i}
                      cx={xAt(hover)}
                      cy={yAt(s.values[hover])}
                      r={3.5}
                      fill={s.color ?? chartColor(i)}
                      className="stroke-white dark:stroke-zinc-950"
                      strokeWidth={2}
                    />
                  ),
                )}
              </g>
            )}
          </svg>
        )}

        {hover !== null && hover < pointCount && width > 0 && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-32 rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-2 text-[11px] shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95"
            style={{
              left: Math.min(Math.max(xAt(hover) - 60, 4), Math.max(4, width - 150)),
            }}
            data-testid={testId ? `${testId}-tooltip` : undefined}
          >
            <p className="mb-1 font-medium text-zinc-600 dark:text-zinc-300">{labels[hover] ?? ""}</p>
            {series.map((s, i) => (
              <p key={s.name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: s.color ?? chartColor(i) }}
                  />
                  {s.name}
                </span>
                <span className="font-mono text-zinc-800 dark:text-zinc-100">
                  {valueFormat(s.values[hover] ?? 0)}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>

      {showLegend && series.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {series.map((s, i) => (
            <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="inline-block size-2 rounded-full" style={{ background: s.color ?? chartColor(i) }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
