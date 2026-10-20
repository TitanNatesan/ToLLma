"use client";
import { fmtBudgetAmount } from "@/app/api-keys/components/BudgetBar";

import { useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  Button, Card, CardContent, Dialog, DialogContent, DialogDescription,
  DialogTitle, EmptyState, ErrorState, Field, Input, LoadingState,
} from "@/components/ui";
import { isForbiddenError, useOrgBudget, useOrgMutations } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import { ApiError } from "@/services/api";
import type { OrgBudget } from "@/types/orgs";

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v: number | string | null | undefined): string {
  const n = num(v);
  if (n === null) return "—";
  return fmtBudgetAmount(n);
}

function capOf(b: OrgBudget): number | null {
  return num(b.max_spend ?? b.max_budget_usd ?? b.cap);
}

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

/** Budget pools card: cap / allocated / unallocated + gated cap editing. */
export function OrgBudgetCard({ orgId, canRead, canEdit }: {
  orgId: string;
  canRead: boolean;
  canEdit: boolean;
}) {
  const budget = useOrgBudget(orgId, { enabled: canRead });
  const mut = useOrgMutations(orgId);
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRead) {
    return <EmptyState title="Budgets" description="You need budget-read permission to view pools." />;
  }

  const data = budget.data;
  const capN = data ? capOf(data) : null;

  async function save() {
    const trimmed = cap.trim();
    if (trimmed !== "" && (!Number.isFinite(Number(trimmed)) || Number(trimmed) < 0)) {
      setError("Enter a non-negative number, or leave empty for unlimited.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const value = trimmed === "" ? null : Number(trimmed);
      // Send both field names; the backend reads whichever it knows.
      await mut.updateBudget.mutateAsync({ max_spend: value, max_budget_usd: value });
      toast.success("Budget cap updated.");
      setEditing(false);
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="org-budget">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-bold">
            <Wallet className="size-3.5" aria-hidden /> Budget pools
          </h3>
          {canEdit && data && !budget.isLoading && (
            <Button size="sm" variant="outline" data-testid="org-budget-edit"
              onClick={() => {
                setCap(capN === null ? "" : String(capN));
                setError(null);
                setEditing(true);
              }}>
              Edit cap
            </Button>
          )}
        </div>

        {budget.isLoading && <LoadingState message="Loading budget…" />}
        {budget.isError && isForbiddenError(budget.error) && (
          <EmptyState title="Budgets unavailable" testId="org-budget-forbidden"
            description="You need Budgets.Read permission to view budget pools." />
        )}
        {budget.isError && isNotFound(budget.error) && (
          <ErrorState title="Budget pools not found"
            message={parseApiError(budget.error).message}
            onRetry={() => void budget.refetch()} />
        )}
        {budget.isError && !isNotFound(budget.error) && !isForbiddenError(budget.error) && (
          <ErrorState title="Could not load budget"
            message={parseApiError(budget.error).message}
            onRetry={() => void budget.refetch()} />
        )}
        {!budget.isLoading && !budget.isError && !data && (
          <EmptyState title="No budget data" description="Budget pools are not configured for this organization yet." testId="org-budget-empty" />
        )}
        {data && !budget.isLoading && !budget.isError && (
          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Cap</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold" data-testid="org-budget-cap">
                {capN === null ? "Unlimited" : money(capN)}
              </dd>
            </div>
            <div className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Allocated</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold" data-testid="org-budget-allocated">
                {money(data.allocated)}
              </dd>
            </div>
            <div className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Unallocated</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold" data-testid="org-budget-unallocated">
                {money(data.unallocated)}
              </dd>
            </div>
          </dl>
        )}

        <Dialog open={editing} onOpenChange={(n) => { if (!n && !busy) setEditing(false); }}>
          <DialogContent className="max-w-md p-4" data-testid="org-budget-dialog">
            <DialogTitle className="text-sm font-semibold">Edit budget cap</DialogTitle>
            <DialogDescription>Empty means unlimited. Applies to the whole organization pool.</DialogDescription>
            <div className="mt-3">
              <Field label="Cap in USD (empty = unlimited)">
                <Input value={cap} onChange={(e) => setCap(e.target.value)}
                  placeholder="e.g. 500" inputMode="decimal" data-testid="org-budget-cap-input" />
              </Field>
            </div>
            {error && (
              <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}
            {cap.trim() !== "" && (Number.isNaN(Number(cap)) || Number(cap) < 0) && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="org-budget-cap-error">
                Enter a non-negative number, or leave empty for unlimited.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
              <Button size="sm" disabled={busy || (cap.trim() !== "" && !Number.isFinite(Number(cap)))}
                onClick={() => void save()} data-testid="org-budget-submit">
                {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save cap
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
