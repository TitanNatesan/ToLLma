/**
 * Platform admin API client (`/api/admin/*`).
 *
 * Every response is pre-aggregated server-side: counts, tokens, costs,
 * latencies, names and statuses only — never message content.
 *
 * The shared `get` helper in `@/services/api` is module-private (that file is
 * out of scope for this change), so this module owns a small GET helper with
 * the exact same contract: resolved API base, bearer + httpOnly cookie auth,
 * one silent refresh-and-retry on 401, and `ApiError` wrapping.
 */

import { ApiError } from "@/services/api";
import { getAccessToken, useAuthStore } from "@/store/auth";
import type {
  AdminApiKeys,
  AdminCache,
  AdminCosts,
  AdminDashboard,
  AdminErrors,
  AdminHealth,
  AdminMedia,
  AdminModels,
  AdminProviders,
  AdminQueryParams,
  AdminTokens,
  AdminUsage,
  AdminUsers,
} from "@/types/admin";

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

async function adminGet<T>(path: string, retry = true): Promise<T> {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${apiBase()}${path}`, {
    cache: "no-store",
    credentials: "include", // httpOnly session cookies
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
        useAuthStore.getState().setAccessToken(data.access_token);
      }
      return adminGet<T>(path, false);
    }
    useAuthStore.getState().reset();
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let data: unknown = body;
    try {
      data = JSON.parse(body);
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, res.statusText, data, `GET ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function query(params: AdminQueryParams): string {
  const q = new URLSearchParams({ preset: params.preset, timezone: params.timezone });
  if (params.granularity) q.set("granularity", params.granularity);
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  if (params.search) q.set("search", params.search);
  return q.toString();
}

/** 403 means the account is not a platform administrator. */
export function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export function getAdminDashboard(params: AdminQueryParams): Promise<AdminDashboard> {
  return adminGet<AdminDashboard>(`/api/admin/dashboard?${query(params)}`);
}

export function getAdminUsage(params: AdminQueryParams): Promise<AdminUsage> {
  return adminGet<AdminUsage>(`/api/admin/usage?${query(params)}`);
}

export function getAdminCosts(params: AdminQueryParams): Promise<AdminCosts> {
  return adminGet<AdminCosts>(`/api/admin/costs?${query(params)}`);
}

export function getAdminTokens(params: AdminQueryParams): Promise<AdminTokens> {
  return adminGet<AdminTokens>(`/api/admin/tokens?${query(params)}`);
}

export function getAdminCache(params: AdminQueryParams): Promise<AdminCache> {
  return adminGet<AdminCache>(`/api/admin/cache?${query(params)}`);
}

export function getAdminMedia(params: AdminQueryParams): Promise<AdminMedia> {
  return adminGet<AdminMedia>(`/api/admin/media?${query(params)}`);
}

export function getAdminErrors(params: AdminQueryParams): Promise<AdminErrors> {
  return adminGet<AdminErrors>(`/api/admin/errors?${query(params)}`);
}

export function getAdminModels(params: AdminQueryParams): Promise<AdminModels> {
  return adminGet<AdminModels>(`/api/admin/models?${query(params)}`);
}

export function getAdminProviders(params: AdminQueryParams): Promise<AdminProviders> {
  return adminGet<AdminProviders>(`/api/admin/providers?${query(params)}`);
}

export function getAdminUsers(params: AdminQueryParams): Promise<AdminUsers> {
  return adminGet<AdminUsers>(`/api/admin/users?${query(params)}`);
}

/** Health is platform-wide (not range-scoped); extra query params are ignored. */
export function getAdminHealth(): Promise<AdminHealth> {
  return adminGet<AdminHealth>("/api/admin/health");
}

/** Platform-wide API-key inventory and usage analytics. */
export function getAdminApiKeys(params: AdminQueryParams): Promise<AdminApiKeys> {
  return adminGet<AdminApiKeys>(`/api/admin/api-keys?${query(params)}`);
}
