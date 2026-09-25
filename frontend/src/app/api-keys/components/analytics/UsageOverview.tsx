"use client";

import { useMemo } from "react";
import { fmtCost, fmtTokens } from "@/lib/utils";
import { fmtMs, num, pct } from "./shared";
import type { ApiKeyAnalyticsSummary } from "@/types/apiKeys";

/**
 * Usage Overview: the seven headline numbers for the range — requests, cost,
 * tokens, success/error rates and latency. All derived from the existing
 * summary query; no inputs, no controls.
 */
export function UsageOverview({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  const tiles = useMemo(() => {
    const requests = summary.requests ?? ({} as ApiKeyAnalyticsSummary["requests"]);
    const total = num(requests.total);
    const base = total > 0 ? total : 1;
    const performance = summary.performance ?? ({} as ApiKeyAnalyticsSummary["performance"]);
    const cost = summary.cost ?? ({} as ApiKeyAnalyticsSummary["cost"]);
    const tokens = summary.tokens ?? ({} as ApiKeyAnalyticsSummary["tokens"]);
    return [
      { label: "Requests", value: fmtTokens(total), tone: "text-tollma-600 dark:text-tollma-400" },
      { label: "Cost", value: fmtCost(cost.total), tone: "text-zinc-900 dark:text-zinc-50" },
      { label: "Tokens", value: fmtTokens(tokens.total), tone: "text-zinc-900 dark:text-zinc-50" },
      {
        label: "Success rate",
        value: pct(num(requests.success) / base),
        tone: "text-emerald-600 dark:text-emerald-400",
      },
      {
        label: "Error rate",
        value: pct(num(requests.failed) / base),
        tone:
          num(requests.failed) > 0
            ? "text-red-600 dark:text-red-400"
            : "text-zinc-900 dark:text-zinc-50",
      },
      {
        label: "Avg latency",
        value: fmtMs(performance.avg_latency_ms),
        tone: "text-zinc-900 dark:text-zinc-50",
      },
      {
        label: "P95 latency",
        value: fmtMs(performance.p95_ms),
        tone: "text-zinc-900 dark:text-zinc-50",
      },
    ];
  }, [summary]);

  return (
    <section
      className="rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-950"
      data-testid="key-usage-overview"
    >
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Usage overview
      </h3>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="min-w-0 rounded-lg border border-zinc-100 bg-zinc-50/50 p-2.5 dark:border-zinc-900 dark:bg-zinc-900/40"
          >
            <dt className="truncate text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              {tile.label}
            </dt>
            <dd
              className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${tile.tone}`}
              title={tile.value}
            >
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
