"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import type { TooltipContentProps } from "recharts";
import { cn, fmtCost, fmtTokens } from "@/lib/utils";
import type { AnalyticsPreset } from "@/types/apiKeys";

/** Coerce Decimal-as-string / null / undefined into a finite number. */
export function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

/** Rates may arrive as fractions (0..1) or percentages (0..100). */
export function rate(value: unknown): number {
  const n = num(value);
  if (n <= 0) return 0;
  return n > 1 ? n / 100 : n;
}

export function pct(value: unknown, digits = 1): string {
  return `${(rate(value) * 100).toFixed(digits)}%`;
}

/** Insight shares are percentages; values <= 1 are treated as fractions. */
export function sharePct(value: unknown, digits = 1): string {
  const n = num(value);
  if (n <= 0) return "0%";
  return `${(n <= 1 ? n * 100 : n).toFixed(digits)}%`;
}

export function fmtMs(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = num(value);
  if (n <= 0) return "—";
  if (n >= 60_000) return `${(n / 60_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}s`;
  return `${Math.round(n)}ms`;
}

/** Cost-per-token style values need more precision than fmtCost gives. */
export function fmtUnitCost(value: unknown): string {
  const n = num(value);
  if (n === 0) return "$0";
  if (Math.abs(n) < 0.000001) return `$${n.toExponential(2)}`;
  if (Math.abs(n) < 0.01) return `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  return fmtCost(n);
}

/** UTC bucket label, matching the admin dashboard's deterministic reads. */
export function parseBucket(bucket: string): Date {
  if (!bucket) return new Date(NaN);
  // Backend buckets are UTC but may arrive without a zone suffix; treat naive
  // stamps as UTC instead of letting Date parse them in the local timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(bucket)) return new Date(`${bucket}T00:00:00Z`);
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(bucket)) return new Date(bucket);
  return new Date(`${bucket}Z`);
}

export function bucketLabel(bucket: string, preset: AnalyticsPreset): string {
  const date = parseBucket(bucket);
  if (isNaN(date.getTime())) return bucket;
  if (preset === "24h") {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function bucketFullLabel(bucket: string, preset: AnalyticsPreset): string {
  const date = parseBucket(bucket);
  if (isNaN(date.getTime())) return bucket;
  if (preset === "24h") {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
  }
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function truncate(value: string, max = 24): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = parseBucket(iso);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = parseBucket(iso);
  if (isNaN(date.getTime())) return "—";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  return fmtDateTime(iso);
}

/** Shared card shell: small uppercase label + optional actions. */
export function SectionFrame({
  title,
  description,
  action,
  children,
  className,
  testId,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
      data-testid={testId}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
          {description && <p className="mt-0.5 text-[11px] text-zinc-400">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export interface MetricItem {
  label: string;
  value: string;
  /** Tooltip/title text for truncated values. */
  hint?: string;
  tone?: "default" | "danger" | "warning" | "success" | "accent";
}

function toneClass(tone: MetricItem["tone"]): string {
  if (tone === "danger") return "text-red-600 dark:text-red-400";
  if (tone === "warning") return "text-amber-600 dark:text-amber-400";
  if (tone === "success") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "accent") return "text-tollma-600 dark:text-tollma-400";
  return "text-zinc-900 dark:text-zinc-50";
}

/** Metric group card: title row + 2-column label/value tiles. */
export function MetricGroup({
  title,
  icon: Icon,
  items,
  testId,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  items: MetricItem[];
  testId?: string;
}) {
  return (
    <div
      className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-950"
      data-testid={testId}
    >
      <div className="mb-2.5 flex items-center gap-1.5">
        <Icon className="size-3.5 text-tollma-500" />
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="truncate text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              {item.label}
            </dt>
            <dd
              className={cn(
                "mt-0.5 truncate font-mono text-[13px] font-semibold tabular-nums",
                toneClass(item.tone),
              )}
              title={item.hint ?? item.value}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export interface AnalyticsTooltipProps extends Partial<TooltipContentProps<number, string>> {
  valueFormat?: (value: number) => string;
  /** Per-series overrides keyed by `dataKey` (mixed-unit charts). */
  valueFormats?: Record<string, (value: number) => string>;
  labelFormat?: (label: string | number) => string;
}

/** Dark-mode-first Recharts tooltip shared by every analytics chart. */
export function AnalyticsTooltip({
  active,
  payload,
  label,
  valueFormat = (value: number) => fmtTokens(value),
  valueFormats,
  labelFormat,
}: AnalyticsTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-2 text-[11px] shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95">
      {label !== undefined && (
        <p className="mb-1 font-medium text-zinc-600 dark:text-zinc-300">
          {labelFormat ? labelFormat(label) : String(label)}
        </p>
      )}
      {payload.map((entry, index) => {
        const format =
          (entry.dataKey !== undefined && valueFormats?.[String(entry.dataKey)]) || valueFormat;
        return (
          <p key={`${String(entry.dataKey)}-${index}`} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
              <span className="inline-block size-2 rounded-full" style={{ background: entry.color }} />
              {entry.name}
            </span>
            <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-100">
              {format(num(entry.value))}
            </span>
          </p>
        );
      })}
    </div>
  );
}

export function EmptyHint({ label, testId }: { label: string; testId?: string }) {
  return (
    <p className="py-8 text-center text-xs text-zinc-400" data-testid={testId}>
      {label}
    </p>
  );
}

export function ChartSkeleton({ height = 180 }: { height?: number }) {
  return (
    <div
      className="w-full animate-pulse rounded-lg bg-zinc-100/70 dark:bg-zinc-900/60"
      style={{ height }}
    />
  );
}

/** Thin share bar used by tables, leaderboards and insight rows. */
export function ShareBar({
  fraction,
  colorClass = "bg-tollma-500",
  className,
}: {
  /** 0..1 */
  fraction: number;
  colorClass?: string;
  className?: string;
}) {
  const width = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800", className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-500", colorClass)}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  /** Enables header-click sorting; return the comparable value. */
  sortValue?: (row: T) => number | string;
  className?: string;
}

/** Compact data table with optional client-side sorting. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  testId,
  initialSortKey,
  defaultSortDir = "desc",
  emptyLabel = "No data in range",
}: {
  columns: Array<TableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  testId?: string;
  initialSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  emptyLabel?: string;
}) {
  const [sort, setSort] = useState<SortState | null>(
    initialSortKey ? { key: initialSortKey, dir: defaultSortDir } : null,
  );
  const sorted = sortRows(rows, columns, sort);
  if (rows.length === 0) {
    return <EmptyHint label={emptyLabel} testId={testId ? `${testId}-empty` : undefined} />;
  }
  return (
    <div className="min-w-0 overflow-x-auto" data-testid={testId}>
      <table className="w-full min-w-full text-left text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-2 py-1.5 font-medium",
                    column.align === "right" ? "text-right" : "text-left",
                    column.sortValue && "cursor-pointer select-none hover:text-zinc-600 dark:hover:text-zinc-200",
                  )}
                  onClick={
                    column.sortValue
                      ? () =>
                          setSort((current) =>
                            current?.key === column.key
                              ? { key: column.key, dir: current.dir === "asc" ? "desc" : "asc" }
                              : { key: column.key, dir: "desc" },
                          )
                      : undefined
                  }
                >
                  {column.header}
                  {active && <span className="ml-1">{sort?.dir === "asc" ? "↑" : "↓"}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50/70 dark:border-zinc-900 dark:hover:bg-zinc-900/40"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-2 py-1.5 align-middle",
                    column.align === "right" ? "text-right" : "text-left",
                    column.className,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SortState {
  key: string;
  dir: "asc" | "desc";
}

function sortRows<T>(
  rows: T[],
  columns: Array<TableColumn<T>>,
  sort: SortState | null,
): T[] {
  if (!sort) return rows;
  const column = columns.find((candidate) => candidate.key === sort.key);
  if (!column?.sortValue) return rows;
  const getValue = column.sortValue;
  return [...rows].sort((a, b) => {
    const av = getValue(a);
    const bv = getValue(b);
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return sort.dir === "asc" ? cmp : -cmp;
  });
}
