/** Admin dashboard display formatting. Presentation only — every number
 *  arrives pre-aggregated from the backend. */

import type { AdminGranularity } from "@/types/admin";

/** Decimal-as-string (or number) to a finite number for charts. */
export function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return isFinite(n) ? n : 0;
}

export function fmtMoney(value: unknown): string {
  const n = toNumber(value);
  if (n === 0) return "$0";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1) return `$${n.toFixed(3)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtNumber(value: unknown): string {
  const n = toNumber(value);
  return Math.round(n).toLocaleString("en-US");
}

/** 1234 -> "1.2k", 2_500_000 -> "2.5M" — compact axis/KPI values. */
export function fmtCompact(value: unknown): string {
  const n = toNumber(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toLocaleString("en-US");
}

/** Percent change (values arrive already in percent). */
export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/** Fraction rates (0..1) — hit rate, cached share, estimated share. */
export function fmtRate(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Error rates arrive already in percent (0..100) from the admin API. */
export function fmtPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function fmtMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !isFinite(value)) return "—";
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

export function fmtBytes(value: unknown): string {
  const n = toNumber(value);
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const scaled = n / Math.pow(1024, index);
  return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function fmtUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return "—";
  if (seconds >= 86_400) return `${(seconds / 86_400).toFixed(1)}d`;
  if (seconds >= 3_600) return `${(seconds / 3_600).toFixed(1)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds)}s`;
}

/** Bucket labels arrive as UTC instants; display in UTC for deterministic reads. */
export function fmtBucket(bucket: string, granularity: AdminGranularity = "day"): string {
  const date = new Date(bucket);
  if (isNaN(date.getTime())) return bucket;
  if (granularity === "hour") {
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  }
  if (granularity === "month") {
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function fmtBucketFull(bucket: string, granularity: AdminGranularity = "day"): string {
  const date = new Date(bucket);
  if (isNaN(date.getTime())) return bucket;
  if (granularity === "hour") {
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
    year: "numeric",
    timeZone: "UTC",
  });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
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
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  return fmtDate(iso);
}

/** Truncate long model/provider identifiers in chart axes. */
export function truncateLabel(value: string, max = 26): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
