/**
 * Prompt logging API client (`/api/v1/prompt-logs/*`).
 *
 * Org scoping rides `?org_id=` on every endpoint EXCEPT the settings PUT
 * body (where `org_id` rides in the payload); personal scope omits it.
 * List pagination reads the `X-Next-Cursor` response header via a raw fetch
 * (apiRequest only returns the parsed body, so it cannot expose headers);
 * the URL itself is built with the shared apiUrl() resolver — never a local
 * host/port hack. List rows never carry message bodies — bodies arrive only
 * via the detail endpoint (which itself requires the ViewContent permission).
 *
 * Every row/detail/purge payload passes through a normalizer: the backend
 * may send the canonical shape (`{items}`, `fields`, `duration_ms`,
 * `completed_at`, `key_name`, `expired_count`) or legacy variance
 * (bare-array bodies, `input_chars`/`output_chars`, `latency_ms`,
 * `api_key_id`, `expired`). The UI only ever sees the canonical shape.
 */

import { ApiError, apiRequest, apiUrl } from "@/services/api";
import { getAccessToken, useAuthStore } from "@/store/auth";

export const PROMPT_LOGS_BASE = "/api/v1/prompt-logs";

/** Backend-validated log statuses (STATUSES in models/prompt_logging.py). */
export const PROMPT_LOG_STATUSES = ["completed", "cancelled", "failed", "partial"] as const;
export type PromptLogStatus = (typeof PROMPT_LOG_STATUSES)[number];
export type PromptLogField = "input" | "output";

export type PromptLoggingMode = "global" | "teams";

export interface PromptLoggingSettings {
  workspace_type: string;
  enabled: boolean;
  mode: PromptLoggingMode | string;
  team_ids: string[];
  /** Key targets (OR alongside team targets when enabled and not global).
   *  Absent on older backends — always normalized to an array. */
  key_ids: string[];
  /** Hierarchical overrides (parallel backend): explicit per-team on/off.
   *  Absent on older backends — normalized to {}. */
  team_states: Record<string, boolean>;
  /** Hierarchical overrides: explicit per-key on/off, null = inherit.
   *  Absent on older backends — normalized to {}. */
  key_states: Record<string, boolean | null>;
  capture_input: boolean;
  capture_output: boolean;
  retention_days: number | null;
  version: number;
  updated_by: string | null;
  updated_at: string | null;
  /** Dict summary (current backend); older backends sent a plain string. */
  effective_summary: Record<string, unknown> | string;
}

export interface PromptLoggingUpdateInput {
  org_id?: string | null;
  enabled: boolean;
  mode: PromptLoggingMode | string;
  team_ids?: string[];
  /** Key targets, max 100 (UUIDs). Only meaningful in teams mode; global clears. */
  key_ids?: string[];
  /** Hierarchical overrides: global ON + any explicit disable is a 422. */
  team_states?: Record<string, boolean>;
  key_states?: Record<string, boolean | null>;
  capture_input: boolean;
  capture_output: boolean;
  retention_days?: number | null;
}

export interface PromptLogRow {
  id: string;
  request_id: string | null;
  created_at: string;
  completed_at: string | null;
  workspace_type: string;
  user_id: string | null;
  user_email?: string | null;
  org_id?: string | null;
  key_id: string | null;
  api_key_id?: string | null;
  key_name?: string | null;
  team_ids: string[];
  provider_id: string | null;
  provider_name?: string | null;
  model_id: string | null;
  model_name?: string | null;
  endpoint: string | null;
  source: string | null;
  status: string;
  duration_ms: number | null;
  latency_ms?: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  fields: PromptLogField[];
  input_chars?: number | null;
  output_chars?: number | null;
  content_expired: boolean;
}

export interface PromptLogPage {
  items: PromptLogRow[];
  nextCursor: string | null;
}

export interface PromptLogDetail extends PromptLogRow {
  input_text: string | null;
  output_text: string | null;
  content_restricted: boolean;
  provenance: Record<string, unknown>;
  usage: Record<string, unknown>;
}

export interface PromptLogTeam {
  id: string;
  name: string;
}

export interface RetentionInfo {
  default_days: number;
  effective_days: number;
  next_run: string | null;
}

export interface PurgeResult {
  expired_count: number;
}

export interface PromptLogFilters {
  org_id?: string | null;
  user_id?: string;
  key_id?: string;
  team_id?: string;
  provider_id?: string;
  model_id?: string;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** `{uuid: boolean}` override map; non-boolean values are dropped. Never throws. */
function asBoolRecord(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, val] of Object.entries(asRecord(v))) {
    if (typeof val === "boolean") out[k] = val;
  }
  return out;
}

/** `{uuid: boolean|null}` override map; anything else is dropped. Never throws. */
function asTristateRecord(v: unknown): Record<string, boolean | null> {
  const out: Record<string, boolean | null> = {};
  for (const [k, val] of Object.entries(asRecord(v))) {
    if (typeof val === "boolean" || val === null) out[k] = val;
  }
  return out;
}

/** Normalize one list/detail row: canonical fields win, legacy variance fills gaps. Never throws. */
export function normalizeLogRow(raw: unknown): PromptLogRow {
  const r = asRecord(raw);
  const inputChars = asNumber(r.input_chars) ?? 0;
  const outputChars = asNumber(r.output_chars) ?? 0;
  const explicit = asStringArray(r.fields).filter(
    (f): f is PromptLogField => f === "input" || f === "output",
  );
  const fields: PromptLogField[] =
    explicit.length > 0 || Array.isArray(r.fields)
      ? explicit
      : ([
          ...(inputChars > 0 ? ["input" as const] : []),
          ...(outputChars > 0 ? ["output" as const] : []),
        ]);
  const keyId = asString(r.key_id) ?? asString(r.api_key_id);
  return {
    id: asString(r.id) ?? "",
    request_id: asString(r.request_id),
    created_at: asString(r.created_at) ?? "",
    completed_at: asString(r.completed_at),
    workspace_type: asString(r.workspace_type) ?? "",
    user_id: asString(r.user_id),
    user_email: asString(r.user_email),
    org_id: asString(r.org_id),
    key_id: keyId,
    api_key_id: asString(r.api_key_id) ?? asString(r.key_id),
    key_name: asString(r.key_name),
    team_ids: asStringArray(r.team_ids),
    provider_id: asString(r.provider_id),
    provider_name: asString(r.provider_name),
    model_id: asString(r.model_id),
    model_name: asString(r.model_name),
    endpoint: asString(r.endpoint),
    source: asString(r.source),
    status: asString(r.status) ?? "unknown",
    duration_ms: asNumber(r.duration_ms) ?? asNumber(r.latency_ms),
    latency_ms: asNumber(r.latency_ms),
    prompt_tokens: asNumber(r.prompt_tokens),
    completion_tokens: asNumber(r.completion_tokens),
    fields,
    input_chars: asNumber(r.input_chars),
    output_chars: asNumber(r.output_chars),
    content_expired: r.content_expired === true,
  };
}

/** Normalize the detail payload: row fields plus null-safe body gating. Never throws. */
export function normalizeLogDetail(raw: unknown): PromptLogDetail {
  const r = asRecord(raw);
  const row = normalizeLogRow(r);
  const inputText = asString(r.input_text);
  const outputText = asString(r.output_text);
  const restricted =
    typeof r.content_restricted === "boolean"
      ? r.content_restricted
      : (inputText ?? outputText) === null && !row.content_expired;
  return {
    ...row,
    input_text: inputText,
    output_text: outputText,
    content_restricted: restricted,
    provenance: asRecord(r.provenance),
    usage: asRecord(r.usage),
  };
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

/** Org scoping rides the query string; personal scope omits it. */
const orgQs = (orgId?: string | null) => qs({ org_id: orgId ?? undefined });

/** Human-readable message from a prompt-logs failure (FastAPI `detail` first). */
export function promptLogErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof ApiError) {
    const data = error.data;
    if (data && typeof data === "object" && "detail" in data) {
      const detail = (data as { detail: unknown }).detail;
      if (typeof detail === "string" && detail.trim()) return detail;
      if (Array.isArray(detail) && detail.length > 0) {
        const first = detail[0] as { msg?: unknown };
        if (typeof first?.msg === "string") return first.msg;
      }
    }
    if (error.status === 403) return "You don't have permission to view prompt logs.";
    if (error.status === 404) return "That prompt log no longer exists.";
    if (error.status >= 500) return "The server could not complete the request.";
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function isPromptLogStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}

/** Normalize one settings read: canonical fields win, legacy variance
 *  (missing key_ids/team_ids, string mode) degrades to safe defaults.
 *  Never throws. */
export function normalizeLoggingSettings(raw: unknown): PromptLoggingSettings {
  const r = asRecord(raw);
  const mode = asString(r.mode) ?? "global";
  return {
    workspace_type: asString(r.workspace_type) ?? "",
    enabled: r.enabled === true,
    mode,
    team_ids: asStringArray(r.team_ids),
    key_ids: asStringArray(r.key_ids),
    team_states: asBoolRecord(r.team_states),
    key_states: asTristateRecord(r.key_states),
    capture_input: r.capture_input !== false,
    capture_output: r.capture_output !== false,
    retention_days: asNumber(r.retention_days),
    version: asNumber(r.version) ?? 0,
    updated_by: asString(r.updated_by),
    updated_at: asString(r.updated_at),
    effective_summary:
      typeof r.effective_summary === "string" || (r.effective_summary !== null && typeof r.effective_summary === "object")
        ? (r.effective_summary as Record<string, unknown> | string)
        : "",
  };
}

export async function getPromptLoggingSettings(orgId?: string | null): Promise<PromptLoggingSettings> {
  const raw = await apiRequest<unknown>(`${PROMPT_LOGS_BASE}/settings${orgQs(orgId)}`);
  return normalizeLoggingSettings(raw);
}

/** `org_id` rides the PUT body (omit for personal scope). */
export async function updatePromptLoggingSettings(
  body: PromptLoggingUpdateInput,
): Promise<PromptLoggingSettings> {
  const raw = await apiRequest<unknown>(`${PROMPT_LOGS_BASE}/settings`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return normalizeLoggingSettings(raw);
}

/**
 * Per-team override. Org scoping rides `?org_id=` (personal scope omits it).
 * Resolves to the workspace default when the backend has no team row yet.
 */
export async function updateTeamLoggingState(
  orgId: string | null | undefined,
  teamId: string,
  enabled: boolean,
): Promise<PromptLoggingSettings> {
  const raw = await apiRequest<unknown>(
    `${PROMPT_LOGS_BASE}/settings/teams/${encodeURIComponent(teamId)}${orgQs(orgId ?? undefined)}`,
    { method: "PUT", body: JSON.stringify({ enabled }) },
  );
  return normalizeLoggingSettings(raw);
}

/**
 * Per-key override; `null` resets to inherit. Org scoping rides `?org_id=`.
 */
export async function updateKeyLoggingState(
  orgId: string | null | undefined,
  keyId: string,
  enabled: boolean | null,
): Promise<PromptLoggingSettings> {
  const raw = await apiRequest<unknown>(
    `${PROMPT_LOGS_BASE}/settings/keys/${encodeURIComponent(keyId)}${orgQs(orgId ?? undefined)}`,
    { method: "PUT", body: JSON.stringify({ enabled }) },
  );
  return normalizeLoggingSettings(raw);
}

export function listPromptLogTeams(orgId?: string | null): Promise<PromptLogTeam[]> {
  return apiRequest<PromptLogTeam[]>(`${PROMPT_LOGS_BASE}/teams${orgQs(orgId)}`);
}

export function getPromptLogRetention(orgId?: string | null): Promise<RetentionInfo> {
  return apiRequest<RetentionInfo>(`${PROMPT_LOGS_BASE}/retention${orgQs(orgId)}`);
}

/**
 * Cursor-paginated list. The next-page cursor travels the `X-Next-Cursor`
 * response header (falling back to a `nextCursor`/`next_cursor` body field),
 * so this stays a raw fetch: apiRequest only returns the parsed body.
 * The URL is built with the shared apiUrl() resolver. Accepts both the
 * `{items: [...]}` envelope and bare-array bodies; unknown shapes yield an
 * empty page, never a crash.
 */
export async function listPromptLogs(filters: PromptLogFilters = {}): Promise<PromptLogPage> {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl(`${PROMPT_LOGS_BASE}/logs${qs(filters as Record<string, string | undefined>)}`), {
    cache: "no-store",
    credentials: "include",
    headers,
  });
  const headerCursor = res.headers.get("X-Next-Cursor");
  if (res.status === 401) {
    useAuthStore.getState().reset();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let data: unknown = body;
    try { data = JSON.parse(body); } catch { /* not JSON */ }
    throw new ApiError(res.status, res.statusText, data, `GET ${PROMPT_LOGS_BASE}/logs -> ${res.status}`);
  }
  const body: unknown = await res.json().catch(() => null);
  const envelope = asRecord(body);
  const itemsRaw = Array.isArray(body) ? body : Array.isArray(envelope.items) ? envelope.items : [];
  const items = (itemsRaw as unknown[]).map(normalizeLogRow).filter((r) => r.id !== "");
  const bodyCursor = Array.isArray(body)
    ? null
    : (asString(envelope.nextCursor) ?? asString(envelope.next_cursor));
  return { items, nextCursor: headerCursor || bodyCursor || null };
}

export async function getPromptLog(id: string, orgId?: string | null): Promise<PromptLogDetail> {
  const raw = await apiRequest<unknown>(
    `${PROMPT_LOGS_BASE}/logs/${encodeURIComponent(id)}${orgQs(orgId)}`,
  );
  return normalizeLogDetail(raw);
}

export function deletePromptLog(id: string, orgId?: string | null): Promise<void> {
  return apiRequest<void>(
    `${PROMPT_LOGS_BASE}/logs/${encodeURIComponent(id)}${orgQs(orgId)}`,
    { method: "DELETE" },
  );
}

/**
 * Expire stored bodies (purge never deletes rows — it NULLs content, keeping
 * metadata). Accepts the canonical `expired_count` and the legacy `expired`.
 */
export async function purgePromptLogs(
  orgId?: string | null,
  before?: string,
): Promise<PurgeResult> {
  const raw = await apiRequest<{ expired_count?: unknown; expired?: unknown }>(
    `${PROMPT_LOGS_BASE}/logs/purge${orgQs(orgId)}`,
    {
      method: "POST",
      body: JSON.stringify(before ? { before } : {}),
    },
  );
  const count = asNumber(raw?.expired_count) ?? asNumber(raw?.expired) ?? 0;
  return { expired_count: Math.max(0, Math.floor(count)) };
}
