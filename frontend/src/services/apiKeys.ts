/**
 * User API-key API client (`/api/v1/keys/*`).
 *
 * Session-authenticated and user-scoped: the backend resolves the owner from
 * the session, so no user id is ever sent. The raw key in create/rotate
 * responses is the only moment a secret crosses this client — callers must
 * hand it straight to the show-once dialog and drop it on close.
 *
 * Follows the `@/services/admin` pattern: resolved API base, bearer +
 * httpOnly cookie credentials, one silent refresh-and-retry on 401, and
 * `ApiError` wrapping. The replace endpoints (policy, IP rules, model
 * permissions) return the updated `KeyRead`.
 */

import { ApiError } from "@/services/api";
import { getAccessToken, setStoredAccessToken, useAuthStore } from "@/store/auth";
import type {
  AnalyticsGroupBy,
  ApiKey,
  ApiKeyAnalytics,
  ApiKeyAnalyticsPreset,
  ApiKeyAnalyticsQuery,
  ApiKeyAnalyticsSummary,
  ApiKeyCreateInput,
  ApiKeyInsightsResponse,
  ApiKeyIpRuleInput,
  ApiKeyModelPermissionInput,
  ApiKeyNetwork,
  ApiKeyPolicyInput,
  ApiKeySecretResponse,
  ApiKeyTimeseries,
  ApiKeyUpdateInput,
} from "@/types/apiKeys";

const BASE = "/api/v1/keys";
/** Rich observability API (`/api/analytics/api-keys/*`), same session auth. */
const ANALYTICS_BASE = "/api/analytics/api-keys";

// Server components resolve BACKEND_URL (service name); client components
// fall back to NEXT_PUBLIC_API_URL (host-mapped port for the browser).
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
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${apiBase()}${path}`, {
    cache: "no-store",
    credentials: "include", // httpOnly session cookies
    ...init,
    headers,
  });

  if (res.status === 401 && retry) {
    // Access token may have expired mid-session: one silent refresh, then retry.
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
    try {
      data = JSON.parse(body);
    } catch {
      // not JSON
    }
    const method = init?.method ?? "GET";
    throw new ApiError(
      res.status,
      res.statusText,
      data,
      `${method} ${path} -> ${res.status} ${body.slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
const put = <T,>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) });
const patch = <T,>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });

const keyPath = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

/** Human-readable message from an ApiError (FastAPI `detail` when present). */
export function apiKeyErrorMessage(error: unknown, fallback = "Something went wrong"): string {
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
    if (error.status === 403) return "This account cannot manage API keys.";
    if (error.status === 404) return "This API key no longer exists.";
    if (error.status >= 500) return "The server could not complete the request.";
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function isApiKeyStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}

/** The signed-in user's keys, newest first (backend ordering). */
export function listApiKeys(): Promise<ApiKey[]> {
  return get<ApiKey[]>(BASE);
}

export function getApiKey(id: string): Promise<ApiKey> {
  return get<ApiKey>(keyPath(id));
}

/** Creates a key; `raw_key` must be shown once and never persisted. */
export function createApiKey(body: ApiKeyCreateInput): Promise<ApiKeySecretResponse> {
  return post<ApiKeySecretResponse>(BASE, body);
}

export function updateApiKey(id: string, body: ApiKeyUpdateInput): Promise<ApiKey> {
  return patch<ApiKey>(keyPath(id), body);
}

export function deleteApiKey(id: string): Promise<void> {
  return del<void>(keyPath(id));
}

/** Rotates the secret; the previous key becomes invalid immediately. */
export function rotateApiKey(id: string): Promise<ApiKeySecretResponse> {
  return post<ApiKeySecretResponse>(`${keyPath(id)}/rotate`, {});
}

export function updateApiKeyPolicy(id: string, body: ApiKeyPolicyInput): Promise<ApiKey> {
  return put<ApiKey>(`${keyPath(id)}/policy`, body);
}

export function updateApiKeyIpRules(id: string, rules: ApiKeyIpRuleInput[]): Promise<ApiKey> {
  return put<ApiKey>(`${keyPath(id)}/ip-rules`, rules);
}

export function updateApiKeyModelPermissions(
  id: string,
  permissions: ApiKeyModelPermissionInput[],
): Promise<ApiKey> {
  return put<ApiKey>(`${keyPath(id)}/model-permissions`, permissions);
}

export function getApiKeyAnalytics(
  id: string,
  preset: ApiKeyAnalyticsPreset,
): Promise<ApiKeyAnalytics> {
  return get<ApiKeyAnalytics>(`${keyPath(id)}/analytics?preset=${encodeURIComponent(preset)}`);
}

// --- rich observability -----------------------------------------------------

function analyticsPath(id: string): string {
  return `${ANALYTICS_BASE}/${encodeURIComponent(id)}`;
}

/** Serializes `preset` (+ custom bounds) into the frozen query contract. */
function analyticsParams(params: ApiKeyAnalyticsQuery, extra?: Record<string, string>): string {
  const search = new URLSearchParams({ preset: params.preset });
  if (params.preset === "custom") {
    if (params.start) search.set("start", params.start);
    if (params.end) search.set("end", params.end);
  }
  for (const [key, value] of Object.entries(extra ?? {})) search.set(key, value);
  return search.toString();
}

/** Complete per-key roll-up: requests, performance, cost, tokens, breakdowns, insights. */
export function getKeyAnalytics(
  id: string,
  params: ApiKeyAnalyticsQuery,
): Promise<ApiKeyAnalyticsSummary> {
  return get<ApiKeyAnalyticsSummary>(`${analyticsPath(id)}?${analyticsParams(params)}`);
}

/** Bucketed history: request statuses, cost/tokens, latency and stacked group usage. */
export function getKeyTimeseries(
  id: string,
  params: ApiKeyAnalyticsQuery,
  groupBy: AnalyticsGroupBy = "model",
): Promise<ApiKeyTimeseries> {
  return get<ApiKeyTimeseries>(
    `${analyticsPath(id)}/timeseries?${analyticsParams(params, { group_by: groupBy })}`,
  );
}

/** Traffic origin: IPs, geo, devices and client/SDK distribution. */
export function getKeyNetwork(id: string, params: ApiKeyAnalyticsQuery): Promise<ApiKeyNetwork> {
  return get<ApiKeyNetwork>(`${analyticsPath(id)}/network?${analyticsParams(params)}`);
}

/** Same insights as the summary payload, fetched independently for the panel. */
export function getKeyInsights(
  id: string,
  params: ApiKeyAnalyticsQuery,
): Promise<ApiKeyInsightsResponse> {
  return get<ApiKeyInsightsResponse>(`${analyticsPath(id)}/insights?${analyticsParams(params)}`);
}
