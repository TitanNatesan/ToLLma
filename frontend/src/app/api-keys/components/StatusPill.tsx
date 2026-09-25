"use client";

import type { ComponentType } from "react";
import {
  CircleCheck,
  CircleDashed,
  CircleDollarSign,
  Clock,
  PowerOff,
  RefreshCw,
  TimerOff,
} from "lucide-react";
import { Badge, Tooltip } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ApiKeyPolicy, ApiKeyStatus, Numeric } from "@/types/apiKeys";

/** Coerce Pydantic Decimal JSON (number | string) to a finite number. */
export function asNumber(value: Numeric | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Every lifecycle state the console can render. */
export type KeyLifecycleStatus =
  | ApiKeyStatus
  | "rate_limited"
  | "budget_exceeded"
  | "rotated"
  | "inactive";

/** Fields used for derivation; all optional beyond the two structural ones. */
export interface KeyStatusInput {
  enabled: boolean;
  expires_at: string | null;
  rotation_count?: number | null;
  last_used_at?: string | null;
  policy?: Pick<ApiKeyPolicy, "max_budget_usd"> | null;
}

/** Extra signals that cannot be read from the key payload alone. */
export interface KeyStatusSignals {
  /** True when the key hit a request/token rate limit in the current window. */
  rateLimited?: boolean;
}

/**
 * Derive the display status from the key payload.
 *
 * Priority (first match wins):
 *   disabled → expired → budget_exceeded → rate_limited → rotated →
 *   inactive (never used) → enabled
 *
 * `cost` is the spend (same reset window as `policy.max_budget_usd`); pass it
 * when analytics are loaded so an exhausted budget is visible in the table.
 * `budget_exceeded` also covers a `$0` budget, which blocks every request.
 */
export function keyStatus(
  key: KeyStatusInput,
  cost?: number | null,
  signals?: KeyStatusSignals,
): KeyLifecycleStatus {
  if (!key.enabled) return "disabled";
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return "expired";

  const budget = asNumber(key.policy?.max_budget_usd);
  if (budget !== null) {
    if (budget <= 0) return "budget_exceeded";
    if (cost !== null && cost !== undefined && cost >= budget) return "budget_exceeded";
  }

  if (signals?.rateLimited) return "rate_limited";
  if ((key.rotation_count ?? 0) > 0) return "rotated";
  if (!key.last_used_at) return "inactive";
  return "enabled";
}

/** Base key state without usage signals — kept for payload-only callers. */
export function apiKeyStatus(key: Pick<KeyStatusInput, "enabled" | "expires_at">): ApiKeyStatus {
  if (!key.enabled) return "disabled";
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return "expired";
  return "enabled";
}

interface StatusConfig {
  label: string;
  icon: ComponentType<{ className?: string }>;
  tip: string;
  /** Pill surface; each state keeps a distinct hue (icon + tint + dot). */
  className: string;
  dot: string;
  iconClassName: string;
}

const STATUS_CONFIG: Record<KeyLifecycleStatus, StatusConfig> = {
  enabled: {
    label: "Enabled",
    icon: CircleCheck,
    tip: "Active and accepting requests within its limits.",
    className:
      "border-transparent bg-tollma-100 text-tollma-800 dark:bg-tollma-950/70 dark:text-tollma-200",
    dot: "bg-tollma-500",
    iconClassName: "text-tollma-600 dark:text-tollma-400",
  },
  disabled: {
    label: "Disabled",
    icon: PowerOff,
    tip: "Turned off manually — every request is rejected with 403.",
    className: "border-transparent bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    dot: "bg-zinc-400",
    iconClassName: "text-zinc-500 dark:text-zinc-400",
  },
  expired: {
    label: "Expired",
    icon: Clock,
    tip: "The expiration date has passed. Extend it or rotate to a new key.",
    className: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    dot: "bg-amber-500",
    iconClassName: "text-amber-600 dark:text-amber-400",
  },
  rate_limited: {
    label: "Rate limited",
    icon: TimerOff,
    tip: "The key hit a requests/tokens-per-window limit. Requests recover when the window resets.",
    className: "border-transparent bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
    dot: "bg-orange-500",
    iconClassName: "text-orange-600 dark:text-orange-400",
  },
  budget_exceeded: {
    label: "Budget exceeded",
    icon: CircleDollarSign,
    tip: "Spend reached the configured budget — the key is blocked until the reset window or a higher limit.",
    className: "border-transparent bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
    dot: "bg-red-500",
    iconClassName: "text-red-600 dark:text-red-400",
  },
  rotated: {
    label: "Rotated",
    icon: RefreshCw,
    tip: "The secret has been rotated at least once. Older copies of the key no longer work.",
    className: "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
    dot: "bg-sky-500",
    iconClassName: "text-sky-600 dark:text-sky-400",
  },
  inactive: {
    label: "Inactive",
    icon: CircleDashed,
    tip: "Created but never used. It will accept requests once a client calls the gateway.",
    className: "border-transparent bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400",
    dot: "bg-zinc-300 dark:bg-zinc-600",
    iconClassName: "text-zinc-400 dark:text-zinc-500",
  },
};

export function ApiKeyStatusPill({
  status,
  className,
  withTooltip = true,
}: {
  status: KeyLifecycleStatus;
  className?: string;
  withTooltip?: boolean;
}) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  const pill = (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-0.5 text-[10px] font-medium",
        config.className,
        className,
      )}
      data-testid={`key-status-${status}`}
    >
      <Icon className={cn("size-3 shrink-0", config.iconClassName)} aria-hidden="true" />
      <span>{config.label}</span>
      <span className={cn("size-1.5 shrink-0 rounded-full", config.dot)} aria-hidden="true" />
    </Badge>
  );

  if (!withTooltip) return pill;
  return (
    <Tooltip content={config.tip}>
      <span className="inline-flex cursor-help" tabIndex={0} aria-label={`${config.label}: ${config.tip}`}>
        {pill}
      </span>
    </Tooltip>
  );
}

/** Absolute timestamp: "Jan 5, 2026, 14:32". */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Compact date-only label: "Jan 5, 2026". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Relative timestamp used in list cells: "just now", "3h ago", "12d ago". */
export function fmtRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "Never";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return fmtDate(iso);
}

/** Upcoming timestamp for expirations: "in 12d", "expired", "Jan 5, 2027". */
export function fmtUntil(iso: string | null | undefined): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "never";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (seconds <= 0) return "expired";
  if (seconds < 3600) return `in ${Math.max(1, Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `in ${Math.floor(seconds / 3600)}h`;
  if (seconds < 30 * 86400) return `in ${Math.floor(seconds / 86400)}d`;
  return `on ${fmtDate(iso)}`;
}
