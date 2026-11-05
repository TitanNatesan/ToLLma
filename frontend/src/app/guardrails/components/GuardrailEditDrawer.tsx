"use client";

import { useMemo, useState } from "react";
import { Button, Checkbox, DetailPanel, Input, Select, Textarea } from "@/components/ui";
import { toast } from "@/lib/notify";
import { parseApiError } from "@/lib/errors";
import type { GuardrailPolicy } from "@/services/guardrails";
import { useGuardrailMutations } from "@/hooks/useGuardrails";
import { GuardrailFormDialog } from "./GuardrailFormDialog";
import { evaluatorSummary, scopeSummary } from "./policyLogic";

/** Evaluator types with independently stored API credentials (jev pattern). */
const CREDENTIAL_EVALUATORS = new Set(["jev", "openai_moderation"]);

/**
 * View + test drawer for a saved policy. Editing reuses the wizard dialog;
 * testing posts content to `/{id}/test` (saved policies only).
 */
export function GuardrailEditDrawer({
  policy,
  onClose,
  orgId,
}: {
  policy: GuardrailPolicy | null;
  onClose: () => void;
  orgId?: string;
}) {
  const mut = useGuardrailMutations(orgId);
  const [editOpen, setEditOpen] = useState(false);
  const [content, setContent] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [runLlm, setRunLlm] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // Credential rotation state (per evaluator id): new key + validation status.
  const [replacing, setReplacing] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [rotState, setRotState] = useState<"idle" | "busy" | "valid" | "invalid">("idle");

  const credentialEvaluators = useMemo(
    () => (policy?.evaluators ?? []).filter((e) => CREDENTIAL_EVALUATORS.has((e.evaluator_type || "").toLowerCase())),
    [policy],
  );

  async function validateReplacement() {
    if (!newKey.trim()) {
      toast.error("Enter a replacement API key first.");
      return;
    }
    setRotState("busy");
    try {
      const res = await mut.validateCredentials.mutateAsync({ evaluator_type: "openai_moderation", credentials: { api_key: newKey.trim() } });
      setRotState(res.valid ? "valid" : "invalid");
      toast[res.valid ? "success" : "error"](res.valid ? "Replacement key valid." : (res.message ?? "Replacement key rejected."));
    } catch (e) {
      setRotState("invalid");
      toast.error(parseApiError(e).message);
    }
  }

  async function saveReplacement(evaluatorId: string) {
    if (!newKey.trim()) {
      toast.error("Enter a replacement API key first.");
      return;
    }
    setRotState("busy");
    try {
      // Server re-validates live before persisting; an invalid key 422s and
      // the previously stored credential stays intact.
      await mut.patchEvaluator.mutateAsync({ evaluatorId, body: { credentials: { api_key: newKey.trim() } } });
      toast.success("Credential rotated.");
      setReplacing(null);
      setNewKey("");
      setRotState("idle");
    } catch (e) {
      setRotState("invalid");
      toast.error(parseApiError(e).message);
    }
  }

  async function runTest() {
    if (!policy || !content.trim()) {
      toast.error("Enter sample content to test.");
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      // Stage is sent as-is (pre | post | both); run_llm defaults off (billable).
      const res = await mut.test.mutateAsync({
        id: policy.id,
        content: content.trim(),
        stage: stage ?? policy.stage,
        run_llm: runLlm,
      });
      const pct = res.confidence != null ? ` (${Math.round(Number(res.confidence) * 100)}%)` : "";
      const cats = (res.categories ?? []).length > 0 ? ` — ${(res.categories ?? []).join(", ")}` : "";
      setResult(
        `${res.verdict}: ${res.action}${pct}${cats}${res.reason ? `. ${res.reason}` : ""}${res.llm_skipped ? " (LLM escalation skipped)" : ""}`,
      );
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <DetailPanel
        open={!!policy}
        onClose={onClose}
        title={policy?.name ?? "Guardrail"}
        subtitle={policy?.description}
        testId="guardrail-drawer"
        footer={
          policy ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} data-testid="drawer-edit">
                Edit
              </Button>
              <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
            </div>
          ) : undefined
        }
      >
        {policy && (
          <div className="space-y-4 text-xs">
            <dl className="grid grid-cols-2 gap-2">
              {[["Severity", policy.severity], ["Enforcement", policy.enforcement], ["Stage", policy.stage], ["Delivery", policy.delivery_mode], ["Scope", scopeSummary(policy)], ["Evaluator", evaluatorSummary(policy)], ["Confidence threshold", policy.confidence_threshold != null ? String(policy.confidence_threshold) : "—"], ["Evaluator timeout", `${policy.evaluator_timeout_ms}ms`], ["Version", String(policy.version)], ["Mandatory", policy.is_mandatory ? "Yes" : "No"], ["Created", new Date(policy.created_at).toLocaleString()], ["Updated", new Date(policy.updated_at).toLocaleString()]].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                  <dt className="text-[10px] uppercase tracking-wider text-zinc-400">{k}</dt>
                  <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">{String(v)}</dd>
                </div>
              ))}
            </dl>
            <div className="space-y-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">Dry-run test</p>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste sample content…" rows={3} data-testid="drawer-test-content" />
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={stage ?? policy.stage}
                  onChange={(e) => setStage(e.target.value)}
                  aria-label="Test stage"
                  data-testid="drawer-test-stage"
                >
                  {(["pre", "post", "both"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
                <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                  <Checkbox checked={runLlm} onChange={() => setRunLlm((v) => !v)} aria-label="Also run LLM escalation (billable)" data-testid="drawer-test-run-llm" />
                  also run LLM escalation (billable)
                </label>
                <Button size="sm" onClick={() => void runTest()} disabled={testing || !content.trim()} data-testid="drawer-test-run">
                  {testing ? "Testing…" : "Test policy"}
                </Button>
              </div>
              <div aria-live="polite" data-testid="drawer-test-live">
                {result && <p data-testid="drawer-test-result" className="text-zinc-600 dark:text-zinc-400">{result}</p>}
              </div>
            </div>
            {credentialEvaluators.length > 0 && (
              <div className="space-y-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">Evaluator credentials</p>
                {credentialEvaluators.map((e) => {
                  const masked = Object.values(e.credentials_masked ?? {})[0] as string | undefined;
                  const isOpenAI = (e.evaluator_type || "").toLowerCase() === "openai_moderation";
                  return (
                    <div key={e.id} className="space-y-1.5 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                      <p className="text-zinc-700 dark:text-zinc-300">
                        {e.evaluator_type} ·{" "}
                        {masked ? (
                          <span data-testid={`drawer-cred-status-${e.id}`}>Configured · {masked}</span>
                        ) : (
                          <span className="text-amber-600" data-testid={`drawer-cred-status-${e.id}`}>Not configured</span>
                        )}
                      </p>
                      {isOpenAI && replacing !== e.id && (
                        <Button size="sm" variant="outline" onClick={() => { setReplacing(e.id); setNewKey(""); setRotState("idle"); }} data-testid={`drawer-cred-replace-${e.id}`}>
                          Replace API key
                        </Button>
                      )}
                      {isOpenAI && replacing === e.id && (
                        <div className="space-y-1.5">
                          <Input type="password" autoComplete="new-password" value={newKey} onChange={(ev) => { setRotState("idle"); setNewKey(ev.target.value); }} placeholder="sk-…" aria-label="Replacement OpenAI API key" data-testid={`drawer-cred-key-${e.id}`} />
                          <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => void validateReplacement()} disabled={rotState === "busy" || !newKey.trim()} data-testid={`drawer-cred-validate-${e.id}`}>
                              {rotState === "busy" ? "Validating…" : "Validate"}
                            </Button>
                            <Button size="sm" onClick={() => void saveReplacement(e.id)} disabled={rotState === "busy" || !newKey.trim()} data-testid={`drawer-cred-save-${e.id}`}>
                              Save new key
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setReplacing(null); setNewKey(""); setRotState("idle"); }}>
                              Cancel
                            </Button>
                            {rotState === "valid" && <span className="text-green-600">Valid</span>}
                            {rotState === "invalid" && <span className="text-red-600">Invalid</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DetailPanel>
      {policy && editOpen && (
        <GuardrailFormDialog open={editOpen} onClose={() => setEditOpen(false)} initial={policy} orgId={orgId} />
      )}
    </>
  );
}

