import { describe, expect, it } from "vitest";
import { normalizeBenchmarkRun, type BenchmarkRun } from "@/services/benchmarks";
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
} from "../benchmarkLogic";

const run = (overrides: Partial<BenchmarkRun> = {}): BenchmarkRun => ({
  id: "run-1",
  name: "baseline",
  traffic_path: "/v1/chat",
  provider_label: "Acme",
  model_label: "model-x",
  logging_mode: "global",
  cache_state: "hit",
  conditions: {},
  n: 50,
  errors: 0,
  mean_ms: 1200,
  p50_ms: 1100,
  p95_ms: 2100,
  p99_ms: 3400,
  ttft_mean_ms: 320,
  ttft_p50_ms: 300,
  prompt_tokens: 1000,
  completion_tokens: 500,
  cache_read: 400,
  cache_write: 100,
  total_cost: "0.012",
  notes: "evening run",
  created_at: "2026-10-26T10:00:00Z",
  ...overrides,
});

describe("formatters", () => {
  it("formats millis honestly (N/A, ms, seconds)", () => {
    expect(formatBenchMs(null)).toBe("N/A");
    expect(formatBenchMs(Number.NaN)).toBe("N/A");
    expect(formatBenchMs(723)).toBe("723ms");
    expect(formatBenchMs(4800)).toBe("4.8s");
  });
  it("never renders $0 for missing cost", () => {
    expect(formatBenchCost(null)).toBe("N/A");
    expect(formatBenchCost("")).toBe("N/A");
    expect(formatBenchCost("0.012")).toBe("$0.012");
  });
  it("formats tokens and counts honestly", () => {
    expect(formatBenchTokens(null)).toBe("N/A");
    expect(formatBenchTokens(1500)).toBe("1,500");
    expect(formatBenchCount(null)).toBe("N/A");
    expect(formatBenchCount(7)).toBe("7");
  });
});

describe("normalizer", () => {
  it("drops id-less rows and fills legacy variance", () => {
    expect(normalizeBenchmarkRun(null)).toBeNull();
    expect(normalizeBenchmarkRun({})).toBeNull();
    const r = normalizeBenchmarkRun({ id: "a", p50: 42, name: "x", cost: 0.5, requests: 12 });
    expect(r).toMatchObject({ id: "a", p50_ms: 42, n: 12, total_cost: "0.5" });
  });
  it("keeps canonical fields and never carries prompt bodies", () => {
    const r = normalizeBenchmarkRun({ id: "a", name: "x", input_text: "secret", output_text: "secret" });
    expect(r).not.toHaveProperty("input_text");
    expect(r).not.toHaveProperty("output_text");
  });
});

describe("data honesty", () => {
  it("flags thin samples and metric-less runs", () => {
    expect(benchmarkDataState(run())).toBe("ok");
    expect(benchmarkDataState(run({ n: 3 }))).toBe("insufficient-data");
    expect(benchmarkDataState(run({ mean_ms: null, p50_ms: null, p95_ms: null, p99_ms: null, ttft_mean_ms: null, ttft_p50_ms: null }))).toBe("no-metrics");
    expect(benchmarkStateLabel("insufficient-data")).toMatch(/insufficient/i);
    expect(benchmarkStateLabel("no-metrics")).toMatch(/no metrics/i);
  });
  it("labels cache states, unknown degrades to the raw value or N/A", () => {
    expect(describeCacheState("hit")).toBe("hit");
    expect(describeCacheState("unsupported")).toBe("Unsupported");
    expect(describeCacheState(null)).toBe("N/A");
  });
  it("explains cache savings or admits N/A", () => {
    expect(benchmarkSavingsExplanation(run())).toMatch(/40\.0%/);
    expect(benchmarkSavingsExplanation(run({ cache_read: 0, cache_write: 0 }))).toMatch(/N\/A/);
    expect(benchmarkSavingsExplanation(run({ cache_read: 0, cache_write: 50, prompt_tokens: 1000 }))).toMatch(/warmed/i);
  });
  it("skips p50-less runs in the comparison bars", () => {
    expect(benchmarkP50Bars([run(), run({ id: "b", name: "thin", p50_ms: null })])).toHaveLength(1);
  });
  it("renders conditions as display rows", () => {
    expect(formatBenchmarkConditions({ temp: 0.2, stream: true })).toEqual([
      { key: "temp", value: "0.2" },
      { key: "stream", value: "true" },
    ]);
    expect(formatBenchmarkConditions({})).toEqual([]);
  });
});

describe("labeling copy", () => {
  it("disclaims guarantees and separates benchmarks from live traffic", () => {
    expect(BENCHMARK_DISCLAIMER).toMatch(/not a guarantee/i);
    expect(BENCHMARK_VS_LIVE_COPY).toMatch(/live/i);
  });
});
