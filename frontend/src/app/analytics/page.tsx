"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Activity,
  BarChart3,
  Boxes,
  Clock,
  Coins,
  Cpu,
  Gauge,
  Hash,
  Layers,
  Lightbulb,
  MessageSquare,
  Server,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Select,
} from "@/components/ui";
import {
  AreaChart,
  BarChart,
  BarList,
  DonutChart,
  Heatmap,
  Sparkline,
} from "@/components/charts";
import {
  useAnalyticsBreakdown,
  useAnalyticsConversations,
  useAnalyticsHeatmap,
  useAnalyticsModels,
  useAnalyticsPerformance,
  useAnalyticsSummary,
  useAnalyticsTimeseries,
  useAnalyticsRefresh,
  browserTimezone,
} from "@/hooks/useAnalytics";
import { downloadAnalyticsExport, formatExportTruncationNotice } from "@/services/api";
import { useAnalyticsWidgets } from "@/hooks/useIntelligence";
import { AnalyticsWidgetsPanel } from "./components/AnalyticsWidgetsPanel";
import { fmtCompactTokens, fmtTokens } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { KpiCard, SectionCard } from "./components/KpiCard";
import { RangePicker } from "./components/RangePicker";
import { ConversationRankList, ModelsTable, ProvidersTable } from "./components/AnalyticsTables";
import { fmtBucket, fmtBucketFull, fmtFloat, fmtMoney, fmtMs, fmtNumber, fmtPct } from "./format";
import type {
  AnalyticsDataset,
  AnalyticsGranularity,
  AnalyticsPreset,
  AnalyticsRangeParams,
  ModelSort,
} from "@/types";

const GRANULARITIES: Array<{ value: AnalyticsGranularity; label: string }> = [
  { value: "hour", label: "Hourly" },
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

const MODEL_SORTS: Array<{ value: ModelSort; label: string }> = [
  { value: "most_used", label: "Most used" },
  { value: "most_expensive", label: "Most expensive" },
  { value: "fastest", label: "Fastest" },
  { value: "slowest", label: "Slowest" },
];

const INSIGHT_STYLES: Record<string, string> = {
  info: "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60",
  positive: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30",
  warning: "border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30",
};

export default function AnalyticsPage() {
  const router = useRouter();
  const timezone = useMemo(() => browserTimezone(), []);

  const [preset, setPreset] = useState<AnalyticsPreset>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [granularity, setGranularity] = useState<AnalyticsGranularity | undefined>(undefined);
  const [modelSort, setModelSort] = useState<ModelSort>("most_expensive");
  const [zoom, setZoom] = useState<{ from: number; to: number } | null>(null);
  const [dataset, setDataset] = useState<AnalyticsDataset>("summary");
  const [exporting, setExporting] = useState(false);

  const customReady = preset !== "custom" || (!!customStart && !!customEnd);
  const params = useMemo<AnalyticsRangeParams>(
    () => ({
      preset,
      tz: timezone,
      ...(preset === "custom" && customStart && customEnd ? { start: customStart, end: customEnd } : {}),
    }),
    [preset, timezone, customStart, customEnd],
  );
  const ready = customReady;
  const queryEnabled = { enabled: ready } as const;

  const summary = useAnalyticsSummary(params);
  const timeseries = useAnalyticsTimeseries(params, granularity);
  const breakdown = useAnalyticsBreakdown(params);
  const models = useAnalyticsModels(params, modelSort);
  const heatmap = useAnalyticsHeatmap(params);
  const performance = useAnalyticsPerformance(params);
  const conversations = useAnalyticsConversations(params);
  const widgets = useAnalyticsWidgets(params);
  const refresh = useAnalyticsRefresh();

  const activeGranularity = granularity ?? timeseries.data?.granularity ?? "day";

  // Zoom is a view of one series; any range/granularity change resets it.
  function changePreset(next: AnalyticsPreset) {
    setZoom(null);
    setPreset(next);
  }
  function changeCustomStart(value: string) {
    setZoom(null);
    setCustomStart(value);
  }
  function changeCustomEnd(value: string) {
    setZoom(null);
    setCustomEnd(value);
  }
  function changeGranularity(next: AnalyticsGranularity) {
    setZoom(null);
    setGranularity(next);
  }

  async function onExport(format: "csv" | "json" | "xlsx") {
    setExporting(true);
    try {
      const result = await downloadAnalyticsExport(params, dataset, format);
      toast.success(`Exported ${dataset} as ${format.toUpperCase()}`);
      const notice = formatExportTruncationNotice(result);
      if (notice) {
        toast.warning(<span data-testid="export-truncated-notice">{notice}</span>);
      }
    } catch (error) {
      toast.error("Export failed", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setExporting(false);
    }
  }

  function openConversation(conversationId: string) {
    router.push(`/c/${conversationId}`);
  }

  const points = timeseries.data?.points ?? [];
  const visiblePoints = zoom ? points.slice(zoom.from, zoom.to + 1) : points;
  const labels = visiblePoints.map((p) => fmtBucketFull(p.bucket, activeGranularity));
  const spendSeries = [{ name: "Spend", values: visiblePoints.map((p) => Number(p.spend)) }];
  const usageSeries = [
    { name: "Requests", values: visiblePoints.map((p) => p.requests) },
  ];
  const tokenSeries = [
    { name: "Prompt", values: visiblePoints.map((p) => p.prompt_tokens) },
    { name: "Completion", values: visiblePoints.map((p) => p.completion_tokens) },
    { name: "Cache read", values: visiblePoints.map((p) => p.cache_read_tokens) },
  ];
  const requestBars = visiblePoints.map((p) => p.requests);
  const requestBarLabels = visiblePoints.map((p) => fmtBucket(p.bucket, activeGranularity));

  const kpi = summary.data;
  const perf = performance.data;
  const providerRows = breakdown.data?.by_provider ?? [];
  const modelRows = breakdown.data?.by_model ?? [];

  const pageHeader = (
    <PageHeader
      title="Analytics"
      subtitle="Usage, spend, tokens and performance intelligence — computed server-side."
      actions={
        <RangePicker
          preset={preset}
          onPreset={changePreset}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStart={changeCustomStart}
          onCustomEnd={changeCustomEnd}
          resolved={summary.data?.range}
          dataset={dataset}
          onDataset={setDataset}
          onExport={onExport}
          exporting={exporting}
          onRefresh={refresh}
          refreshing={
            summary.isFetching ||
            timeseries.isFetching ||
            breakdown.isFetching ||
            performance.isFetching
          }
        />
      }
    />
  );

  if (!ready) {
    return (
      <main
        className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white px-4 py-4 dark:bg-zinc-950"
        data-testid="analytics-page"
      >
        {pageHeader}
        <div className="mt-6">
          <EmptyState
            icon={Clock}
            title="Select a custom range"
            description="Pick both a start and end date to load analytics for that period."
            testId="analytics-custom-prompt"
          />
        </div>
      </main>
    );
  }

  if (summary.isError) {
    return (
      <main
        className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white px-4 py-4 dark:bg-zinc-950"
        data-testid="analytics-page"
      >
        {pageHeader}
        <div className="mt-6">
          <ErrorState
            title="Analytics unavailable"
            message={summary.error instanceof Error ? summary.error.message : "Could not load analytics."}
            onRetry={() => void summary.refetch()}
          />
        </div>
      </main>
    );
  }

  if (summary.isLoading || !kpi) {
    return (
      <main
        className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white px-4 py-4 dark:bg-zinc-950"
        data-testid="analytics-page"
      >
        {pageHeader}
        <div className="mt-10">
          <LoadingState message="Crunching your usage data…" />
        </div>
      </main>
    );
  }

  const empty = Number(kpi.total_requests.value) === 0;

  return (
    <main
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white px-4 py-4 dark:bg-zinc-950"
      data-testid="analytics-page"
    >
      {pageHeader}

      <div className="mt-4 flex flex-col gap-4 pb-10">
        {empty ? (
          <SectionCard id="summary" title="No activity yet" testId="analytics-empty">
            <EmptyState
              icon={BarChart3}
              title="No usage in this range"
              description="Send a message or pick a wider date range to see spend, token and performance analytics."
              action={
                <Button size="sm" variant="outline" className="text-xs" onClick={() => router.push("/")}>
                  Go to chat
                </Button>
              }
            />
          </SectionCard>
        ) : (
          <>
            {/* Insights */}
            {kpi.insights.length > 0 && (
              <section id="insights" className="scroll-mt-4" data-testid="analytics-insights">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {kpi.insights.map((insight) => (
                    <div
                      key={insight.id}
                      className={cn("flex gap-3 rounded-xl border p-3", INSIGHT_STYLES[insight.severity])}
                      data-testid={`insight-${insight.id}`}
                    >
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-tollma-600 dark:text-tollma-400" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{insight.title}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                          {insight.detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* KPI grid */}
            <section
              id="summary"
              className="grid scroll-mt-4 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
              data-testid="analytics-kpis"
            >
              <KpiCard
                label="Total spend"
                value={fmtMoney(kpi.total_spend.value)}
                changePct={kpi.total_spend.change_pct}
                icon={<Wallet className="size-4" />}
                spark={<Sparkline values={points.map((p) => Number(p.spend))} />}
                testId="kpi-spend"
              />
              <KpiCard
                label="Total requests"
                value={fmtNumber(Number(kpi.total_requests.value))}
                changePct={kpi.total_requests.change_pct}
                icon={<Activity className="size-4" />}
                spark={<Sparkline values={points.map((p) => p.requests)} />}
                testId="kpi-requests"
              />
              <KpiCard
                label="Total tokens"
                value={fmtTokens(kpi.total_tokens.value)}
                sub={`${fmtCompactTokens(kpi.prompt_tokens)} prompt · ${fmtCompactTokens(kpi.completion_tokens)} completion`}
                changePct={kpi.total_tokens.change_pct}
                icon={<Hash className="size-4" />}
                spark={<Sparkline values={points.map((p) => p.total_tokens)} />}
                testId="kpi-tokens"
              />
              <KpiCard
                label="Active models"
                value={fmtNumber(kpi.active_models)}
                sub={`${fmtNumber(kpi.active_providers)} active providers`}
                icon={<Boxes className="size-4" />}
                testId="kpi-active-models"
              />
              <KpiCard
                label="Avg cost / request"
                value={fmtMoney(kpi.avg_cost_per_request)}
                sub={`${fmtNumber(kpi.active_conversations)} conversations used`}
                icon={<Coins className="size-4" />}
                testId="kpi-avg-cost"
              />
              <KpiCard
                label="Avg tokens / request"
                value={fmtFloat(kpi.avg_tokens_per_request, 1)}
                icon={<Layers className="size-4" />}
                testId="kpi-avg-tokens"
              />
              <KpiCard
                label="Avg response time"
                value={fmtMs(kpi.avg_response_ms)}
                sub={`First token ${fmtMs(kpi.avg_ttfb_ms)}`}
                icon={<Gauge className="size-4" />}
                testId="kpi-avg-response"
              />
              <KpiCard
                label="Streaming sessions"
                value={fmtNumber(kpi.streaming_sessions)}
                sub={`${fmtNumber(kpi.failed_requests)} failed · ${fmtNumber(kpi.estimated_requests)} estimated`}
                icon={<Zap className="size-4" />}
                testId="kpi-streaming"
              />
              <KpiCard
                label="Run-rate projection"
                value={fmtMoney(kpi.run_rate_projection ?? kpi.projected_month_spend)}
                sub="Run-rate, not a prediction · based on selected-period pace"
                icon={<TrendingUp className="size-4" />}
                testId="kpi-projection"
              />
              <KpiCard
                label="Cache efficiency"
                value={fmtCompactTokens(kpi.cache_read_tokens + kpi.cache_write_tokens)}
                sub={`${fmtCompactTokens(kpi.cache_read_tokens)} read · ${fmtCompactTokens(kpi.cache_write_tokens)} write · ${fmtCompactTokens(kpi.reasoning_tokens)} reasoning`}
                icon={<Sparkles className="size-4" />}
                testId="kpi-cache"
              />
            </section>

            <AnalyticsWidgetsPanel widgets={widgets.data} />

            {/* Spending */}
            <SectionCard
              id="cost"
              title="Spend over time"
              description="Drag across the chart to zoom into a window."
              testId="analytics-section-cost"
              action={
                <div className="flex items-center gap-1">
                  {GRANULARITIES.map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      onClick={() => changeGranularity(g.value)}
                      aria-pressed={activeGranularity === g.value}
                      data-testid={`granularity-${g.value}`}
                      className={cn(
                        "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                        activeGranularity === g.value
                          ? "bg-tollma-600 text-white dark:bg-tollma-500"
                          : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                      )}
                    >
                      {g.label}
                    </button>
                  ))}
                  {zoom && (
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => setZoom(null)} data-testid="zoom-reset">
                      Reset zoom
                    </Button>
                  )}
                </div>
              }
            >
              {timeseries.isLoading ? (
                <LoadingState message="Loading series…" />
              ) : (
                <AreaChart
                  labels={labels}
                  series={spendSeries}
                  valueFormat={fmtMoney}
                  onZoom={(from, to) => setZoom({ from, to })}
                  testId="spend-chart"
                />
              )}
            </SectionCard>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <SectionCard id="cost-providers" title="Provider spend breakdown" testId="analytics-section-providers-split">
                {breakdown.isLoading ? (
                  <LoadingState />
                ) : (
                  <DonutChart
                    slices={providerRows.map((row) => ({ name: row.name, value: Number(row.spend) }))}
                    centerLabel="Total spend"
                    centerValue={fmtMoney(kpi.total_spend.value)}
                    valueFormat={fmtMoney}
                    testId="provider-donut"
                  />
                )}
              </SectionCard>

              <SectionCard id="cost-models" title="Model spend breakdown" testId="analytics-section-models-split">
                {breakdown.isLoading ? (
                  <LoadingState />
                ) : (
                  <BarList
                    items={modelRows.map((row) => ({
                      name: row.name,
                      value: Number(row.spend),
                      hint: `${fmtNumber(row.requests)} req`,
                    }))}
                    valueFormat={fmtMoney}
                    testId="model-spend-list"
                  />
                )}
              </SectionCard>
            </div>

            <SectionCard
              id="cost-conversations"
              title="Top 10 most expensive conversations"
              testId="analytics-top-conversations"
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-800">
                      <th className="py-2 pr-3 font-medium">Conversation</th>
                      <th className="py-2 pr-3 font-medium">Provider</th>
                      <th className="py-2 pr-3 font-medium">Model</th>
                      <th className="py-2 pr-3 text-right font-medium">Cost</th>
                      <th className="py-2 text-right font-medium">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(conversations.data?.most_expensive ?? []).slice(0, 10).map((row) => (
                      <tr
                        key={row.id}
                        className="cursor-pointer border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
                        onClick={() => openConversation(row.id)}
                        data-testid={`top-conversation-${row.id}`}
                      >
                        <td className="max-w-64 truncate py-2 pr-3 font-medium text-zinc-800 dark:text-zinc-200">
                          {row.title}
                        </td>
                        <td className="py-2 pr-3 text-zinc-500 dark:text-zinc-400">{row.provider_name ?? "—"}</td>
                        <td className="py-2 pr-3 text-zinc-500 dark:text-zinc-400">{row.model_name ?? "—"}</td>
                        <td className="py-2 pr-3 text-right font-mono text-zinc-800 dark:text-zinc-200">
                          {fmtMoney(row.spend)}
                        </td>
                        <td className="py-2 text-right font-mono text-zinc-500 dark:text-zinc-400">
                          {fmtTokens(row.tokens)}
                        </td>
                      </tr>
                    ))}
                    {(conversations.data?.most_expensive ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-zinc-400">
                          No conversations in range
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            {/* Usage */}
            <SectionCard id="usage" title="Usage timeline" description="Requests over the selected period." testId="analytics-section-usage">
              {timeseries.isLoading ? (
                <LoadingState />
              ) : (
                <AreaChart
                  labels={labels}
                  series={usageSeries}
                  valueFormat={(v) => fmtNumber(v)}
                  onZoom={(from, to) => setZoom({ from, to })}
                  testId="usage-chart"
                />
              )}
            </SectionCard>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
              <SectionCard
                id="usage-peak"
                title="Peak usage hours"
                description="Requests by weekday and hour of day."
                className="xl:col-span-3"
                testId="analytics-section-heatmap"
              >
                {heatmap.isLoading ? (
                  <LoadingState />
                ) : (
                  <>
                    <Heatmap
                      cells={heatmap.data?.cells ?? []}
                      maxRequests={heatmap.data?.max_requests ?? 0}
                      peak={heatmap.data?.peak}
                      quiet={heatmap.data?.quiet}
                      testId="usage-heatmap"
                    />
                    <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {heatmap.data?.peak && (
                        <span data-testid="heatmap-peak">
                          Most active: <strong className="font-medium">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][heatmap.data.peak.day]}</strong>{" "}
                          {String(heatmap.data.peak.hour).padStart(2, "0")}:00
                        </span>
                      )}
                      {heatmap.data?.quiet && (
                        <span data-testid="heatmap-quiet">
                          Least active: {String(heatmap.data.quiet.hour).padStart(2, "0")}:00 ({heatmap.data.quiet.requests} req)
                        </span>
                      )}
                    </div>
                  </>
                )}
              </SectionCard>

              <SectionCard
                id="usage-requests"
                title="Requests"
                description="Bucketed by the selected granularity."
                className="xl:col-span-2"
                testId="analytics-section-requests"
              >
                {timeseries.isLoading ? (
                  <LoadingState />
                ) : (
                  <BarChart labels={requestBarLabels} values={requestBars} testId="requests-chart" />
                )}
              </SectionCard>
            </div>

            {/* Tokens */}
            <SectionCard
              id="tokens"
              title="Token analytics"
              description="Prompt, completion and cache token flow."
              testId="analytics-section-tokens"
            >
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                {[
                  { label: "Prompt", value: kpi.prompt_tokens, testId: "token-prompt" },
                  { label: "Completion", value: kpi.completion_tokens, testId: "token-completion" },
                  { label: "Cache read", value: kpi.cache_read_tokens, testId: "token-cache-read" },
                  { label: "Cache write", value: kpi.cache_write_tokens, testId: "token-cache-write" },
                  { label: "Reasoning", value: kpi.reasoning_tokens, testId: "token-reasoning" },
                  { label: "Total", value: kpi.total_tokens.value, testId: "token-total" },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-900">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">{item.label}</p>
                    <p className="mt-1 font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100" data-testid={item.testId}>
                      {fmtCompactTokens(item.value)}
                    </p>
                    <p className="text-[10px] text-zinc-400">{fmtTokens(item.value)}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div>
                  {timeseries.isLoading ? (
                    <LoadingState />
                  ) : (
                    <AreaChart
                      labels={labels}
                      series={tokenSeries}
                      valueFormat={(v) => fmtCompactTokens(v)}
                      testId="token-chart"
                    />
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">By provider</p>
                    <BarList
                      items={providerRows.map((row) => ({ name: row.name, value: row.total_tokens }))}
                      valueFormat={(v) => fmtCompactTokens(v)}
                      testId="tokens-provider-list"
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">By model</p>
                    <BarList
                      items={modelRows.map((row) => ({ name: row.name, value: row.total_tokens }))}
                      valueFormat={(v) => fmtCompactTokens(v)}
                      testId="tokens-model-list"
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Performance */}
            <SectionCard
              id="performance"
              title="Performance"
              description="Latency, response size and reasoning duration."
              testId="analytics-section-performance"
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                <KpiCard label="First token" value={fmtMs(perf?.avg_ttfb_ms)} testId="perf-ttfb" />
                <KpiCard label="Completion" value={fmtMs(perf?.avg_completion_ms)} testId="perf-completion" />
                <KpiCard label="Stream duration" value={fmtMs(perf?.avg_stream_duration_ms)} testId="perf-stream" />
                <KpiCard label="Avg response length" value={`${fmtNumber(Math.round(perf?.avg_response_chars ?? 0))} chars`} testId="perf-length" />
                <KpiCard label="Avg thinking" value={fmtMs(perf?.avg_thinking_ms)} testId="perf-thinking" />
                <KpiCard
                  label="Tool calls / request"
                  value={perf?.avg_tool_calls_per_request === null ? "Not tracked" : fmtFloat(perf?.avg_tool_calls_per_request ?? 0, 2)}
                  sub={perf?.avg_tool_calls_per_request === null ? "Tool use is not persisted yet" : undefined}
                  testId="perf-tools"
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-900">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Latency by model</p>
                    {perf?.fastest_model && (
                      <Badge variant="success" className="px-1.5 py-0 text-[9px]">
                        Fastest: {perf.fastest_model.name} · {fmtMs(perf.fastest_model.avg_latency_ms)}
                      </Badge>
                    )}
                  </div>
                  <BarList
                    items={(perf?.by_model ?? [])
                      .filter((row) => row.avg_latency_ms !== null)
                      .map((row) => ({ name: row.name, value: row.avg_latency_ms ?? 0, hint: `${fmtNumber(row.requests)} req` }))}
                    valueFormat={(v) => fmtMs(v)}
                    testId="latency-model-list"
                  />
                  {perf?.slowest_model && (
                    <p className="mt-2 text-[10px] text-zinc-400" data-testid="slowest-model">
                      Slowest: {perf.slowest_model.name} · {fmtMs(perf.slowest_model.avg_latency_ms)}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-900">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Latency by provider
                  </p>
                  <BarList
                    items={(perf?.by_provider ?? [])
                      .filter((row) => row.avg_latency_ms !== null)
                      .map((row) => ({
                        name: row.name,
                        value: row.avg_latency_ms ?? 0,
                        hint: `TTFB ${fmtMs(row.avg_ttfb_ms)}`,
                      }))}
                    valueFormat={(v) => fmtMs(v)}
                    testId="latency-provider-list"
                  />
                </div>
              </div>
            </SectionCard>

            {/* Models */}
            <SectionCard
              id="models"
              title="Model analytics"
              description="Per-model spend, usage, and reliability. Ranked by the backend."
              testId="analytics-section-models"
              action={
                <Select
                  value={modelSort}
                  onChange={(e) => setModelSort(e.target.value as ModelSort)}
                  sizeVariant="sm"
                  aria-label="Model ranking"
                  data-testid="model-sort"
                  className="w-36 text-xs"
                >
                  {MODEL_SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              }
            >
              {models.isLoading ? <LoadingState /> : <ModelsTable rows={models.data?.models ?? []} />}
            </SectionCard>

            {/* Providers */}
            <SectionCard
              id="providers"
              title="Provider analytics"
              description="Spend, traffic, latency and error rates per provider."
              testId="analytics-section-providers"
            >
              {breakdown.isLoading ? <LoadingState /> : <ProvidersTable rows={providerRows} />}
            </SectionCard>

            {/* Conversations */}
            <SectionCard
              id="conversations"
              title="Conversation analytics"
              description="Where your usage concentrates."
              testId="analytics-section-conversations"
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                <ConversationRankList
                  title="Most active"
                  rows={conversations.data?.most_active ?? []}
                  metric={(row) => `${row.messages} msgs`}
                  onOpen={(row) => openConversation(row.id)}
                  testId="rank-active"
                />
                <ConversationRankList
                  title="Longest"
                  rows={conversations.data?.longest ?? []}
                  metric={(row) => `${row.user_messages} prompts`}
                  onOpen={(row) => openConversation(row.id)}
                  testId="rank-longest"
                />
                <ConversationRankList
                  title="Most expensive"
                  rows={conversations.data?.most_expensive ?? []}
                  metric={(row) => fmtMoney(row.spend)}
                  onOpen={(row) => openConversation(row.id)}
                  testId="rank-expensive"
                />
                <ConversationRankList
                  title="Largest context"
                  rows={conversations.data?.largest_context ?? []}
                  metric={(row) => `${fmtCompactTokens(row.max_context_tokens)} ctx`}
                  onOpen={(row) => openConversation(row.id)}
                  testId="rank-context"
                />
                <ConversationRankList
                  title="Highest tokens"
                  rows={conversations.data?.highest_tokens ?? []}
                  metric={(row) => fmtTokens(row.tokens)}
                  onOpen={(row) => openConversation(row.id)}
                  testId="rank-tokens"
                />
                <div className="rounded-lg border border-dashed border-zinc-200 p-4 dark:border-zinc-800">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    <Cpu className="size-3.5" /> Exports
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                    Every dataset on this page can be exported as CSV or JSON from the toolbar above. Compute happens
                    server-side for PDF-ready pipelines.
                  </p>
                </div>
              </div>
            </SectionCard>

            <p className="text-center text-[10px] text-zinc-400">
              {fmtPct(kpi.total_spend.change_pct)} spend · {fmtPct(kpi.total_requests.change_pct)} requests vs previous
              period · {timezone}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
