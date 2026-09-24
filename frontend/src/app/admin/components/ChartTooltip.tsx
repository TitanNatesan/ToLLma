"use client";

import type { TooltipContentProps } from "recharts";
import { fmtNumber } from "./format";

export interface ChartTooltipProps extends Partial<TooltipContentProps<number, string>> {
  valueFormat?: (value: number) => string;
  labelFormat?: (label: string | number) => string;
}

/** Shared admin chart tooltip (light + dark surfaces, optional per-point hint). */
export function ChartTooltip({
  active,
  payload,
  label,
  valueFormat = fmtNumber,
  labelFormat,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-2 text-[11px] shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95">
      {label !== undefined && (
        <p className="mb-1 font-medium text-zinc-600 dark:text-zinc-300">
          {labelFormat ? labelFormat(label) : String(label)}
        </p>
      )}
      {payload.map((entry, index) => {
        const datum = entry.payload as { hint?: string } | undefined;
        const key = entry.dataKey !== undefined ? String(entry.dataKey) : `${entry.name}-${index}`;
        return (
          <p key={key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
              <span className="inline-block size-2 rounded-full" style={{ background: entry.color }} />
              {entry.name}
            </span>
            <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-100">
              {valueFormat(Number(entry.value ?? 0))}
              {datum?.hint && <span className="ml-1.5 font-sans text-zinc-400">{datum.hint}</span>}
            </span>
          </p>
        );
      })}
    </div>
  );
}
