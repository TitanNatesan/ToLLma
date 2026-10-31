import { describe, expect, it } from "vitest";
import type { GuardrailPolicy } from "@/services/guardrails";
import {
  DETECTION_STEP_COPY,
  SCOPE_STEP_COPY,
  WIZARD_SCOPE_OPTIONS,
  buildPolicyPayload,
  buildReviewSummary,
  draftFromPolicy,
  emptyGuardrailDraft,
  mapPolicySaveError,
  unknownScopeKeys,
  validateWizardStep,
  type GuardrailDraft,
} from "../policyLogic";

const EXTRAS = { log_triggers: true, notify_on_trigger: false, failure_action: "allow", is_enabled: true };

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

describe("wizard scope step (Global + API keys only)", () => {
  it("offers exactly Global and Specific API keys — no team, provider, or model scope", () => {
    expect(WIZARD_SCOPE_OPTIONS.map((o) => o.value)).toEqual(["global", "keys"]);
    const labels = WIZARD_SCOPE_OPTIONS.map((o) => `${o.label} ${o.hint}`.toLowerCase()).join(" | ");
    expect(labels).not.toMatch(/team/);
    expect(labels).not.toMatch(/provider/);
    expect(labels).not.toMatch(/model/);
  });
  it("states the scope copy", () => {
    expect(SCOPE_STEP_COPY).toBe("Applies globally or to selected keys only.");
  });
  it("blocks key scope without keys and unknown scopes", () => {
    expect(validateWizardStep(3, draft({ scope: "global" }))).toBeNull();
    expect(validateWizardStep(3, draft({ scope: "keys", key_ids: [] }))).toMatch(/at least one API key/i);
    expect(validateWizardStep(3, draft({ scope: "keys", key_ids: ["k1"] }))).toBeNull();
  });
  it("emits only global|key assignments (agreed scope_type set)", () => {
    const keyed = buildPolicyPayload(draft({ scope: "keys", key_ids: ["k1"] }), EXTRAS);
    expect(keyed.assignments?.map((a) => a.scope_type)).toEqual(["key"]);
    const global = buildPolicyPayload(draft({ scope: "global", key_ids: ["k1"] }), EXTRAS);
    expect(global.assignments).toEqual([
      { scope_type: "global", applies_internal: true, applies_external: true },
    ]);
  });
  it("refuses keys outside the workspace", () => {
    expect(unknownScopeKeys(draft({ scope: "global", key_ids: ["nope"] }), ["k1"])).toEqual([]);
    expect(unknownScopeKeys(draft({ scope: "keys", key_ids: ["k1"] }), ["k1"])).toEqual([]);
    expect(unknownScopeKeys(draft({ scope: "keys", key_ids: ["k1", "stale"] }), ["k1"])).toEqual(["stale"]);
  });
});

describe("detection step copy", () => {
  it("says only selected categories are evaluated", () => {
    expect(DETECTION_STEP_COPY).toBe("Only selected categories are evaluated.");
  });
  it("keeps categories independently selectable (no auto-select coupling)", () => {
    expect(validateWizardStep(1, draft({ categories: ["pii"] }))).toBeNull();
    expect(validateWizardStep(1, draft({ categories: ["pii", "prompt_injection"] }))).toBeNull();
  });
});

describe("review step summary", () => {
  it("shows name/categories/evaluator/severity/stages/scope/keys/mode/enabled", () => {
    const rows = buildReviewSummary(
      draft({ scope: "keys", key_ids: ["k1", "k2"], enforcement: "monitor" }),
      { keyNames: new Map([["k1", "prod"]]), enabled: true },
    );
    const keys = Object.fromEntries(rows);
    expect(Object.keys(keys)).toEqual([
      "Name",
      "Categories",
      "Evaluator",
      "Severity",
      "Stages",
      "Scope",
      "Keys",
      "Mode",
      "Enabled",
    ]);
    expect(keys["Name"]).toBe("PII block");
    expect(keys["Categories"]).toBe("pii");
    expect(keys["Evaluator"]).toBe("deterministic");
    expect(keys["Severity"]).toBe("high");
    expect(keys["Stages"]).toBe("both");
    expect(keys["Scope"]).toContain("Keys");
    expect(keys["Keys"]).toContain("prod");
    expect(keys["Mode"]).toBe("monitor");
    expect(keys["Enabled"]).toBe("On");
  });
  it("renders global scope without key names", () => {
    const rows = Object.fromEntries(buildReviewSummary(draft(), { enabled: false }));
    expect(rows["Scope"]).toContain("Global");
    expect(rows["Keys"]).toBe("Every key");
    expect(rows["Enabled"]).toBe("Off");
  });
});

describe("detection gate (zero categories can never proceed)", () => {
  it("blocks the Detection step with an explicit inline error", () => {
    expect(validateWizardStep(1, draft({ categories: [] }))).toMatch(/at least one protection category/i);
  });
  it("stays blocked when enforcement is block (backend 422s empty-rules+block)", () => {
    expect(validateWizardStep(1, draft({ categories: [], enforcement: "block" }))).toMatch(
      /at least one protection category/i,
    );
  });
  it("lets a single selected category through", () => {
    expect(validateWizardStep(1, draft({ categories: ["pii"], enforcement: "block" }))).toBeNull();
  });
});

describe("edit-mode credential relief", () => {
  const jevBare = draft({ evaluator: "jev", credentials: {} });
  const moderationBare = draft({ evaluator: "openai_moderation", credentials: {} });
  it("demands credentials on create", () => {
    expect(validateWizardStep(2, jevBare)).toMatch(/jev/i);
    expect(validateWizardStep(2, moderationBare)).toMatch(/api key/i);
  });
  it("skips credential re-entry on edit (secrets never round-trip)", () => {
    expect(validateWizardStep(2, jevBare, { isEditing: true })).toBeNull();
    expect(validateWizardStep(2, moderationBare, { isEditing: true })).toBeNull();
  });
  it("still guards delivery/escalation on edit", () => {
    expect(
      validateWizardStep(2, draft({ stage: "pre", delivery_mode: "buffer_then_inspect" }), { isEditing: true }),
    ).toMatch(/post/i);
    expect(validateWizardStep(2, draft({ needsLlmEscalation: true }), { isEditing: true })).toMatch(/escalation/i);
  });
});

const savedPolicy = (patch: Partial<GuardrailPolicy> = {}): GuardrailPolicy => ({
  id: "p1",
  name: "PII block",
  description: "desc",
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
  version: 3,
  org_id: "org1",
  rules: [{ category: "pii", severity: "high", config: {} }],
  evaluators: [{ id: "e1", evaluator_type: "jev", provider_id: null, model_ref: null, credentials_masked: { api_key: "••••1234" }, operation: null, timeout_ms: null, threshold: null }],
  assignments: [{ scope_type: "key", api_key_id: "k1", applies_internal: true, applies_external: true }],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  ...patch,
});

describe("edit-mode preload (draftFromPolicy)", () => {
  it("preserves name/rules/severity/enforcement/stage/scope/keys/threshold/timeout/evaluator", () => {
    const d = draftFromPolicy(savedPolicy());
    expect(d.name).toBe("PII block");
    expect(d.description).toBe("desc");
    expect(d.categories).toEqual(["pii"]);
    expect(d.severity).toBe("high");
    expect(d.enforcement).toBe("block");
    expect(d.stage).toBe("both");
    expect(d.scope).toBe("keys");
    expect(d.key_ids).toEqual(["k1"]);
    expect(d.threshold).toBe(0.8);
    expect(d.timeout_ms).toBe(2000);
    expect(d.evaluator).toBe("jev");
  });
  it("restores global scope when no targeted assignments exist", () => {
    const d = draftFromPolicy(savedPolicy({ assignments: [{ scope_type: "global", applies_internal: true, applies_external: true }] }));
    expect(d.scope).toBe("global");
    expect(d.key_ids).toEqual([]);
  });
  it("never prefills credentials (secrets never round-trip)", () => {
    expect(draftFromPolicy(savedPolicy()).credentials).toEqual({});
    expect(draftFromPolicy(savedPolicy({ evaluators: [] })).evaluator).toBe("deterministic");
  });
  it("restores llm escalation targets from a stored llm evaluator row", () => {
    const d = draftFromPolicy(
      savedPolicy({
        evaluators: [
          { id: "e1", evaluator_type: "deterministic", provider_id: null, model_ref: null, credentials_masked: {}, operation: null, timeout_ms: null, threshold: null },
          { id: "e2", evaluator_type: "llm", provider_id: "pr", model_ref: "m", credentials_masked: {}, operation: null, timeout_ms: null, threshold: null },
        ],
      }),
    );
    expect(d.evaluator).toBe("deterministic");
    expect(d.needsLlmEscalation).toBe(true);
    expect(d.escalationProviderId).toBe("pr");
    expect(d.escalationModelId).toBe("m");
  });
  it("starts every preload from the same blank baseline as create", () => {
    const blank = emptyGuardrailDraft();
    expect(blank.categories).toEqual([]);
    expect(blank.key_ids).toEqual([]);
    expect(blank.scope).toBe("global");
    expect(draftFromPolicy(savedPolicy({ name: "", rules: [], assignments: [] })).categories).toEqual([]);
  });
});

const api422 = (detail: unknown) => ({ status: 422, statusText: "Unprocessable Entity", data: { detail }, message: "PUT -> 422" });

describe("save-error mapping (backend 422s become step errors)", () => {
  it("routes empty-rules+block to Detection with a readable message", () => {
    const m = mapPolicySaveError(api422("block enforcement requires at least one rule (empty-rules-block)"));
    expect(m?.step).toBe(1);
    expect(m?.message).toMatch(/at least one protection categor/i);
  });
  it("routes unknown/foreign key scope to the Scope step", () => {
    const m = mapPolicySaveError(api422("key scope references keys outside this workspace"));
    expect(m?.step).toBe(3);
    expect(m?.message).toMatch(/must belong to this workspace/i);
    expect(mapPolicySaveError(api422("invalid scope_type: 'team'"))?.step).toBe(3);
  });
  it("keeps any other backend text on Review instead of swallowing it", () => {
    const m = mapPolicySaveError(api422("invalid notify_repeat_minutes: 0"));
    expect(m).toEqual({ step: 4, message: "invalid notify_repeat_minutes: 0" });
  });
  it("reads FastAPI array details and envelope messages, ignores textless failures", () => {
    expect(mapPolicySaveError(api422([{ msg: "invalid category: 'x'" }]))?.step).toBe(1);
    expect(mapPolicySaveError({ status: 422, data: { error: { message: "global scope must not carry refs" } } })?.step).toBe(3);
    expect(mapPolicySaveError(new Error("boom"))).toBeNull();
    expect(mapPolicySaveError({ status: 500, data: {} })).toBeNull();
  });
});
