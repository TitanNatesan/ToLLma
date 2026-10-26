import { describe, expect, it } from "vitest";
import { normalizeLoggingSettings } from "@/services/promptLogs";
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
  mode: "teams",
  team_ids: [],
  key_ids: [],
  capture_input: true,
  capture_output: true,
  retention_days: "",
  ...overrides,
});

describe("key-target validation", () => {
  it("blocks teams-mode with zero teams AND zero keys (logs nothing)", () => {
    expect(validateSettingsDraft(draft())).toMatch(/logs nothing/i);
  });
  it("accepts keys alone, teams alone, or both (OR semantics)", () => {
    expect(validateSettingsDraft(draft({ key_ids: ["k1"] }))).toBeNull();
    expect(validateSettingsDraft(draft({ team_ids: ["t1"] }))).toBeNull();
    expect(validateSettingsDraft(draft({ team_ids: ["t1"], key_ids: ["k1"] }))).toBeNull();
  });
  it("caps keys at MAX_KEY_TARGETS", () => {
    const tooMany = Array.from({ length: MAX_KEY_TARGETS + 1 }, (_, i) => `k${i}`);
    expect(validateSettingsDraft(draft({ key_ids: tooMany }))).toMatch(/max 100/i);
    expect(validateSettingsDraft(draft({ key_ids: tooMany.slice(0, MAX_KEY_TARGETS) }))).toBeNull();
  });
  it("applies the same empty-targets rule to personal workspaces (teams list is always empty there)", () => {
    expect(validateSettingsDraft(draft())).toMatch(/logs nothing/i);
    expect(validateSettingsDraft(draft({ key_ids: ["k1"] }))).toBeNull();
  });
});

describe("key-target payload", () => {
  it("includes key_ids alongside team_ids in teams mode", () => {
    const body = buildSettingsPayload(draft({ team_ids: ["t1"], key_ids: ["k1", "k2"] }), "org1");
    expect(body).toMatchObject({ org_id: "org1", mode: "teams", team_ids: ["t1"], key_ids: ["k1", "k2"] });
  });
  it("clears targets outside teams mode (global ignores+clears)", () => {
    const body = buildSettingsPayload(draft({ mode: "global", team_ids: ["t1"], key_ids: ["k1"] }), "org1");
    expect(body.team_ids).toEqual([]);
    expect(body.key_ids).toEqual([]);
  });
  it("keeps key targeting for personal scope in teams mode", () => {
    const body = buildSettingsPayload(draft({ team_ids: ["t1"], key_ids: ["k1"] }), undefined);
    expect(body.mode).toBe("teams");
    expect(body.team_ids).toEqual([]);
    expect(body.key_ids).toEqual(["k1"]);
  });
  it("clears personal targets outside teams mode (global ignores+clears)", () => {
    const body = buildSettingsPayload(draft({ mode: "global", team_ids: ["t1"], key_ids: ["k1"] }), undefined);
    expect(body.team_ids).toEqual([]);
    expect(body.key_ids).toEqual([]);
  });
});

describe("settings normalization fallback", () => {
  it("defaults missing key_ids to [] (older backends)", () => {
    const s = normalizeLoggingSettings({ enabled: true, mode: "teams", team_ids: ["t1"] });
    expect(s.key_ids).toEqual([]);
    expect(s.team_ids).toEqual(["t1"]);
  });
});

describe("precedence copy", () => {
  it("covers global override, team OR key, disabled, and global-clear", () => {
    expect(LOGGING_PRECEDENCE_COPY).toMatch(/global/i);
    expect(LOGGING_PRECEDENCE_COPY).toMatch(/either|combin/i);
    expect(LOGGING_PRECEDENCE_COPY).toMatch(/off|nothing/i);
    expect(LOGGING_PRECEDENCE_COPY).toMatch(/clear/i);
  });
  it("adapts to the current draft state", () => {
    expect(loggingPrecedenceCopy({ enabled: false, mode: "teams" })).toMatch(/off/i);
    expect(loggingPrecedenceCopy({ enabled: true, mode: "global" })).toMatch(/whole workspace/i);
    expect(loggingPrecedenceCopy({ enabled: true, mode: "teams" })).toMatch(/either match/i);
  });
});
