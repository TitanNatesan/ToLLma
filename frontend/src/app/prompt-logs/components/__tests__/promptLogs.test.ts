import { describe, expect, it } from "vitest";
import { KEY_TARGET_MODE } from "@/services/promptLogs";
import {
  EMPTY_LOG_FILTER,
  buildLogQuery,
  buildSettingsPayload,
  canShowBodies,
  datetimeLocalToISO,
  formatLogTime,
  isFilterEmpty,
  mergeLogPages,
  resolvePromptLogPerms,
  rowHasNoBodies,
  validateSettingsDraft,
} from "../promptLogLogic";
import type { PromptLogPage } from "@/services/promptLogs";

const row = (id: string) => ({
  id,
  request_id: `req-${id}`,
  created_at: "2026-10-26T10:00:00Z",
  completed_at: "2026-10-26T10:00:01Z",
  workspace_type: "org",
  user_id: "u1",
  key_id: "k1",
  provider_id: "p1",
  model_id: "m1",
  endpoint: "/v1/chat",
  source: "gateway",
  status: "ok",
  duration_ms: 100,
  prompt_tokens: 10,
  completion_tokens: 5,
  fields: ["input", "output"] as Array<"input" | "output">,
  content_expired: false,
});

describe("resolvePromptLogPerms", () => {
  it("grants everything in personal workspaces", () => {
    expect(resolvePromptLogPerms({ isOrg: false, isRoot: false, permissions: [] })).toEqual({
      canRead: true,
      canViewContent: true,
      canManage: true,
      canDelete: true,
    });
  });
  it("gates each org capability by its code (root bypasses)", () => {
    const p = resolvePromptLogPerms({ isOrg: true, isRoot: false, permissions: ["PromptLogs.Read"] });
    expect(p.canRead).toBe(true);
    expect(p.canViewContent).toBe(false);
    expect(p.canManage).toBe(false);
    expect(p.canDelete).toBe(false);
    const root = resolvePromptLogPerms({ isOrg: true, isRoot: true, permissions: [] });
    expect(root).toEqual({ canRead: true, canViewContent: true, canManage: true, canDelete: true });
  });
});

describe("filter composition", () => {
  it("empty filter composes to no params", () => {
    expect(isFilterEmpty(EMPTY_LOG_FILTER)).toBe(true);
    expect(buildLogQuery(EMPTY_LOG_FILTER)).toEqual({});
  });
  it("AND-composes only set fields, omitting blanks", () => {
    const q = buildLogQuery({ ...EMPTY_LOG_FILTER, user_id: " u1 ", status: "ok", q: "  " });
    expect(q).toEqual({ user_id: "u1", status: "ok" });
    expect(q).not.toHaveProperty("q");
  });
  it("converts datetime-local bounds to ISO (from inclusive, to exclusive)", () => {
    const q = buildLogQuery({ ...EMPTY_LOG_FILTER, from: "2026-10-01T00:00", to: "2026-10-02T00:00" });
    expect(q.from).toBe(datetimeLocalToISO("2026-10-01T00:00"));
    expect(q.to).toBe(datetimeLocalToISO("2026-10-02T00:00"));
    expect(new Date(q.from!).toISOString()).toBe(q.from);
  });
  it("drops unparseable datetimes", () => {
    expect(buildLogQuery({ ...EMPTY_LOG_FILTER, from: "not-a-date" })).toEqual({});
  });
});

describe("cursor pagination merging", () => {
  it("concatenates pages and dedupes refetch overlap by id", () => {
    const pages: PromptLogPage[] = [
      { items: [row("a"), row("b")], nextCursor: "c1" },
      { items: [row("b"), row("c")], nextCursor: null },
    ];
    expect(mergeLogPages(pages).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("content gating", () => {
  it("list rows carry no bodies", () => {
    expect(rowHasNoBodies(row("a") as unknown as Record<string, unknown>)).toBe(true);
    expect(rowHasNoBodies({ ...row("a"), input_text: "hi" } as unknown as Record<string, unknown>)).toBe(false);
    expect(rowHasNoBodies({ ...row("a"), output_text: "hi" } as unknown as Record<string, unknown>)).toBe(false);
  });
  it("bodies show only with ViewContent and when not restricted", () => {
    expect(canShowBodies({ content_restricted: false }, true)).toBe(true);
    expect(canShowBodies({ content_restricted: false }, false)).toBe(false);
    expect(canShowBodies({ content_restricted: true }, true)).toBe(false);
  });
});

describe("settings validation", () => {
  const draft = {
    enabled: true,
    mode: "global",
    key_ids: [] as string[],
    capture_input: true,
    capture_output: true,
    retention_days: "",
  };
  it("blocks selected-keys mode with no keys (logs nothing)", () => {
    expect(validateSettingsDraft({ ...draft, mode: KEY_TARGET_MODE })).toMatch(/logs nothing/i);
    expect(validateSettingsDraft({ ...draft, mode: KEY_TARGET_MODE, key_ids: ["k1"] })).toBeNull();
  });
  it("supports personal key-only targeting", () => {
    expect(validateSettingsDraft({ ...draft, mode: KEY_TARGET_MODE })).toMatch(/logs nothing/i);
    expect(validateSettingsDraft({ ...draft, mode: KEY_TARGET_MODE, key_ids: ["k1"] })).toBeNull();
    const body = buildSettingsPayload({ ...draft, mode: KEY_TARGET_MODE, key_ids: ["k1"] }, undefined);
    expect(body.mode).toBe(KEY_TARGET_MODE);
    expect(body.key_ids).toEqual(["k1"]);
  });
  it("rejects non-positive retention days", () => {
    expect(validateSettingsDraft({ ...draft, retention_days: "0" })).toMatch(/retention/i);
    expect(validateSettingsDraft({ ...draft, retention_days: "1.5" })).toMatch(/retention/i);
    expect(validateSettingsDraft({ ...draft, retention_days: "30" })).toBeNull();
  });
  it("keeps org key targeting in the payload (no team legs)", () => {
    const body = buildSettingsPayload({ ...draft, mode: KEY_TARGET_MODE, key_ids: ["k1"] }, "org1");
    expect(body).toMatchObject({ org_id: "org1", mode: KEY_TARGET_MODE, key_ids: ["k1"] });
    expect(body).not.toHaveProperty("team_ids");
    expect(body).not.toHaveProperty("team_states");
  });
});

describe("formatLogTime", () => {
  it("labels the user-timezone offset explicitly", () => {
    const out = formatLogTime("2026-10-26T10:00:00Z");
    expect(out).toMatch(/UTC[+−]/);
    expect(formatLogTime(null)).toBe("—");
    expect(formatLogTime("bogus")).toBe("—");
  });
});
