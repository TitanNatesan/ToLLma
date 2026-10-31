import { describe, expect, it } from "vitest";
import {
  DETECTION_STEP_COPY,
  EMPTY_FILTER,
  SCOPE_STEP_COPY,
  WIZARD_SCOPE_OPTIONS,
  buildEvaluatorConfigs,
  buildPolicyPayload,
  buildReviewSummary,
  evaluatorSummary,
  filterPolicies,
  isPolicyLocked,
  isScoped,
  resolveKeyAssignments,
  scopeSummary,
  toggleAssignment,
  unknownScopeKeys,
  validateWizardStep,
  type GuardrailDraft,
} from "../components/policyLogic";
import type { GuardrailPolicy } from "@/services/guardrails";

const draft = (patch: Partial<GuardrailDraft> = {}): GuardrailDraft => ({
  name: "PII block",
  description: "",
  severity: "high",
  enforcement: "block",
  stage: "both",
  evaluator: "deterministic",
  delivery_mode: "audit_after_delivery",
  categories: ["pii"],
  scope: "global",
  provider_ids: [],
  model_ids: [],
  key_ids: [],
  credentials: {},
  threshold: 0.8,
  timeout_ms: 2000,
  needsLlmEscalation: false,
  escalationProviderId: "",
  escalationModelId: "",
  notifyRecipients: "",
  ...patch,
});

const EXTRAS = { log_triggers: true, notify_on_trigger: false, failure_action: "allow", is_enabled: true };

const policy = (patch: Partial<GuardrailPolicy> = {}): GuardrailPolicy => ({
  id: "p1",
  name: "PII block",
  severity: "high",
  enforcement: "block",
  stage: "both",
  delivery_mode: "audit_after_delivery",
  log_triggers: true,
  notify_on_trigger: false,
  failure_action: "allow",
  confidence_threshold: 0.8,
  evaluator_timeout_ms: 2000,
  is_enabled: true,
  is_mandatory: false,
  is_template: false,
  version: 1,
  org_id: null,
  rules: [{ category: "pii", severity: "high", config: {} }],
  evaluators: [],
  assignments: [{ scope_type: "global", applies_internal: true, applies_external: true }],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...patch,
});

describe("validateWizardStep", () => {
  it("requires a name on step 0", () => {
    expect(validateWizardStep(0, draft({ name: "  " }))).toMatch(/name/i);
    expect(validateWizardStep(0, draft())).toBeNull();
  });
  it("requires known-vocabulary categories on step 1", () => {
    expect(validateWizardStep(1, draft({ categories: [] }))).toMatch(/categor/i);
    expect(validateWizardStep(1, draft({ categories: ["toxicity"] }))).toMatch(/vocabulary/i);
    expect(validateWizardStep(1, draft({ categories: ["pii", "prompt_injection"] }))).toBeNull();
  });
  it("rejects buffer_then_inspect on pre-only, allows audit modes on pre", () => {
    expect(validateWizardStep(2, draft({ stage: "pre", delivery_mode: "buffer_then_inspect" }))).toMatch(/post/i);
    expect(validateWizardStep(2, draft({ stage: "pre", delivery_mode: "audit_after_delivery" }))).toBeNull();
    expect(validateWizardStep(2, draft({ stage: "both", delivery_mode: "buffer_then_inspect" }))).toBeNull();
  });
  it("requires jev api key + base_url and escalation targets", () => {
    expect(validateWizardStep(2, draft({ evaluator: "jev", credentials: {} }))).toMatch(/jev/i);
    expect(validateWizardStep(2, draft({ evaluator: "jev", credentials: { api_key: "k", api_url: "u" } }))).toMatch(/jev/i);
    expect(validateWizardStep(2, draft({ evaluator: "jev", credentials: { api_key: "k", base_url: "u" } }))).toBeNull();
    expect(validateWizardStep(2, draft({ needsLlmEscalation: true }))).toMatch(/escalation/i);
  });
  it("requires an api key for openai_moderation before continuing", () => {
    expect(validateWizardStep(2, draft({ evaluator: "openai_moderation", credentials: {} }))).toMatch(/api key/i);
    expect(validateWizardStep(2, draft({ evaluator: "openai_moderation", credentials: { api_key: "  " } }))).toMatch(/api key/i);
    expect(validateWizardStep(2, draft({ evaluator: "openai_moderation", credentials: { api_key: "sk-test" } }))).toBeNull();
  });
  it("requires keys for key-scoped policies (global + keys only)", () => {
    expect(validateWizardStep(3, draft({ scope: "keys" }))).toMatch(/key/i);
    expect(validateWizardStep(3, draft({ scope: "keys", key_ids: ["k1"] }))).toBeNull();
    expect(validateWizardStep(3, draft({ scope: "global" }))).toBeNull();
    expect(validateWizardStep(3, draft({ scope: "targeted" }))).toMatch(/global or specific API keys/i);
  });
  it("bounds threshold and timeout", () => {
    expect(validateWizardStep(4, draft({ threshold: 2 }))).toMatch(/threshold/i);
    expect(validateWizardStep(4, draft({ timeout_ms: -1 }))).toMatch(/timeout/i);
    expect(validateWizardStep(4, draft())).toBeNull();
  });
});

describe("buildPolicyPayload", () => {
  it("uses backend field names (rules, assignments, confidence_threshold, evaluator_timeout_ms)", () => {
    const body = buildPolicyPayload(draft({ categories: ["pii", "secret_leakage"] }), EXTRAS);
    expect(body.rules).toEqual([
      { category: "pii", severity: "high", config: {} },
      { category: "secret_leakage", severity: "high", config: {} },
    ]);
    expect(body.assignments).toEqual([
      { scope_type: "global", applies_internal: true, applies_external: true },
    ]);
    expect(body.confidence_threshold).toBe(0.8);
    expect(body.evaluator_timeout_ms).toBe(2000);
    expect(body).not.toHaveProperty("threshold");
    expect(body).not.toHaveProperty("timeout_ms");
    expect(body).not.toHaveProperty("evaluator");
    expect(body).not.toHaveProperty("categories");
  });
  it("maps key ids to key assignments only (global + keys scope model)", () => {
    const body = buildPolicyPayload(
      draft({ scope: "keys", key_ids: ["k1"] }),
      EXTRAS,
    );
    expect(body.assignments).toEqual([{ scope_type: "key", api_key_id: "k1", applies_internal: true, applies_external: true }]);
    expect(body.assignments?.some((a) => a.scope_type === "provider")).toBe(false);
  });
});

describe("buildEvaluatorConfigs", () => {
  it("emits nothing for deterministic", () => {
    expect(buildEvaluatorConfigs(draft())).toEqual([]);
  });
  it("uses evaluator_type + base_url for jev", () => {
    const out = buildEvaluatorConfigs(draft({ evaluator: "jev", credentials: { api_key: "k", base_url: "https://jev" } }));
    expect(out).toEqual([{ evaluator_type: "jev", credentials: { api_key: "k", base_url: "https://jev" } }]);
    expect(out[0]).not.toHaveProperty("kind");
    expect(out[0]).not.toHaveProperty("api_url");
  });
  it("emits trimmed api_key for openai_moderation, omits credentials when empty", () => {
    expect(
      buildEvaluatorConfigs(draft({ evaluator: "openai_moderation", credentials: { api_key: "  sk-test  " } })),
    ).toEqual([{ evaluator_type: "openai_moderation", credentials: { api_key: "sk-test" } }]);
    expect(
      buildEvaluatorConfigs(draft({ evaluator: "openai_moderation", credentials: {} })),
    ).toEqual([{ evaluator_type: "openai_moderation", credentials: undefined }]);
  });
});

describe("filterPolicies", () => {
  const rows = [
    policy({ id: "1", name: "PII block", severity: "high", enforcement: "block", is_enabled: true }),
    policy({
      id: "2", name: "Toxicity warn", severity: "low", enforcement: "warn", is_enabled: false,
      assignments: [{ scope_type: "provider", provider_id: "pr", applies_internal: true, applies_external: true }],
    }),
  ];
  it("matches text across name and description", () => {
    expect(filterPolicies(rows, { ...EMPTY_FILTER, q: "tox" }).map((p) => p.id)).toEqual(["2"]);
  });
  it("filters severity, enforcement, enabled, and scope", () => {
    expect(filterPolicies(rows, { ...EMPTY_FILTER, severity: "high" })).toHaveLength(1);
    expect(filterPolicies(rows, { ...EMPTY_FILTER, enabled: "off" }).map((p) => p.id)).toEqual(["2"]);
    expect(filterPolicies(rows, { ...EMPTY_FILTER, scope: "global" }).map((p) => p.id)).toEqual(["1"]);
    expect(filterPolicies(rows, { ...EMPTY_FILTER, scope: "scoped" }).map((p) => p.id)).toEqual(["2"]);
  });
});

describe("scope helpers", () => {
  it("derives scope/evaluator summaries from assignments/evaluators", () => {
    expect(scopeSummary(policy())).toBe("Global");
    expect(isScoped(policy())).toBe(false);
    const scoped = policy({
      assignments: [{ scope_type: "key", api_key_id: "k", applies_internal: true, applies_external: true }],
    });
    expect(isScoped(scoped)).toBe(true);
    expect(scopeSummary(scoped)).toContain("key");
    expect(evaluatorSummary(policy())).toBe("deterministic");
    expect(evaluatorSummary(policy({ evaluators: [{ id: "e", evaluator_type: "laya", provider_id: null, model_ref: null, credentials_masked: {}, operation: null, timeout_ms: null, threshold: null }] }))).toBe("laya");
  });
});

describe("key assignment logic", () => {
  const mandatory = policy({ id: "m", name: "Org mandatory", org_id: "org", is_mandatory: true });
  const globalOrg = policy({
    id: "g", name: "Org global", org_id: "org",
    assignments: [{ scope_type: "global", applies_internal: true, applies_external: true }],
  });
  const assignable = policy({ id: "a", name: "Optional", org_id: null, assignments: [] });
  it("locks is_mandatory and org-global policies", () => {
    expect(isPolicyLocked(mandatory)).toBe(true);
    expect(isPolicyLocked(globalOrg)).toBe(true);
    expect(isPolicyLocked(assignable)).toBe(false);
    // Personal global policies are not locked.
    expect(isPolicyLocked(policy())).toBe(false);
  });
  it("never locks disabled policies", () => {
    // Disabled org-global policies do not lock.
    expect(isPolicyLocked({ ...globalOrg, is_enabled: false })).toBe(false);
    // Mandatory-disabled is unreachable (backend 422s disabling mandatory),
    // but must not lock as defense in depth.
    expect(isPolicyLocked({ ...mandatory, is_enabled: false })).toBe(false);
  });
  it("merges inherited + locked + assigned, never duplicating", () => {
    const r = resolveKeyAssignments({ inherited: [assignable], assignable: [assignable], assignedIds: ["a"] });
    expect(r.effective.map((p) => p.id).sort()).toEqual(["a"]);
    const r2 = resolveKeyAssignments({ inherited: [], assignable: [mandatory, assignable], assignedIds: ["a"] });
    expect(r2.effective.map((p) => p.id).sort()).toEqual(["a", "m"]);
    expect(r2.lockedIds.has("m")).toBe(true);
  });
  it("locked policies cannot be toggled off", () => {
    const locked = new Set(["m"]);
    expect(toggleAssignment(new Set(["m"]), locked, "m").has("m")).toBe(true);
    expect(toggleAssignment(new Set(), locked, "a").has("a")).toBe(true);
    expect(toggleAssignment(new Set(["a"]), locked, "a").has("a")).toBe(false);
  });
  it("requires key guardrails while global guardrails are enabled", () => {
    // An org-global policy inherited by the key stays locked: it lands in
    // lockedIds + effective and can never be toggled off.
    const r = resolveKeyAssignments({ inherited: [globalOrg], assignable: [globalOrg, assignable], assignedIds: [] });
    expect(r.lockedIds.has("g")).toBe(true);
    expect(r.effective.map((p) => p.id)).toContain("g");
    expect(toggleAssignment(new Set(), r.lockedIds, "g").has("g")).toBe(false);
    expect(toggleAssignment(new Set(["g"]), r.lockedIds, "g").has("g")).toBe(true);
  });
});
