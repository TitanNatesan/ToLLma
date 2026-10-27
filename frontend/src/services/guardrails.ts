/**
 * Guardrails API client (`/api/v1/guardrails/*`).
 *
 * Mirrors backend `backend/src/tollms/api/guardrails/{router,service,schemas}.py`
 * exactly: field names, org scoping, and shapes follow the router signatures.
 * Org scoping is `?org_id=` on every endpoint EXCEPT create (where `org_id`
 * rides in the POST body per `PolicyCreate`); personal scope omits it.
 */

import { ApiError } from "@/services/api";
import { getAccessToken, setStoredAccessToken, useAuthStore } from "@/store/auth";

export const GUARDRAILS_BASE = "/api/v1/guardrails";

export type GuardrailSeverity = "low" | "medium" | "high" | "critical";
export type GuardrailEnforcement = "monitor" | "warn" | "block";
export type GuardrailStage = "pre" | "post" | "both";
export type GuardrailDeliveryMode =
  | "buffer_then_inspect"
  | "inspect_before_buffer"
  | "audit_after_delivery"
  | "audit_then_delivery";
export type GuardrailEvaluatorType = "deterministic" | "laya" | "openai_moderation" | "jev" | "llm";
export type GuardrailScopeType = "global" | "provider" | "key";
export type GuardrailSource = "internal" | "external";

export interface GuardrailRule {
  id?: string;
  category: string;
  severity: string;
  config?: Record<string, unknown>;
}

export interface GuardrailAssignment {
  id?: string;
  scope_type: GuardrailScopeType | string;
  provider_id?: string | null;
  model_id?: string | null;
  api_key_id?: string | null;
  applies_internal: boolean;
  applies_external: boolean;
}

export interface GuardrailEvaluator {
  id: string;
  evaluator_type: string;
  provider_id: string | null;
  model_ref: string | null;
  credentials_masked: Record<string, string>;
  operation: string | null;
  timeout_ms: number | null;
  threshold: number | null;
}

/** Mirrors backend `PolicyRead` (+ `is_mandatory`, shipped in parallel). */
export interface GuardrailPolicy {
  id: string;
  name: string;
  description?: string | null;
  severity: string;
  enforcement: string;
  stage: string;
  delivery_mode: string;
  log_triggers: boolean;
  notify_on_trigger: boolean;
  failure_action: string;
  confidence_threshold: number | null;
  evaluator_timeout_ms: number;
  is_enabled: boolean;
  is_mandatory: boolean;
  is_template: boolean;
  version: number;
  org_id: string | null;
  rules: GuardrailRule[];
  evaluators: GuardrailEvaluator[];
  assignments: GuardrailAssignment[];
  created_at: string;
  updated_at: string;
}

/** Mirrors backend `PolicyCreate` (`org_id` rides in the body). */
export interface GuardrailCreateInput {
  name: string;
  description?: string | null;
  severity: string;
  enforcement: string;
  stage: string;
  delivery_mode?: string;
  log_triggers?: boolean;
  notify_on_trigger?: boolean;
  failure_action?: string;
  confidence_threshold?: number | null;
  evaluator_timeout_ms?: number | null;
  is_enabled?: boolean;
  org_id?: string | null;
  rules?: GuardrailRule[];
  assignments?: GuardrailAssignment[];
}

/** Mirrors backend `PolicyUpdate`. */
export type GuardrailUpdateInput = Partial<
  Pick<
    GuardrailCreateInput,
    | "name"
    | "description"
    | "severity"
    | "enforcement"
    | "stage"
    | "delivery_mode"
    | "log_triggers"
    | "notify_on_trigger"
    | "failure_action"
    | "confidence_threshold"
    | "evaluator_timeout_ms"
    | "is_enabled"
  >
> & { rules?: GuardrailRule[]; assignments?: GuardrailAssignment[] };

/** Mirrors backend `TestRequest` (`run_llm` shipped in parallel, default off). */
export interface GuardrailTestInput {
  content: string;
  stage?: string;
  credentials?: Record<string, unknown> | null;
  run_llm?: boolean;
}

/** Mirrors backend `TestResult` (+ `llm_skipped`, shipped in parallel). */
export interface GuardrailTestResult {
  verdict: string;
  action: string;
  confidence: number;
  categories: string[];
  reason: string | null;
  evaluator_type?: string | null;
  failure_kind?: string | null;
  llm_skipped?: boolean;
}

export interface GuardrailTemplate {
  key: string;
  name: string;
  description: string;
  severity: string;
  enforcement: string;
  stage: string;
  rules: GuardrailRule[];
  evaluator_types: string[];
}

/** Mirrors backend `EffectiveRead`. */
export interface EffectiveGuardrails {
  policies: GuardrailPolicy[];
  deciding_policy_id: string | null;
}

/** Mirrors backend `TriggerRead` — renders only what exists. */
export interface TriggerEvent {
  id: string;
  policy_id: string | null;
  policy_version: number;
  workspace_type: string;
  endpoint: string | null;
  source: string;
  stage: string | null;
  category: string | null;
  severity: string | null;
  confidence: number | null;
  enforcement: string | null;
  action: string;
  reason: string | null;
  latency_ms: number | null;
  notified: boolean;
  failure_kind: string | null;
  created_at: string;
}

export interface TriggerPage {
  items: TriggerEvent[];
  next_cursor?: string | null;
}

/** Mirrors backend `laya_health()` (`{"reachable": ...}` on every path). */
export interface LayaHealth {
  reachable: boolean;
  latency_ms?: number | null;
  message?: string | null;
  [key: string]: unknown;
}

/** Mirrors backend `EvaluatorCreate`. */
export interface EvaluatorCreateInput {
  evaluator_type: string;
  provider_id?: string | null;
  model_ref?: string | null;
  credentials?: Record<string, unknown> | null;
  operation?: string | null;
  timeout_ms?: number | null;
  threshold?: number | null;
}

/** Mirrors backend `EvaluatorPatch`. */
export interface EvaluatorPatchInput {
  provider_id?: string | null;
  model_ref?: string | null;
  credentials?: Record<string, unknown> | null;
  operation?: string | null;
  timeout_ms?: number | null;
  threshold?: number | null;
}

/** Mirrors backend `CredentialsValidate`. */
export interface CredentialsValidateInput {
  evaluator_type: string;
  credentials?: Record<string, unknown> | null;
  base_url?: string | null;
}

export interface CredentialsValidateResult {
  valid: boolean;
  message: string;
  latency_ms: number;
}

function apiBase(): string {
  if (typeof window !== "undefined") {
    if (window.location.hostname && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }
  }
  return process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${apiBase()}${path}`, { cache: "no-store", credentials: "include", ...init, headers });
  if (res.status === 401 && retry) {
    const refreshed = await fetch(`${apiBase()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
    }).catch(() => null);
    if (refreshed?.ok) {
      const data = (await refreshed.json().catch(() => null)) as { access_token?: string } | null;
      if (data?.access_token) {
        setStoredAccessToken(data.access_token);
        useAuthStore.getState().setAccessToken(data.access_token);
      }
      return request<T>(path, init, false);
    }
    useAuthStore.getState().reset();
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let data: unknown = body;
    try { data = JSON.parse(body); } catch { /* not JSON */ }
    throw new ApiError(res.status, res.statusText, data, `${init?.method ?? "GET"} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T,>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

/** Org scoping rides the query string; personal scope omits it. `org_id` = nullish → "". */
const orgQs = (orgId?: string | null) => qs({ org_id: orgId ?? undefined });

const policyPath = (id: string, orgId?: string | null) =>
  `${GUARDRAILS_BASE}/${encodeURIComponent(id)}${orgQs(orgId)}`;

/** Human-readable message from a guardrails failure (FastAPI `detail` first). */
export function guardrailErrorMessage(error: unknown, fallback = "Something went wrong"): string {
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
    if (error.status === 403) return "You don't have permission to manage guardrails.";
    if (error.status === 404) return "That guardrail no longer exists.";
    if (error.status >= 500) return "The server could not complete the request.";
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function isGuardrailStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}

export async function listGuardrails(orgId?: string | null): Promise<GuardrailPolicy[]> {
  return get<GuardrailPolicy[]>(`${GUARDRAILS_BASE}${orgQs(orgId)}`);
}

export function getGuardrail(id: string, orgId?: string | null): Promise<GuardrailPolicy> {
  return get<GuardrailPolicy>(policyPath(id, orgId));
}

/** `org_id` rides the POST body (matches `PolicyCreate`); omit for personal scope. */
export function createGuardrail(body: GuardrailCreateInput): Promise<GuardrailPolicy> {
  return post<GuardrailPolicy>(GUARDRAILS_BASE, body);
}

export function updateGuardrail(id: string, body: GuardrailUpdateInput, orgId?: string | null): Promise<GuardrailPolicy> {
  return patch<GuardrailPolicy>(policyPath(id, orgId), body);
}

export function deleteGuardrail(id: string, orgId?: string | null): Promise<void> {
  return del<void>(policyPath(id, orgId));
}

export function cloneGuardrail(id: string, orgId?: string | null): Promise<GuardrailPolicy> {
  return post<GuardrailPolicy>(`${GUARDRAILS_BASE}/${encodeURIComponent(id)}/clone${orgQs(orgId)}`, undefined);
}

export function enableGuardrail(id: string, orgId?: string | null): Promise<GuardrailPolicy> {
  return post<GuardrailPolicy>(`${GUARDRAILS_BASE}/${encodeURIComponent(id)}/enable${orgQs(orgId)}`, undefined);
}

export function disableGuardrail(id: string, orgId?: string | null): Promise<GuardrailPolicy> {
  return post<GuardrailPolicy>(`${GUARDRAILS_BASE}/${encodeURIComponent(id)}/disable${orgQs(orgId)}`, undefined);
}

export function testGuardrail(id: string, body: GuardrailTestInput, orgId?: string | null): Promise<GuardrailTestResult> {
  return post<GuardrailTestResult>(`${GUARDRAILS_BASE}/${encodeURIComponent(id)}/test${orgQs(orgId)}`, body);
}

export async function listGuardrailTemplates(): Promise<GuardrailTemplate[]> {
  return get<GuardrailTemplate[]>(`${GUARDRAILS_BASE}/templates`);
}

export function createGuardrailFromTemplate(key: string, orgId?: string | null): Promise<GuardrailPolicy> {
  return post<GuardrailPolicy>(`${GUARDRAILS_BASE}/from-template/${encodeURIComponent(key)}${orgQs(orgId)}`, undefined);
}

export function getLayaHealth(): Promise<LayaHealth> {
  return get<LayaHealth>(`${GUARDRAILS_BASE}/health/laya`);
}

export function validateGuardrailCredentials(body: CredentialsValidateInput): Promise<CredentialsValidateResult> {
  return post<CredentialsValidateResult>(`${GUARDRAILS_BASE}/credentials/validate`, body);
}

export function listEvaluators(policyId: string, orgId?: string | null): Promise<GuardrailEvaluator[]> {
  return get<GuardrailEvaluator[]>(`${GUARDRAILS_BASE}/${encodeURIComponent(policyId)}/evaluators${orgQs(orgId)}`);
}

export function createEvaluator(policyId: string, body: EvaluatorCreateInput, orgId?: string | null): Promise<GuardrailEvaluator> {
  return post<GuardrailEvaluator>(`${GUARDRAILS_BASE}/${encodeURIComponent(policyId)}/evaluators${orgQs(orgId)}`, body);
}

export function patchEvaluator(evaluatorId: string, body: EvaluatorPatchInput, orgId?: string | null): Promise<GuardrailEvaluator> {
  return patch<GuardrailEvaluator>(
    `${GUARDRAILS_BASE}/evaluators/${encodeURIComponent(evaluatorId)}${orgQs(orgId)}`,
    body,
  );
}

export function revalidateEvaluator(evaluatorId: string, orgId?: string | null): Promise<CredentialsValidateResult> {
  return post<CredentialsValidateResult>(
    `${GUARDRAILS_BASE}/evaluators/${encodeURIComponent(evaluatorId)}/revalidate${orgQs(orgId)}`,
    undefined,
  );
}

export function deleteEvaluator(evaluatorId: string, orgId?: string | null): Promise<void> {
  return del<void>(`${GUARDRAILS_BASE}/evaluators/${encodeURIComponent(evaluatorId)}${orgQs(orgId)}`);
}

/** Applicable policies for a provider/model/key tuple (all ids optional). */
export function getEffectiveGuardrails(params?: {
  provider_id?: string;
  model_id?: string;
  key_id?: string;
  org_id?: string | null;
  source?: string;
}): Promise<EffectiveGuardrails> {
  return get<EffectiveGuardrails>(`${GUARDRAILS_BASE}/effective${qs(params ?? {})}`);
}

export interface TriggerFilters {
  org_id?: string | null;
  workspace_type?: string;
  policy_id?: string;
  severity?: string;
  action?: string;
  source?: string;
  provider_id?: string;
  key_id?: string;
  cursor?: string;
  limit?: number;
}

export async function listTriggers(filters: TriggerFilters = {}): Promise<TriggerPage> {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${apiBase()}${GUARDRAILS_BASE}/triggers${qs(filters as Record<string, string | undefined>)}`, {
    cache: "no-store",
    credentials: "include",
    headers,
  });
  const nextCursor = res.headers.get("X-Next-Cursor");
  if (res.status === 401) {
    useAuthStore.getState().reset();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let data: unknown = body;
    try { data = JSON.parse(body); } catch { /* not JSON */ }
    throw new ApiError(res.status, res.statusText, data, `GET ${GUARDRAILS_BASE}/triggers -> ${res.status}`);
  }
  const items = (await res.json()) as TriggerEvent[];
  return { items, next_cursor: nextCursor };
}

export function getTrigger(id: string, orgId?: string | null): Promise<TriggerEvent> {
  return get<TriggerEvent>(`${GUARDRAILS_BASE}/triggers/${encodeURIComponent(id)}${orgQs(orgId)}`);
}

/** Attach a key via `assignments` (fetch-merge-write, never clobbers). */
export async function attachKeyToGuardrails(policyIds: string[], keyId: string, orgId?: string | null): Promise<void> {
  await Promise.all(
    policyIds.map(async (id) => {
      const current = await getGuardrail(id, orgId).catch(() => null);
      if (!current) return;
      if ((current.assignments ?? []).some((a) => a.scope_type === "key" && a.api_key_id === keyId)) return;
      await updateGuardrail(
        id,
        {
          assignments: [
            ...current.assignments,
            { scope_type: "key", api_key_id: keyId, applies_internal: true, applies_external: true },
          ],
        },
        orgId,
      );
    }),
  );
}

/** Detach a key by dropping its `key`-scoped assignments (fetch-merge-write). */
export async function detachKeyFromGuardrails(policyIds: string[], keyId: string, orgId?: string | null): Promise<void> {
  await Promise.all(
    policyIds.map(async (id) => {
      const current = await getGuardrail(id, orgId).catch(() => null);
      if (!current) return;
      await updateGuardrail(
        id,
        { assignments: current.assignments.filter((a) => !(a.scope_type === "key" && a.api_key_id === keyId)) },
        orgId,
      );
    }),
  );
}
