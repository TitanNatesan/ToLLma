import { describe, expect, it } from "vitest";
import { normalizeLogDetail, normalizeLogRow } from "@/services/promptLogs";
import {
  EMPTY_LOG_FILTER,
  buildLogQuery,
  filterFromParams,
  filterToParams,
  formatCost,
  hasPricedCost,
  scoreValueLabel,
  totalTokensOf,
  validateScoreForm,
} from "../promptLogLogic";

describe("observability filters", () => {
  it("round-trips trace/session/level/cost/token filters through URL params", () => {
    const f = {
      ...EMPTY_LOG_FILTER,
      trace_id: "tr-1",
      session_key: "sess-1",
      level: "warning",
      min_cost: "0.01",
      max_cost: "2",
      min_tokens: "5",
      max_tokens: "500",
    };
    const params = filterToParams(f);
    expect(filterFromParams((k) => params[k] ?? null)).toEqual(f);
    expect(buildLogQuery(f)).toMatchObject({
      trace_id: "tr-1",
      session_key: "sess-1",
      level: "warning",
      min_cost: "0.01",
      max_cost: "2",
      min_tokens: "5",
      max_tokens: "500",
    });
  });
  it("drops unknown levels like unknown statuses", () => {
    expect(filterFromParams((k) => (k === "level" ? "bogus" : null)).level).toBe("");
    expect(filterFromParams((k) => (k === "level" ? "error" : null)).level).toBe("error");
  });
});

describe("formatCost", () => {
  it("renders unpriced for NULL/empty, never $0.00", () => {
    expect(formatCost(null)).toBe("unpriced");
    expect(formatCost(undefined)).toBe("unpriced");
    expect(formatCost("")).toBe("unpriced");
    expect(formatCost("  ")).toBe("unpriced");
    expect(hasPricedCost(null)).toBe(false);
    expect(hasPricedCost("0.001")).toBe(true);
  });
  it("keeps sub-cent precision with currency", () => {
    expect(formatCost("0.0000123", "USD")).toBe("0.000012 USD");
    expect(formatCost(0.5, "USD")).toBe("0.5 USD");
    expect(formatCost("1.234", null)).toBe("1.23");
  });
});

describe("totalTokensOf", () => {
  it("prefers backend totals, falls back to prompt+completion", () => {
    expect(totalTokensOf({ total_tokens: 42, prompt_tokens: 10, completion_tokens: 5 })).toBe(42);
    expect(totalTokensOf({ prompt_tokens: 10, completion_tokens: 5 })).toBe(15);
    expect(totalTokensOf({})).toBeNull();
  });
});

describe("score form", () => {
  it("requires a name and a type-appropriate value", () => {
    expect(validateScoreForm({ name: "", data_type: "numeric", value: "1", comment: "" })).toMatch(/name/i);
    expect(validateScoreForm({ name: "q", data_type: "numeric", value: "", comment: "" })).toMatch(/numeric/i);
    expect(validateScoreForm({ name: "q", data_type: "numeric", value: "abc", comment: "" })).toMatch(/number/i);
    expect(validateScoreForm({ name: "q", data_type: "categorical", value: "", comment: "" })).toMatch(/value/i);
    expect(validateScoreForm({ name: "q", data_type: "boolean", value: "true", comment: "" })).toBeNull();
    expect(validateScoreForm({ name: "q", data_type: "numeric", value: "4.5", comment: "" })).toBeNull();
  });
  it("labels numeric from value_num, rest from value_text", () => {
    expect(scoreValueLabel({ data_type: "numeric", value_num: "4.5", value_text: null })).toBe("4.5");
    expect(scoreValueLabel({ data_type: "categorical", value_num: null, value_text: "good" })).toBe("good");
  });
});

describe("observability normalizers", () => {
  it("normalizes cost/trace/usage columns, NULL-safe on legacy rows", () => {
    const row = normalizeLogRow({
      id: "a",
      total_cost: "0.001",
      currency: "USD",
      usage_estimated: true,
      total_tokens: 100,
      trace_id: "tr-1",
      level: "info",
    });
    expect(row.total_cost).toBe("0.001");
    expect(row.currency).toBe("USD");
    expect(row.usage_estimated).toBe(true);
    expect(row.trace_id).toBe("tr-1");
    const legacy = normalizeLogRow({ id: "b" });
    expect(legacy.total_cost).toBeNull();
    expect(legacy.trace_id).toBeNull();
    expect(legacy.usage_estimated).toBeNull();
  });
  it("keeps Decimal numbers and model_params dicts", () => {
    const d = normalizeLogDetail({ id: "c", total_cost: 0.002, model_params: { temp: 0.7 } });
    expect(d.total_cost).toBe("0.002");
    expect(d.model_params).toEqual({ temp: 0.7 });
    expect(normalizeLogDetail({ id: "d", model_params: ["x"] }).model_params).toBeNull();
  });
});
