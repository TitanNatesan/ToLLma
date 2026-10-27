"use client";

import { Lock } from "lucide-react";
import { Badge, DataTable, StatusBadge, Switch } from "@/components/ui";
import type { GuardrailPolicy } from "@/services/guardrails";
import { evaluatorSummary, isPolicyLocked, scopeSummary } from "./policyLogic";

const SEVERITY_CLASS: Record<string, string> = {
  low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
};

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export interface GuardrailRowActions {
  onView: (p: GuardrailPolicy) => void;
  onEdit: (p: GuardrailPolicy) => void;
  onClone: (p: GuardrailPolicy) => void;
  onToggle: (p: GuardrailPolicy, on: boolean) => void;
  onTest: (p: GuardrailPolicy) => void;
  onDelete: (p: GuardrailPolicy) => void;
  canEdit: boolean;
  canClone: boolean;
  canTest: boolean;
  canDelete: boolean;
  canToggle: boolean;
  busyId: string | null;
}

export function GuardrailsTable({
  rows,
  actions,
}: {
  rows: GuardrailPolicy[];
  actions: GuardrailRowActions;
}) {
  const { onView, onEdit, onClone, onToggle, onTest, onDelete, canEdit, canClone, canTest, canDelete, canToggle, busyId } = actions;
  return (
    <DataTable
      testId="guardrails-table"
      rows={rows}
      rowKey={(p) => p.id}
      emptyMessage="No guardrail policies match."
      onRowClick={onView}
      rowTestId={(p) => `guardrail-row-${p.id}`}
      columns={[
        {
          key: "name",
          header: "Policy",
          render: (p) => (
            <span className="min-w-0">
              <span className="flex max-w-52 items-center gap-1 font-medium text-zinc-900 dark:text-zinc-100">
                {isPolicyLocked(p) && <Lock className="size-3 shrink-0 text-zinc-400" aria-label="Mandatory policy" />}
                <span className="truncate">{p.name}</span>
              </span>
              {p.description && (
                <span className="block max-w-52 truncate text-[11px] text-zinc-500">{p.description}</span>
              )}
            </span>
          ),
        },
        {
          key: "severity",
          header: "Severity",
          render: (p) => (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_CLASS[p.severity] ?? SEVERITY_CLASS.low}`}
              data-testid={`severity-${p.id}`}
            >
              {p.severity}
            </span>
          ),
        },
        {
          key: "enforcement",
          header: "Enforcement",
          render: (p) => <Badge variant="outline" className="text-[10px]">{p.enforcement}</Badge>,
        },
        {
          key: "stage",
          header: "Stage",
          render: (p) => <span className="text-zinc-500">{p.stage}</span>,
        },
        {
          key: "evaluator",
          header: "Evaluator",
          render: (p) => (
            <span className="block max-w-40 truncate text-zinc-500" title={evaluatorSummary(p)}>
              {evaluatorSummary(p)}
            </span>
          ),
        },
        {
          key: "scope",
          header: "Scope",
          render: (p) => (
            <span className="block max-w-40 truncate text-zinc-500" title={scopeSummary(p)}>
              {scopeSummary(p)}
            </span>
          ),
        },
        {
          key: "status",
          header: "Status",
          render: (p) => {
            const locked = isPolicyLocked(p);
            return (
              <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <StatusBadge status={p.is_enabled ? "valid" : "unknown"} label={p.is_enabled ? "On" : "Off"} />
                <Switch
                  checked={p.is_enabled}
                  disabled={!canToggle || busyId === p.id || locked}
                  onCheckedChange={(v) => onToggle(p, v)}
                  aria-label={locked ? `${p.name} is mandatory and cannot be disabled` : `Enable ${p.name}`}
                  data-testid={`guardrail-toggle-${p.id}`}
                />
              </span>
            );
          },
        },
        {
          key: "actions",
          header: "Actions",
          align: "right",
          render: (p) => (
            <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="rounded px-1.5 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:hover:bg-zinc-800" onClick={() => onView(p)} data-testid={`guardrail-view-${p.id}`}>View</button>
              {canEdit && (
                <button type="button" className="rounded px-1.5 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:hover:bg-zinc-800" onClick={() => onEdit(p)} data-testid={`guardrail-edit-${p.id}`}>Edit</button>
              )}
              {canClone && (
                <button type="button" className="rounded px-1.5 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:hover:bg-zinc-800" onClick={() => onClone(p)} data-testid={`guardrail-clone-${p.id}`}>Clone</button>
              )}
              {canTest && (
                <button type="button" className="rounded px-1.5 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:hover:bg-zinc-800" onClick={() => onTest(p)} data-testid={`guardrail-test-${p.id}`}>Test</button>
              )}
              {canDelete && (
                <button type="button" className="rounded px-1.5 py-1 text-[11px] text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:hover:bg-red-950/20" onClick={() => onDelete(p)} data-testid={`guardrail-delete-${p.id}`}>Delete</button>
              )}
            </span>
          ),
        },
      ]}
    />
  );
}
