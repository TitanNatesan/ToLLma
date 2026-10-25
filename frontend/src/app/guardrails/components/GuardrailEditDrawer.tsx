"use client";

import { useState } from "react";
import { Button, Checkbox, DetailPanel, Select, Textarea } from "@/components/ui";
import { toast } from "@/lib/notify";
import { parseApiError } from "@/lib/errors";
import type { GuardrailPolicy } from "@/services/guardrails";
import { useGuardrailMutations } from "@/hooks/useGuardrails";
import { GuardrailFormDialog } from "./GuardrailFormDialog";
import { evaluatorSummary, scopeSummary } from "./policyLogic";

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
          </div>
        )}
      </DetailPanel>
      {policy && editOpen && (
        <GuardrailFormDialog open={editOpen} onClose={() => setEditOpen(false)} initial={policy} orgId={orgId} />
      )}
    </>
  );
}

