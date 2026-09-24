"use client";

import { RefreshCw } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { fmtDate } from "./format";
import type { AdminPreset, AdminRange } from "@/types/admin";

export const ADMIN_PRESETS: ReadonlyArray<{ value: AdminPreset; label: string; short: string }> = [
  { value: "last_7d", label: "Last 7 days", short: "7D" },
  { value: "last_30d", label: "Last 30 days", short: "30D" },
  { value: "last_90d", label: "Last 90 days", short: "90D" },
  { value: "this_month", label: "This month", short: "Month" },
  { value: "today", label: "Today", short: "Today" },
];

interface RangePickerProps {
  preset: AdminPreset;
  onPreset: (preset: AdminPreset) => void;
  /** Resolved server-side range (start/end instants). */
  range?: AdminRange;
  onRefresh: () => void;
  refreshing?: boolean;
  disabled?: boolean;
}

/** Time-range selector driving every admin query (UTC buckets). */
export function RangePicker({
  preset,
  onPreset,
  range,
  onRefresh,
  refreshing = false,
  disabled = false,
}: RangePickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="admin-range">
      <div
        role="group"
        aria-label="Time range"
        className="hidden items-center rounded-lg border border-zinc-200 bg-zinc-50/60 p-0.5 sm:flex dark:border-zinc-800 dark:bg-zinc-900/60"
      >
        {ADMIN_PRESETS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.label}
            disabled={disabled}
            onClick={() => onPreset(option.value)}
            aria-pressed={option.value === preset}
            data-testid={`admin-range-${option.value}`}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              option.value === preset
                ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            {option.short}
          </button>
        ))}
      </div>

      <Select
        value={preset}
        onChange={(event) => onPreset(event.target.value as AdminPreset)}
        sizeVariant="sm"
        aria-label="Time range"
        disabled={disabled}
        data-testid="admin-range-select"
        wrapperClassName="sm:hidden"
        className="w-36 text-xs"
      >
        {ADMIN_PRESETS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      {range && (
        <span className="hidden text-[11px] text-zinc-400 lg:inline" data-testid="admin-range-resolved">
          {fmtDate(range.start)} – {fmtDate(range.end)} · {range.timezone}
        </span>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={onRefresh}
        disabled={disabled}
        aria-label="Refresh admin analytics"
        data-testid="admin-refresh"
        className="size-8"
      >
        <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
      </Button>
    </div>
  );
}
