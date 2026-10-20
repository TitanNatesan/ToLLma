"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AnalyticsPreset } from "@/types/apiKeys";

export interface RangeValue {
  preset: AnalyticsPreset;
  start: string;
  end: string;
  /** Distinguishes the Calendar-month shortcut from a hand-picked range. */
  quick?: "month";
}

export const DEFAULT_RANGE: RangeValue = { preset: "7d", start: "", end: "" };

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const PRESETS: ReadonlyArray<{ value: Exclude<AnalyticsPreset, "custom">; label: string }> = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

/** Preset rail + custom date bounds + refresh, shared by Analytics and Network. */
export function RangeSelector({
  value,
  onChange,
  onRefresh,
  fetching = false,
  testIdPrefix = "key-range",
}: {
  value: RangeValue;
  onChange: (next: RangeValue) => void;
  onRefresh: () => void;
  fetching?: boolean;
  testIdPrefix?: string;
}) {
  const monthActive = value.preset === "custom" && value.quick === "month";
  const customActive = value.preset === "custom" && value.quick !== "month";

  return (
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
      <div
        role="group"
        aria-label="Analytics range"
        className="flex shrink-0 flex-nowrap items-center rounded-lg border border-zinc-200 bg-zinc-50/60 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/60"
      >
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            aria-pressed={value.preset === preset.value}
            onClick={() => onChange({ ...value, preset: preset.value, quick: undefined })}
            data-testid={`${testIdPrefix}-${preset.value}`}
            className={cn(
              "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
              value.preset === preset.value
                ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={monthActive}
          onClick={() => {
            const now = new Date();
            const first = new Date(now.getFullYear(), now.getMonth(), 1);
            onChange({ preset: "custom", start: isoDate(first), end: isoDate(now), quick: "month" });
          }}
          data-testid={`${testIdPrefix}-month`}
          className={cn(
            "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
            monthActive
              ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
          )}
        >
          Month
        </button>
        <button
          type="button"
          aria-pressed={customActive}
          onClick={() => onChange({ ...value, preset: "custom", quick: undefined })}
          data-testid={`${testIdPrefix}-custom`}
          className={cn(
            "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
            customActive
              ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
          )}
        >
          Custom
        </button>
      </div>

      {value.preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={value.start}
            max={value.end || undefined}
            onChange={(event) => onChange({ ...value, start: event.target.value, quick: undefined })}
            aria-label="Range start"
            data-testid={`${testIdPrefix}-start`}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:[color-scheme:dark]"
          />
          <span className="text-[10px] text-zinc-400">→</span>
          <input
            type="date"
            value={value.end}
            min={value.start || undefined}
            onChange={(event) => onChange({ ...value, end: event.target.value, quick: undefined })}
            aria-label="Range end"
            data-testid={`${testIdPrefix}-end`}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:[color-scheme:dark]"
          />
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={fetching}
        className="h-7 px-2 text-[11px]"
        data-testid={`${testIdPrefix}-refresh`}
      >
        <RefreshCw className={cn("size-3", fetching && "animate-spin")} />
        Refresh
      </Button>
    </div>
  );
}
