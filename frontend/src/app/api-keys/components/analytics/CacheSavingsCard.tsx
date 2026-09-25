"use client";

import { useMemo } from "react";
import { PiggyBank, Sparkles } from "lucide-react";
import { fmtCost, fmtTokens } from "@/lib/utils";
import { SectionFrame, ShareBar, num } from "./shared";
import type { ApiKeyAnalyticsSummary } from "@/types/apiKeys";

/** Prompt-cache savings: tokens/money saved and the provider split. */
export function CacheSavingsCard({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  const savings = summary.cache_savings;
  const tokensSaved = num(savings?.tokens_saved);
  const moneySaved = num(savings?.money_saved);
  const providers = useMemo(
    () =>
      [...(savings?.by_provider ?? [])]
        .map((row) => ({
          provider: row.provider || "unknown provider",
          tokens: num(row.tokens_saved),
          money: num(row.money_saved),
        }))
        .sort((a, b) => b.tokens - a.tokens),
    [savings?.by_provider],
  );
  const maxTokens = Math.max(...providers.map((row) => row.tokens), 1);

  return (
    <SectionFrame
      title="Cache savings"
      description="Prompt-cache reads that avoided full input cost."
      testId="key-cache-savings"
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            <Sparkles className="size-3 text-tollma-500" />
            Tokens saved
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {fmtTokens(tokensSaved)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            <PiggyBank className="size-3 text-emerald-500" />
            Money saved
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            {fmtCost(moneySaved)}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          By provider
        </p>
        {providers.length === 0 ? (
          <p className="py-3 text-center text-xs text-zinc-400" data-testid="key-cache-providers-empty">
            No cache reads in this range
          </p>
        ) : (
          <ul className="space-y-2" data-testid="key-cache-providers">
            {providers.map((row) => (
              <li key={row.provider} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate text-zinc-600 dark:text-zinc-400" title={row.provider}>
                    {row.provider}
                  </span>
                  <span className="shrink-0 font-mono text-zinc-500">
                    {fmtTokens(row.tokens)}
                    <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">
                      {fmtCost(row.money)}
                    </span>
                  </span>
                </div>
                <ShareBar
                  fraction={row.tokens / maxTokens}
                  colorClass="bg-gradient-to-r from-emerald-500/70 to-emerald-500"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionFrame>
  );
}
