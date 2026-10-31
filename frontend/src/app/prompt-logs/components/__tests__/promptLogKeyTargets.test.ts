import { describe, expect, it } from "vitest";
import { KEY_TARGET_MODE, normalizeLoggingSettings } from "@/services/promptLogs";
import {
  LOGGING_PRECEDENCE_COPY,
  MAX_KEY_TARGETS,
  buildSettingsPayload,
  loggingPrecedenceCopy,
  validateSettingsDraft,
  type SettingsDraft,
} from "../promptLogLogic";

const draft = (overrides: Partial<SettingsDraft> = {}): SettingsDraft => ({
  enabled: true,
  mode: KEY_TARGET_MODE,
  key_ids: [],
  capture_input: true,
  capture_output: true,
  retention_days: "",
  ...overrides,
});

describe("key-target validation", () => {
  it("blocks selected-keys mode with zero keys (logs nothing)", () => {
    expect(validateSettingsDraft(draft())).toMatch(/logs nothing/i);
    expect(validateSettingsDraft(draft())).not.toMatch(/team/i);
  });
  it("accepts keys alone", () => {
    expect(validateSettingsDraft(draft({ key_ids: ["k1"] }))).toBeNull();
  });
  it("caps keys at MAX_KEY_TARGETS", () => {
    const tooMany = Array.from({ length: MAX_KEY_TARGETS + 1 }, (_, i) => `k${i}`);
    expect(validateSettingsDraft(draft({ key_ids: tooMany }))).toMatch(/max 100/i);
    expect(validateSettingsDraft(draft({ key_ids: tooMany.slice(0, MAX_KEY_TARGETS) }))).toBeNull();
  });
  it("applies the same empty-targets rule to personal workspaces", () => {
    expect(validateSettingsDraft(draft())).toMatch(/logs nothing/i);
    expect(validateSettingsDraft(draft({ key_ids: ["k1"] }))).toBeNull();
  });
  it("treats legacy teams mode as key targeting", () => {
    expect(validateSettingsDraft(draft({ mode: "teams" }))).toMatch(/logs nothing/i);
    expect(validateSettingsDraft(draft({ mode: "teams", key_ids: ["k1"] }))).toBeNull();
  });
});

describe("key-target payload", () => {
  it("includes key_ids without team legs", () => {
    const body = buildSettingsPayload(draft({ key_ids: ["k1", "k2"] }), "org1");
    expect(body).toMatchObject({ org_id: "org1", mode: KEY_TARGET_MODE, key_ids: ["k1", "k2"] });
    expect(body).not.toHaveProperty("team_ids");
    expect(body).not.toHaveProperty("team_states");
  });
  it("clears targets in global mode (global ignores+clears)", () => {
    const body = buildSettingsPayload(draft({ mode: "global", key_ids: ["k1"] }), "org1");
    expect(body.key_ids).toEqual([]);
  });
  it("keeps key targeting for personal scope", () => {
    const body = buildSettingsPayload(draft({ key_ids: ["k1"] }), undefined);
    expect(body.mode).toBe(KEY_TARGET_MODE);
    expect(body).not.toHaveProperty("org_id");
    expect(body.key_ids).toEqual(["k1"]);
  });
  it("clears personal targets in global mode (global ignores+clears)", () => {
    const body = buildSettingsPayload(draft({ mode: "global", key_ids: ["k1"] }), undefined);
    expect(body.key_ids).toEqual([]);
  });
});

describe("settings normalization fallback", () => {
  it("defaults missing key_ids to [] and drops team legs (older backends)", () => {
    const s = normalizeLoggingSettings({ enabled: true, mode: KEY_TARGET_MODE, team_ids: ["t1"], team_states: { t1: true } });
    expect(s.key_ids).toEqual([]);
    expect("team_ids" in s).toBe(false);
    expect("team_states" in s).toBe(false);
  });
});

describe("precedence copy", () => {
  it("covers global override, key targets, disabled, and global-clear (no teams)", () => {
    expect(LOGGING_PRECEDENCE_COPY).toMatch(/global/i);
    expect(LOGGING_PRECEDENCE_COPY).toMatch(/key targets/i);
    expect(LOGGING_PRECEDENCE_COPY).toMatch(/off|nothing/i);
    expect(LOGGING_PRECEDENCE_COPY).toMatch(/clear/i);
    expect(LOGGING_PRECEDENCE_COPY).not.toMatch(/team/i);
  });
  it("adapts to the current draft state", () => {
    expect(loggingPrecedenceCopy({ enabled: false, mode: KEY_TARGET_MODE })).toMatch(/off/i);
    expect(loggingPrecedenceCopy({ enabled: true, mode: "global" })).toMatch(/whole workspace/i);
    expect(loggingPrecedenceCopy({ enabled: true, mode: KEY_TARGET_MODE })).toMatch(/selected keys only/i);
  });
});
