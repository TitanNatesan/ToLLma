"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fmtMs, fmtNumber, fmtPercent } from "./format";
import type { AdminHealthCheck, AdminHealthSummary } from "@/types/admin";

type Tone = "ok" | "warn" | "bad" | "neutral";

const OK_STATUSES = ["ok", "healthy", "valid", "active", "up", "ready", "completed", "connected"];
const WARN_STATUSES = ["degraded", "warning", "unknown", "pending", "queued", "running", "starting"];
const BAD_STATUSES = ["down", "error", "failed", "invalid", "cancelled", "unavailable", "unreachable"];

export function statusTone(status: string): Tone {
  const value = status.toLowerCase();
  if (OK_STATUSES.includes(value)) return "ok";
  if (WARN_STATUSES.includes(value)) return "warn";
  if (BAD_STATUSES.includes(value)) return "bad";
  return "neutral";
}

const TONES: Record<Tone, { dot: string; text: string }> = {
  ok: { dot: "bg-tollma-500", text: "text-tollma-700 dark:text-tollma-300" },
  warn: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  bad: { dot: "bg-red-500", text: "text-red-700 dark:text-red-300" },
  neutral: { dot: "bg-zinc-400", text: "text-zinc-500 dark:text-zinc-400" },
};

/** Colored status label shared by health checks and error tables. */
export function StatusPill({ status, className }: { status: string; className?: string }) {
  const tone = TONES[statusTone(status)];
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", tone.text, className)}
      data-testid={`admin-status-${status}`}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
      {label}
    </span>
  );
}

function StatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-100 py-2 last:border-0 dark:border-zinc-900">
      <dt className="text-[11px] uppercase tracking-wider text-zinc-400">{label}</dt>
      <dd className="text-xs text-zinc-700 dark:text-zinc-200">{children}</dd>
    </div>
  );
}

/** Overview card: platform health at a glance. */
export function HealthOverviewCard({ health }: { health: AdminHealthSummary }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2" data-testid="admin-health-summary">
      <StatRow label="Status">
        <StatusPill status={health.status} />
      </StatRow>
      <StatRow label="Database">
        <StatusPill status={health.database} />
      </StatRow>
      <StatRow label="Cache">
        <StatusPill status={health.cache} />
      </StatRow>
      <StatRow label="Active generations">
        <span className="font-mono tabular-nums">{fmtNumber(health.active_generations)}</span>
      </StatRow>
      <StatRow label="Avg latency">
        <span className="font-mono tabular-nums">{fmtMs(health.avg_latency_ms)}</span>
      </StatRow>
      <StatRow label="P95 latency">
        <span className="font-mono tabular-nums">{fmtMs(health.p95_latency_ms)}</span>
      </StatRow>
      <StatRow label="Error rate (1h)">
        <span className="font-mono tabular-nums">{fmtPercent(health.error_rate_1h)}</span>
      </StatRow>
    </dl>
  );
}

/** Full health tab: one row per backend check. */
export function HealthChecksList({ checks }: { checks: AdminHealthCheck[] }) {
  if (checks.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-zinc-400" data-testid="admin-health-checks-empty">
        No health checks reported
      </p>
    );
  }
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-900" data-testid="admin-health-checks">
      {checks.map((check) => (
        <li key={check.name} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <StatusPill status={check.status} />
            <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">
              {check.name}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            {check.detail && (
              <span className="max-w-72 truncate text-[11px] text-zinc-400" title={check.detail}>
                {check.detail}
              </span>
            )}
            <span className="shrink-0 font-mono tabular-nums text-[11px] text-zinc-500 dark:text-zinc-400">
              {fmtMs(check.latency_ms)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
