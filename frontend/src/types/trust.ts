/**
 * Trust Center + Legal frontend types (Agent E, Wave 3).
 *
 * Live shapes verified against the Wave 3 backend (see ADMIN_UI_SPEC.md and
 * routers `api/legal`, `api/privacy`, `api/governance`, `api/incidents`).
 * Backend-extra fields are omitted or optional; reads tolerate unknown
 * shapes via the shared EmptyState/ErrorState paths, never crashes.
 */

import type { User } from "@/types";

export type LegalLifecycle = "draft" | "published" | "archived";

/** F1 identity; `summary`/`category` are E-side display (server has none). */
export interface LegalDocument {
  slug: string;
  version: string;
  title: string;
  locale: string;
  /** Server lifecycle field is `status`; `lifecycle` kept for seed rows. */
  status: string;
  lifecycle?: LegalLifecycle;
  content_hash: string;
  requires_reaccept: boolean;
  effective_at: string | null;
  published_at?: string | null;
  summary?: string;
  category?: "core" | "privacy" | "security" | "data" | "ai" | "operations";
  /** Full markdown body; present on detail reads, absent on list reads. */
  body?: string;
}

/** POST /api/v1/legal/acceptances (orchestrator). Method is server-set. */
export interface LegalAcceptancePayload {
  slug: string;
  ui_version?: string;
}

export interface LegalAcceptanceRead {
  id: string;
  document_slug: string;
  document_version: string;
  content_hash: string;
  accepted_at: string;
  method: string;
  locale: string;
}

/** /auth/me user with the F3 age gate (types/index.ts untouched — E scope). */
export type UserWithAge = User & { age_confirmed?: boolean | null };

/** F4 consent categories (frozen enum; functional is non-withdrawable). */
export type ConsentCategory =
  | "functional"
  | "analytics"
  | "prompt_logging"
  | "marketing"
  | "third_party_sharing";

export interface ConsentRead {
  id: string;
  category: string;
  status: string;
  version: number;
  granted_at: string | null;
  withdrawn_at: string | null;
  updated_at: string;
}

/** F9 retention categories (personal scope; org scope via org_id). */
export type RetentionCategory =
  | "conversations"
  | "messages"
  | "attachments"
  | "prompt_logs"
  | "request_logs"
  | "guardrail_triggers"
  | "api_request_logs";

export interface RetentionRead {
  id: string;
  data_category: string;
  retention_days: number | null;
  zero_retention: boolean;
  org_id: string | null;
  version: number;
  updated_at: string;
}

/** F5 DSR (E displays; B enforces; F owns grievance handoff). */
export type DSRType = "access" | "correction" | "erasure" | "portability" | "grievance";

export interface DSRRead {
  id: string;
  type: string;
  status: string;
  reason_code: string | null;
  detail: string | null;
  due_at: string;
  fulfilled_at: string | null;
  created_at: string;
  events?: Array<{
    id: string;
    from_status: string | null;
    to_status: string;
    note: string | null;
    created_at: string;
  }>;
}

/** Local-first cookie prefs (frontend behavior only — no backend). */
export interface CookiePrefs {
  analytics: boolean;
  marketing: boolean;
}

/** F8 provider-policy record (D → E). Extra server fields optional. */
export interface ProviderPolicy {
  id?: string;
  provider_key: string;
  scope: "global" | "organization";
  org_id?: string | null;
  display_name: string;
  terms_url?: string | null;
  aup_url?: string | null;
  privacy_url?: string | null;
  dpa_url?: string | null;
  status_page_url?: string | null;
  commercial_use_allowed?: boolean | null;
  training_on_inputs?: string | null;
  retention_summary?: string | null;
  retention_days?: number | null;
  dpa_available?: boolean | null;
  region_pinning_available?: boolean | null;
  last_reviewed_at?: string | null;
  review_cadence_days?: number | null;
  source_notes?: string | null;
  is_active?: boolean | null;
  stale?: boolean | null;
}

/** F10 subprocessor public shape. Admin-only fields never enter this type. */
export interface Subprocessor {
  name: string;
  purpose: string;
  location: string;
  status: string;
}

/** Public vuln intake (F) → Trust Center disclosure form. */
export interface VulnIntake {
  title: string;
  details: string;
  affected?: string;
  reporter_contact?: string;
}

export interface IntakeAccepted {
  id: string;
  status: string;
  received_at: string;
}

// --- Admin compliance (ADMIN_UI_SPEC.md §2; E implements, F owns API) ---

export interface ComplianceCaseItem {
  id: string;
  title: string;
  status: string;
  severity?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComplianceCasePage {
  items: ComplianceCaseItem[];
  next_cursor: string | null;
}

export interface ComplianceStatusPatch {
  to: string;
  note?: string;
  link_incident_id?: string;
  owner_admin_id?: string;
}

export interface AbuseReviewItem {
  id: string;
  reason_code: string;
  subject_type: string;
  subject_id: string | null;
  details: string;
  status: string;
  assignee: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubprocessorAdmin extends Subprocessor {
  id: string;
  dpa_ref: string | null;
  added_at: string;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}
