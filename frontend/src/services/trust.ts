/**
 * Trust Center + Legal + Privacy API client (Agent E, Wave 3).
 *
 * Typed fetchers for the live Wave 3 contracts (F1 legal, F4/F5/F9 privacy,
 * F8 provider policies, F10 subprocessors, F vuln intake). Every fetcher
 * throws ApiError on failure — callers decide between seed fallback (legal
 * catalogue) and EmptyState/ErrorState (registries with no seed).
 *
 * The small GET/POST/PUT helpers mirror `services/admin.ts:adminGet` (same
 * auth contract: bearer + httpOnly cookies, one silent refresh-and-retry on
 * 401) because the shared `get` helper in `services/api.ts` is module-private.
 */

import { ApiError } from "@/services/api";
import { getAccessToken, useAuthStore } from "@/store/auth";
import type { AuthResponse } from "@/types";
import type {
  AbuseReviewItem,
  ComplianceCasePage,
  ComplianceStatusPatch,
  ConsentCategory,
  ConsentRead,
  DSRRead,
  DSRType,
  IntakeAccepted,
  LegalAcceptancePayload,
  LegalAcceptanceRead,
  LegalDocument,
  ProviderPolicy,
  RetentionCategory,
  RetentionRead,
  Subprocessor,
  UserWithAge,
  VulnIntake,
} from "@/types/trust";

function apiBase(): string {
  if (typeof window !== "undefined") {
    if (window.location.hostname && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }
  }
  return process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

async function trustReq<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    cache: "no-store",
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry) {
    const refreshed = await fetch(`${apiBase()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
    }).catch(() => null);
    if (refreshed?.ok) {
      const data = (await refreshed.json().catch(() => null)) as { access_token?: string } | null;
      if (data?.access_token) useAuthStore.getState().setAccessToken(data.access_token);
      return trustReq<T>(method, path, body, false);
    }
    useAuthStore.getState().reset();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // backend 500s may be non-JSON (e.g. reaccept bug) — keep raw text
    }
    throw new ApiError(res.status, res.statusText, data, `${method} ${path} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const trustGet = <T,>(path: string) => trustReq<T>("GET", path);
const trustPost = <T,>(path: string, body: unknown) => trustReq<T>("POST", path, body);
const trustPut = <T,>(path: string, body: unknown) => trustReq<T>("PUT", path, body);
const trustPatch = <T,>(path: string, body: unknown) => trustReq<T>("PATCH", path, body);

/** True for backend-absent (endpoint not built yet) vs. real failures. */
export function isNotBuiltError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501);
}

// --- Auth: age gate (F3; services/api.ts untouched — separate entry point) ---

/**
 * Password signup carrying the F3 18+ confirmation. Mirrors
 * `services/api:signup` (token storage + auth store) with `age_confirmed`.
 * Without it the backend 422s AGE_CONFIRMATION_REQUIRED.
 */
export async function signupWithAge(
  email: string,
  password: string,
  fullName: string | undefined,
  ageConfirmed: boolean,
): Promise<AuthResponse> {
  const res = await trustPost<AuthResponse>("/auth/signup", {
    email,
    password,
    full_name: fullName ?? null,
    age_confirmed: ageConfirmed,
  });
  if (res.access_token) {
    try {
      const { setStoredAccessToken } = await import("@/store/auth");
      setStoredAccessToken(res.access_token);
    } catch {
      // storage unavailable (SSR) — the auth store sync below still applies
    }
    useAuthStore.getState().setAccessToken(res.access_token);
  }
  return res;
}

/** One-click 18+ self-declaration for legacy/OAuth accounts (F3). */
export function confirmAge(): Promise<{ user: UserWithAge }> {
  return trustPost<{ user: UserWithAge }>("/auth/confirm-age", {});
}

// --- Legal (F1/F2 live; orchestrator implements) ---

export function listLegalDocuments(): Promise<LegalDocument[]> {
  return trustGet<LegalDocument[]>("/api/v1/legal/documents?locale=en-IN");
}

export function getLegalDocument(slug: string): Promise<LegalDocument> {
  return trustGet<LegalDocument>(`/api/v1/legal/documents/${encodeURIComponent(slug)}`);
}

export function acceptLegalDocument(payload: LegalAcceptancePayload): Promise<LegalAcceptanceRead> {
  return trustPost<LegalAcceptanceRead>("/api/v1/legal/acceptances", payload);
}

export function listMyAcceptances(): Promise<LegalAcceptanceRead[]> {
  return trustGet<LegalAcceptanceRead[]>("/api/v1/legal/acceptances/me");
}

/**
 * Docs needing re-acceptance. The Wave 3 backend 500s here
 * (`needs_reaccept` AttributeError — reported to orchestrator); callers
 * treat any failure as "unknown" and hide the banner rather than erroring.
 */
export async function listReacceptRequired(): Promise<LegalDocument[] | null> {
  try {
    return await trustGet<LegalDocument[]>("/api/v1/legal/reaccept-required");
  } catch {
    return null;
  }
}

// --- Privacy (F4/F5/F9 live; B implements) ---

export function listConsents(): Promise<ConsentRead[]> {
  return trustGet<ConsentRead[]>("/api/v1/privacy/consents");
}

export function setConsent(category: ConsentCategory, granted: boolean): Promise<ConsentRead> {
  return trustPut<ConsentRead>("/api/v1/privacy/consents", { category, granted, source: "settings_ui" });
}

export function listRetention(): Promise<RetentionRead[]> {
  return trustGet<RetentionRead[]>("/api/v1/privacy/retention");
}

export function setRetention(
  data_category: RetentionCategory,
  retention_days: number | null,
  zero_retention: boolean,
): Promise<RetentionRead> {
  return trustPut<RetentionRead>("/api/v1/privacy/retention", { data_category, retention_days, zero_retention });
}

export function listDSRs(): Promise<DSRRead[]> {
  return trustGet<DSRRead[]>("/api/v1/privacy/dsr");
}

export function submitDSR(type: DSRType, detail?: string): Promise<DSRRead> {
  return trustPost<DSRRead>("/api/v1/privacy/dsr", { type, detail: detail || undefined });
}

/** Full account export (JSON dict) — the caller triggers the download. */
export function requestFullExport(): Promise<Record<string, unknown>> {
  return trustGet<Record<string, unknown>>("/api/v1/privacy/export");
}

// --- Governance (F8 live; D implements) ---

export function listProviderPolicies(): Promise<ProviderPolicy[]> {
  return trustGet<ProviderPolicy[]>("/api/v1/governance/provider-policies");
}

// --- Subprocessors (F10 live; verified: GET /api/v1/subprocessors, no auth) ---

export function listSubprocessors(): Promise<Subprocessor[]> {
  return trustGet<Subprocessor[]>("/api/v1/subprocessors");
}

// --- Public vuln intake (F implements; Trust Center disclosure form posts here) ---

export function submitVulnReport(intake: VulnIntake): Promise<IntakeAccepted> {
  return trustPost<IntakeAccepted>("/api/v1/incidents/reports/vulnerability", {
    title: intake.title,
    details: intake.details,
    affected: intake.affected || undefined,
    reporter_contact: intake.reporter_contact || undefined,
  });
}

// --- Admin compliance (ADMIN_UI_SPEC.md §2; fetchers live page-side) ---

export interface ComplianceListParams {
  status?: string;
  severity?: string;
  limit?: number;
  cursor?: string | null;
  signal?: AbortSignal;
}

function complianceQuery(params: ComplianceListParams): string {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.severity) q.set("severity", params.severity);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.cursor) q.set("cursor", params.cursor);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Raw fetch returning the parsed body (for X-Next-Cursor header reads use adminComplianceFetch). */
export async function adminComplianceFetch<T>(path: string, signal?: AbortSignal): Promise<{ data: T; nextCursor: string | null }> {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${apiBase()}${path}`, { cache: "no-store", credentials: "include", headers, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, res.statusText, data, `GET ${path} -> ${res.status}`);
  }
  const headerCursor = res.headers.get("X-Next-Cursor");
  const data = (await res.json()) as T;
  const bodyCursor =
    data && typeof data === "object" && "next_cursor" in data && typeof (data as { next_cursor: unknown }).next_cursor === "string"
      ? (data as unknown as { next_cursor: string }).next_cursor
      : null;
  return { data, nextCursor: headerCursor ?? bodyCursor };
}

const COMPLIANCE_BASE = "/api/admin/compliance";

export function listComplianceCases(
  queue: "incidents" | "legal-requests" | "vuln-reports" | "complaints",
  params: ComplianceListParams,
): Promise<{ data: ComplianceCasePage; nextCursor: string | null }> {
  return adminComplianceFetch<ComplianceCasePage>(`${COMPLIANCE_BASE}/${queue}${complianceQuery(params)}`, params.signal);
}

export function getComplianceCase<T>(queue: string, id: string): Promise<T> {
  return trustGet<T>(`${COMPLIANCE_BASE}/${queue}/${encodeURIComponent(id)}`);
}

export function patchComplianceCase<T>(queue: string, id: string, patch: ComplianceStatusPatch): Promise<T> {
  const body: Record<string, unknown> = { to: patch.to };
  if (patch.note) body.note = patch.note;
  if (patch.link_incident_id) body.link_incident_id = patch.link_incident_id;
  if (patch.owner_admin_id) body.owner_admin_id = patch.owner_admin_id;
  return trustPatch<T>(`${COMPLIANCE_BASE}/${queue}/${encodeURIComponent(id)}`, body);
}

export function listAbuseReviews(params: ComplianceListParams): Promise<{ data: AbuseReviewItem[]; nextCursor: string | null }> {
  return adminComplianceFetch<AbuseReviewItem[]>(`${COMPLIANCE_BASE}/abuse-reviews${complianceQuery(params)}`, params.signal).then(
    ({ data }) => ({ data, nextCursor: null }),
  );
}
