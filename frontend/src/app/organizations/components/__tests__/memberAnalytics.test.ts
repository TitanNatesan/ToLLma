import { describe, expect, it } from "vitest";
import { normalizeMemberAnalytics } from "@/services/orgs";

describe("normalizeMemberAnalytics", () => {
  it("passes the canonical contract through", () => {
    const out = normalizeMemberAnalytics({
      requests: 10,
      succeeded: 8,
      failed: 1,
      blocked: 1,
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      cache_read_tokens: 20,
      cache_write_tokens: 5,
      total_cost: "1.25",
      avg_cost_per_request: "0.125",
      by_model: [{ model: "gpt-4", requests: 6, tokens: 90, cost: "1.00" }],
      by_provider: [{ provider: "openai", requests: 10, tokens: 150, cost: "1.25" }],
      by_key: [{ key_id: "k1", key_name: "prod", requests: 10, tokens: 150, cost: "1.25" }],
      trend: [{ bucket: "2026-10-01", requests: 4, tokens: 60, cost: "0.5" }],
      last_activity: "2026-10-20T00:00:00Z",
      last_model: "gpt-4",
      last_key: "prod",
    });
    expect(out.requests).toBe(10);
    expect(out.total_cost).toBe(1.25);
    expect(out.by_model).toHaveLength(1);
    expect(out.by_key[0]).toEqual({ key_id: "k1", key_name: "prod", requests: 10, tokens: 150, cost: 1.25 });
    expect(out.trend[0].bucket).toBe("2026-10-01");
    expect(out.last_activity).toBe("2026-10-20T00:00:00Z");
  });

  it("degrades to empty breakdowns and nulls on partial/older backends", () => {
    const out = normalizeMemberAnalytics({ requests: 3 });
    expect(out.requests).toBe(3);
    expect(out.succeeded).toBeNull();
    expect(out.total_cost).toBeNull();
    expect(out.by_model).toEqual([]);
    expect(out.by_provider).toEqual([]);
    expect(out.by_key).toEqual([]);
    expect(out.trend).toEqual([]);
    expect(out.last_activity).toBeNull();
  });

  it("never throws on garbage and coerces numeric strings", () => {
    const out = normalizeMemberAnalytics(null);
    expect(out.by_model).toEqual([]);
    const bad = normalizeMemberAnalytics({
      requests: "nope",
      total_cost: "abc",
      by_model: [{ model: 42, requests: "x", tokens: null, cost: {} }],
      by_key: [{ key_id: 7, key_name: 9 }],
      trend: [{ bucket: 5 }],
    });
    expect(bad.requests).toBeNull();
    expect(bad.total_cost).toBeNull();
    expect(bad.by_model[0].model).toBe("—");
    expect(bad.by_key).toEqual([]);
    expect(bad.trend).toEqual([]);
  });

  it("never surfaces key secrets — names/ids only", () => {
    const out = normalizeMemberAnalytics({
      by_key: [{ key_id: "k1", key_name: "prod", raw_key: "sk-secret", secret: "sk-secret" }],
    });
    expect(out.by_key[0]).not.toHaveProperty("raw_key");
    expect(out.by_key[0]).not.toHaveProperty("secret");
    expect(JSON.stringify(out)).not.toContain("sk-secret");
  });
});
