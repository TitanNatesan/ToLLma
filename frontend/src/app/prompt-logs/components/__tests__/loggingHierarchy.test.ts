import { describe, expect, it } from "vitest";
import { KEY_TARGET_MODE, normalizeLoggingSettings } from "@/services/promptLogs";
import {
  GLOBAL_MANDATORY_COPY,
  buildKeyLoggingPayload,
  defaultKeyLoggingEnabled,
  formatEffectiveSummaryWithStates,
  isGlobalLoggingLocked,
  resolveKeyLogging,
  scopeBadgeLabel,
  scopeEffectiveLine,
  validateHierarchicalStates,
} from "../promptLogLogic";

const base = {
  enabled: true,
  mode: KEY_TARGET_MODE,
  key_ids: ["k1"],
  key_states: {} as Record<string, boolean | null>,
};

describe("global lock", () => {
  it("locks only when enabled AND mode is global", () => {
    expect(isGlobalLoggingLocked({ enabled: true, mode: "global" })).toBe(true);
    expect(isGlobalLoggingLocked({ enabled: false, mode: "global" })).toBe(false);
    expect(isGlobalLoggingLocked({ enabled: true, mode: KEY_TARGET_MODE })).toBe(false);
  });
  it("mandatory copy names global scope and locked overrides (no teams)", () => {
    expect(GLOBAL_MANDATORY_COPY).toMatch(/global/i);
    expect(GLOBAL_MANDATORY_COPY).toMatch(/lock/i);
    expect(GLOBAL_MANDATORY_COPY).not.toMatch(/team/i);
  });
});

describe("workspace defaults", () => {
  it("logs only listed keys (key-only targeting)", () => {
    expect(defaultKeyLoggingEnabled(base, "k1")).toBe(true);
    expect(defaultKeyLoggingEnabled(base, "k9")).toBe(false);
    expect(defaultKeyLoggingEnabled({ ...base, enabled: false }, "k1")).toBe(false);
    expect(defaultKeyLoggingEnabled({ ...base, mode: "global" }, "k9")).toBe(true);
  });
  it("treats legacy teams mode as key targeting", () => {
    expect(defaultKeyLoggingEnabled({ ...base, mode: "teams" }, "k1")).toBe(true);
    expect(defaultKeyLoggingEnabled({ ...base, mode: "teams" }, "k9")).toBe(false);
  });
});

describe("resolveKeyLogging", () => {
  it("locks ON under global", () => {
    const v = resolveKeyLogging({ ...base, mode: "global" }, "k9");
    expect(v).toMatchObject({ effective: true, locked: true });
  });
  it("prefers the explicit key override both ways", () => {
    const on = resolveKeyLogging({ ...base, key_states: { k9: true } }, "k9");
    expect(on).toMatchObject({ explicit: true, effective: true, source: "Key override" });
    const off = resolveKeyLogging({ ...base, key_states: { k1: false } }, "k1");
    expect(off).toMatchObject({ explicit: false, effective: false, source: "Key override" });
  });
  it("inherits the workspace default otherwise (listed logs, unlisted does not)", () => {
    expect(resolveKeyLogging(base, "k9")).toMatchObject({
      explicit: null,
      effective: false,
      source: "Workspace default",
    });
    expect(resolveKeyLogging(base, "k1").effective).toBe(true);
  });
  it("null resets to inherit", () => {
    const v = resolveKeyLogging({ ...base, key_states: { k1: null } }, "k1");
    expect(v.explicit).toBeNull();
    expect(v.effective).toBe(true);
  });
  it("ignores garbage override values", () => {
    const v = resolveKeyLogging({ ...base, key_states: { k9: "yes" as unknown as boolean } }, "k9");
    expect(v.explicit).toBeNull();
  });
});

describe("validation + payloads", () => {
  it("rejects global ON with any explicit key disable (the 422 case)", () => {
    expect(
      validateHierarchicalStates({ enabled: true, mode: "global", key_states: { k1: false } }),
    ).toMatch(/global/i);
    expect(validateHierarchicalStates({ enabled: true, mode: "global", key_states: { k1: true } })).toBeNull();
    expect(validateHierarchicalStates({ enabled: true, mode: KEY_TARGET_MODE, key_states: { k1: false } })).toBeNull();
    expect(validateHierarchicalStates({ enabled: false, mode: "global" })).toBeNull();
  });
  it("builds the granular key endpoint body", () => {
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
      key_states: { k1: null },
    });
    const out = formatEffectiveSummaryWithStates("All logs on", withStates);
    expect(out).toContain("1 key override");
    expect(out).toContain("locked by global");
  });
  it("normalizes states defensively (older backends, garbage)", () => {
    const s = normalizeLoggingSettings({ enabled: true, mode: KEY_TARGET_MODE });
    expect(s.key_states).toEqual({});
    expect("team_states" in s).toBe(false);
    expect("team_ids" in s).toBe(false);
    const g = normalizeLoggingSettings({ key_states: { k1: 0, k2: false } });
    expect(g.key_states).toEqual({ k2: false });
  });
});
