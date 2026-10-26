"use client";

import { useMemo, useState } from "react";
import { fmtBudgetAmount } from "@/app/api-keys/components/BudgetBar";
import { AreaChart, BarList } from "@/components/charts";
import { EmptyState, ErrorState, LoadingState, Select } from "@/components/ui";
import { parseApiError } from "@/lib/errors";
import { ApiError } from "@/services/api";
import { isForbiddenError, useMemberAnalytics } from "@/hooks/useOrgs";

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v: number | string | null | undefined): string | null {
  const n = num(v);
  return n === null ? null : fmtBudgetAmount(n);
}

function compact(v: number | string | null | undefined): string {
  const n = num(v);
  return n === null ? "—" : n.toLocaleString();
}

type Preset = "7d" | "30d" | "90d";

const PRESETS: Array<{ id: Preset; label: string; days: number }> = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
];

function rangeFor(preset: Preset): { from: string; to: string; label: string } {
  const def = PRESETS.find((p) => p.id === preset)!;
  const to = new Date();
  const from = new Date(to.getTime() - def.days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString(), label: def.label };
}

function Tile({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid={testId}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100" title={value}>
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-[10px] text-zinc-400" title={sub}>{sub}</p>}
    </div>
  );
}

/** Member usage analytics: range filter, KPI row, breakdowns, trend, last activity. */
export function MemberAnalyticsSection({ orgId, userId, canView }: {
  orgId: string;
  userId: string;
  canView: boolean;
}) {
  const [preset, setPreset] = useState<Preset>("30d");
  const range = useMemo(() => rangeFor(preset), [preset]);
  const query = useMemberAnalytics(orgId, userId, {
    enabled: canView,
    params: { from: range.from, to: range.to },
  });

  if (!canView) {
    return <p className="text-zinc-500">You need analytics permission to view usage.</p>;
  }
  if (query.isLoading) return <LoadingState message="Loading usage…" />;
  if (query.isError && isForbiddenError(query.error)) {
    return (
      <EmptyState title="Usage unavailable"
        description="You need analytics permission to view usage for this member." />
    );
  }
  if (query.isError && query.error instanceof ApiError && query.error.status === 404) {
    // Backend landing in parallel: no analytics read yet → honest empty state.
    return <p className="text-zinc-500">No usage recorded for this member in range.</p>;
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState title="Could not load usage"
        message={query.error ? parseApiError(query.error).message : "No data."}
        onRetry={() => void query.refetch()} />
    );
  }

  return (
    <MemberAnalyticsBody
      data={query.data}
      preset={preset}
      onPreset={setPreset}
      rangeLabel={range.label}
      onRetry={() => void query.refetch()}
    />
  );
}

function MemberAnalyticsBody({ data, preset, onPreset, rangeLabel, onRetry }: {
  data: import("@/types/orgs").MemberAnalytics;
  preset: Preset;
  onPreset: (p: Preset) => void;
  rangeLabel: string;
  onRetry: () => void;
}) {
  const requests = num(data.requests);
  const tokens = num(data.total_tokens);
  const cost = money(data.total_cost);
  const avgCost = money(data.avg_cost_per_request);

  const models = [...(data.by_model ?? [])].sort((a, b) => (num(b.requests) ?? 0) - (num(a.requests) ?? 0));
  const providers = [...(data.by_provider ?? [])].sort((a, b) => (num(b.requests) ?? 0) - (num(a.requests) ?? 0));
  const keys = [...(data.by_key ?? [])].sort((a, b) => (num(b.requests) ?? 0) - (num(a.requests) ?? 0));
  const trend = data.trend ?? [];

  const hasTotals = requests !== null || tokens !== null || cost !== null
    || num(data.succeeded) !== null || num(data.failed) !== null || num(data.blocked) !== null;
  const hasBreakdowns = models.length > 0 || providers.length > 0 || keys.length > 0;
  const empty = !hasTotals && !hasBreakdowns && trend.length === 0;
  // Totals without any detail: older/partial backend — render what exists.
  const partial = hasTotals && !hasBreakdowns && trend.length === 0;

  const labels = trend.map((p) => {
    const d = new Date(p.bucket);
    return Number.isNaN(d.getTime()) ? p.bucket : d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  });
  const reqSeries = trend.map((p) => num(p.requests) ?? 0);

  const modelBars = models.slice(0, 8).map((r) => ({
    name: r.model || "—",
    value: cost !== null ? (num(r.cost) ?? 0) : (num(r.requests) ?? 0),
    hint: `${compact(r.requests)} req`,
  }));
  const providerBars = providers.slice(0, 8).map((r) => ({
    name: r.provider || "—",
    value: cost !== null ? (num(r.cost) ?? 0) : (num(r.requests) ?? 0),
    hint: `${compact(r.requests)} req`,
  }));
  const keyBars = keys.slice(0, 8).map((r) => ({
    // Names only — analytics reads never carry key secrets.
    name: r.key_name || (r.key_id ? `${r.key_id.slice(0, 8)}…` : "—"),
    value: cost !== null ? (num(r.cost) ?? 0) : (num(r.requests) ?? 0),
    hint: `${compact(r.requests)} req`,
  }));
  const valueFormat = (v: number) => (cost !== null ? fmtBudgetAmount(v) : compact(v));

  const lastBits = [
    data.last_activity
      ? (() => {
          const d = new Date(data.last_activity as string);
          return Number.isNaN(d.getTime()) ? null : `Last active ${d.toLocaleString()}`;
        })()
      : null,
    data.last_model ? `model ${data.last_model}` : null,
    data.last_key ? `key ${data.last_key}` : null,
  ].filter((b): b is string => b !== null);

  return (
    <div className="flex flex-col gap-2" data-testid="member-usage">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={preset} onChange={(e) => onPreset(e.target.value as Preset)} sizeVariant="sm"
          className="w-36" aria-label="Usage time range" data-testid="member-usage-range">
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
        <span className="text-[11px] text-zinc-400">{rangeLabel}</span>
      </div>

      {empty ? (
        <p className="text-zinc-500">No usage recorded for this member in range.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" data-testid="member-usage-kpis">
            <Tile label="Requests" value={compact(data.requests)} testId="member-usage-requests" />
            <Tile label="Succeeded" value={compact(data.succeeded)} testId="member-usage-succeeded" />
            <Tile label="Failed" value={compact(data.failed)} testId="member-usage-failed" />
            <Tile label="Blocked" value={compact(data.blocked)} testId="member-usage-blocked" />
            <Tile label="Input tokens" value={compact(data.input_tokens)} testId="member-usage-input" />
            <Tile label="Output tokens" value={compact(data.output_tokens)} testId="member-usage-output" />
            <Tile label="Total tokens" value={compact(data.total_tokens)} testId="member-usage-tokens" />
            <Tile label="Cache read" value={compact(data.cache_read_tokens)} testId="member-usage-cache-read" />
            <Tile label="Cache write" value={compact(data.cache_write_tokens)} testId="member-usage-cache-write" />
            <Tile label="Total cost" value={cost ?? "—"}
              sub={cost === null ? "No cost data (needs ViewCost or no usage)" : undefined}
              testId="member-usage-cost" />
            <Tile label="Avg cost / req" value={avgCost ?? "—"} testId="member-usage-avg-cost" />
          </div>

          {partial && (
            <p className="text-[11px] text-zinc-400" data-testid="member-usage-partial">
              Detailed breakdowns are unavailable for this range — totals only.{" "}
              <button type="button" className="underline underline-offset-2" onClick={onRetry}>Retry</button>
            </p>
          )}

          {trend.length > 0 && (
            <div data-testid="member-usage-trend">
              <AreaChart testId="member-usage-trend-chart" labels={labels}
                series={[{ name: "Requests", values: reqSeries }]} />
            </div>
          )}

          {modelBars.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">By model</p>
              <BarList testId="member-usage-by-model" items={modelBars} valueFormat={valueFormat} />
            </div>
          )}
          {providerBars.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">By provider</p>
              <BarList testId="member-usage-by-provider" items={providerBars} valueFormat={valueFormat} />
            </div>
          )}
          {keyBars.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">By key</p>
              <BarList testId="member-usage-by-key" items={keyBars} valueFormat={valueFormat} />
            </div>
          )}

          {lastBits.length > 0 && (
            <p className="text-[11px] text-zinc-400" data-testid="member-usage-last">
              {lastBits.join(" · ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
