import { describe, expect, it } from "vitest";
import {
  EMPTY_LOG_FILTER,
  buildLogQuery,
  buildSettingsPayload,
  canShowBodies,
  isFilterEmpty,
  isoToDatetimeLocal,
  mergeLogPages,
  resolvePromptLogPerms,
  validateSettingsDraft,
} from "../promptLogLogic";

describe("acceptance gaps", () => {
  it("round-trips datetime-local conversion, blank on invalid", () => {
    const iso = "2026-10-26T10:00:00.000Z";
    const local = isoToDatetimeLocal(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(isoToDatetimeLocal("bogus")).toBe("");
    expect(isoToDatetimeLocal("")).toBe("");
  });
  it("flags non-empty filters", () => {
    expect(isFilterEmpty({ ...EMPTY_LOG_FILTER, status: "failed" })).toBe(false);
    expect(isFilterEmpty({ ...EMPTY_LOG_FILTER, q: "  x " })).toBe(false);
  });
  it("composes every set field and trims blanks", () => {
    const q = buildLogQuery({
      ...EMPTY_LOG_FILTER,
      user_id: " u1 ",
      key_id: "k1",
      provider_id: "p1",
      model_id: "m1",
      status: "completed",
      q: "req-1",
      from: "",
      to: "",
    });
    expect(q).toEqual({
      user_id: "u1",
      key_id: "k1",
      provider_id: "p1",
      model_id: "m1",
      status: "completed",
      q: "req-1",
    });
  });
  it("gates manage/delete separately from read", () => {
    const p = resolvePromptLogPerms({
      isOrg: true,
      isRoot: false,
      permissions: ["PromptLogs.Read", "PromptLogs.Delete"],
    });
    expect(p.canRead).toBe(true);
    expect(p.canManage).toBe(false);
    expect(p.canDelete).toBe(true);
    expect(p.canViewContent).toBe(false);
  });
  it("merges zero pages to zero rows", () => {
    expect(mergeLogPages([])).toEqual([]);
  });
  it("denies bodies when restricted even with permission", () => {
    expect(canShowBodies({ content_restricted: true }, true)).toBe(false);
    expect(canShowBodies({ content_restricted: false }, false)).toBe(false);
  });
  it("accepts blank retention and nulls it in the payload", () => {
    expect(
      validateSettingsDraft(
        { enabled: true, mode: "global", team_ids: [], key_ids: [], capture_input: true, capture_output: true, retention_days: "" },
      ),
    ).toBeNull();
    expect(
      buildSettingsPayload(
        { enabled: true, mode: "global", team_ids: [], key_ids: [], capture_input: true, capture_output: true, retention_days: "" },
        "org1",
      ).retention_days,
    ).toBeNull();
  });
});
