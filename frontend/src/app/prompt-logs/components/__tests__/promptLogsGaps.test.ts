import { describe, expect, it } from "vitest";
import {
  EMPTY_LOG_FILTER,
  LOG_FILTER_KEYS,
  filterFromParams,
  filterToParams,
  formatDurationMs,
  formatEffectiveSummary,
  getLogKeyDisplay,
  getLogModelDisplay,
  getLogProviderDisplay,
  getLogUserDisplay,
  promptLogStatusVariant,
  shortId,
  shortRequestId,
  tabFromParam,
  type LogFilter,
} from "../promptLogLogic";

describe("URL filter sync round-trip", () => {
  const full: LogFilter = {
    user_id: "u1",
    key_id: "k1",
    team_id: "t1",
    provider_id: "p1",
    model_id: "m1",
    status: "completed",
    q: "req-1",
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-02T00:00:00.000Z",
  };

  it("round-trips every filter key through URL params", () => {
    const params = filterToParams(full);
    expect(Object.keys(params).sort()).toEqual([...LOG_FILTER_KEYS].sort());
    const back = filterFromParams((key) => params[key] ?? null);
    expect(back).toEqual(full);
  });

  it("omits blanks so empty filters leave a clean URL", () => {
    expect(filterToParams(EMPTY_LOG_FILTER)).toEqual({});
    expect(filterFromParams(() => null)).toEqual(EMPTY_LOG_FILTER);
  });

  it("drops unknown statuses instead of sending them to the server", () => {
    expect(filterFromParams((key) => (key === "status" ? "bogus" : null)).status).toBe("");
    expect(filterFromParams((key) => (key === "status" ? "failed" : null)).status).toBe("failed");
  });
});

describe("formatEffectiveSummary", () => {
  it("handles nullish and legacy string summaries", () => {
    expect(formatEffectiveSummary(null)).toBe("");
    expect(formatEffectiveSummary(undefined)).toBe("");
    expect(formatEffectiveSummary("All logs on")).toBe("All logs on");
  });

  it("renders the standard enabled dict as one line", () => {
    expect(
      formatEffectiveSummary({ enabled: true, capture: "full", scope: "all", retention_days: 90 }),
    ).toBe("Logging enabled · full capture · scope: all · retention 90d");
    expect(
      formatEffectiveSummary({ enabled: false, capture: "none", scope: "all", retention_days: 30 }),
    ).toBe("Logging disabled · none capture · scope: all · retention 30d");
  });

  it("renders team-scope counts with singular/plural", () => {
    expect(
      formatEffectiveSummary({ enabled: true, capture: "input", scope: { teams: 2 }, retention_days: 7 }),
    ).toContain("scope: 2 teams");
    expect(
      formatEffectiveSummary({ enabled: true, capture: "input", scope: { teams: 1 }, retention_days: 7 }),
    ).toContain("scope: 1 team");
  });

  it("never emits [object Object] for unknown shapes", () => {
    const out = formatEffectiveSummary({ weird: { nested: true }, n: 3 });
    expect(out).not.toContain("[object Object]");
    expect(out).toContain("weird:");
    expect(formatEffectiveSummary(["a", "b"])).toBe("a,b");
  });
});

describe("normalizer fallbacks", () => {
  it("prefers key names, then ids, then an em dash", () => {
    expect(getLogKeyDisplay({ key_name: "prod", key_id: "k1", api_key_id: "a1" })).toBe("prod");
    expect(getLogKeyDisplay({ key_id: "k123456789" })).toBe("k1234567");
    expect(getLogKeyDisplay({ api_key_id: "a123456789" })).toBe("a1234567");
    expect(getLogKeyDisplay({})).toBe("—");
    expect(getLogKeyDisplay({ key_name: null, key_id: null, api_key_id: null })).toBe("—");
  });

  it("shortens ids and request ids, null-safe", () => {
    expect(shortId("abcdef123456")).toBe("abcdef12");
    expect(shortId(null)).toBe("—");
    expect(shortId(undefined)).toBe("—");
    expect(shortRequestId("abcdef123456")).toBe("abcdef12…");
    expect(shortRequestId(null)).toBeNull();
  });

  it("maps known statuses, stays neutral otherwise", () => {
    expect(promptLogStatusVariant("completed")).toBe("success");
    expect(promptLogStatusVariant("failed")).toBe("destructive");
    expect(promptLogStatusVariant("cancelled")).toBe("warning");
    expect(promptLogStatusVariant("partial")).toBe("outline");
    expect(promptLogStatusVariant("whatever")).toBe("secondary");
  });

  it("defaults tabs to logs", () => {
    expect(tabFromParam("settings")).toBe("settings");
    expect(tabFromParam(null)).toBe("logs");
    expect(tabFromParam("bogus")).toBe("logs");
  });
});

describe("log display fallbacks (backend names deploying in parallel)", () => {
  it("prefers user email, then short id, then an em dash", () => {
    expect(getLogUserDisplay({ user_email: "a@x.com", user_id: "u123456789" })).toBe("a@x.com");
    expect(getLogUserDisplay({ user_email: "", user_id: "u123456789" })).toBe("u1234567");
    expect(getLogUserDisplay({ user_id: "u123456789" })).toBe("u1234567");
    expect(getLogUserDisplay({})).toBe("—");
    expect(getLogUserDisplay({ user_email: null, user_id: null })).toBe("—");
  });

  it("prefers provider/model names, then short ids", () => {
    expect(getLogProviderDisplay({ provider_name: "OpenAI", provider_id: "p123456789" })).toBe("OpenAI");
    expect(getLogProviderDisplay({ provider_id: "p123456789" })).toBe("p1234567");
    expect(getLogProviderDisplay({})).toBe("—");
    expect(getLogModelDisplay({ model_name: "gpt-4", model_id: "m123456789" })).toBe("gpt-4");
    expect(getLogModelDisplay({ model_id: "m123456789" })).toBe("m1234567");
    expect(getLogModelDisplay({})).toBe("—");
  });
});

describe("formatDurationMs", () => {
  it("renders sub-second durations as whole milliseconds", () => {
    expect(formatDurationMs(723)).toBe("723ms");
    expect(formatDurationMs(0)).toBe("0ms");
    expect(formatDurationMs(999.6)).toBe("1000ms");
  });
  it("renders >=1s with one decimal in seconds", () => {
    expect(formatDurationMs(1000)).toBe("1.0s");
    expect(formatDurationMs(4800)).toBe("4.8s");
  });
  it("degrades nullish/non-finite to an em dash", () => {
    expect(formatDurationMs(null)).toBe("—");
    expect(formatDurationMs(undefined)).toBe("—");
    expect(formatDurationMs(NaN)).toBe("—");
  });
});
