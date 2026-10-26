"use client";

import { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  DetailPanel,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui";
import { BarList } from "@/components/charts";
import { useOrgStore } from "@/store/org";
import { useBenchmarkRuns } from "@/hooks/useBenchmarks";
import { isBenchmarkStatus, type BenchmarkRun } from "@/services/benchmarks";
import { parseApiError } from "@/lib/errors";
import { fmtTokens } from "@/lib/utils";
import {
  BENCHMARK_DISCLAIMER,
  BENCHMARK_VS_LIVE_COPY,
  benchmarkDataState,
  benchmarkP50Bars,
  benchmarkSavingsExplanation,
  benchmarkStateLabel,
  describeCacheState,
  formatBenchmarkConditions,
  formatBenchCost,
  formatBenchCount,
  formatBenchMs,
  formatBenchTokens,
} from "./benchmarkLogic";

function tokensLabel(run: BenchmarkRun): string {
  if (run.prompt_tokens == null && run.completion_tokens == null) return "N/A";
  return fmtTokens((run.prompt_tokens ?? 0) + (run.completion_tokens ?? 0));
}

function RunDetail({ run, onClose }: { run: BenchmarkRun | null; onClose: () => void }) {
  const conditions = run ? formatBenchmarkConditions(run.conditions) : [];
  return (
    <DetailPanel
      open={!!run}
      onClose={onClose}
      title={run?.name ?? "Benchmark run"}
      subtitle={run ? `${run.provider_label ?? "—"} · ${run.model_label ?? "—"}` : undefined}
      testId="benchmark-run-drawer"
      width={440}
      zIndex={60}
    >
      {run && (
        <div className="space-y-3 text-xs" data-testid="benchmark-run-detail">
          <dl className="grid grid-cols-2 gap-2">
            {[
              ["State", benchmarkStateLabel(benchmarkDataState(run))],
              ["Traffic", run.traffic_path ?? "N/A"],
              ["Logging mode", run.logging_mode ?? "N/A"],
              ["Cache", describeCacheState(run.cache_state)],
              ["Samples (n)", formatBenchCount(run.n)],
              ["Errors", formatBenchCount(run.errors)],
              ["Mean", formatBenchMs(run.mean_ms)],
              ["p50", formatBenchMs(run.p50_ms)],
              ["p95", formatBenchMs(run.p95_ms)],
              ["p99", formatBenchMs(run.p99_ms)],
              ["TTFB mean", formatBenchMs(run.ttft_mean_ms)],
              ["Prompt tokens", formatBenchTokens(run.prompt_tokens)],
              ["Completion tokens", formatBenchTokens(run.completion_tokens)],
              ["Cache read", formatBenchTokens(run.cache_read)],
              ["Cache write", formatBenchTokens(run.cache_write)],
              ["Total cost", formatBenchCost(run.total_cost)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                <dt className="text-[10px] uppercase tracking-wider text-zinc-400">{k}</dt>
                <dd className="mt-0.5 break-all font-medium text-zinc-900 dark:text-zinc-100">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
            <p className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">Conditions</p>
            {conditions.length === 0 ? (
              <p className="text-zinc-400">No conditions recorded for this run.</p>
            ) : (
              <dl className="space-y-1">
                {conditions.map((c) => (
                  <div key={c.key} className="flex items-baseline justify-between gap-2">
                    <dt className="shrink-0 text-zinc-500">{c.key}</dt>
                    <dd className="truncate font-mono text-zinc-800 dark:text-zinc-200" title={c.value}>{c.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
            <p className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">Notes</p>
            <p className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
              {run.notes?.trim() ? run.notes : "No notes."}
            </p>
          </div>
          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400" data-testid="benchmark-savings">
            {benchmarkSavingsExplanation(run)}
          </p>
          <p className="text-[11px] text-zinc-400">{BENCHMARK_DISCLAIMER}</p>
        </div>
      )}
    </DetailPanel>
  );
}

export function BenchmarksDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const context = useOrgStore((s) => s.context);
  const orgId = context.type === "org" ? context.orgId : undefined;
  const feed = useBenchmarkRuns(orgId, 25, open);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);

  const rows = useMemo(
    () => (feed.data?.pages ?? []).flatMap((p) => p.items),
    [feed.data],
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  const compared = useMemo(() => {
    const list = pinned.length > 0 ? pinned.map((id) => byId.get(id)).filter((r): r is BenchmarkRun => !!r) : rows;
    return benchmarkP50Bars(list);
  }, [pinned, byId, rows]);

  function togglePin(id: string) {
    setPinned((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  return (
    <>
      <DetailPanel
        open={open}
        onClose={onClose}
        title="Benchmarks"
        subtitle={context.type === "org" ? `Controlled runs · ${context.orgName}` : "Controlled runs"}
        testId="benchmarks-drawer"
        width={920}
      >
        <div className="space-y-3" data-testid="benchmarks-panel">
          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400" data-testid="benchmarks-disclaimer">
            {BENCHMARK_DISCLAIMER}
          </p>
          <p className="text-[11px] text-zinc-400" data-testid="benchmarks-vs-live">
            {BENCHMARK_VS_LIVE_COPY}
          </p>

          {feed.isPending ? (
            <LoadingState message="Loading benchmark runs…" className="py-12" />
          ) : feed.error ? (
            isBenchmarkStatus(feed.error, 404) ? (
              <EmptyState
                icon={FlaskConical}
                title="Benchmarks aren't available"
                description="The benchmark service hasn't been enabled for this workspace yet."
                testId="benchmarks-unavailable"
              />
            ) : (
              <ErrorState
                title="Could not load benchmark runs"
                message={parseApiError(feed.error).message}
                onRetry={() => void feed.refetch()}
              />
            )
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FlaskConical}
              title="No benchmark runs yet"
              description="Runs are recorded by tooling — they appear here once the first controlled run lands."
              testId="benchmarks-empty"
            />
          ) : (
            <>
              <div data-testid="benchmarks-p50">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  p50 latency comparison {pinned.length > 0 ? `(${pinned.length} pinned)` : "(all runs)"}
                </p>
                {compared.length === 0 ? (
                  <p className="py-2 text-xs text-zinc-400">No p50 data to compare yet.</p>
                ) : (
                  <BarList items={compared} valueFormat={formatBenchMs} testId="benchmarks-p50-bars" />
                )}
              </div>
              <DataTable<BenchmarkRun>
                columns={[
                  {
                    key: "compare", header: "Pin",
                    render: (r) => (
                      <span onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={pinned.includes(r.id)}
                          onChange={() => togglePin(r.id)}
                          aria-label={`Pin ${r.name} for comparison`}
                          data-testid={`benchmark-pin-${r.id}`}
                        />
                      </span>
                    ),
                  },
                  {
                    key: "run", header: "Run",
                    render: (r) => {
                      const state = benchmarkDataState(r);
                      return (
                        <span className="block min-w-0" title={`${r.name} · ${r.created_at || "undated"}`}>
                          <span className="block max-w-32 truncate font-medium text-zinc-900 dark:text-zinc-100">{r.name}</span>
                          {state !== "ok" && (
                            <Badge variant={state === "insufficient-data" ? "warning" : "secondary"} className="mt-0.5">
                              {benchmarkStateLabel(state)}
                            </Badge>
                          )}
                        </span>
                      );
                    },
                  },
                  { key: "traffic", header: "Traffic", render: (r) => <span className="max-w-28 truncate" title={r.traffic_path ?? ""}>{r.traffic_path ?? "N/A"}</span> },
                  { key: "model", header: "Model", render: (r) => <span className="max-w-28 truncate" title={`${r.provider_label ?? ""} ${r.model_label ?? ""}`.trim()}>{[r.provider_label, r.model_label].filter(Boolean).join(" / ") || "N/A"}</span> },
                  { key: "logging", header: "Logging", render: (r) => r.logging_mode ?? "N/A" },
                  { key: "cache", header: "Cache", render: (r) => describeCacheState(r.cache_state) },
                  { key: "n", header: "N", align: "right", render: (r) => formatBenchCount(r.n) },
                  { key: "errors", header: "Errors", align: "right", render: (r) => formatBenchCount(r.errors) },
                  { key: "mean", header: "Mean", align: "right", render: (r) => formatBenchMs(r.mean_ms) },
                  { key: "p50", header: "p50", align: "right", render: (r) => formatBenchMs(r.p50_ms) },
                  { key: "p95", header: "p95", align: "right", render: (r) => formatBenchMs(r.p95_ms) },
                  { key: "p99", header: "p99", align: "right", render: (r) => formatBenchMs(r.p99_ms) },
                  { key: "ttfb", header: "TTFB", align: "right", render: (r) => formatBenchMs(r.ttft_mean_ms ?? r.ttft_p50_ms) },
                  { key: "tokens", header: "Tokens", align: "right", render: (r) => <span title={`prompt ${r.prompt_tokens ?? "N/A"} + completion ${r.completion_tokens ?? "N/A"}`}>{tokensLabel(r)}</span> },
                  { key: "cost", header: "Cost", align: "right", render: (r) => formatBenchCost(r.total_cost) },
                ]}
                rows={rows}
                rowKey={(r) => r.id}
                emptyMessage="No benchmark runs in this range"
                testId="benchmarks-table"
                onRowClick={(r) => setSelectedId(r.id)}
                rowTestId={(r) => `benchmark-row-${r.id}`}
              />
              {feed.hasNextPage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void feed.fetchNextPage()}
                  disabled={feed.isFetchingNextPage}
                  data-testid="benchmarks-more"
                >
                  {feed.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              )}
            </>
          )}
        </div>
      </DetailPanel>
      <RunDetail run={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
