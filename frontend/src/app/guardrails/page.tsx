"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageContainer,
  PageHeader,
  SearchInput,
  Select,
} from "@/components/ui";
import { ConfirmDialog } from "@/app/api-keys/components/ConfirmDialog";
import { toast } from "@/lib/notify";
import { parseApiError, toastApiError } from "@/lib/errors";
import { useGuardrailMutations, useGuardrails } from "@/hooks/useGuardrails";
import { useOrgs } from "@/hooks/useOrgs";
import { useOrgStore } from "@/store/org";
import type { GuardrailPolicy } from "@/services/guardrails";
import { EMPTY_FILTER, filterPolicies } from "./components/policyLogic";
import { GuardrailsTable } from "./components/GuardrailsTable";
import { GuardrailFormDialog } from "./components/GuardrailFormDialog";
import { GuardrailEditDrawer } from "./components/GuardrailEditDrawer";
import { TriggerHistoryPanel } from "./components/TriggerHistoryPanel";
import { TemplateGallery } from "./components/TemplateGallery";

const PAGE_SIZE = 20;

export default function GuardrailsPage() {
  const context = useOrgStore((st) => st.context);
  const isOrg = context.type === "org";
  const orgId = isOrg ? context.orgId : undefined;

  const orgs = useOrgs();
  const orgEntry = orgId ? (orgs.data ?? []).find((o) => o.id === orgId) : undefined;
  const canOrg = (code: string) =>
    !!orgEntry && (orgEntry.is_root || orgEntry.permissions.includes(code));
  const canRead = !isOrg || canOrg("Guardrails.Read");
  const canCreate = !isOrg || canOrg("Guardrails.Create");
  const canEdit = !isOrg || canOrg("Guardrails.Update");
  const canClone = !isOrg || canOrg("Guardrails.Create");
  const canTest = !isOrg || canOrg("Guardrails.Test");
  const canDelete = !isOrg || canOrg("Guardrails.Delete");
  const canToggle = !isOrg || canOrg("Guardrails.Update");
  const canViewEvents = !isOrg || canOrg("Guardrails.ViewEvents");

  const list = useGuardrails(orgId);
  const mut = useGuardrailMutations(orgId);

  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<"policies" | "triggers" | "templates">("policies");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<GuardrailPolicy | null>(null);
  const [viewing, setViewing] = useState<GuardrailPolicy | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GuardrailPolicy | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const policies = useMemo(() => list.data ?? [], [list.data]);
  const filtered = useMemo(() => filterPolicies(policies, filter), [policies, filter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  async function runBusy(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusyId(id);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toastApiError(e, { title: "Action failed" });
    } finally {
      setBusyId(null);
    }
  }

  if (isOrg && !orgs.isPending && !canRead) {
    return (
      <PageContainer data-testid="guardrails-page">
        <EmptyState
          title="Guardrails"
          description="You need the Guardrails.Read permission to view organization guardrails."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer data-testid="guardrails-page">
      <PageHeader
        title="Guardrails"
        subtitle={isOrg ? `Organization policies · ${orgEntry?.name ?? ""}` : "Personal policies"}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="guardrail-new">
              New guardrail
            </Button>
          ) : undefined
        }
      />
      <div className="flex gap-1 border-b border-zinc-200 px-4 dark:border-zinc-800" role="tablist" aria-label="Guardrails views" data-testid="guardrails-tabs">
        {(["policies", "triggers", "templates"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            data-testid={`tab-${t}`}
            className={`px-3 py-2 text-xs font-medium capitalize ${tab === t ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100" : "text-zinc-500"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "policies" && (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <div className="min-w-44 flex-1">
              <SearchInput value={filter.q} onChange={(e) => { setFilter({ ...filter, q: e.target.value }); setPage(0); }} onClear={() => setFilter({ ...filter, q: "" })} placeholder="Search policies…" data-testid="guardrail-search" />
            </div>
            {(["severity", "enforcement", "enabled", "scope"] as const).map((k) => (
              <div key={k} className="w-32">
                <Select value={filter[k]} onChange={(e) => { setFilter({ ...filter, [k]: e.target.value }); setPage(0); }} aria-label={`${k} filter`} data-testid={`guardrail-filter-${k}`}>
                  <option value="ALL">{k === "enabled" ? "On/Off" : `All ${k}`}</option>
                  {k === "severity" && ["low", "medium", "high", "critical"].map((v) => <option key={v} value={v}>{v}</option>)}
                  {k === "enforcement" && ["monitor", "warn", "block"].map((v) => <option key={v} value={v}>{v}</option>)}
                  {k === "enabled" && [<option key="on" value="on">Enabled</option>, <option key="off" value="off">Disabled</option>]}
                  {k === "scope" && [<option key="global" value="global">Global</option>, <option key="scoped" value="scoped">Scoped</option>]}
                </Select>
              </div>
            ))}
          </div>

          {list.isPending ? (
            <LoadingState message="Loading guardrails…" className="py-12" />
          ) : list.error ? (
            <ErrorState title="Could not load guardrails" message={parseApiError(list.error).message} onRetry={() => void list.refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title={policies.length === 0 ? "No guardrails yet" : "No matching policies"}
              description={policies.length === 0 ? "Create your first policy or start from a template." : "Adjust the search or filters."}
              testId="no-guardrails"
              action={policies.length === 0 && canCreate ? (<Button size="sm" variant="outline" onClick={() => setTab("templates")}>Browse templates</Button>) : undefined}
            />
          ) : (
            <>
              <GuardrailsTable
                rows={rows}
                actions={{
                  canEdit,
                  canClone,
                  canTest,
                  canDelete,
                  canToggle,
                  busyId,
                  onView: setViewing,
                  onEdit: setEditing,
                  onClone: (p) => void runBusy(p.id, () => mut.clone.mutateAsync(p.id), `Cloned "${p.name}".`),
                  onToggle: (p, on) =>
                    void runBusy(p.id, () => (on ? mut.enable.mutateAsync(p.id) : mut.disable.mutateAsync(p.id)), on ? `"${p.name}" enabled.` : `"${p.name}" disabled.`),
                  onTest: setViewing,
                  onDelete: setDeleteTarget,
                }}
              />
              {pageCount > 1 && (
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>Page {safePage + 1} of {pageCount} · {filtered.length} policies</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} data-testid="page-prev">Prev</Button>
                    <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} data-testid="page-next">Next</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "triggers" && (
        <div className="p-4">
          <TriggerHistoryPanel policies={policies} canView={canViewEvents} orgId={orgId} />
        </div>
      )}

      {tab === "templates" && (
        <div className="p-4">
          <TemplateGallery orgId={orgId} canCreate={canCreate} />
        </div>
      )}

      <p className="px-4 pb-4 text-[11px] text-zinc-400">
        Need to call the API directly? <Link href="/docs">API docs</Link> cover the guardrails endpoints.
      </p>

      {createOpen && (
        <GuardrailFormDialog open={createOpen} onClose={() => setCreateOpen(false)} initial={null} orgId={orgId} />
      )}
      {editing && (
        <GuardrailFormDialog open={!!editing} onClose={() => setEditing(null)} initial={editing} orgId={orgId} />
      )}
      <GuardrailEditDrawer policy={viewing} onClose={() => setViewing(null)} orgId={orgId} />

      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        title={`Delete “${deleteTarget?.name ?? ""}”?`}
        description="The policy stops applying immediately. Trigger history is kept. This cannot be undone."
        confirmLabel="Delete policy"
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          const p = deleteTarget;
          setDeleteTarget(null);
          void runBusy(p.id, () => mut.remove.mutateAsync(p.id), `Guardrail "${p.name}" deleted.`);
        }}
      />
    </PageContainer>
  );
}
