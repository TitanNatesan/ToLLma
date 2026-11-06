"use client";

/**
 * Admin compliance data layer (Agent E, Wave 3; ADMIN_UI_SPEC.md §2).
 * Page-local: query keys are the F contract (do not rename without F).
 * Report PII appears on detail reads only, behind the page's isAdmin gate.
 */

import { ApiError } from "@/services/api";
import { getAccessToken } from "@/store/auth";
import type {
  AbuseReviewItem,
  ComplianceCasePage,
  ComplianceStatusPatch,
  SubprocessorAdmin,
} from "@/types/trust";
import { adminComplianceFetch, getComplianceCase, patchComplianceCase } from "@/services/trust";

function apiBase(): string {
  if (typeof window !== "undefined") {
    if (window.location.hostname && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }
  }
  return process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

async function adminWrite<T>(method: "POST" | "PATCH", path: string, body: unknown): Promise<T> {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, res.statusText, data, `${method} ${path} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const BASE = "/api/admin/compliance";

export type CaseQueue = "incidents" | "legal-requests" | "vuln-reports" | "complaints";

/** Server status enums (ADMIN_UI_SPEC.md §2) — display formatting is local. */
export const CASE_STATUSES: Record<CaseQueue | "abuse-reviews", string[]> = {
  incidents: ["open", "triaged", "mitigating", "resolved", "closed", "duplicate"],
  "legal-requests": ["received", "verifying", "validated", "in_review", "fulfilled", "rejected", "closed"],
  "vuln-reports": ["received", "triaged", "confirmed", "fixed", "disclosed", "dismissed", "closed"],
  complaints: ["received", "under_review", "resolved", "dismissed", "escalated", "closed"],
  "abuse-reviews": ["submitted", "under_review", "action_taken", "dismissed", "appeal_filed", "action_upheld", "action_reversed"],
};

/** `snake_case` → `Snake case` for status display. Server values stay canonical. */
export function humanizeStatus(status: string): string {
  const s = status.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function listCases(queue: CaseQueue, status: string | null, cursor: string | null, signal?: AbortSignal) {
  const q = new URLSearchParams({ limit: "25" });
  if (status) q.set("status", status);
  if (cursor) q.set("cursor", cursor);
  return adminComplianceFetch<ComplianceCasePage>(`${BASE}/${queue}?${q.toString()}`, signal);
}

export function getCaseDetail<T>(queue: CaseQueue, id: string): Promise<T> {
  return getComplianceCase<T>(queue, id);
}

export function patchCase<T>(queue: CaseQueue, id: string, patch: ComplianceStatusPatch): Promise<T> {
  return patchComplianceCase<T>(queue, id, patch);
}

export function listAbuseReviews(status: string | null, signal?: AbortSignal) {
  const q = new URLSearchParams({ limit: "50" });
  if (status) q.set("status", status);
  return adminComplianceFetch<AbuseReviewItem[]>(`${BASE}/abuse-reviews?${q.toString()}`, signal);
}

export function listVendors(): Promise<SubprocessorAdmin[]> {
  return adminComplianceFetch<SubprocessorAdmin[]>(`${BASE}/subprocessors`).then(({ data }) => data);
}

export function createVendor(body: { name: string; purpose?: string; location?: string; status?: string; dpa_ref?: string }): Promise<SubprocessorAdmin> {
  return adminWrite<SubprocessorAdmin>("POST", `${BASE}/subprocessors`, body);
}

export function patchVendor(id: string, body: Partial<Pick<SubprocessorAdmin, "purpose" | "location" | "status" | "dpa_ref">>): Promise<SubprocessorAdmin> {
  return adminWrite<SubprocessorAdmin>("PATCH", `${BASE}/subprocessors/${encodeURIComponent(id)}`, body);
}

/** Detail shapes (admin-only PII fields included; never rendered for non-admin). */
export interface TimelineEntry {
  at: string;
  actor: string;
  from?: string;
  to: string;
  note?: string | null;
}

export interface IncidentDetail {
  id: string;
  title: string;
  status: string;
  severity?: string | null;
  kind: string;
  summary?: string | null;
  timeline?: TimelineEntry[];
  owner_admin_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LegalRequestDetail {
  id: string;
  title: string;
  status: string;
  request_type: string;
  claimant: string;
  authority_ref?: string | null;
  reporter_contact?: string | null;
  verify_notes?: string | null;
  due_at?: string | null;
  timeline?: TimelineEntry[];
  created_at: string;
  updated_at: string;
}

export interface VulnReportDetail {
  id: string;
  title: string;
  status: string;
  severity?: string | null;
  affected?: string | null;
  details?: string;
  reporter_contact?: string | null;
  related_incident_id?: string | null;
  timeline?: TimelineEntry[];
  created_at: string;
  updated_at: string;
}

export interface ComplaintDetail {
  id: string;
  title: string;
  status: string;
  category: string;
  details?: string;
  reporter_contact?: string | null;
  sla_due_at?: string | null;
  related_incident_id?: string | null;
  timeline?: TimelineEntry[];
  created_at: string;
  updated_at: string;
}
