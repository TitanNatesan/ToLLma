/**
 * Pure prompt-log helpers: filter composition, settings validation, cursor
 * merging, permission gating, timezone formatting. No JSX — covered by
 * colocated vitest.
 */

import { PROMPT_LOG_STATUSES } from "@/services/promptLogs";
import type {
  PromptLogPage,
  PromptLogRow,
  PromptLoggingUpdateInput,
} from "@/services/promptLogs";

export { PROMPT_LOG_STATUSES };

/** Org permission codes (same Group.Code convention as Guardrails.*). */
export const PROMPT_LOG_PERMS = {
  read: "PromptLogs.Read",
  viewContent: "PromptLogs.ViewContent",
  manage: "PromptLogs.Manage",
  delete: "PromptLogs.Delete",
} as const;

export interface PromptLogPerms {
  canRead: boolean;
  canViewContent: boolean;
  canManage: boolean;
  canDelete: boolean;
}

/** Personal workspaces bypass org permission checks (mirrors guardrails). */
export function resolvePromptLogPerms(input: {
  isOrg: boolean;
  isRoot: boolean;
  permissions: string[];
}): PromptLogPerms {
  if (!input.isOrg) return { canRead: true, canViewContent: true, canManage: true, canDelete: true };
  const can = (code: string) => input.isRoot || input.permissions.includes(code);
  return {
    canRead: can(PROMPT_LOG_PERMS.read),
    canViewContent: can(PROMPT_LOG_PERMS.viewContent),
    canManage: can(PROMPT_LOG_PERMS.manage),
    canDelete: can(PROMPT_LOG_PERMS.delete),
  };
}

export interface LogFilter {
  user_id: string;
  key_id: string;
  provider_id: string;
  model_id: string;
  status: string;
  /** `datetime-local` input values (local wall time), converted to ISO on query. */
  from: string;
  to: string;
  q: string;
}

export const EMPTY_LOG_FILTER: LogFilter = {
  user_id: "",
  key_id: "",
  provider_id: "",
  model_id: "",
  status: "",
  from: "",
  to: "",
  q: "",
};

/** True when every filter is at its default (used for the filters-empty state). */
export function isFilterEmpty(f: LogFilter): boolean {
  return Object.values(f).every((v) => v.trim() === "");
}

/**
 * Compose the server query from the filter bar. All set fields AND-combine;
 * `from` is inclusive-start and `to` is exclusive-end (both ISO). Blanks are
 * omitted, never sent as empty strings.
 */
export function buildLogQuery(f: LogFilter): {
  user_id?: string;
  key_id?: string;
  provider_id?: string;
  model_id?: string;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
} {
  const out: Record<string, string> = {};
  const set = (k: string, v: string) => {
    const t = v.trim();
    if (t) out[k] = t;
  };
  set("user_id", f.user_id);
  set("key_id", f.key_id);
  set("provider_id", f.provider_id);
  set("model_id", f.model_id);
  set("status", f.status);
  set("q", f.q);
  // datetime-local carries local wall time: interpret in the browser zone.
  if (f.from.trim()) {
    const iso = datetimeLocalToISO(f.from);
    if (iso) out.from = iso;
  }
  if (f.to.trim()) {
    const iso = datetimeLocalToISO(f.to);
    if (iso) out.to = iso;
  }
  return out;
}

/** `datetime-local` value ("YYYY-MM-DDTHH:mm") -> ISO instant, or null. */
export function datetimeLocalToISO(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO instant -> `datetime-local` value for repopulating the filter inputs. */
export function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const tzFormatter = (timeZone: Intl.DateTimeFormatOptions["timeZone"]) =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  });

/**
 * Display an instant in the user's timezone with an explicit UTC-offset label
 * (e.g. "12 Oct 2026, 14:03:22 UTC+2"), so log times are never ambiguous.
 */
export function formatLogTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "−";
  const abs = Math.abs(offsetMin);
  const label = `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`;
  return `${tzFormatter(undefined).format(d)} ${label}`;
}

/** Merge cursor pages, deduping by id (refetch overlap guard). */
export function mergeLogPages(pages: PromptLogPage[]): PromptLogRow[] {
  const seen = new Set<string>();
  const out: PromptLogRow[] = [];
  for (const page of pages) {
    for (const row of page.items ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

/**
 * List rows must never carry message bodies — the list endpoint returns
 * metadata only; bodies arrive solely via the detail endpoint gated by
 * PromptLogs.ViewContent.
 */
export function rowHasNoBodies(row: Record<string, unknown>): boolean {
  return !("input_text" in row) && !("output_text" in row);
}

/** Detail may expose bodies only when the viewer holds ViewContent. */
export function canShowBodies(detail: { content_restricted: boolean }, canViewContent: boolean): boolean {
  if (detail.content_restricted) return false;
  return canViewContent;
}

/** Max key targets per PUT (backend contract: UUIDs, max 100). */
export const MAX_KEY_TARGETS = 100;

export interface SettingsDraft {
  enabled: boolean;
  mode: string;
  team_ids: string[];
  /** Key targets, OR-ed with team targets when enabled and not global. */
  key_ids: string[];
  capture_input: boolean;
  capture_output: boolean;
  retention_days: string;
}

/**
 * Validate before PUT. Teams-mode with no teams AND no keys logs nothing —
 * block the save so recording never silently stops. Key targets are capped
 * at MAX_KEY_TARGETS. The same rule covers personal workspaces (their teams
 * list is always empty, so key-only targeting validates the same way).
 */
export function validateSettingsDraft(d: SettingsDraft): string | null {
  if (d.enabled && d.mode !== "global" && d.team_ids.length === 0 && (d.key_ids ?? []).length === 0) {
    return "Team mode with no teams or keys selected logs nothing. Select at least one team or key, or switch to global mode.";
  }
  if ((d.key_ids ?? []).length > MAX_KEY_TARGETS) {
    return `Too many keys selected (max ${MAX_KEY_TARGETS}). Remove some to save.`;
  }
  if (d.retention_days.trim()) {
    const n = Number(d.retention_days);
    if (!Number.isInteger(n) || n <= 0) return "Retention days must be a positive whole number.";
  }
  return null;
}

/**
 * Draft -> backend-shaped PUT body. Personal scope keeps key targets in
 * teams mode (team_ids stay empty — no teams exist there). Non-teams modes
 * clear targets server-side, so the payload sends empty arrays there.
 */
export function buildSettingsPayload(
  d: SettingsDraft,
  orgId?: string | null,
): PromptLoggingUpdateInput {
  const retention = d.retention_days.trim() ? Number(d.retention_days) : null;
  const teamsMode = d.mode === "teams";
  if (orgId) {
    return {
      org_id: orgId,
      enabled: d.enabled,
      mode: d.mode,
      team_ids: teamsMode ? d.team_ids : [],
      key_ids: teamsMode ? (d.key_ids ?? []).slice(0, MAX_KEY_TARGETS) : [],
      capture_input: d.capture_input,
      capture_output: d.capture_output,
      retention_days: retention,
    };
  }
  return {
    enabled: d.enabled,
    mode: d.mode,
    team_ids: [],
    key_ids: teamsMode ? (d.key_ids ?? []).slice(0, MAX_KEY_TARGETS) : [],
    capture_input: d.capture_input,
    capture_output: d.capture_output,
    retention_days: retention,
  };
}

/**
 * Scope precedence explainer for the settings UI. Global overrides every
 * target; team and key targets OR-combine; disabled logs nothing; enabling
 * global clears stored targets server-side.
 */
export const LOGGING_PRECEDENCE_COPY =
  "Global logs every request and ignores team and key targets. In team mode, team and key targets combine (a request matching either is logged); personal workspaces match personal keys. When logging is off, nothing is recorded. Switching to global clears stored targets.";

export function loggingPrecedenceCopy(d: Pick<SettingsDraft, "enabled" | "mode">): string {
  if (!d.enabled) return "Logging is off — no requests are recorded, regardless of scope or targets.";
  if (d.mode === "global") return `Logging is on for the whole workspace. ${LOGGING_PRECEDENCE_COPY}`;
  return `Logging is on for selected teams and keys only (either match logs the request). ${LOGGING_PRECEDENCE_COPY}`;
}

/** Badge variant per backend-validated status (unknown statuses stay neutral). */
export function promptLogStatusVariant(
  status: string,
): "success" | "destructive" | "warning" | "outline" | "secondary" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "destructive";
    case "cancelled":
      return "warning";
    case "partial":
      return "outline";
    default:
      return "secondary";
  }
}

/**
 * Render the settings `effective_summary` dict as one summary line.
 * Older backends sent a plain string (passed through); anything else
 * degrades to a shallow key/value join — never "[object Object]".
 */
export function formatEffectiveSummary(summary: unknown): string {
  if (summary === null || summary === undefined) return "";
  if (typeof summary === "string") return summary;
  if (typeof summary !== "object" || Array.isArray(summary)) return String(summary);
  const s = summary as Record<string, unknown>;
  const parts: string[] = [];
  if ("enabled" in s) parts.push(s.enabled ? "Logging enabled" : "Logging disabled");
  if (typeof s.capture === "string" && s.capture) parts.push(`${s.capture} capture`);
  const scope = s.scope;
  if (typeof scope === "string") {
    parts.push(scope === "all" ? "scope: all" : `scope: ${scope}`);
  } else if (scope !== null && typeof scope === "object" && !Array.isArray(scope)) {
    const teams = (scope as Record<string, unknown>).teams;
    if (typeof teams === "number") parts.push(`scope: ${teams} team${teams === 1 ? "" : "s"}`);
  }
  if (typeof s.retention_days === "number") parts.push(`retention ${s.retention_days}d`);
  else if (s.retention_days === null) parts.push("retention off");
  if (parts.length > 0) return parts.join(" · ");
  try {
    const flat = Object.entries(s).map(([k, v]) =>
      typeof v === "object" ? `${k}: ${JSON.stringify(v)}` : `${k}: ${String(v)}`,
    );
    const joined = flat.join(" · ");
    return joined.length > 160 ? `${joined.slice(0, 157)}…` : joined;
  } catch {
    return "";
  }
}

/** First 8 chars of an id, or an em dash when absent. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

/** Key display: name wins, then either id field (`key_id` legacy, `api_key_id` canonical). */
export function getLogKeyDisplay(row: {
  key_name?: string | null;
  key_id?: string | null;
  api_key_id?: string | null;
}): string {
  return row.key_name ?? shortId(row.key_id ?? row.api_key_id);
}

/** Short request id for table cells, or null when the row has none. */
export function shortRequestId(requestId: string | null | undefined): string | null {
  return requestId ? `${requestId.slice(0, 8)}…` : null;
}

/** User display: email wins (backend LogMeta), else short id, else em dash. */
export function getLogUserDisplay(row: {
  user_email?: string | null;
  user_id?: string | null;
}): string {
  return row.user_email || shortId(row.user_id);
}

/** Provider display: resolved name wins, else short provider id. */
export function getLogProviderDisplay(row: {
  provider_name?: string | null;
  provider_id?: string | null;
}): string {
  return row.provider_name || shortId(row.provider_id);
}

/** Model display: resolved name wins, else short model id. */
export function getLogModelDisplay(row: {
  model_name?: string | null;
  model_id?: string | null;
}): string {
  return row.model_name || shortId(row.model_id);
}

/** Endpoint label: known gateway endpoints get friendly names, unknown raw
 *  values pass through, empty renders an em dash. */
export function endpointLabel(endpoint: string | null | undefined): string {
  switch ((endpoint ?? "").trim()) {
    case "":
      return "—";
    case "chat":
      return "Chat page";
    case "chat_completions":
      return "Chat completions";
    case "messages":
      return "Messages";
    case "responses":
      return "Responses";
    default:
      return endpoint as string;
  }
}

/**
 * Human duration: sub-second stays whole milliseconds ("723ms"), >=1s
 * renders one-decimal seconds ("4.8s"). Nullish/non-finite -> em dash.
 */
export function formatDurationMs(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Tabs synced to the `?tab=` query param. */
export type PromptLogTab = "logs" | "settings";

export function tabFromParam(value: string | null): PromptLogTab {
  return value === "settings" ? "settings" : "logs";
}

/** Query-param keys backing the filter bar (single source of truth for URL sync). */
export const LOG_FILTER_KEYS = [
  "user_id",
  "key_id",
  "provider_id",
  "model_id",
  "status",
  "q",
  "from",
  "to",
] as const satisfies ReadonlyArray<keyof LogFilter>;

/** Rebuild the filter bar from URL params (unknown statuses are dropped). */
export function filterFromParams(get: (key: string) => string | null): LogFilter {
  const pick = (key: string) => get(key) ?? "";
  const status = pick("status");
  return {
    user_id: pick("user_id"),
    key_id: pick("key_id"),
    provider_id: pick("provider_id"),
    model_id: pick("model_id"),
    status: (PROMPT_LOG_STATUSES as readonly string[]).includes(status) ? status : "",
    q: pick("q"),
    from: pick("from"),
    to: pick("to"),
  };
}

/** Non-empty filter fields as URL params (blanks are omitted). */
export function filterToParams(f: LogFilter): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of LOG_FILTER_KEYS) {
    const v = f[key].trim();
    if (v) out[key] = v;
  }
  return out;
}

/**
 * Hierarchical logging overrides (parallel backend; every accessor tolerates
 * older backends where team_states/key_states are absent).
 */

import type { PromptLoggingSettings } from "@/services/promptLogs";

/** Global ON locks every scope: per-team/per-key controls render disabled. */
export function isGlobalLoggingLocked(s: Pick<PromptLoggingSettings, "enabled" | "mode">): boolean {
  return s.enabled === true && s.mode === "global";
}

/** Workspace default for a team with no explicit override: the legacy
 *  targeting rule (teams mode logs only listed teams; any other enabled
 *  mode logs everything). */
export function defaultTeamLoggingEnabled(
  s: Pick<PromptLoggingSettings, "enabled" | "mode" | "team_ids">,
  teamId: string,
): boolean {
  if (!s.enabled) return false;
  if (s.mode === "global") return true;
  if (s.mode !== "teams") return true;
  return (s.team_ids ?? []).includes(teamId);
}

/**
 * Workspace default for a key with no explicit override and no team
 * override: legacy OR rule (a key matches directly or through its teams).
 */
export function defaultKeyLoggingEnabled(
  s: Pick<PromptLoggingSettings, "enabled" | "mode" | "team_ids" | "key_ids">,
  keyId: string,
  keyTeamIds: string[] = [],
): boolean {
  if (!s.enabled) return false;
  if (s.mode === "global") return true;
  if (s.mode !== "teams") return true;
  if ((s.key_ids ?? []).includes(keyId)) return true;
  const targeted = new Set(s.team_ids ?? []);
  return keyTeamIds.some((t) => targeted.has(t));
}

export interface ScopeLoggingView {
  /** Explicit override; null = inherit the workspace/team default. */
  explicit: boolean | null;
  /** Resolved outcome after the global lock and inheritance chain. */
  effective: boolean;
  /** True when global ON forces logging regardless of overrides. */
  locked: boolean;
  /** One-line provenance for the UI ("Global policy", "Team override", …). */
  source: string;
}

/** Resolve one team's logging state. Missing entries inherit the default. */
export function resolveTeamLogging(
  s: Pick<PromptLoggingSettings, "enabled" | "mode" | "team_ids" | "team_states">,
  teamId: string,
): ScopeLoggingView {
  const locked = isGlobalLoggingLocked(s);
  if (locked) return { explicit: null, effective: true, locked, source: "Global policy" };
  const raw = (s.team_states ?? {})[teamId];
  const explicit = typeof raw === "boolean" ? raw : null;
  if (explicit !== null) {
    return { explicit, effective: explicit, locked: false, source: "Team override" };
  }
  return {
    explicit: null,
    effective: defaultTeamLoggingEnabled(s, teamId),
    locked: false,
    source: "Workspace default",
  };
}

/** Resolve one key's logging state: explicit key state wins, then the
 *  strongest team signal (any explicit team ON beats inheritance), then the
 *  workspace default. */
export function resolveKeyLogging(
  s: Pick<
    PromptLoggingSettings,
    "enabled" | "mode" | "team_ids" | "key_ids" | "team_states" | "key_states"
  >,
  keyId: string,
  keyTeamIds: string[] = [],
): ScopeLoggingView {
  const locked = isGlobalLoggingLocked(s);
  if (locked) return { explicit: null, effective: true, locked, source: "Global policy" };
  const raw = (s.key_states ?? {})[keyId];
  const explicit = typeof raw === "boolean" || raw === null ? raw : null;
  if (explicit === true) {
    return { explicit, effective: true, locked: false, source: "Key override" };
  }
  if (explicit === false) {
    return { explicit, effective: false, locked: false, source: "Key override" };
  }
  // Backend precedence (resolution.py): explicit key override wins; otherwise a
  // listed-live key target captures (match_source="key") even when every team
  // signal is off; then any enabled-team hit captures; else no capture.
  if ((s.key_ids ?? []).includes(keyId)) {
    if (!s.enabled) {
      return { explicit: null, effective: false, locked: false, source: "Workspace default" };
    }
    return { explicit: null, effective: true, locked: false, source: "Workspace default" };
  }
  const states = s.team_states ?? {};
  const teamExplicit = keyTeamIds
    .map((t) => states[t])
    .filter((v): v is boolean => typeof v === "boolean");
  if (teamExplicit.length > 0) {
    // Any explicit team ON logs the key (OR semantics); explicit OFFs alone
    // mean no team hit — the key inherits nothing further here because the
    // listed-key leg above already missed.
    if (teamExplicit.some((v) => v)) {
      return { explicit: null, effective: true, locked: false, source: "Team override" };
    }
    return { explicit: null, effective: false, locked: false, source: "Team override" };
  }
  return {
    explicit: null,
    effective: defaultKeyLoggingEnabled(s, keyId, keyTeamIds),
    locked: false,
    source: "Workspace default",
  };
}

/**
 * Reject a save that the backend answers 422 to: global ON with any explicit
 * disable. Immediate per-scope controls are locked instead, so this guards
 * the bulk PUT path (and races where global flipped on mid-edit).
 */
export function validateHierarchicalStates(input: {
  enabled: boolean;
  mode: string;
  team_states?: Record<string, boolean>;
  key_states?: Record<string, boolean | null>;
}): string | null {
  if (!(input.enabled && input.mode === "global")) return null;
  const disabledTeam = Object.entries(input.team_states ?? {}).find(([, v]) => v === false);
  if (disabledTeam) {
    return "Global logging is on: every team is logged and per-team disables are rejected. Remove the team override instead.";
  }
  const disabledKey = Object.entries(input.key_states ?? {}).find(([, v]) => v === false);
  if (disabledKey) {
    return "Global logging is on: every key is logged and per-key disables are rejected. Reset the key to inherit instead.";
  }
  return null;
}

/** Bodies for the granular endpoints (single source of truth for tests). */
export function buildTeamLoggingPayload(enabled: boolean): { enabled: boolean } {
  return { enabled };
}

export function buildKeyLoggingPayload(enabled: boolean | null): { enabled: boolean | null } {
  return { enabled };
}

/**
 * Mandatory-global explainer shown wherever global scope can be enabled:
 * it captures every request and locks per-scope overrides on.
 */
export const GLOBAL_MANDATORY_COPY =
  "Global logging is mandatory for the whole workspace: every team and every key is logged, and per-team / per-key controls lock on. Narrower targeting is lost.";

/**
 * Effective-state line for one scope: "On"/"Off" plus provenance, with the
 * lock called out. Used by team/key forms and the settings override lists.
 */
export function scopeEffectiveLine(view: ScopeLoggingView): string {
  const state = view.effective ? "On" : "Off";
  if (view.locked) return `${state} · locked by ${view.source.toLowerCase()}`;
  if (view.explicit === null) return `${state} · inherited (${view.source.toLowerCase()})`;
  return `${state} · ${view.source.toLowerCase()}`;
}

/** Short badge copy for the settings override lists. */
export function scopeBadgeLabel(view: ScopeLoggingView): "ON" | "OFF" {
  return view.effective ? "ON" : "OFF";
}

/**
 * Append hierarchical override counts and the global lock to the effective
 * summary line. Additive only: summaries without states render exactly as
 * before (older backends, existing tests).
 */
export function formatEffectiveSummaryWithStates(
  summary: unknown,
  s?: Pick<PromptLoggingSettings, "enabled" | "mode" | "team_states" | "key_states">,
): string {
  const base = formatEffectiveSummary(summary);
  if (!s) return base;
  const parts = [base];
  const teamOverrides = Object.keys(s.team_states ?? {}).length;
  const keyOverrides = Object.keys(s.key_states ?? {}).length;
  if (teamOverrides > 0) parts.push(`${teamOverrides} team override${teamOverrides === 1 ? "" : "s"}`);
  if (keyOverrides > 0) parts.push(`${keyOverrides} key override${keyOverrides === 1 ? "" : "s"}`);
  if (isGlobalLoggingLocked(s)) parts.push("locked by global");
  return parts.filter(Boolean).join(" · ");
}
