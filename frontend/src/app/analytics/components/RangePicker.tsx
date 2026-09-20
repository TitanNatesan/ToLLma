"use client";

import { Calendar, Download, RefreshCw } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { PRESET_LABELS } from "../format";
import type { AnalyticsDataset, AnalyticsPreset, AnalyticsRange } from "@/types";

const PRESETS: AnalyticsPreset[] = [
  "today",
  "yesterday",
  "last_7d",
  "last_30d",
  "this_month",
  "last_month",
  "last_90d",
  "custom",
];

const DATASETS: Array<{ value: AnalyticsDataset; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "timeseries", label: "Time series" },
  { value: "models", label: "Models" },
  { value: "providers", label: "Providers" },
  { value: "conversations", label: "Conversations" },
];

interface RangePickerProps {
  preset: AnalyticsPreset;
  onPreset: (preset: AnalyticsPreset) => void;
  customStart: string;
  customEnd: string;
  onCustomStart: (value: string) => void;
  onCustomEnd: (value: string) => void;
  resolved?: AnalyticsRange;
  dataset: AnalyticsDataset;
  onDataset: (dataset: AnalyticsDataset) => void;
  onExport: (format: "csv" | "json") => void;
  exporting?: boolean;
  onRefresh: () => void;
  refreshing?: boolean;
}

/** Date-range control + export menu. Range resolution happens server-side. */
export function RangePicker({
  preset,
  onPreset,
  customStart,
  customEnd,
  onCustomStart,
  onCustomEnd,
  resolved,
  dataset,
  onDataset,
  onExport,
  exporting,
  onRefresh,
  refreshing,
}: RangePickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="analytics-range">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="range-picker">
            <Calendar className="size-3.5" />
            {PRESET_LABELS[preset] ?? "Range"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {PRESETS.map((value) => (
            <DropdownMenuItem
              key={value}
              onClick={() => onPreset(value)}
              data-testid={`range-${value}`}
              className={cn("text-xs", value === preset && "font-medium text-tollma-700 dark:text-tollma-300")}
            >
              {PRESET_LABELS[value]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {preset === "custom" && (
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1 dark:border-zinc-800">
          <input
            type="date"
            value={customStart}
            max={customEnd || undefined}
            onChange={(e) => onCustomStart(e.target.value)}
            aria-label="Start date"
            data-testid="range-start"
            className="bg-transparent text-xs text-zinc-600 outline-none dark:text-zinc-300 [color-scheme:light] dark:[color-scheme:dark]"
          />
          <span className="text-xs text-zinc-400">–</span>
          <input
            type="date"
            value={customEnd}
            min={customStart || undefined}
            onChange={(e) => onCustomEnd(e.target.value)}
            aria-label="End date"
            data-testid="range-end"
            className="bg-transparent text-xs text-zinc-600 outline-none dark:text-zinc-300 [color-scheme:light] dark:[color-scheme:dark]"
          />
        </div>
      )}

      {resolved && (
        <span className="hidden text-[11px] text-zinc-400 md:inline" data-testid="range-resolved">
          {new Date(resolved.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
          {new Date(resolved.end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Select
          value={dataset}
          onChange={(e) => onDataset(e.target.value as AnalyticsDataset)}
          sizeVariant="sm"
          aria-label="Export dataset"
          data-testid="export-dataset"
          className="w-32 text-xs"
        >
          {DATASETS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              disabled={exporting}
              data-testid="export-button"
            >
              <Download className="size-3.5" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem onClick={() => onExport("csv")} data-testid="export-csv" className="text-xs">
              CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("json")} data-testid="export-json" className="text-xs">
              JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          aria-label="Refresh analytics"
          data-testid="analytics-refresh"
          className="size-8"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
        </Button>
      </div>
    </div>
  );
}
