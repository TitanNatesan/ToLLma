"use client";

import { useMemo } from "react";
import { asNumber } from "../StatusPill";
import { fmtBudgetAmount, fmtPercentUsed } from "../BudgetBar";
import { ChartSkeleton, EmptyHint, SectionFrame, num } from "./shared";
import type { Numeric } from "@/types/apiKeys";

const RING = 2 * Math.PI * 44;

/** Remaining-budget progress ring: spent vs the key's budget cap. Read-only. */
export function BudgetGauge({
  costTotal,
  maxBudget,
  loading = false,
}: {
  costTotal: Numeric;
  maxBudget: Numeric | null | undefined;
  loading?: boolean;
}) {
  const gauge = useMemo(() => {
    const budget = asNumber(maxBudget);
    if (budget === null) return { state: "unlimited" as const };
    if (budget <= 0) return { state: "blocked" as const, budget };
    const spent = num(costTotal);
    const usedPct = (spent / budget) * 100;
    const remaining = Math.max(0, budget - spent);
    const fraction = Math.max(0, Math.min(1, spent / budget));
    const tone =
      fraction >= 1 ? "#dc2626" : fraction >= 0.8 ? "#d97706" : "var(--color-tollma-500)";
    return { state: "capped" as const, budget, spent, usedPct, remaining, fraction, tone };
  }, [costTotal, maxBudget]);

  return (
    <SectionFrame
      title="Remaining budget"
      description="Share of the budget cap still available."
      testId="key-budget-gauge"
    >
      {loading ? (
        <ChartSkeleton height={150} />
      ) : gauge.state === "unlimited" ? (
        <EmptyHint label="Unlimited budget — no cap to track" />
      ) : gauge.state === "blocked" ? (
        <p className="py-8 text-center text-xs font-medium text-red-600 dark:text-red-400">
          Blocked · $0 budget rejects every request.
        </p>
      ) : (
        <div
          className="flex items-center gap-4"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round(gauge.usedPct))}
          aria-valuetext={`${fmtPercentUsed(gauge.usedPct)}% used, ${fmtBudgetAmount(gauge.remaining)} remaining`}
          data-testid="key-budget-gauge-body"
        >
          <svg viewBox="0 0 100 100" className="size-28 shrink-0" role="img" aria-label="Budget remaining">
            <circle cx="50" cy="50" r="44" fill="none" strokeWidth="10" className="stroke-zinc-100 dark:stroke-zinc-800" />
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke={gauge.tone}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${gauge.fraction * RING} ${RING}`}
              transform="rotate(-90 50 50)"
            />
            <text
              x="50"
              y="46"
              textAnchor="middle"
              className="fill-zinc-900 font-mono text-[15px] font-semibold dark:fill-zinc-50"
            >
              {fmtPercentUsed(100 - Math.min(100, gauge.usedPct))}%
            </text>
            <text x="50" y="60" textAnchor="middle" className="fill-zinc-400 text-[8px]">
              left
            </text>
          </svg>
          <dl className="min-w-0 space-y-2 text-[11px]">
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Remaining</dt>
              <dd className="font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {fmtBudgetAmount(gauge.remaining)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Spent</dt>
              <dd className="font-mono text-zinc-500">
                {fmtBudgetAmount(gauge.spent)} of {fmtBudgetAmount(gauge.budget)}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </SectionFrame>
  );
}
