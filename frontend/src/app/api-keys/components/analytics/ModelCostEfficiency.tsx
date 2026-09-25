"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { fmtCompactTokens, fmtCost, fmtTokens } from "@/lib/utils";
import { EmptyHint, SectionFrame, num, truncate } from "./shared";
import type { ApiKeyAnalyticsSummary } from "@/types/apiKeys";

interface EfficiencyPoint {
  name: string;
  x: number;
  y: number;
  z: number;
}

function EfficiencyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: EfficiencyPoint; color?: string }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-2 text-[11px] shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95">
      <p className="mb-1 max-w-56 truncate font-medium text-zinc-600 dark:text-zinc-300" title={point.name}>
        {truncate(point.name, 32)}
      </p>
      <p className="flex items-center justify-between gap-3">
        <span className="text-zinc-500 dark:text-zinc-400">Cost</span>
        <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-100">{fmtCost(point.x)}</span>
      </p>
      <p className="flex items-center justify-between gap-3">
        <span className="text-zinc-500 dark:text-zinc-400">Tokens</span>
        <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-100">
          {fmtTokens(point.y)}
        </span>
      </p>
      <p className="flex items-center justify-between gap-3">
        <span className="text-zinc-500 dark:text-zinc-400">Requests</span>
        <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-100">
          {fmtTokens(point.z)}
        </span>
      </p>
    </div>
  );
}

/**
 * Model Cost Efficiency: scatter of cost (X) vs tokens (Y), bubble size =
 * requests. Outliers to the bottom-right are expensive for what they return.
 */
export function ModelCostEfficiency({ summary }: { summary: ApiKeyAnalyticsSummary }) {
  const points = useMemo<EfficiencyPoint[]>(
    () =>
      (summary.models ?? [])
        .map((row) => ({
          name: row.model || "unknown model",
          x: num(row.spend),
          y: num(row.tokens),
          z: num(row.requests),
        }))
        .filter((point) => point.x > 0 || point.y > 0),
    [summary.models],
  );

  return (
    <SectionFrame
      title="Model cost efficiency"
      description="Cost vs tokens per model — bubble size is request volume."
      testId="key-model-efficiency"
    >
      {points.length === 0 ? (
        <EmptyHint label="No model spend in this range" />
      ) : (
        <div
          role="img"
          aria-label="Model cost versus tokens"
          className="w-full text-zinc-400 dark:text-zinc-500"
          data-testid="key-model-efficiency-chart"
        >
          <ResponsiveContainer width="100%" height={230}>
            <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-zinc-200 dark:stroke-zinc-800"
              />
              <XAxis
                type="number"
                dataKey="x"
                name="Cost"
                tick={{ fill: "currentColor", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => fmtCost(value)}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Tokens"
                tick={{ fill: "currentColor", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={46}
                tickFormatter={(value: number) => fmtCompactTokens(value)}
              />
              <ZAxis type="number" dataKey="z" name="Requests" range={[40, 420]} />
              <Tooltip content={<EfficiencyTooltip />} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter
                name="Models"
                data={points}
                fill="var(--color-tollma-500)"
                fillOpacity={0.7}
                isAnimationActive={false}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionFrame>
  );
}
