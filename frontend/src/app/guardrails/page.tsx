"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { OrgContextSidebar } from "@/app/organizations/components/OrgContextSidebar";
import { SidebarPanelPortal } from "@/components/Sidebar/SidebarPanelPortal";
import { toast } from "@/lib/notify";
import { parseApiError, toastApiError } from "@/lib/errors";
import { useGuardrailMutations, useGuardrails, useGuardrailTriggers } from "@/hooks/useGuardrails";
import { useOrgs } from "@/hooks/useOrgs";
import { useOrgStore } from "@/store/org";
import type { GuardrailPolicy } from "@/services/guardrails";
import { EMPTY_FILTER, EMPTY_TRIGGER_FILTER, filterPolicies, type TriggerFilterState } from "./components/policyLogic";
import { GuardrailsTable } from "./components/GuardrailsTable";
import { GuardrailFormDialog } from "./components/GuardrailFormDialog";
import { GuardrailEditDrawer } from "./components/GuardrailEditDrawer";
import { TriggerHistoryPanel } from "./components/TriggerHistoryPanel";
import { TemplateGallery } from "./components/TemplateGallery";

const PAGE_SIZE = 20;

export default function GuardrailsPage() {
  // useSearchParams (?policy= deep link) needs a Suspense boundary or the
  // production build fails.
  return (
    <Suspense fallback={<LoadingState message="Loading guardrails…" className="py-12" />}>
      <GuardrailsPageInner />
    </Suspense>
  );
}

function GuardrailsPageInner() {
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

  const list = useGuardrails(orgId, { enabled: canRead });
  const mut = useGuardrailMutations(orgId);

  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilterState>(EMPTY_TRIGGER_FILTER);
  const [templateQ, setTemplateQ] = useState("");
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<"policies" | "triggers" | "templates">("policies");
  // First triggers visit arms the feed; it then stays mounted so tab
  // switches reuse the cache instead of refetching.
  const [triggersSeen, setTriggersSeen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<GuardrailPolicy | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Deep link (?policy=): selecting a policy keeps the id in the URL so the
  // detail drawer is shareable and survives reload. Selection is derived from
  // the URL (no mirror state).
  const policyParam = searchParams.get("policy");
  function viewPolicy(policy: GuardrailPolicy | null) {
    const id = policy?.id ?? null;
    const params = new URLSearchParams(searchParams.toString());
    if ((params.get("policy") ?? null) === id) return;
    if (id) params.set("policy", id);
    else params.delete("policy");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }
  const policies = useMemo(() => list.data ?? [], [list.data]);
  const viewing = policyParam ? (policies.find((pl) => pl.id === policyParam) ?? null) : null;
  const [deleteTarget, setDeleteTarget] = useState<GuardrailPolicy | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const triggerServerFilters = useMemo(
    () => ({
      org_id: orgId ?? undefined,
      policy_id: triggerFilter.policyId || undefined,
      severity: triggerFilter.severity || undefined,
      action: triggerFilter.action || undefined,
      source: triggerFilter.source || undefined,
    }),
    [orgId, triggerFilter],
  );
  const triggerFeed = useGuardrailTriggers(
    triggerServerFilters,
    canViewEvents && (tab === "triggers" || triggersSeen),
  );

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
          testId="guardrails-denied"
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
            onClick={() => { setTab(t); if (t === "triggers") setTriggersSeen(true); }}
            data-testid={`tab-${t}`}
            className={`rounded-t px-3 py-2 text-xs font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 ${tab === t ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100" : "text-zinc-500"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <SidebarPanelPortal>
        <OrgContextSidebar heading={tab === "policies" ? "Policy filters" : tab === "triggers" ? "Trigger filters" : "Template filters"} testId="guardrail-sidebar" bare storageKey="guardrail-sidebar-collapsed">
          {tab === "policies" && (
            <>
              <SearchInput value={filter.q} onChange={(e) => { setFilter({ ...filter, q: e.target.value }); setPage(0); }} onClear={() => setFilter({ ...filter, q: "" })} placeholder="Search policies…" data-testid="guardrail-search" />
              {(["severity", "enforcement", "enabled", "scope"] as const).map((k) => (
                <Select key={k} value={filter[k]} onChange={(e) => { setFilter({ ...filter, [k]: e.target.value }); setPage(0); }} aria-label={`${k} filter`} data-testid={`guardrail-filter-${k}`}>
                  <option value="ALL">{k === "enabled" ? "On/Off" : `All ${k}`}</option>
                  {k === "severity" && ["low", "medium", "high", "critical"].map((v) => <option key={v} value={v}>{v}</option>)}
                  {k === "enforcement" && ["monitor", "warn", "block"].map((v) => <option key={v} value={v}>{v}</option>)}
                  {k === "enabled" && [<option key="on" value="on">Enabled</option>, <option key="off" value="off">Disabled</option>]}
                  {k === "scope" && [<option key="global" value="global">Global</option>, <option key="scoped" value="scoped">Scoped</option>]}
                </Select>
              ))}
              {([
                ...(filter.q.trim() ? [{ key: "q", label: `Search: ${filter.q.trim()}` }] : []),
                ...(["severity", "enforcement", "enabled", "scope"] as const)
                  .filter((k) => filter[k] !== "ALL")
                  .map((k) => ({ key: k, label: `${k}: ${filter[k]}` })),
              ].length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5" data-testid="guardrail-active-filters" aria-live="polite">
                  {[
                    ...(filter.q.trim() ? [{ key: "q", label: `Search: ${filter.q.trim()}` }] : []),
                    ...(["severity", "enforcement", "enabled", "scope"] as const)
                      .filter((k) => filter[k] !== "ALL")
                      .map((k) => ({ key: k, label: `${k}: ${filter[k]}` })),
                  ].map((chip) => (
                    <button key={chip.key} type="button"
                      onClick={() => { setFilter(chip.key === "q" ? { ...filter, q: "" } : { ...filter, [chip.key]: "ALL" }); setPage(0); }}
                      aria-label={`Clear ${chip.key} filter`}
                      className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 transition-colors hover:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:border-zinc-800 dark:text-zinc-300">
                      {chip.label} ✕
                    </button>
                  ))}
                  <button type="button" onClick={() => { setFilter(EMPTY_FILTER); setPage(0); }}
                    data-testid="guardrail-filters-reset"
                    className="rounded text-[11px] font-medium text-tollma-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/60 dark:text-tollma-400">
                    Reset
                  </button>
                </div>
              )}
            </>
          )}
          {tab === "triggers" && (
            <>
              <Select value={triggerFilter.policyId} onChange={(e) => setTriggerFilter({ ...triggerFilter, policyId: e.target.value })} aria-label="Policy filter" data-testid="trigger-filter-policy" disabled={!canViewEvents}>
                <option value="">All policies</option>
                {policies.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              </Select>
              <Select value={triggerFilter.severity} onChange={(e) => setTriggerFilter({ ...triggerFilter, severity: e.target.value })} aria-label="Severity filter" data-testid="trigger-filter-severity" disabled={!canViewEvents}>
                <option value="">Severity</option>
                {["low", "medium", "high", "critical"].map((sv) => <option key={sv} value={sv}>{sv}</option>)}
              </Select>
              <Select value={triggerFilter.action} onChange={(e) => setTriggerFilter({ ...triggerFilter, action: e.target.value })} aria-label="Action filter" data-testid="trigger-filter-action" disabled={!canViewEvents}>
                <option value="">Action</option>
                {["logged", "warned", "blocked", "allowed"].map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
              <Select value={triggerFilter.source} onChange={(e) => setTriggerFilter({ ...triggerFilter, source: e.target.value })} aria-label="Source filter" data-testid="trigger-filter-source" disabled={!canViewEvents}>
                <option value="">Source</option>
                {(["internal", "external"] as const).map((sr) => <option key={sr} value={sr}>{sr}</option>)}
              </Select>
              <SearchInput value={triggerFilter.q} onChange={(e) => setTriggerFilter({ ...triggerFilter, q: e.target.value })} onClear={() => setTriggerFilter({ ...triggerFilter, q: "" })} placeholder="Search reason…" aria-label="Search triggers" data-testid="trigger-search" disabled={!canViewEvents} />
            </>
          )}
          {tab === "templates" && (
            <SearchInput value={templateQ} onChange={(e) => setTemplateQ(e.target.value)} onClear={() => setTemplateQ("")} placeholder="Search templates…" aria-label="Search templates" data-testid="template-search" />
          )}
        </OrgContextSidebar>
      </SidebarPanelPortal>

      {tab === "policies" && (
        <div className="flex flex-col gap-4 p-4">
          <div className="min-w-0 flex-1 space-y-3">
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
                  onView: viewPolicy,
                  onEdit: setEditing,
                  onClone: (p) => void runBusy(p.id, () => mut.clone.mutateAsync(p.id), `Cloned "${p.name}".`),
                  onToggle: (p, on) =>
                    void runBusy(p.id, () => (on ? mut.enable.mutateAsync(p.id) : mut.disable.mutateAsync(p.id)), on ? `"${p.name}" enabled.` : `"${p.name}" disabled.`),
                  onTest: viewPolicy,
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
        </div>
      )}

      {tab === "triggers" && (
        <div className="p-4">
          <TriggerHistoryPanel policies={policies} canView={canViewEvents} orgId={orgId} filters={triggerFilter} onFiltersChange={setTriggerFilter} feed={triggerFeed} />
        </div>
      )}

      {tab === "templates" && (
        <div className="p-4">
          <TemplateGallery orgId={orgId} canCreate={canCreate} search={templateQ} />
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
      <GuardrailEditDrawer policy={viewing} onClose={() => viewPolicy(null)} orgId={orgId} />

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
