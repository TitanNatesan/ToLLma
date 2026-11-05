/**
 * Pure guardrail helpers: draft validation, payload builders, list filtering,
 * key-level assignment resolution. No JSX — covered by colocated vitest.
 *
 * Field names mirror backend `PolicyCreate`/`PolicyRead` exactly (`rules[]`,
 * `assignments[]`, `confidence_threshold`, `evaluator_timeout_ms`).
 */

import type {
  EvaluatorCreateInput,
  GuardrailAssignment,
  GuardrailCreateInput,
  GuardrailPolicy,
} from "@/services/guardrails";

/** Backend category vocabulary (`service.CATEGORIES`) — keep in sync. */
export const GUARDRAIL_CATEGORIES = [
  "harmful_content",
  "prompt_injection",
  "secret_leakage",
  "pii",
  "unsafe_output",
  "data_disclosure",
  "untrusted_instruction",
  "invalid_structure",
  "domain_violation",
  "tool_action",
] as const;

export interface GuardrailDraft {
  name: string;
  description?: string;
  severity: string;
  enforcement: string;
  stage: GuardrailStageValue;
  evaluator: string;
  delivery_mode: string;
  categories: string[];
  /** "global" applies to every request; "keys" applies to selected API keys only. */
  scope: string;
  provider_ids: string[];
  model_ids: string[];
  key_ids: string[];
  credentials: Record<string, string>;
  threshold: number | null;
  timeout_ms: number | null;
  needsLlmEscalation: boolean;
  escalationProviderId: string;
  escalationModelId: string;
}

export type GuardrailStageValue = "pre" | "post" | "both";

export const STEP_COUNT = 5;

/** Blank wizard state (create flow + edit-preload baseline). */
export function emptyGuardrailDraft(): GuardrailDraft {
  return {
    name: "", description: "", severity: "medium", enforcement: "monitor",
    stage: "both", evaluator: "deterministic", delivery_mode: "audit_after_delivery",
    categories: [], scope: "global", provider_ids: [], model_ids: [], key_ids: [],
    credentials: {}, threshold: 0.8, timeout_ms: 2000,
    needsLlmEscalation: false, escalationProviderId: "", escalationModelId: "",
  };
}

/** Step-4 scope choices: Global + specific API keys only (no teams, no providers). */
export const WIZARD_SCOPE_OPTIONS = [
  { value: "global", label: "Global", hint: "Applies globally — every request in this workspace." },
  { value: "keys", label: "Specific API keys", hint: "Applies only to the keys you select below." },
] as const;

/** Step-4 scope explainer (single source of truth for the dialog + tests). */
export const SCOPE_STEP_COPY = "Applies globally or to selected keys only.";

/** Step-2 detection explainer: categories never auto-select each other. */
export const DETECTION_STEP_COPY = "Only selected categories are evaluated.";

export interface WizardValidationOptions {
  /** Edit mode: stored credentials never round-trip to the client, so the
   *  evaluator step must not demand re-entry (rotation lives in the drawer). */
  isEditing?: boolean;
}

/** Step index (0-based) -> blocking error, or null when the step is valid. */
export function validateWizardStep(step: number, d: GuardrailDraft, opts?: WizardValidationOptions): string | null {
  const isEditing = opts?.isEditing === true;
  switch (step) {
    case 0:
      if (!d.name.trim()) return "Name is required.";
      return null;
    case 1:
      if (d.categories.length === 0) return "Pick at least one protection category.";
      if (d.categories.some((c) => !(GUARDRAIL_CATEGORIES as readonly string[]).includes(c))) {
        return "Unknown category — pick from the backend vocabulary.";
      }
      if (!d.severity) return "Pick a severity.";
      if (!d.stage) return "Pick a stage.";
      return null;
    case 2: {
      // Evaluator: jev needs credentials (api_key + base_url); openai_moderation
      // needs its own api_key; LLM escalation needs provider+model. Skipped in
      // edit mode — the save path never resends credentials.
      if (!isEditing && d.evaluator === "jev") {
        const missing = ["api_key", "base_url"].filter((k) => !(d.credentials[k] ?? "").trim());
        if (missing.length > 0) return "Jev needs an API key and base URL before continuing.";
      }
      if (!isEditing && d.evaluator === "openai_moderation" && !(d.credentials.api_key ?? "").trim()) {
        return "OpenAI Moderation needs an API key before continuing.";
      }
      if (d.needsLlmEscalation && (!d.escalationProviderId || !d.escalationModelId)) {
        return "LLM escalation needs both a provider and a model.";
      }
      // Mirrors backend create-path rule: only buffer_then_inspect withholds
      // output, and only on non-streaming post/both paths.
      if (d.delivery_mode === "buffer_then_inspect" && d.stage !== "post" && d.stage !== "both") {
        return "buffer_then_inspect requires stage post or both — pre-only inspection cannot withhold output.";
      }
      return null;
    }
    case 3: {
      if (d.scope !== "global" && d.scope !== "keys") {
        return "Pick a scope: global or specific API keys.";
      }
      if (d.scope === "keys" && d.key_ids.length === 0) {
        return "Key-scoped policies need at least one API key.";
      }
      return null;
    }
    case 4:
      if (d.threshold !== null && (Number.isNaN(d.threshold) || d.threshold < 0 || d.threshold > 1)) {
        return "Threshold must be between 0 and 1.";
      }
      if (d.timeout_ms !== null && (Number.isNaN(d.timeout_ms) || d.timeout_ms <= 0)) {
        return "Timeout must be a positive number of milliseconds.";
      }
      return null;
    default:
      return null;
  }
}

/** Build a backend-shaped `PolicyCreate` body from the wizard draft. */
export function buildPolicyPayload(
  d: GuardrailDraft,
  extras: {
    log_triggers: boolean;
    notify_on_trigger: boolean;
    failure_action: string;
    is_enabled: boolean;
  },
): GuardrailCreateInput {
  const trim = (ids: string[]) => ids.map((s) => s.trim()).filter(Boolean);
  const keys = trim(d.key_ids);
  const assignments: GuardrailAssignment[] =
    d.scope === "global" || keys.length === 0
      ? [{ scope_type: "global", applies_internal: true, applies_external: true }]
      : keys.map((api_key_id) => ({
          scope_type: "key" as const,
          api_key_id,
          applies_internal: true,
          applies_external: true,
        }));
  return {
    name: d.name.trim(),
    description: d.description || null,
    severity: d.severity,
    enforcement: d.enforcement,
    stage: d.stage,
    delivery_mode: d.delivery_mode,
    log_triggers: extras.log_triggers,
    notify_on_trigger: extras.notify_on_trigger,
    failure_action: extras.failure_action,
    is_enabled: extras.is_enabled,
    confidence_threshold: d.threshold,
    evaluator_timeout_ms: d.timeout_ms,
    rules: d.categories.map((category) => ({ category, severity: d.severity, config: {} })),
    assignments,
  };
}

/**
 * Evaluator configs to create right after the policy (deterministic = none).
 *
 * A checked LLM-escalation toggle appends a second `llm` row beside the
 * primary. The backend runs it as a second-stage judge
 * (`evaluation._needs_escalation`); `operation: "escalate"` is set so the
 * row fires on any positive signal even when no confidence threshold is
 * configured (threshold-only escalation would never fire then). A primary
 * `llm` evaluator is already a single llm row, so it is never duplicated.
 */
export function buildEvaluatorConfigs(d: GuardrailDraft): EvaluatorCreateInput[] {
  const out: EvaluatorCreateInput[] = [];
  if (d.evaluator === "jev") {
    const credentials: Record<string, unknown> = {};
    if (d.credentials.api_key?.trim()) credentials.api_key = d.credentials.api_key.trim();
    if (d.credentials.base_url?.trim()) credentials.base_url = d.credentials.base_url.trim();
    out.push({
      evaluator_type: "jev",
      credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
    });
  } else if (d.evaluator === "openai_moderation") {
    // Independent per-policy credential (jev pattern): stored encrypted,
    // validated live by the backend before persist. Never emitted when empty —
    // the backend rejects credential-less openai_moderation configs.
    const apiKey = d.credentials.api_key?.trim();
    out.push({
      evaluator_type: "openai_moderation",
      credentials: apiKey ? { api_key: apiKey } : undefined,
    });
  } else if (d.evaluator === "llm") {
    if (d.escalationProviderId) {
      out.push({ evaluator_type: "llm", provider_id: d.escalationProviderId, model_ref: d.escalationModelId || undefined });
    }
  } else if (d.evaluator === "laya") {
    out.push({ evaluator_type: "laya" });
  }
  if (d.needsLlmEscalation && d.evaluator !== "llm" && d.escalationProviderId) {
    out.push({
      evaluator_type: "llm",
      provider_id: d.escalationProviderId,
      model_ref: d.escalationModelId || undefined,
      operation: "escalate",
    });
  }
  return out;
}

/**
 * Edit-mode preload: saved policy -> wizard draft. Rules restore categories,
 * non-global assignments restore key scope, and a stored llm evaluator row
 * restores the escalation targets. Credentials stay empty on purpose — the
 * backend never returns secrets, and the edit save path never resends them
 * (rotation happens per-evaluator in the drawer).
 */
export function draftFromPolicy(policy: GuardrailPolicy): GuardrailDraft {
  const d = emptyGuardrailDraft();
  d.name = policy.name;
  d.description = policy.description ?? "";
  d.severity = policy.severity;
  d.enforcement = policy.enforcement;
  d.stage = (policy.stage as GuardrailDraft["stage"]) ?? "both";
  d.delivery_mode = policy.delivery_mode ?? "audit_after_delivery";
  d.categories = (policy.rules ?? []).map((r) => r.category);
  d.threshold = policy.confidence_threshold;
  d.timeout_ms = policy.evaluator_timeout_ms;
  const rows = policy.assignments ?? [];
  const targeted = rows.filter((a) => (a.scope_type ?? "global").toLowerCase() !== "global");
  // Scope model is Global + API keys only: any non-global assignment edits as
  // key scope (provider/model legs are dropped — re-pick keys or go global).
  if (targeted.length > 0) {
    d.scope = "keys";
    d.key_ids = targeted.map((a) => a.api_key_id).filter((v): v is string => !!v);
  }
  const evals = policy.evaluators ?? [];
  const primary = evals.find((e) => (e.evaluator_type ?? "").toLowerCase() !== "llm") ?? evals[0];
  const llm = evals.find((e) => (e.evaluator_type ?? "").toLowerCase() === "llm");
  d.evaluator = primary?.evaluator_type ?? "deterministic";
  if (llm && llm !== primary) {
    d.needsLlmEscalation = true;
    d.escalationProviderId = llm.provider_id ?? "";
    d.escalationModelId = llm.model_ref ?? "";
  } else if (primary && (primary.evaluator_type ?? "").toLowerCase() === "llm") {
    d.escalationProviderId = primary.provider_id ?? "";
    d.escalationModelId = primary.model_ref ?? "";
  }
  return d;
}

export interface PolicyFilter {
  q: string;
  severity: string; // "ALL" | severity
  enforcement: string; // "ALL" | enforcement
  enabled: string; // "ALL" | "on" | "off"
  scope: string; // "ALL" | "global" | "scoped"
}

export const EMPTY_FILTER: PolicyFilter = { q: "", severity: "ALL", enforcement: "ALL", enabled: "ALL", scope: "ALL" };

/** Scoped = at least one non-global assignment. */
export function isScoped(p: GuardrailPolicy): boolean {
  return (p.assignments ?? []).some((a) => (a.scope_type ?? "global").toLowerCase() !== "global");
}

/** Short human scope label derived from `assignments[]`. */
export function scopeSummary(p: GuardrailPolicy): string {
  const rows = p.assignments ?? [];
  if (rows.length === 0) return "Global";
  if (rows.some((a) => (a.scope_type ?? "global").toLowerCase() === "global")) return "Global";
  const kinds = new Set(rows.map((a) => (a.scope_type ?? "").toLowerCase()));
  return `Scoped (${[...kinds].sort().join(", ")})`;
}

/** Short evaluator label derived from `evaluators[]`. */
export function evaluatorSummary(p: GuardrailPolicy): string {
  const types = [...new Set((p.evaluators ?? []).map((e) => e.evaluator_type).filter(Boolean))];
  return types.length > 0 ? types.join(", ") : "deterministic";
}

/** Client-side list filtering for the policies table. */
export function filterPolicies(policies: GuardrailPolicy[], f: PolicyFilter): GuardrailPolicy[] {
  const q = f.q.trim().toLowerCase();
  return policies.filter((p) => {
    if (q && !`${p.name} ${p.description ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.severity !== "ALL" && p.severity !== f.severity) return false;
    if (f.enforcement !== "ALL" && p.enforcement !== f.enforcement) return false;
    if (f.enabled === "on" && !p.is_enabled) return false;
    if (f.enabled === "off" && p.is_enabled) return false;
    if (f.scope === "global" && isScoped(p)) return false;
    if (f.scope === "scoped" && !isScoped(p)) return false;
    return true;
  });
}

/**
 * Keys in the draft that are not part of the workspace (stale ids, or keys
 * from another workspace). Non-empty means the scope step must refuse the
 * save: assignments may only reference keys in this workspace.
 */
export function unknownScopeKeys(draft: GuardrailDraft, workspaceKeyIds: string[]): string[] {
  if (draft.scope === "global") return [];
  const known = new Set(workspaceKeyIds);
  return draft.key_ids.filter((id) => !known.has(id));
}

/** Where a failed save should land the wizard, with a readable message. */
export interface PolicySaveErrorMapping {
  step: number;
  message: string;
}

const CATEGORY_SAVE_ERROR = /categor|empty.?rules|at least one rule|rule.*required|rules.*block/i;
const SCOPE_SAVE_ERROR = /scope|workspace|api_key_id|unknown key|foreign key/i;

/** Pull a human-readable message out of any save failure (FastAPI `detail` first). */
function readableSaveDetail(error: unknown): string | null {
  if (typeof error === "string") return error.trim() || null;
  if (typeof error !== "object" || error === null) return null;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === "object") {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim().slice(0, 300);
    if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: unknown } | undefined;
      if (first && typeof first.msg === "string" && first.msg.trim()) {
        return first.msg.trim().slice(0, 300);
      }
    }
    const inner = (data as { error?: unknown }).error;
    if (inner && typeof inner === "object") {
      const msg = (inner as { message?: unknown }).message;
      if (typeof msg === "string" && msg.trim() && !msg.startsWith("An unexpected")) {
        return msg.trim().slice(0, 300);
      }
    }
  }
  return null;
}

/**
 * Map a failed policy save to the owning wizard step. Covers the backend
 * contract that block-enforcement policies REQUIRE >=1 rule (empty-rules+block
 * 422s land on Detection) and unknown/foreign key scope (lands on Scope).
 * Anything else with backend text lands on Review with that text; errors
 * without backend text return null (caller falls back to the generic toast).
 */
export function mapPolicySaveError(error: unknown): PolicySaveErrorMapping | null {
  const detail = readableSaveDetail(error);
  if (!detail) return null;
  if (CATEGORY_SAVE_ERROR.test(detail)) {
    return {
      step: 1,
      message: /block/i.test(detail)
        ? "Block-enforcement policies need at least one protection category. Pick at least one category on the Detection step, or switch enforcement to monitor."
        : "The server rejected the protection categories. Pick at least one known category on the Detection step.",
    };
  }
  if (SCOPE_SAVE_ERROR.test(detail)) {
    return {
      step: 3,
      message:
        "The server rejected the key scope. Selected keys must belong to this workspace — remove unknown keys or switch to global scope.",
    };
  }
  return { step: 4, message: detail };
}

export interface ReviewSummaryInput {
  keyNames?: Map<string, string>;
  enabled: boolean;
}

/**
 * Step-5 review rows: name / categories / evaluator / severity / stages /
 * scope / keys / mode / enabled. Single source of truth for the dialog and
 * the wizard scope test.
 */
export function buildReviewSummary(
  d: GuardrailDraft,
  input: ReviewSummaryInput,
): [string, string][] {
  const scope = d.scope === "global" ? "Global — every request" : `Keys (${d.key_ids.length} selected)`;
  const keys =
    d.scope === "global"
      ? "Every key"
      : d.key_ids.length === 0
        ? "—"
        : d.key_ids.map((id) => input.keyNames?.get(id) ?? `${id.slice(0, 8)}…`).join(", ");
  return [
    ["Name", d.name.trim() || "—"],
    ["Categories", d.categories.length > 0 ? d.categories.join(", ") : "—"],
    ["Evaluator", d.evaluator + (d.needsLlmEscalation ? " + LLM escalation" : "")],
    ["Severity", d.severity],
    ["Stages", d.stage],
    ["Scope", scope],
    ["Keys", keys],
    ["Mode", d.enforcement],
    ["Enabled", input.enabled ? "On" : "Off"],
  ];
}

/**
 * A policy row is locked when the backend flags it mandatory OR when it is an
 * enabled org policy with a global assignment (applies to every key in the org).
 * Disabled policies never lock (a mandatory-disabled row is unreachable — the
 * backend rejects disabling a mandatory policy with 422 — so this is defense
 * in depth). Locked rows show a lock and can never be detached or disabled.
 */
export function isPolicyLocked(p: GuardrailPolicy): boolean {
  if (!p.is_enabled) return false;
  if (p.is_mandatory) return true;
  if (p.org_id == null) return false;
  return (p.assignments ?? []).some((a) => (a.scope_type ?? "global").toLowerCase() === "global");
}

export interface KeyAssignmentInput {
  /** Policies applying via global/provider scope (read-only). */
  inherited: GuardrailPolicy[];
  /** All assignable policies. */
  assignable: GuardrailPolicy[];
  /** Currently assigned key-specific policy ids. */
  assignedIds: string[];
}

/** Split key-level assignment state; locked policies can never be unassigned. */
export function resolveKeyAssignments(input: KeyAssignmentInput): {
  effective: GuardrailPolicy[];
  lockedIds: Set<string>;
  toggleable: GuardrailPolicy[];
} {
  const all = [...input.inherited, ...input.assignable];
  const lockedIds = new Set(all.filter(isPolicyLocked).map((p) => p.id));
  const assigned = new Set(input.assignedIds);
  const effectiveMap = new Map<string, GuardrailPolicy>();
  for (const p of input.inherited) effectiveMap.set(p.id, p);
  for (const p of input.assignable) {
    if (assigned.has(p.id) || lockedIds.has(p.id)) effectiveMap.set(p.id, p);
  }
  return {
    effective: [...effectiveMap.values()],
    lockedIds,
    toggleable: input.assignable,
  };
}

/** Toggling a locked policy is a no-op (returns the set unchanged). */
export function toggleAssignment(assigned: Set<string>, locked: Set<string>, id: string): Set<string> {
  if (locked.has(id)) return new Set(assigned);
  const next = new Set(assigned);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
