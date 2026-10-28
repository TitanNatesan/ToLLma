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
  notifyRecipients: string;
}

export type GuardrailStageValue = "pre" | "post" | "both";

export const STEP_COUNT = 5;

/** Step index (0-based) -> blocking error, or null when the step is valid. */
export function validateWizardStep(step: number, d: GuardrailDraft): string | null {
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
      // needs its own api_key; LLM escalation needs provider+model.
      if (d.evaluator === "jev") {
        const missing = ["api_key", "base_url"].filter((k) => !(d.credentials[k] ?? "").trim());
        if (missing.length > 0) return "Jev needs an API key and base URL before continuing.";
      }
      if (d.evaluator === "openai_moderation" && !(d.credentials.api_key ?? "").trim()) {
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
    case 3:
      if (d.scope !== "global" && d.provider_ids.length === 0 && d.model_ids.length === 0 && d.key_ids.length === 0) {
        return "Scoped policies need at least one provider, model, or key.";
      }
      return null;
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
  const providers = trim(d.provider_ids);
  const models = trim(d.model_ids);
  const keys = trim(d.key_ids);
  const assignments: GuardrailAssignment[] =
    d.scope === "global" || (providers.length === 0 && models.length === 0 && keys.length === 0)
      ? [{ scope_type: "global", applies_internal: true, applies_external: true }]
      : [
          ...providers.map((provider_id) => ({
            scope_type: "provider" as const,
            provider_id,
            applies_internal: true,
            applies_external: true,
          })),
          // Backend scopes are global|provider|key; model targets ride a provider-scoped row.
          ...models.map((model_id) => ({
            scope_type: "provider" as const,
            model_id,
            applies_internal: true,
            applies_external: true,
          })),
          ...keys.map((api_key_id) => ({
            scope_type: "key" as const,
            api_key_id,
            applies_internal: true,
            applies_external: true,
          })),
        ];
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

/** Evaluator configs to create right after the policy (deterministic = none). */
export function buildEvaluatorConfigs(d: GuardrailDraft): EvaluatorCreateInput[] {
  if (d.evaluator === "jev") {
    const credentials: Record<string, unknown> = {};
    if (d.credentials.api_key?.trim()) credentials.api_key = d.credentials.api_key.trim();
    if (d.credentials.base_url?.trim()) credentials.base_url = d.credentials.base_url.trim();
    return [
      {
        evaluator_type: "jev",
        credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
      },
    ];
  }
  if (d.evaluator === "openai_moderation") {
    // Independent per-policy credential (jev pattern): stored encrypted,
    // validated live by the backend before persist. Never emitted when empty —
    // the backend rejects credential-less openai_moderation configs.
    const apiKey = d.credentials.api_key?.trim();
    return [
      {
        evaluator_type: "openai_moderation",
        credentials: apiKey ? { api_key: apiKey } : undefined,
      },
    ];
  }
  if (d.evaluator === "llm") {
    if (!d.escalationProviderId) return [];
    return [{ evaluator_type: "llm", provider_id: d.escalationProviderId, model_ref: d.escalationModelId || undefined }];
  }
  if (d.evaluator === "laya" || d.evaluator === "openai_moderation") {
    return [{ evaluator_type: d.evaluator }];
  }
  return [];
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
