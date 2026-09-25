"use client";

import { useMemo } from "react";
import { CalendarClock, Hourglass, KeyRound, PiggyBank, Timer, TimerOff } from "lucide-react";
import { ApiKeyStatusPill, apiKeyStatus, asNumber, fmtDateTime, fmtUntil, keyStatus } from "../StatusPill";
import { num } from "./shared";
import type { ApiKey, Numeric } from "@/types/apiKeys";

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <div className="mt-1 truncate text-xs text-zinc-700 dark:text-zinc-200">{value}</div>
    </div>
  );
}

/**
 * Key Health: read-only identity + budget snapshot for one API key.
 * Spend is the analytics range total (the only spend figure the existing
 * summary query exposes), so remaining budget is relative to that window.
 */
export function KeyHealthSection({
  apiKey,
  costTotal,
  loadingKey = false,
  loadingCost = false,
}: {
  apiKey?: ApiKey;
  costTotal: Numeric;
  loadingKey?: boolean;
  loadingCost?: boolean;
}) {
  const health = useMemo(() => {
    if (!apiKey) return null;
    const spent = num(costTotal);
    const status = keyStatus(apiKey, spent);
    const base = apiKeyStatus(apiKey);
    const budget = asNumber(apiKey.policy?.max_budget_usd);
    const remaining = budget === null ? null : budget - spent;
    const resetDays = apiKey.policy?.budget_reset_days ?? null;
    return { status, base, budget, remaining, spent, resetDays };
  }, [apiKey, costTotal]);

  if (loadingKey || !apiKey || !health) {
    return (
      <section
        className="rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-950"
        data-testid="key-health"
        aria-busy="true"
      >
        <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Key health
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-10 animate-pulse rounded-lg bg-zinc-100/70 dark:bg-zinc-900/60"
            />
          ))}
        </div>
      </section>
    );
  }

  const remainingLabel =
    health.budget === null
      ? "Unlimited"
      : health.budget <= 0
        ? "Blocked · $0 cap"
        : loadingCost
          ? "…"
          : `$${(Math.max(0, health.remaining ?? 0)).toLocaleString("en-US", { maximumFractionDigits: 2 })} remaining`;

  const cycleLabel =
    health.resetDays === null || health.resetDays === undefined || health.resetDays <= 0
      ? "No reset · all-time"
      : `${health.resetDays}-day rolling`;

  return (
    <section
      className="rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-950"
      data-testid="key-health"
    >
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Key health
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Meta
          label="Status"
          value={
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="size-3 text-zinc-400" />
              <ApiKeyStatusPill status={health.status} />
            </span>
          }
        />
        <Meta label="Created" value={fmtDateTime(apiKey.created_at)} />
        <Meta
          label="Last used"
          value={
            <span className="inline-flex items-center gap-1">
              <Timer className="size-3 text-zinc-400" />
              {apiKey.last_used_at ? fmtDateTime(apiKey.last_used_at) : "Never"}
            </span>
          }
        />
        <Meta
          label="Expiration"
          value={
            <span className="inline-flex items-center gap-1" title={apiKey.expires_at ?? undefined}>
              <TimerOff className="size-3 text-zinc-400" />
              {apiKey.expires_at
                ? `${fmtDateTime(apiKey.expires_at)} (${fmtUntil(apiKey.expires_at)})`
                : "Never"}
            </span>
          }
        />
        <Meta
          label="Remaining budget"
          value={
            <span className="inline-flex items-center gap-1 font-mono">
              <PiggyBank className="size-3 text-zinc-400" />
              {remainingLabel}
            </span>
          }
        />
        <Meta
          label="Current budget cycle"
          value={
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3 text-zinc-400" />
              {cycleLabel}
            </span>
          }
        />
      </div>
      {health.base === "expired" && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <Hourglass className="size-3" />
          This key is expired — analytics below are historical.
        </p>
      )}
    </section>
  );
}
