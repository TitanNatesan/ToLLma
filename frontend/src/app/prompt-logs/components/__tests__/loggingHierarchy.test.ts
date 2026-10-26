import { describe, expect, it } from "vitest";
import { normalizeLoggingSettings } from "@/services/promptLogs";
import {
  GLOBAL_MANDATORY_COPY,
  buildKeyLoggingPayload,
  buildTeamLoggingPayload,
  defaultKeyLoggingEnabled,
  defaultTeamLoggingEnabled,
  formatEffectiveSummaryWithStates,
  isGlobalLoggingLocked,
  resolveKeyLogging,
  resolveTeamLogging,
  scopeBadgeLabel,
  scopeEffectiveLine,
  validateHierarchicalStates,
} from "../promptLogLogic";

const base = {
  enabled: true,
  mode: "teams",
  team_ids: ["t1"],
  key_ids: ["k1"],
  team_states: {} as Record<string, boolean>,
  key_states: {} as Record<string, boolean | null>,
};

describe("global lock", () => {
  it("locks only when enabled AND mode is global", () => {
    expect(isGlobalLoggingLocked({ enabled: true, mode: "global" })).toBe(true);
    expect(isGlobalLoggingLocked({ enabled: false, mode: "global" })).toBe(false);
    expect(isGlobalLoggingLocked({ enabled: true, mode: "teams" })).toBe(false);
  });
  it("mandatory copy names global scope and locked overrides", () => {
    expect(GLOBAL_MANDATORY_COPY).toMatch(/global/i);
    expect(GLOBAL_MANDATORY_COPY).toMatch(/lock/i);
  });
});

describe("workspace defaults", () => {
  it("teams inherit the legacy targeting rule", () => {
    expect(defaultTeamLoggingEnabled(base, "t1")).toBe(true);
    expect(defaultTeamLoggingEnabled(base, "t9")).toBe(false);
    expect(defaultTeamLoggingEnabled({ ...base, enabled: false }, "t1")).toBe(false);
    expect(defaultTeamLoggingEnabled({ ...base, mode: "global" }, "t9")).toBe(true);
  });
  it("keys match directly or through their teams (OR)", () => {
    expect(defaultKeyLoggingEnabled(base, "k1", [])).toBe(true);
    expect(defaultKeyLoggingEnabled(base, "k9", ["t1"])).toBe(true);
    expect(defaultKeyLoggingEnabled(base, "k9", ["t9"])).toBe(false);
    expect(defaultKeyLoggingEnabled({ ...base, mode: "global" }, "k9", [])).toBe(true);
  });
});

describe("resolveTeamLogging", () => {
  it("locks ON under global", () => {
    const v = resolveTeamLogging({ ...base, mode: "global" }, "t9");
    expect(v).toMatchObject({ effective: true, locked: true, source: "Global policy" });
  });
  it("prefers the explicit override", () => {
    expect(resolveTeamLogging({ ...base, team_states: { t9: true } }, "t9").effective).toBe(true);
    expect(resolveTeamLogging({ ...base, team_states: { t1: false } }, "t1")).toMatchObject({
      effective: false,
      locked: false,
      source: "Team override",
    });
  });
  it("inherits the workspace default otherwise", () => {
    const v = resolveTeamLogging(base, "t9");
    expect(v).toMatchObject({ explicit: null, effective: false, source: "Workspace default" });
    expect(resolveTeamLogging(base, "t1").effective).toBe(true);
  });
});

describe("resolveKeyLogging", () => {
  it("locks ON under global", () => {
    const v = resolveKeyLogging({ ...base, mode: "global" }, "k9", ["t9"]);
    expect(v).toMatchObject({ effective: true, locked: true });
  });
  it("prefers the explicit key override both ways", () => {
    const on = resolveKeyLogging({ ...base, key_states: { k9: true } }, "k9", []);
    expect(on).toMatchObject({ explicit: true, effective: true, source: "Key override" });
    const off = resolveKeyLogging({ ...base, key_states: { k1: false } }, "k1", ["t1"]);
    expect(off).toMatchObject({ explicit: false, effective: false, source: "Key override" });
  });
  it("an explicit team ON logs the key; team OFFs do not veto a listed key", () => {
    const s = { ...base, team_states: { t1: true } };
    expect(resolveKeyLogging(s, "k9", ["t1"])).toMatchObject({ effective: true, source: "Team override" });
    const off = { ...base, team_states: { t1: false } };
    // Listed-live key target captures even when every team state is off/disabled
    // (backend match_source="key").
    expect(resolveKeyLogging(off, "k1", ["t1"])).toMatchObject({ effective: true, source: "Workspace default" });
    expect(resolveKeyLogging(off, "k9", ["t1"])).toMatchObject({ effective: false, source: "Team override" });
    expect(resolveKeyLogging(off, "k9", ["t2"])).toMatchObject({ effective: false, source: "Workspace default" });
  });
  it("null resets to inherit", () => {
    const v = resolveKeyLogging({ ...base, key_states: { k1: null } }, "k1", []);
    expect(v.explicit).toBeNull();
    expect(v.effective).toBe(true);
  });
  it("ignores garbage override values", () => {
    const v = resolveKeyLogging({ ...base, key_states: { k9: "yes" as unknown as boolean } }, "k9", []);
    expect(v.explicit).toBeNull();
  });
});

describe("validation + payloads", () => {
  it("rejects global ON with any explicit disable (the 422 case)", () => {
    expect(
      validateHierarchicalStates({ enabled: true, mode: "global", team_states: { t1: false } }),
    ).toMatch(/global/i);
    expect(
      validateHierarchicalStates({ enabled: true, mode: "global", key_states: { k1: false } }),
    ).toMatch(/global/i);
    expect(validateHierarchicalStates({ enabled: true, mode: "global", team_states: { t1: true } })).toBeNull();
    expect(validateHierarchicalStates({ enabled: true, mode: "teams", team_states: { t1: false } })).toBeNull();
    expect(validateHierarchicalStates({ enabled: false, mode: "global" })).toBeNull();
  });
  it("builds the granular endpoint bodies", () => {
    expect(buildTeamLoggingPayload(true)).toEqual({ enabled: true });
    expect(buildTeamLoggingPayload(false)).toEqual({ enabled: false });
    expect(buildKeyLoggingPayload(null)).toEqual({ enabled: null });
    expect(buildKeyLoggingPayload(false)).toEqual({ enabled: false });
  });
});

describe("effective-state copy", () => {
  it("renders locked / inherited / override lines", () => {
    expect(scopeEffectiveLine({ explicit: null, effective: true, locked: true, source: "Global policy" })).toMatch(/locked/i);
    expect(
      scopeEffectiveLine({ explicit: null, effective: false, locked: false, source: "Workspace default" }),
    ).toMatch(/inherited/i);
    expect(scopeEffectiveLine({ explicit: true, effective: true, locked: false, source: "Key override" })).toMatch(/key override/i);
    expect(scopeBadgeLabel({ explicit: null, effective: true, locked: true, source: "x" })).toBe("ON");
    expect(scopeBadgeLabel({ explicit: false, effective: false, locked: false, source: "x" })).toBe("OFF");
  });
  it("extends the summary line additively (older backends unchanged)", () => {
    const s = normalizeLoggingSettings({ enabled: true, mode: "global" });
    expect(formatEffectiveSummaryWithStates("All logs on", undefined)).toBe("All logs on");
    expect(formatEffectiveSummaryWithStates("All logs on", s)).toBe("All logs on · locked by global");
    const withStates = normalizeLoggingSettings({
      enabled: true,
      mode: "global",
      team_states: { t1: true, t2: false },
      key_states: { k1: null },
    });
    const out = formatEffectiveSummaryWithStates("All logs on", withStates);
    expect(out).toContain("2 team overrides");
    expect(out).toContain("1 key override");
    expect(out).toContain("locked by global");
  });
  it("normalizes states defensively (older backends, garbage)", () => {
    const s = normalizeLoggingSettings({ enabled: true, mode: "teams" });
    expect(s.team_states).toEqual({});
    expect(s.key_states).toEqual({});
    const g = normalizeLoggingSettings({ team_states: { t1: "yes", t2: true }, key_states: { k1: 0, k2: false } });
    expect(g.team_states).toEqual({ t2: true });
    expect(g.key_states).toEqual({ k2: false });
  });
});
