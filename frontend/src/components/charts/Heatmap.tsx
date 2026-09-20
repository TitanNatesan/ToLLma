"use client";

import { useMemo, useState } from "react";
import { useElementSize } from "./useElementSize";
import { WEEKDAYS, WEEKDAYS_SHORT, compactNumber } from "./palette";
import { cn } from "@/lib/utils";

export interface HeatmapCellData {
  day: number;
  hour: number;
  requests: number;
  spend: string;
  tokens: number;
}

interface HeatmapProps {
  cells: HeatmapCellData[];
  maxRequests: number;
  peak?: { day: number; hour: number } | null;
  quiet?: { day: number; hour: number } | null;
  testId?: string;
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday-first display; backend uses 0=Sunday

/** Weekday × hour request density. Peak cell gets an accent ring, quiet one a dash. */
export function Heatmap({ cells, maxRequests, peak, quiet, testId }: HeatmapProps) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<HeatmapCellData | null>(null);
  const byKey = useMemo(() => {
    const map = new Map<string, HeatmapCellData>();
    for (const cell of cells) map.set(`${cell.day}:${cell.hour}`, cell);
    return map;
  }, [cells]);

  const labelWidth = 34;
  const gap = 2;
  const gridWidth = Math.max(200, width - labelWidth);
  const cellW = Math.max(4, (gridWidth - 23 * gap) / 24);
  const cellH = 18;
  const gridHeight = 7 * (cellH + gap);

  return (
    <div ref={ref} className="relative w-full" data-testid={testId}>
      {width > 0 && (
        <svg width={width} height={gridHeight + 18} className="overflow-visible">
          {[0, 6, 12, 18, 23].map((hour) => (
            <text
              key={hour}
              x={labelWidth + hour * (cellW + gap) + cellW / 2}
              y={10}
              textAnchor="middle"
              className="fill-zinc-400 text-[9px]"
            >
              {hour.toString().padStart(2, "0")}
            </text>
          ))}
          {DAY_ORDER.map((day, row) => (
            <g key={day}>
              <text
                x={labelWidth - 8}
                y={18 + row * (cellH + gap) + cellH / 2 + 3}
                textAnchor="end"
                className="fill-zinc-400 text-[9px]"
              >
                {WEEKDAYS_SHORT[day]}
              </text>
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = byKey.get(`${day}:${hour}`);
                const requests = cell?.requests ?? 0;
                const intensity = maxRequests > 0 ? requests / maxRequests : 0;
                const isPeak = peak?.day === day && peak?.hour === hour;
                const isQuiet = quiet?.day === day && quiet?.hour === hour && maxRequests > 0;
                return (
                  <rect
                    key={hour}
                    x={labelWidth + hour * (cellW + gap)}
                    y={18 + row * (cellH + gap)}
                    width={cellW}
                    height={cellH}
                    rx={3}
                    fill={requests === 0 ? undefined : "var(--color-tollma-500)"}
                    fillOpacity={requests === 0 ? 0 : 0.08 + intensity * 0.92}
                    className={cn(
                      requests === 0 && "fill-zinc-100 dark:fill-zinc-800",
                      isPeak && "stroke-tollma-600 dark:stroke-tollma-400",
                      isQuiet && "stroke-zinc-300 dark:stroke-zinc-600",
                    )}
                    strokeWidth={isPeak || isQuiet ? 1.5 : 0}
                    strokeDasharray={isQuiet ? "2 1" : undefined}
                    onMouseEnter={() => setHover({ day, hour, requests, spend: cell?.spend ?? "0", tokens: cell?.tokens ?? 0 })}
                    onMouseLeave={() => setHover(null)}
                    data-testid={testId ? `${testId}-cell-${day}-${hour}` : undefined}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      )}

      {hover && (
        <div className="pointer-events-none absolute -top-1 right-0 z-10 rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95">
          <p className="font-medium text-zinc-600 dark:text-zinc-300">
            {WEEKDAYS[hover.day]} {hover.hour.toString().padStart(2, "0")}:00
          </p>
          <p className="text-zinc-500 dark:text-zinc-400">
            {compactNumber(hover.requests)} requests · {compactNumber(hover.tokens)} tokens
          </p>
        </div>
      )}
    </div>
  );
}
