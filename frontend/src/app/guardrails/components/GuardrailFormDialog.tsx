"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from "@/components/ui";
import { toast } from "@/lib/notify";
import { parseApiError, toastApiError } from "@/lib/errors";
import type { GuardrailPolicy } from "@/services/guardrails";
import { useGuardrailMutations, useLayaHealth } from "@/hooks/useGuardrails";
import { useModels, useProviders } from "@/hooks/useRegistry";
import { cn } from "@/lib/utils";
import {
  GUARDRAIL_CATEGORIES,
  STEP_COUNT,
  buildEvaluatorConfigs,
  buildPolicyPayload,
  validateWizardStep,
  type GuardrailDraft,
} from "./policyLogic";

const CATEGORIES = GUARDRAIL_CATEGORIES;
const SEVERITIES = ["low", "medium", "high", "critical"];
const ENFORCEMENTS = [
  { value: "monitor", hint: "Log only — traffic always flows. Start here to measure noise before enforcing." },
  { value: "warn", hint: "Flag the turn to the caller but still deliver it. Good for gradual rollouts." },
  { value: "block", hint: "Stop the turn. Highest protection, highest false-positive cost." },
];
const EVALUATORS = ["deterministic", "laya", "openai_moderation", "jev", "llm"] as const;
const STAGES = ["pre", "post", "both"] as const;
const DELIVERY = [
  { value: "buffer_then_inspect", hint: "Withholds output until inspection completes — non-streaming paths only. Streams always deliver and audit." },
  { value: "inspect_before_buffer", hint: "Bounded-window audit scan while buffering. Cannot guarantee pre-delivery blocking on streams — recorded as audit rows." },
  { value: "audit_after_delivery", hint: "Audit-only. Delivers first, audits after. Zero added latency." },
  { value: "audit_then_delivery", hint: "Audit-only. Audits a copy, then delivers the original." },
];

function emptyDraft(): GuardrailDraft {
  return {
    name: "", description: "", severity: "medium", enforcement: "monitor",
    stage: "both", evaluator: "deterministic", delivery_mode: "audit_after_delivery",
    categories: [], scope: "global", provider_ids: [], model_ids: [], key_ids: [],
    credentials: {}, threshold: 0.8, timeout_ms: 2000,
    needsLlmEscalation: false, escalationProviderId: "", escalationModelId: "",
    notifyRecipients: "",
  };
}

function fromPolicy(p: GuardrailPolicy): GuardrailDraft {
  const d = emptyDraft();
  d.name = p.name;
  d.description = p.description ?? "";
  d.severity = p.severity;
  d.enforcement = p.enforcement;
  d.stage = (p.stage as GuardrailDraft["stage"]) ?? "both";
  d.delivery_mode = p.delivery_mode ?? "audit_after_delivery";
  d.categories = (p.rules ?? []).map((r) => r.category);
  d.threshold = p.confidence_threshold;
  d.timeout_ms = p.evaluator_timeout_ms;
  const rows = p.assignments ?? [];
  const targeted = rows.filter((a) => (a.scope_type ?? "global").toLowerCase() !== "global");
  if (targeted.length > 0) {
    d.scope = "targeted";
    d.provider_ids = targeted.map((a) => a.provider_id).filter((v): v is string => !!v);
    d.model_ids = targeted.map((a) => a.model_id).filter((v): v is string => !!v);
    d.key_ids = targeted.map((a) => a.api_key_id).filter((v): v is string => !!v);
  }
  d.evaluator = p.evaluators?.[0]?.evaluator_type ?? "deterministic";
  return d;
}

const STEPS = ["Basics", "Protection", "Evaluator", "Execution", "Scope", "Enforcement", "Logging", "Advanced"];

export function GuardrailFormDialog({
  open,
  onClose,
  initial,
  orgId,
}: {
  open: boolean;
  onClose: () => void;
  initial: GuardrailPolicy | null;
  orgId?: string;
}) {
  const mut = useGuardrailMutations(orgId);
  const laya = useLayaHealth(open);
  const providersQuery = useProviders();
  const modelsQuery = useModels();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<GuardrailDraft>(() => (initial ? fromPolicy(initial) : emptyDraft()));
  const [enabled, setEnabled] = useState(initial?.is_enabled ?? true);
  const [logTriggers, setLogTriggers] = useState(initial?.log_triggers ?? true);
  const [notify, setNotify] = useState(initial?.notify_on_trigger ?? false);
  const [failureAction, setFailureAction] = useState(initial?.failure_action ?? "allow");
  const [saving, setSaving] = useState(false);
  const [credState, setCredState] = useState<"idle" | "busy" | "valid" | "invalid">("idle");

  const set = (patch: Partial<GuardrailDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const stepError = validateWizardStep(step, draft);
  const isEditing = !!initial;

  async function handleSave() {
    for (let i = 0; i < STEP_COUNT; i++) {
      const err = validateWizardStep(i, draft);
      if (err) {
        setStep(i);
        toast.error(err);
        return;
      }
    }
    setSaving(true);
    try {
      const body = buildPolicyPayload(draft, {
        log_triggers: logTriggers,
        notify_on_trigger: notify,
        failure_action: failureAction,
        is_enabled: enabled,
      });
      if (isEditing) {
        await mut.update.mutateAsync({ id: initial.id, body });
        toast.success(`Guardrail "${draft.name.trim()}" updated.`);
      } else {
        const created = await mut.create.mutateAsync(body);
        for (const evaluator of buildEvaluatorConfigs(draft)) {
          await mut.createEvaluator.mutateAsync({ policyId: created.id, body: evaluator });
        }
        toast.success(`Guardrail "${draft.name.trim()}" created.`);
      }
      onClose();
    } catch (e) {
      toastApiError(e, { title: isEditing ? "Update failed" : "Create failed" });
    } finally {
      setSaving(false);
    }
  }

  async function handleValidateCreds() {
    setCredState("busy");
    try {
      const credentials = {
        ...(draft.credentials.api_key?.trim() ? { api_key: draft.credentials.api_key.trim() } : {}),
      };
      const res = await mut.validateCredentials.mutateAsync({
        evaluator_type: "jev",
        credentials,
        base_url: draft.credentials.base_url?.trim() || undefined,
      });
      setCredState(res.valid ? "valid" : "invalid");
      toast[res.valid ? "success" : "error"](res.valid ? "Credentials valid." : (res.message ?? "Credentials rejected."));
    } catch (e) {
      setCredState("invalid");
      toast.error(parseApiError(e).message);
    }
  }

  const layaReachable = laya.data?.reachable;
  const modelsForProvider = useMemo(
    () => (modelsQuery.data ?? []).filter((m) => !draft.escalationProviderId || m.provider_id === draft.escalationProviderId),
    [modelsQuery.data, draft.escalationProviderId],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-5" data-testid="guardrail-form-dialog">
        <DialogTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {isEditing ? `Edit “${initial.name}”` : "New guardrail"}
        </DialogTitle>
        <DialogDescription asChild>
          <div>
            <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Policy wizard steps" data-testid="wizard-steps">
              {STEPS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={i === step}
                  onClick={() => setStep(i)}
                  data-testid={`wizard-step-tab-${i}`}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px]",
                    i === step
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                  )}
                >
                  {i + 1}. {label}
                </button>
              ))}
            </div>
            <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1" data-testid="wizard-step-body">
              {step === 0 && (
                <div className="space-y-3">
                  <Field label="Name">
                    <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Block PII in responses" data-testid="gr-name" />
                  </Field>
                  <Field label="Description">
                    <Textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="What this policy protects and why" data-testid="gr-description" />
                  </Field>
                  <Field label="Template">
                    <Input value="" placeholder="Optional template key (e.g. pii-strict)" onChange={() => {}} disabled data-testid="gr-template" />
                  </Field>
                  <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enabled" data-testid="gr-enabled" />
                    Enabled on save
                  </label>
                </div>
              )}
              {step === 1 && (
                <div className="space-y-3">
                  <Field label="Protection categories">
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIES.map((c) => (
                        <label key={c} className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", draft.categories.includes(c) ? "border-tollma-500 bg-tollma-50 text-tollma-800 dark:bg-tollma-950/30 dark:text-tollma-300" : "border-zinc-200 dark:border-zinc-800")}>
                          <Checkbox checked={draft.categories.includes(c)} onChange={() => set({ categories: draft.categories.includes(c) ? draft.categories.filter((x) => x !== c) : [...draft.categories, c] })} aria-label={c} data-testid={`gr-cat-${c}`} />
                          {c.replace(/_/g, " ")}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Severity">
                      <Select value={draft.severity} onChange={(e) => set({ severity: e.target.value })} data-testid="gr-severity">
                        {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    </Field>
                    <Field label="Stages">
                      <Select value={draft.stage} onChange={(e) => set({ stage: e.target.value as GuardrailDraft["stage"] })} data-testid="gr-stage">
                        {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    </Field>
                  </div>
                </div>
              )}
              {step === 2 && (
                <div className="space-y-3">
                  <Field label="Evaluator">
                    <Select value={draft.evaluator} onChange={(e) => set({ evaluator: e.target.value })} data-testid="gr-evaluator">
                      {EVALUATORS.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
                    </Select>
                  </Field>
                  {draft.evaluator === "laya" && (
                    <p className="rounded-lg border border-zinc-200 p-2.5 text-xs dark:border-zinc-800" data-testid="laya-health">
                      Laya health: <strong>{laya.isPending ? "checking…" : layaReachable ? "reachable" : "unreachable"}</strong>
                      {laya.data?.latency_ms != null && <span className="text-zinc-500"> · {laya.data.latency_ms}ms</span>}
                      {laya.data?.message && <span className="block text-zinc-500">{laya.data.message}</span>}
                    </p>
                  )}
                  {draft.evaluator === "jev" && (
                    <div className="space-y-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
                      <Field label="API key">
                        <Input type="password" autoComplete="off" value={draft.credentials.api_key ?? ""} onChange={(e) => set({ credentials: { ...draft.credentials, api_key: e.target.value } })} placeholder="••••••" data-testid="gr-jev-key" />
                      </Field>
                      <Field label="Base URL">
                        <Input value={draft.credentials.base_url ?? ""} onChange={(e) => set({ credentials: { ...draft.credentials, base_url: e.target.value } })} placeholder="https://…" data-testid="gr-jev-url" />
                      </Field>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => void handleValidateCreds()} disabled={credState === "busy"} data-testid="gr-jev-validate">
                          {credState === "busy" ? "Validating…" : "Validate"}
                        </Button>
                        {credState === "valid" && <span className="text-xs text-green-600">Valid</span>}
                        {credState === "invalid" && <span className="text-xs text-red-600">Invalid</span>}
                      </div>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <Switch checked={draft.needsLlmEscalation} onCheckedChange={(v) => set({ needsLlmEscalation: v })} data-testid="gr-llm-escalation" />
                    Escalate uncertain calls to an LLM judge
                  </label>
                  {draft.needsLlmEscalation && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Escalation provider">
                        <Select value={draft.escalationProviderId} onChange={(e) => set({ escalationProviderId: e.target.value, escalationModelId: "" })} data-testid="gr-esc-provider">
                          <option value="">Select…</option>
                          {(providersQuery.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </Select>
                      </Field>
                      <Field label="Escalation model">
                        <Select value={draft.escalationModelId} onChange={(e) => set({ escalationModelId: e.target.value })} data-testid="gr-esc-model">
                          <option value="">Select…</option>
                          {modelsForProvider.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </Select>
                      </Field>
                    </div>
                  )}
                </div>
              )}
              {step === 3 && (
                <div className="space-y-3">
                  <Field label="Delivery mode">
                    <Select value={draft.delivery_mode} onChange={(e) => set({ delivery_mode: e.target.value })} data-testid="gr-delivery">
                      {DELIVERY.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.value.replace(/_/g, " ")}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {DELIVERY.map((d) => (
                    <p key={d.value} className={cn("text-xs", draft.delivery_mode === d.value ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400")}>
                      <strong>{d.value.replace(/_/g, " ")}:</strong> {d.hint}
                    </p>
                  ))}
                  {draft.stage === "pre" && <p className="text-xs text-zinc-500">Pre-only policy — only buffer_then_inspect withholds output, and only on non-streaming post paths.</p>}
                </div>
              )}
              {step === 4 && (
                <div className="space-y-3">
                  <Field label="Scope">
                    <Select value={draft.scope} onChange={(e) => set({ scope: e.target.value })} data-testid="gr-scope">
                      <option value="global">Global — every request</option>
                      <option value="targeted">Targeted — specific providers / models / keys</option>
                    </Select>
                  </Field>
                  {draft.scope === "targeted" && (
                    <>
                      <Field label="Provider IDs (comma-separated)">
                        <Input value={draft.provider_ids.join(", ")} onChange={(e) => set({ provider_ids: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} data-testid="gr-scope-providers" />
                      </Field>
                      <Field label="Model IDs (comma-separated)">
                        <Input value={draft.model_ids.join(", ")} onChange={(e) => set({ model_ids: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} data-testid="gr-scope-models" />
                      </Field>
                      <Field label="Key IDs (comma-separated)">
                        <Input value={draft.key_ids.join(", ")} onChange={(e) => set({ key_ids: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} data-testid="gr-scope-keys" />
                      </Field>
                      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                        <Checkbox checked disabled aria-label="Internal traffic" /> Internal traffic
                        <Checkbox checked disabled aria-label="External traffic" /> External traffic
                      </label>
                    </>
                  )}
                </div>
              )}
              {step === 5 && (
                <div className="space-y-2">
                  {ENFORCEMENTS.map((e) => (
                    <label key={e.value} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-2.5", draft.enforcement === e.value ? "border-tollma-500" : "border-zinc-200 dark:border-zinc-800")}>
                      <input type="radio" name="enforcement" value={e.value} checked={draft.enforcement === e.value} onChange={() => set({ enforcement: e.value })} data-testid={`gr-enf-${e.value}`} className="mt-0.5" />
                      <span className="text-xs"><strong className="capitalize">{e.value}.</strong> {e.hint}</span>
                    </label>
                  ))}
                </div>
              )}
              {step === 6 && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <Switch checked={logTriggers} onCheckedChange={setLogTriggers} data-testid="gr-log" /> Log trigger events
                  </label>
                  <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <Switch checked={notify} onCheckedChange={setNotify} data-testid="gr-notify" /> Notify on trigger
                  </label>
                  {notify && (
                    <Field label="Recipients (comma-separated emails/webhooks)">
                      <Input value={draft.notifyRecipients} onChange={(e) => set({ notifyRecipients: e.target.value })} placeholder="sec@example.com" data-testid="gr-recipients" />
                    </Field>
                  )}
                </div>
              )}
              {step === 7 && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Confidence threshold (0–1)">
                      <Input type="number" min={0} max={1} step={0.05} value={draft.threshold ?? ""} onChange={(e) => set({ threshold: e.target.value === "" ? null : Number(e.target.value) })} data-testid="gr-threshold" />
                    </Field>
                    <Field label="Evaluator timeout (ms)">
                      <Input type="number" min={1} value={draft.timeout_ms ?? ""} onChange={(e) => set({ timeout_ms: e.target.value === "" ? null : Number(e.target.value) })} data-testid="gr-timeout" />
                    </Field>
                  </div>
                  <Field label="Evaluator failure action">
                    <Select value={failureAction} onChange={(e) => setFailureAction(e.target.value)} data-testid="gr-failure">
                      <option value="allow">allow — fail open</option>
                      <option value="block">block — fail closed</option>
                    </Select>
                  </Field>
                  <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <Switch checked={draft.needsLlmEscalation} onCheckedChange={(v) => set({ needsLlmEscalation: v })} data-testid="gr-llm-escalation-2" />
                    Escalate to LLM judge on low confidence
                  </label>
                  {!isEditing && (
                    <p className="rounded-lg bg-zinc-50 p-2.5 text-xs text-zinc-500 dark:bg-zinc-900" data-testid="test-hint">
                      Save the policy first, then use Test on the row to dry-run content before enabling enforcement.
                    </p>
                  )}
                </div>
              )}
              {stepError && (
                <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300" data-testid="wizard-error">
                  {stepError}
                </p>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} data-testid="wizard-back">Back</Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                {step < STEP_COUNT - 1 ? (
                  <Button size="sm" onClick={() => stepError ? toast.error(stepError) : setStep((s) => s + 1)} data-testid="wizard-next">Next</Button>
                ) : (
                  <Button size="sm" onClick={() => void handleSave()} disabled={saving} data-testid="wizard-save">
                    {saving ? "Saving…" : isEditing ? "Save changes" : "Create policy"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
