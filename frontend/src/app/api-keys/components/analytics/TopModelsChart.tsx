"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartColor } from "@/components/charts/palette";
import { cn, fmtCompactTokens, fmtCost, fmtTokens } from "@/lib/utils";
import { AnalyticsTooltip, EmptyHint, SectionFrame, num, truncate } from "./shared";
import type { ApiKeyAnalyticsSummary } from "@/types/apiKeys";

type TopMetric = "requests" | "spend" | "tokens";

const METRICS: ReadonlyArray<{ value: TopMetric; label: string }> = [
  { value: "requests", label: "Requests" },
  { value: "spend", label: "Spend" },
  { value: "tokens", label: "Tokens" },
];

function formatFor(metric: TopMetric): (value: number) => string {
  if (metric === "spend") return (value) => fmtCost(value);
  if (metric === "tokens") return (value) => fmtCompactTokens(value);
  return (value) => fmtTokens(value);
}

/** Top Models: ranked bar chart with a Requests | Spend | Tokens toggle. */
export function TopModelsChart({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  const [metric, setMetric] = useState<TopMetric>("requests");

  const rows = useMemo(() => {
    const valueOf =
      metric === "spend"
        ? (row: { spend: unknown }) => num(row.spend)
        : metric === "tokens"
          ? (row: { tokens: unknown }) => num(row.tokens)
          : (row: { requests: unknown }) => num(row.requests);
    return [...(summary.models ?? [])]
      .map((row) => ({ name: row.model || "unknown model", value: valueOf(row) }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [summary.models, metric]);

  const format = formatFor(metric);

  return (
    <SectionFrame
      title="Top models"
      description="Ranked models for the selected metric."
      testId="key-top-models-chart"
      action={
        <div
          role="group"
          aria-label="Top models metric"
          className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50/60 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/60"
        >
          {METRICS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={metric === option.value}
              onClick={() => setMetric(option.value)}
              data-testid={`key-top-models-${option.value}`}
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
                metric === option.value
                  ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <EmptyHint label="No model traffic in this range" />
      ) : (
        <div
          role="img"
          aria-label={`Top models by ${metric}`}
          className="w-full text-zinc-400 dark:text-zinc-500"
          data-testid="key-top-models-bars"
        >
          <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 32 + 16)}>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                horizontal={false}
                className="stroke-zinc-200 dark:stroke-zinc-800"
              />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fill: "currentColor", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: string) => truncate(value, 20)}
              />
              <Tooltip
                content={<AnalyticsTooltip valueFormat={format} />}
                cursor={{ fill: "rgba(113,113,122,0.08)" }}
              />
              <Bar dataKey="value" name={metric} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {rows.map((entry, index) => (
                  <Cell key={entry.name} fill={chartColor(index)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionFrame>
  );
}
