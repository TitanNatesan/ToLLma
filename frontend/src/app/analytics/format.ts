/** Analytics display formatting. Presentation only — every number arrives
 *  pre-aggregated from the backend. */

import type { AnalyticsGranularity } from "@/types";

export function fmtMoney(value: unknown): string {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!isFinite(n) || n === 0) return "$0";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1) return `$${n.toFixed(3)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

export function fmtPct(value: number | null | undefined, withSign = true): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  const sign = withSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function fmtNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function fmtFloat(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  return value.toFixed(digits);
}

/** Bucket labels come back as local wall-clock instants, so display as-is. */
export function fmtBucket(bucket: string, granularity: AnalyticsGranularity): string {
  const date = new Date(bucket);
  if (isNaN(date.getTime())) return bucket;
  switch (granularity) {
    case "hour":
      return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    case "week":
    case "day":
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    case "month":
      return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
}

export function fmtBucketFull(bucket: string, granularity: AnalyticsGranularity): string {
  const date = new Date(bucket);
  if (isNaN(date.getTime())) return bucket;
  if (granularity === "hour") {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const PRESET_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_7d: "Last 7 days",
  last_30d: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  last_90d: "Last 90 days",
  custom: "Custom range",
};
