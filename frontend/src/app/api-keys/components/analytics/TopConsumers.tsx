"use client";

import { useMemo } from "react";
import { BarChart3, Coins, Cpu, Route } from "lucide-react";
import { chartColor } from "@/components/charts/palette";
import { fmtCost, fmtTokens } from "@/lib/utils";
import { SectionFrame, endpointLabel, num, truncate } from "./shared";
import type { ApiKeyAnalyticsSummary } from "@/types/apiKeys";

interface LeaderboardItem {
  name: string;
  value: number;
  hint?: string;
}

function Leaderboard({
  title,
  icon: Icon,
  items,
  valueFormat,
  testId,
}: {
  title: string;
  icon: typeof Cpu;
  items: LeaderboardItem[];
  valueFormat: (value: number) => string;
  testId: string;
}) {
  const visible = items.slice(0, 6);
  const max = Math.max(...visible.map((item) => item.value), 0.000001);
  return (
    <SectionFrame title={title} testId={testId}>
      {visible.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-400">No data in range</p>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((item, index) => (
            <li key={`${item.name}-${index}`} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span
                  className="flex min-w-0 items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300"
                  title={item.name}
                >
                  <span className="w-3 shrink-0 text-right font-mono text-[10px] text-zinc-400">
                    {index + 1}
                  </span>
                  <Icon className="size-3 shrink-0 text-zinc-400" />
                  <span className="truncate">{truncate(item.name, 28)}</span>
                </span>
                <span className="shrink-0 font-mono text-zinc-500 dark:text-zinc-400">
                  {valueFormat(item.value)}
                  {item.hint && <span className="ml-1.5 text-zinc-400">{item.hint}</span>}
                </span>
              </div>
              <div className="ml-4 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max((item.value / max) * 100, 2)}%`,
                    background: chartColor(index),
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionFrame>
  );
}

/** Ranked leaderboards: traffic leaders and spend drivers. */
export function TopConsumers({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  const modelsByRequests = useMemo(
    () =>
      [...(summary.models ?? [])]
        .map((row) => ({
          name: row.model || "unknown model",
          value: num(row.requests),
          hint: fmtCost(row.spend),
        }))
        .sort((a, b) => b.value - a.value),
    [summary.models],
  );

  const providersByRequests = useMemo(
    () =>
      [...(summary.providers ?? [])]
        .map((row) => ({
          name: row.provider || "unknown provider",
          value: num(row.requests),
          hint: fmtCost(row.spend),
        }))
        .sort((a, b) => b.value - a.value),
    [summary.providers],
  );

  const modelsBySpend = useMemo(
    () =>
      [...(summary.models ?? [])]
        .map((row) => ({
          name: row.model || "unknown model",
          value: num(row.spend),
          hint: `${fmtTokens(row.requests)} req`,
        }))
        .sort((a, b) => b.value - a.value),
    [summary.models],
  );

  const endpointsBySpend = useMemo(
    () =>
      [...(summary.endpoints ?? [])]
        .map((row) => ({
          name: endpointLabel(row.endpoint),
          value: num(row.spend),
          hint: `${fmtTokens(row.requests)} req`,
        }))
        .sort((a, b) => b.value - a.value),
    [summary.endpoints],
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="key-top-consumers">
      <Leaderboard
        title="Most used models"
        icon={Cpu}
        items={modelsByRequests}
        valueFormat={(value) => `${fmtTokens(value)} req`}
        testId="key-top-models"
      />
      <Leaderboard
        title="Most used providers"
        icon={Route}
        items={providersByRequests}
        valueFormat={(value) => `${fmtTokens(value)} req`}
        testId="key-top-providers"
      />
      <Leaderboard
        title="Most expensive models"
        icon={Coins}
        items={modelsBySpend}
        valueFormat={(value) => fmtCost(value)}
        testId="key-top-expensive-models"
      />
      <Leaderboard
        title="Most expensive endpoints"
        icon={BarChart3}
        items={endpointsBySpend}
        valueFormat={(value) => fmtCost(value)}
        testId="key-top-expensive-endpoints"
      />
    </div>
  );
}
