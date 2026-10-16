"use client";

import { Calendar, Download, RefreshCw } from "lucide-react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { AnalyticsDataset, AnalyticsPreset, AnalyticsRange } from "@/types";
import type { AdminPreset } from "@/types/admin";

/** Shared refresh icon-button (analytics + admin pickers). */
export function RangeRefreshButton({
  onRefresh,
  refreshing,
  disabled,
  label,
  testId,
}: {
  onRefresh: () => void;
  refreshing?: boolean;
  disabled?: boolean;
  label: string;
  testId: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onRefresh}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      className="size-8"
    >
      <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
    </Button>
  );
}

/** Shared resolved-range caption; `showAt` picks the breakpoint it appears from. */
export function RangeResolvedLabel({
  text,
  testId,
  showAt = "md",
}: {
  text: string;
  testId: string;
  showAt?: "md" | "lg";
}) {
  return (
    <span
      className={cn("hidden text-[11px] text-zinc-400", showAt === "md" ? "md:inline" : "lg:inline")}
      data-testid={testId}
    >
      {text}
    </span>
  );
}

const ANALYTICS_PRESETS: AnalyticsPreset[] = [
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

/** Date-range control + export menu. Range resolution happens server-side. */
export function AnalyticsRangePicker({
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
  presetLabels,
}: {
  preset: AnalyticsPreset;
  onPreset: (preset: AnalyticsPreset) => void;
  customStart: string;
  customEnd: string;
  onCustomStart: (value: string) => void;
  onCustomEnd: (value: string) => void;
  resolved?: AnalyticsRange;
  dataset: AnalyticsDataset;
  onDataset: (dataset: AnalyticsDataset) => void;
  onExport: (format: "csv" | "json" | "xlsx") => void;
  exporting?: boolean;
  onRefresh: () => void;
  refreshing?: boolean;
  presetLabels: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="analytics-range">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" data-testid="range-picker">
            <Calendar className="size-3.5" />
            {presetLabels[preset] ?? "Range"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {ANALYTICS_PRESETS.map((value) => (
            <DropdownMenuItem
              key={value}
              onClick={() => onPreset(value)}
              data-testid={`range-${value}`}
              className={cn("text-xs", value === preset && "font-medium text-tollma-700 dark:text-tollma-300")}
            >
              {presetLabels[value]}
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
        <RangeResolvedLabel
          text={`${new Date(resolved.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(resolved.end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
          testId="range-resolved"
          showAt="md"
        />
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
            <DropdownMenuItem onClick={() => onExport("xlsx")} data-testid="export-xlsx" className="text-xs">
              XLSX
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <RangeRefreshButton
          onRefresh={onRefresh}
          refreshing={refreshing}
          label="Refresh analytics"
          testId="analytics-refresh"
        />
      </div>
    </div>
  );
}

export const ADMIN_PRESETS: ReadonlyArray<{ value: AdminPreset; label: string; short: string }> = [
  { value: "last_7d", label: "Last 7 days", short: "7D" },
  { value: "last_30d", label: "Last 30 days", short: "30D" },
  { value: "last_90d", label: "Last 90 days", short: "90D" },
  { value: "this_month", label: "This month", short: "Month" },
  { value: "today", label: "Today", short: "Today" },
];

/** Time-range selector driving every admin query (UTC buckets). */
export function AdminRangePicker({
  preset,
  onPreset,
  rangeLabel,
  onRefresh,
  refreshing = false,
  disabled = false,
}: {
  preset: AdminPreset;
  onPreset: (preset: AdminPreset) => void;
  /** Preformatted server-side range caption (`fmtDate` applied at the call site). */
  rangeLabel?: string;
  onRefresh: () => void;
  refreshing?: boolean;
  disabled?: boolean;
}) {
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

      {rangeLabel && (
        <RangeResolvedLabel text={rangeLabel} testId="admin-range-resolved" showAt="lg" />
      )}

      <RangeRefreshButton
        onRefresh={onRefresh}
        refreshing={refreshing}
        disabled={disabled}
        label="Refresh admin analytics"
        testId="admin-refresh"
      />
    </div>
  );
}
