/**
 * Pure benchmark-run helpers: honest-state formatting, data sufficiency,
 * cache-savings explanations, and BarList shaping. No JSX — covered by
 * colocated vitest. No prompt bodies ever flow through here (conditions,
 * notes, and labels only).
 */

import type { BenchmarkRun } from "@/services/benchmarks";
import { fmtCost, fmtTokens } from "@/lib/utils";

/** Below this sample count a run is directionally useful at best. */
export const MIN_BENCHMARK_N = 10;

/** Controlled-run disclaimer shown above every benchmark surface. */
export const BENCHMARK_DISCLAIMER =
  "Controlled benchmark, not a guarantee: figures come from scripted tooling runs under fixed conditions, not live traffic. Treat them as relative comparisons, not production promises.";

/** Live-production vs benchmark distinction for the drawer header. */
export const BENCHMARK_VS_LIVE_COPY =
  "Benchmarks replay fixed prompts off the live path; live-production latency, cache, and cost for this conversation appear in Model Intelligence.";

/** Missing metric — honest N/A, never a zero that looks measured. */
export function formatBenchMs(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  return `${Math.round(v)}ms`;
}

export function formatBenchCost(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "N/A";
  return fmtCost(v);
}

export function formatBenchTokens(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  return fmtTokens(v);
}

export function formatBenchCount(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  return String(Math.max(0, Math.floor(v)));
}

/** Data honesty for one run: thin samples and metric-less runs are labeled. */
export type BenchmarkDataState = "ok" | "insufficient-data" | "no-metrics";

export function benchmarkDataState(run: BenchmarkRun): BenchmarkDataState {
  const latencies = [run.mean_ms, run.p50_ms, run.p95_ms, run.p99_ms, run.ttft_mean_ms, run.ttft_p50_ms];
  if (!latencies.some((v) => typeof v === "number" && Number.isFinite(v))) return "no-metrics";
  if ((run.n ?? 0) < MIN_BENCHMARK_N) return "insufficient-data";
  return "ok";
}

export function benchmarkStateLabel(state: BenchmarkDataState): string {
  switch (state) {
    case "ok":
      return "Measured";
    case "insufficient-data":
      return `Insufficient data (n < ${MIN_BENCHMARK_N})`;
    case "no-metrics":
      return "No metrics";
  }
}

/** Cache-state display: known states label, anything else is N/A. */
export function describeCacheState(cacheState: string | null | undefined): string {
  if (!cacheState) return "N/A";
  const c = cacheState.trim().toLowerCase();
  if (c === "hit" || c === "miss" || c === "mixed" || c === "disabled" || c === "unsupported") {
    return c === "unsupported" ? "Unsupported" : cacheState.trim();
  }
  return cacheState.trim() || "N/A";
}

/**
 * Cache-savings explanation for the detail view: share of prompt tokens
 * served from cache, or an honest N/A when the run recorded no cache data.
 */
export function benchmarkSavingsExplanation(run: BenchmarkRun): string {
  const read = run.cache_read ?? 0;
  const prompt = run.prompt_tokens ?? 0;
  if (read > 0 && prompt > 0) {
    const pct = Math.min(100, (read / prompt) * 100);
    return `${fmtTokens(read)} of ${fmtTokens(prompt)} prompt tokens served from cache (${pct.toFixed(1)}%) — estimated savings vs. full input price.`;
  }
  if ((run.cache_write ?? 0) > 0) {
    return "This run warmed the cache (writes recorded) but served nothing from it — savings N/A.";
  }
  return "No cache activity recorded in this run — savings N/A.";
}

/** p50 comparison bars: runs without a p50 are skipped (never plotted as 0). */
export function benchmarkP50Bars(runs: BenchmarkRun[]): Array<{ name: string; value: number; hint?: string }> {
  return runs
    .filter((r) => typeof r.p50_ms === "number" && Number.isFinite(r.p50_ms as number))
    .map((r) => ({ name: r.name, value: r.p50_ms as number, hint: r.model_label ?? undefined }));
}

/** Conditions dict -> display rows (unknown shapes degrade to a count). */
export function formatBenchmarkConditions(conditions: BenchmarkRun["conditions"]): Array<{ key: string; value: string }> {
  return Object.entries(conditions ?? {}).map(([key, v]) => ({
    key,
    value: typeof v === "string" ? v : JSON.stringify(v) ?? "—",
  }));
}
