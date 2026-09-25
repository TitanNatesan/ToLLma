"use client";

import { useMemo } from "react";
import { Timer, TriangleAlert } from "lucide-react";
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
import { fmtTokens } from "@/lib/utils";
import { AnalyticsTooltip, EmptyHint, SectionFrame, num, pct, rate } from "./shared";
import type { ApiKeyAnalyticsSummary } from "@/types/apiKeys";

const SEGMENTS = [
  { key: "success", label: "Success", className: "bg-emerald-500" },
  { key: "failed", label: "Failed", className: "bg-red-500" },
  { key: "cancelled", label: "Cancelled", className: "bg-zinc-400 dark:bg-zinc-500" },
] as const;

/** Request outcomes: success/failure composition, error categories, failure leaders. */
export function RequestBreakdown({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  const requests = summary.requests;
  const total = num(requests?.total);
  const segments = useMemo(
    () =>
      SEGMENTS.map((segment) => ({
        ...segment,
        value: num(requests?.[segment.key]),
      })),
    [requests],
  );

  const failuresByModel = useMemo(
    () =>
      (summary.models ?? [])
        .map((row) => {
          if (row.success_rate === null || row.success_rate === undefined) return null;
          const failed = Math.round(num(row.requests) * (1 - rate(row.success_rate)));
          if (failed <= 0) return null;
          return { name: row.model || "unknown model", failed };
        })
        .filter((row): row is { name: string; failed: number } => row !== null)
        .sort((a, b) => b.failed - a.failed)
        .slice(0, 8),
    [summary.models],
  );

  const failuresByProvider = useMemo(
    () =>
      (summary.providers ?? [])
        .map((row) => {
          const failed = Math.round(num(row.requests) * rate(row.error_rate));
          if (failed <= 0) return null;
          return {
            name: row.provider || "unknown provider",
            value: failed,
            hint: pct(rate(row.error_rate)),
            color: chartColor(4),
          };
        })
        .filter((row): row is { name: string; value: number; hint: string; color: string } => row !== null)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    [summary.providers],
  );

  return (
    <SectionFrame
      title="Error distribution"
      description="Outcomes, timeouts and failures by model and provider."
      testId="key-analytics-errors"
    >
      <div className="space-y-4">
        <div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            {segments.map((segment) => (
              <div
                key={segment.key}
                className={segment.className}
                style={{ width: total > 0 ? `${(segment.value / total) * 100}%` : "0%" }}
                title={`${segment.label}: ${fmtTokens(segment.value)}`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {segments.map((segment) => (
              <span key={segment.key} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span className={`inline-block size-2 rounded-full ${segment.className}`} />
                {segment.label}
                <span className="font-mono text-zinc-700 dark:text-zinc-300">
                  {fmtTokens(segment.value)}
                </span>
                <span className="text-zinc-400">{pct(segment.value / (total || 1))}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
            <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              <Timer className="size-3 text-amber-500" />
              Timeouts
            </p>
            <p className="mt-1 font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {fmtTokens(num(requests?.timeout))}
            </p>
            <p className="text-[10px] text-zinc-400">
              {pct(num(requests?.timeout) / (total || 1))} of requests
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
            <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              <TriangleAlert className="size-3 text-amber-500" />
              Retries
            </p>
            <p className="mt-1 font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {fmtTokens(num(requests?.retry))}
            </p>
            <p className="text-[10px] text-zinc-400">
              {pct(num(requests?.retry) / (total || 1))} of requests
            </p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            Failures by model
          </p>
          {failuresByModel.length === 0 ? (
            <EmptyHint label="No failures in this range" testId="key-errors-models-empty" />
          ) : (
            <div
              role="img"
              aria-label="Failed requests by model"
              className="w-full text-zinc-400 dark:text-zinc-500"
              data-testid="key-errors-models"
            >
              <ResponsiveContainer width="100%" height={Math.max(140, failuresByModel.length * 30 + 16)}>
                <BarChart
                  data={failuresByModel}
                  layout="vertical"
                  margin={{ top: 4, right: 32, left: 4, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    className="stroke-zinc-200 dark:stroke-zinc-800"
                  />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tick={{ fill: "currentColor", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: string) =>
                      value.length > 16 ? `${value.slice(0, 15)}…` : value
                    }
                  />
                  <Tooltip
                    content={<AnalyticsTooltip valueFormat={(value: number) => `${fmtTokens(value)}`} />}
                    cursor={{ fill: "rgba(113,113,122,0.08)" }}
                  />
                  <Bar dataKey="failed" name="Failed" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {failuresByModel.map((entry) => (
                      <Cell key={entry.name} fill={chartColor(4)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
            Failures by provider
          </p>
          {failuresByProvider.length === 0 ? (
            <EmptyHint label="No provider errors in this range" testId="key-errors-providers-empty" />
          ) : (
            <FailuresByProviderBars rows={failuresByProvider} />
          )}
        </div>
      </div>
    </SectionFrame>
  );
}

function FailuresByProviderBars({
  rows,
}: {
  rows: Array<{ name: string; value: number; hint: string; color: string }>;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="space-y-2" data-testid="key-errors-providers">
      {rows.map((row) => (
        <li key={row.name} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">{row.name}</span>
            <span className="shrink-0 font-mono text-zinc-500">
              {fmtTokens(row.value)}
              <span className="ml-1.5 text-zinc-400">{row.hint}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full"
              style={{ width: `${(row.value / max) * 100}%`, background: row.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
