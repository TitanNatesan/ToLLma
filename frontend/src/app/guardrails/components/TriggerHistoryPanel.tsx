"use client";

import { useMemo, useState } from "react";
import {
  Button,
  DetailPanel,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
} from "@/components/ui";
import { parseApiError } from "@/lib/errors";
import type { GuardrailPolicy, TriggerEvent } from "@/services/guardrails";
import { useGuardrailTrigger, useGuardrailTriggers } from "@/hooks/useGuardrails";
import { ScrollText } from "lucide-react";
import { EMPTY_TRIGGER_FILTER, matchTriggerReason, type TriggerFilterState } from "./policyLogic";

function TriggerInspector({ id, orgId, onClose }: { id: string | null; orgId?: string; onClose: () => void }) {
  const q = useGuardrailTrigger(id, orgId);
  const t = q.data;
  return (
    <DetailPanel open={!!id} onClose={onClose} title={t?.policy_id ? `Policy ${t.policy_id.slice(0, 8)}…` : "Trigger"} subtitle={t?.id} testId="trigger-inspector">
      {q.isPending ? (
        <LoadingState message="Loading trigger…" />
      ) : q.error || !t ? (
        <ErrorState title="Could not load trigger" message={q.error ? parseApiError(q.error).message : "Not found"} onRetry={() => void q.refetch()} />
      ) : (
        <dl className="grid grid-cols-2 gap-2 text-xs">
          {[
            ["Policy", t.policy_id], ["Version", String(t.policy_version)], ["Workspace", t.workspace_type],
            ["Endpoint", t.endpoint], ["Stage", t.stage], ["Category", t.category], ["Severity", t.severity],
            ["Confidence", t.confidence != null ? `${Math.round(Number(t.confidence) * 100)}%` : null],
            ["Enforcement", t.enforcement], ["Action", t.action],
            ["Latency", t.latency_ms != null ? `${t.latency_ms}ms` : null],
            ["Source", t.source],
            ["Notified", t.notified ? "Yes" : "No"],
            ["Failure", t.failure_kind ?? "No"],
            ["At", t.created_at ? new Date(t.created_at).toLocaleString() : null],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">{k}</dt>
              <dd className="mt-0.5 break-words font-medium text-zinc-900 dark:text-zinc-100">{v != null && v !== "" ? String(v) : "—"}</dd>
            </div>
          ))}
          {t.reason && (
            <div className="col-span-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Reason</dt>
              <dd className="mt-0.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{t.reason}</dd>
            </div>
          )}
          {t.input_excerpt && (
            <div className="col-span-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Input excerpt</dt>
              <dd className="mt-0.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{t.input_excerpt}</dd>
            </div>
          )}
          {t.output_excerpt && (
            <div className="col-span-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Output excerpt</dt>
              <dd className="mt-0.5 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{t.output_excerpt}</dd>
            </div>
          )}
        </dl>
      )}
    </DetailPanel>
  );
}

export function TriggerHistoryPanel({
  policies,
  canView,
  orgId,
  filters,
  onFiltersChange,
  feed,
}: {
  policies: GuardrailPolicy[];
  canView: boolean;
  orgId?: string;
  /** Controlled mode: the page owns these in the persistent sidebar so tab switches keep them. */
  filters?: TriggerFilterState;
  onFiltersChange?: (f: TriggerFilterState) => void;
  /** Controlled mode: the page owns the feed so tab switches don't refetch. */
  feed?: ReturnType<typeof useGuardrailTriggers>;
}) {
  const [inner, setInner] = useState<TriggerFilterState>(EMPTY_TRIGGER_FILTER);
  const f = filters ?? inner;
  const setF: (next: TriggerFilterState) => void = onFiltersChange ?? setInner;
  const controlled = filters !== undefined;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const serverFilters = useMemo(
    () => ({
      org_id: orgId ?? undefined,
      policy_id: f.policyId || undefined,
      severity: f.severity || undefined,
      action: f.action || undefined,
      source: f.source || undefined,
    }),
    [orgId, f],
  );
  // Uncontrolled legacy mode fetches here; controlled mode uses the page-owned feed.
  const innerFeed = useGuardrailTriggers(serverFilters, canView && feed === undefined);
  const activeFeed = feed ?? innerFeed;

  function update(patch: Partial<TriggerFilterState>) {
    setF({ ...f, ...patch });
  }

  if (!canView) {
    return (
      <EmptyState
        icon={ScrollText}
        title="Trigger history"
        description="You need Guardrails.ViewEvents to see trigger events."
        testId="triggers-gated"
      />
    );
  }

  const pages = activeFeed.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const shown = items.filter((t: TriggerEvent) => matchTriggerReason(t, f.q));

  return (
    <div className="space-y-3" data-testid="trigger-history">
      {!controlled && (
        <div className="flex flex-wrap gap-2">
          <div className="w-44">
            <Select value={f.policyId} onChange={(e) => update({ policyId: e.target.value })} aria-label="Policy filter" data-testid="trigger-filter-policy">
              <option value="">All policies</option>
              {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          <div className="w-32">
            <Select value={f.severity} onChange={(e) => update({ severity: e.target.value })} aria-label="Severity filter" data-testid="trigger-filter-severity">
              <option value="">Severity</option>
              {["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div className="w-32">
            <Select value={f.action} onChange={(e) => update({ action: e.target.value })} aria-label="Action filter" data-testid="trigger-filter-action">
              <option value="">Action</option>
              {["logged", "warned", "blocked", "allowed"].map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </div>
          <div className="w-32">
            <Select value={f.source} onChange={(e) => update({ source: e.target.value })} aria-label="Source filter" data-testid="trigger-filter-source">
              <option value="">Source</option>
              {(["internal", "external"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div className="min-w-40 flex-1">
            <Input value={f.q} onChange={(e) => update({ q: e.target.value })} placeholder="Search reason…" aria-label="Search triggers" className="h-8 text-xs" data-testid="trigger-search" />
          </div>
        </div>
      )}
      {activeFeed.isPending ? (
        <LoadingState message="Loading triggers…" className="py-8" />
      ) : activeFeed.error ? (
        <ErrorState title="Could not load triggers" message={parseApiError(activeFeed.error).message} onRetry={() => void activeFeed.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState icon={ScrollText} title="No trigger events" description="Matching policy triggers will appear here." testId="no-triggers" />
      ) : (
        <>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {shown.map((t: TriggerEvent) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  data-testid={`trigger-row-${t.id}`}
                  className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{t.policy_id ? policies.find((p) => p.id === t.policy_id)?.name ?? t.policy_id.slice(0, 8) : "Unknown policy"}</span>
                  {t.category && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{t.category}</span>}
                  {t.severity && <span className="text-[10px] uppercase text-zinc-500">{String(t.severity)}</span>}
                  {t.action && <span className="text-[10px] text-zinc-500">{t.action}</span>}
                  <span className="ml-auto text-[11px] text-zinc-400">{t.created_at ? new Date(t.created_at).toLocaleString() : ""}</span>
                </button>
              </li>
            ))}
          </ul>
          {activeFeed.hasNextPage && (
            <Button size="sm" variant="outline" onClick={() => void activeFeed.fetchNextPage()} disabled={activeFeed.isFetchingNextPage} data-testid="triggers-more">
              {activeFeed.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </>
      )}
      <TriggerInspector id={selectedId} orgId={orgId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
