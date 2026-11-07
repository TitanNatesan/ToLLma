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

/** Backend-validated log levels (_LEVELS in api/prompt_logging/records.py). */
export const PROMPT_LOG_LEVELS = ["debug", "info", "warning", "error"] as const;
export type PromptLogLevel = (typeof PROMPT_LOG_LEVELS)[number];
export type PromptLogField = "input" | "output";

/** Wire mode: backend MODES is ("global", "keys"). The UI only ever sends
 *  these two values — key targeting rides `mode: "keys"`. */
export type PromptLoggingMode = "global" | "keys";

/** Legacy server-read mode: older backends still report `"teams"`. Used ONLY
 *  when normalizing server reads — never sent to the backend. */
export type LegacyPromptLoggingMode = PromptLoggingMode | "teams";

/** Non-global targeting mode sent by the UI: keys only, no teams. */
export const KEY_TARGET_MODE = "keys";

export interface PromptLoggingSettings {
  workspace_type: string;
  enabled: boolean;
  mode: PromptLoggingMode | string;
  /** Key targets (logged when enabled and not global).
   *  Absent on older backends — always normalized to an array. */
  key_ids: string[];
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
  /** Key targets, max 100 (UUIDs). Only meaningful when not global; global clears. */
  key_ids?: string[];
  /** Hierarchical overrides: global ON + any explicit disable is a 422. */
  key_states?: Record<string, boolean | null>;
  capture_input: boolean;
  capture_output: boolean;
  retention_days?: number | null;
}

export interface PromptLogRow {
  /** Wave 3 observability columns (NULL/unknown on older backends — always optional). */
  usage_estimated?: boolean | null;
  total_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  reasoning_tokens?: number | null;
  /** Decimal-serialized costs (Pydantic emits strings); NULL = unpriced. */
  input_cost?: string | number | null;
  output_cost?: string | number | null;
  total_cost?: string | number | null;
  currency?: string | null;
  pricing_version?: string | null;
  trace_id?: string | null;
  session_key?: string | null;
  finish_reason?: string | null;
  model_params?: Record<string, unknown> | null;
  level?: string | null;
  status_message?: string | null;
  error_code?: string | null;
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

export interface RetentionInfo {
  default_days: number;
  effective_days: number | null;
  next_run: string | null;
}

export interface PurgeResult {
  expired_count: number;
}

export interface PromptLogFilters {
  org_id?: string | null;
  user_id?: string;
  key_id?: string;
  provider_id?: string;
  model_id?: string;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
  trace_id?: string;
  session_key?: string;
  level?: string;
  min_cost?: string | number;
  max_cost?: string | number;
  min_tokens?: string | number;
  max_tokens?: string | number;
  limit?: number;
  cursor?: string;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Decimal-serialized cost: Pydantic emits strings, but tolerate numbers. Never throws. */
function asDecimal(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
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
  const modelParamsRaw = r.model_params;
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
    usage_estimated: typeof r.usage_estimated === "boolean" ? r.usage_estimated : null,
    total_tokens: asNumber(r.total_tokens),
    cache_read_tokens: asNumber(r.cache_read_tokens),
    cache_write_tokens: asNumber(r.cache_write_tokens),
    reasoning_tokens: asNumber(r.reasoning_tokens),
    input_cost: asDecimal(r.input_cost),
    output_cost: asDecimal(r.output_cost),
    total_cost: asDecimal(r.total_cost),
    currency: asString(r.currency),
    pricing_version: asString(r.pricing_version),
    trace_id: asString(r.trace_id),
    session_key: asString(r.session_key),
    finish_reason: asString(r.finish_reason),
    model_params:
      modelParamsRaw !== null && typeof modelParamsRaw === "object" && !Array.isArray(modelParamsRaw)
        ? (modelParamsRaw as Record<string, unknown>)
        : null,
    level: asString(r.level),
    status_message: asString(r.status_message),
    error_code: asString(r.error_code),
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
 *  (missing key_ids, string mode, dropped team legs) degrades to safe defaults.
 *  Never throws. */
export function normalizeLoggingSettings(raw: unknown): PromptLoggingSettings {
  const r = asRecord(raw);
  const mode: LegacyPromptLoggingMode | string = asString(r.mode) ?? "global";
  return {
    workspace_type: asString(r.workspace_type) ?? "",
    enabled: r.enabled === true,
    mode,
    key_ids: asStringArray(r.key_ids),
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

/* --- Wave 3: ledger export + scores (observability) --- */

/** Subset of PromptLogFilters the export endpoint accepts (it has no user/key/provider/q/date legs). */
export interface PromptLogExportFilters {
  trace_id?: string;
  session_key?: string;
  status?: string;
  level?: string;
  min_cost?: string | number;
  max_cost?: string | number;
  min_tokens?: string | number;
  max_tokens?: string | number;
}

export interface PromptLogExportResult {
  filename: string;
  /** Non-null when the server has more pages (X-Next-Cursor). Single-shot download: surface as truncation. */
  nextCursor: string | null;
}

/**
 * Ledger export (CSV/JSONL attachment). Raw fetch like the list: auth rides
 * Bearer + httpOnly cookies (`credentials: include`), the filename comes from
 * `Content-Disposition`, and the next-page cursor from `X-Next-Cursor`.
 */
export async function exportPromptLogs(
  filters: PromptLogExportFilters = {},
  format: "csv" | "jsonl" = "csv",
  orgId?: string | null,
): Promise<PromptLogExportResult> {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(
    apiUrl(`${PROMPT_LOGS_BASE}/logs/export${qs({ org_id: orgId ?? undefined, format, limit: 1000, ...filters })}`),
    { cache: "no-store", credentials: "include", headers },
  );
  if (res.status === 401) {
    useAuthStore.getState().reset();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let data: unknown = body;
    try { data = JSON.parse(body); } catch { /* not JSON */ }
    throw new ApiError(res.status, res.statusText, data, `GET ${PROMPT_LOGS_BASE}/logs/export -> ${res.status}`);
  }
  const blob = await res.blob();
  const match = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "");
  const filename = match?.[1] ?? `tollma-prompt-logs.${format === "jsonl" ? "jsonl" : "csv"}`;
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
  return { filename, nextCursor: res.headers.get("X-Next-Cursor") };
}

/** Score data types (mirror models/scores.py). */
export const SCORE_DATA_TYPES = ["numeric", "categorical", "boolean"] as const;
export type ScoreDataType = (typeof SCORE_DATA_TYPES)[number];

export interface ScoreRead {
  id: string;
  name: string;
  data_type: string;
  value_num: string | number | null;
  value_text: string | null;
  trace_id: string | null;
  prompt_log_id: string | null;
  session_key: string | null;
  experiment_id: string | null;
  source: string;
  config_name: string | null;
  comment: string | null;
  environment: string | null;
  user_id: string | null;
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScoreCreateInput {
  name: string;
  data_type: ScoreDataType | string;
  value_num?: number | null;
  value_text?: string | null;
  trace_id?: string | null;
  prompt_log_id?: string | null;
  session_key?: string | null;
  comment?: string | null;
}

export interface ScoreFilters {
  org_id?: string | null;
  trace_id?: string | null;
  prompt_log_id?: string | null;
  session_key?: string | null;
  name?: string;
  limit?: number;
  cursor?: string;
}

function asScore(v: unknown): ScoreRead | null {
  const r = asRecord(v);
  const id = asString(r.id);
  if (!id) return null;
  const num = r.value_num;
  return {
    id,
    name: asString(r.name) ?? "",
    data_type: asString(r.data_type) ?? "numeric",
    value_num:
      typeof num === "number" && Number.isFinite(num) ? num : typeof num === "string" ? num : null,
    value_text: asString(r.value_text),
    trace_id: asString(r.trace_id),
    prompt_log_id: asString(r.prompt_log_id),
    session_key: asString(r.session_key),
    experiment_id: asString(r.experiment_id),
    source: asString(r.source) ?? "human",
    config_name: asString(r.config_name),
    comment: asString(r.comment),
    environment: asString(r.environment),
    user_id: asString(r.user_id),
    org_id: asString(r.org_id),
    created_at: asString(r.created_at) ?? "",
    updated_at: asString(r.updated_at) ?? "",
  };
}

/** List scores for a log/trace (Read-gated server-side; visible wherever the log row is). */
export async function listScores(filters: ScoreFilters = {}): Promise<ScoreRead[]> {
  const raw = await apiRequest<unknown>(`/api/v1/scores${qs(filters as Record<string, string | undefined>)}`);
  const items = asRecord(raw).items;
  if (!Array.isArray(items)) return [];
  return items.map(asScore).filter((s): s is ScoreRead => s !== null);
}

/** Attach a human score to a log/trace. */
export async function createScore(body: ScoreCreateInput, orgId?: string | null): Promise<ScoreRead> {
  const raw = await apiRequest<unknown>(`/api/v1/scores${orgQs(orgId ?? undefined)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const score = asScore(raw);
  if (!score) throw new Error("The server returned an unreadable score.");
  return score;
}

/** Delete a score (Manage-gated server-side). */
export function deleteScore(id: string, orgId?: string | null): Promise<void> {
  return apiRequest<void>(`/api/v1/scores/${encodeURIComponent(id)}${orgQs(orgId ?? undefined)}`, {
    method: "DELETE",
  });
}
