"use client";
import { fmtBudgetAmount } from "@/app/api-keys/components/BudgetBar";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Badge, Button, Card, CardContent, EmptyState, Field, Input, LoadingState,
} from "@/components/ui";
import { WorkspaceLoggingSection } from "@/components/logging/WorkspaceLoggingSection";
import { isForbiddenError, isNotFoundError, useOrgBudget, useOrgMutations } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import type { Organization } from "@/types/orgs";

type SettingsTab = "profile" | "budgets" | "logging" | "danger";

function money(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return fmtBudgetAmount(n);
}

/** Settings: profile, budgets summary, logging, danger zone.
 * Only backend-supported actions render enabled; everything unimplemented
 * renders disabled with an "Unavailable" badge — never fake buttons. */
export const SETTINGS_TABS = ["profile", "budgets", "logging", "danger"] as const;

export function isSettingsTab(v: string | null): v is SettingsTab {
  return v === "profile" || v === "budgets" || v === "logging" || v === "danger";
}

export function OrgSettingsSection({ orgId, org, canManage }: {
  orgId: string;
  org: Organization;
  canManage: boolean;
}) {
  // Active tab lives in ?settingsTab= so it is shareable and survives
  // back/forward; the section sidebar renders the nav (same testids).
  const searchParams = useSearchParams();
  const param = searchParams.get("settingsTab");
  const tab: SettingsTab = isSettingsTab(param) ? param : "profile";

  return (
    <div className="max-w-3xl space-y-2.5" data-testid="org-settings">

      {tab === "profile" && (
        <div role="region" aria-label="Organization profile">
          <ProfileTab orgId={orgId} org={org} canManage={canManage} />
        </div>
      )}
      {tab === "budgets" && (
        <div role="region" aria-label="Budgets">
          <BudgetsTab orgId={orgId} />
        </div>
      )}
      {tab === "logging" && (
        <div role="region" aria-label="Prompt logging">
          <LoggingTab orgId={orgId} canManage={canManage} />
        </div>
      )}
      {tab === "danger" && (
        <div role="region" aria-label="Danger zone">
          <DangerTab />
        </div>
      )}
    </div>
  );
}

function ProfileTab({ orgId, org, canManage }: { orgId: string; org: Organization; canManage: boolean }) {
  const mut = useOrgMutations(orgId);
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description ?? "");
  const [industry, setIndustry] = useState(org.industry ?? "");
  const [website, setWebsite] = useState(org.website ?? "");
  const [location, setLocation] = useState(org.location ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = name.trim() !== org.name
    || (description.trim() || "") !== (org.description ?? "")
    || (industry.trim() || "") !== (org.industry ?? "")
    || (website.trim() || "") !== (org.website ?? "")
    || (location.trim() || "") !== (org.location ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await mut.updateOrg.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        industry: industry.trim() || null,
        website: website.trim() || null,
        location: location.trim() || null,
      });
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-xs font-bold">Organization profile</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Scope: this organization only — visible to every member. Saved via PATCH — applies immediately and is audit-logged. Slug <span className="font-mono">/{org.slug}</span> never changes.
          </p>
        </div>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
            disabled={!canManage} data-testid="org-profile-name" />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500}
            disabled={!canManage} data-testid="org-profile-description" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Industry">
            <Input value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={80}
              disabled={!canManage} data-testid="org-profile-industry" />
          </Field>
          <Field label="Website">
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={200}
              disabled={!canManage} data-testid="org-profile-website" />
          </Field>
          <Field label="Location">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120}
              disabled={!canManage} data-testid="org-profile-location" />
          </Field>
        </div>
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
        {!canManage && (
          <p className="text-[11px] text-zinc-400">You need organization-settings permission to edit the profile.</p>
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void save()}
            disabled={busy || !canManage || !dirty || name.trim().length < 2}
            data-testid="org-profile-save">
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save profile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BudgetsTab({ orgId }: { orgId: string }) {
  const budget = useOrgBudget(orgId);
  const cap = budget.data ? (budget.data.max_spend ?? budget.data.max_budget_usd ?? budget.data.cap) : undefined;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold">Budgets</h3>
            <p className="mt-0.5 text-xs text-zinc-500">Scope: this organization&apos;s shared spend pool. Impact: read-only here — caps are edited under Budgets by budget managers.</p>
          </div>
          <Link href={`/organizations/${orgId}?section=budgets`} data-testid="org-budgets-link">
            <Button size="sm" variant="outline">Open Budgets</Button>
          </Link>
        </div>
        {budget.isLoading && <div className="mt-3"><LoadingState message="Loading budget…" /></div>}
        {budget.isError && isForbiddenError(budget.error) && (
          <p className="mt-3 text-xs text-zinc-500">You need Budgets.Read permission to view budget pools.</p>
        )}
        {budget.isError && isNotFoundError(budget.error) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="text-xs text-zinc-500">Budget pools weren&apos;t found for this organization.</p>
            <Button size="sm" variant="outline" onClick={() => void budget.refetch()}
              data-testid="org-budgets-retry">Retry</Button>
          </div>
        )}
        {budget.isError && !isForbiddenError(budget.error) && !isNotFoundError(budget.error) && (
          <p className="mt-3 text-xs text-zinc-500">{parseApiError(budget.error).message}</p>
        )}
        {budget.data && (
          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Cap</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold">{money(cap)}</dd>
            </div>
            <div className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Allocated</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold">{money(budget.data.allocated)}</dd>
            </div>
            <div className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Unallocated</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold">{money(budget.data.unallocated)}</dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function LoggingTab({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-bold">Prompt logging</h3>
        <p className="mt-0.5 text-xs text-zinc-500">
          Scope: workspace-wide capture defaults for this org. Impact: per-team and per-key overrides live under Prompt Logs; global ON locks every scope.
        </p>
        <div className="mt-2">
          <WorkspaceLoggingSection orgId={orgId} canManage={canManage} />
        </div>
      </CardContent>
    </Card>
  );
}

function DangerTab() {
  const actions = [
    { label: "Transfer Root", reason: "Root transfer is not implemented by the backend yet." },
    { label: "Suspend Organization", reason: "Organization suspension is not implemented by the backend yet." },
    { label: "Delete Organization", reason: "Organization deletion is not implemented by the backend yet." },
  ];
  return (
    <Card className="border-red-200 dark:border-red-900/60">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-red-700 dark:text-red-300">Danger Zone</h3>
        </div>
        <p className="mt-0.5 text-xs text-zinc-500">
          Scope: the entire organization and every member. Impact: irreversible — only backend-supported actions render enabled.
        </p>
        {actions.length === 0 ? (
          <EmptyState title="No danger-zone actions" description="Nothing here needs your attention." />
        ) : (
          <ul className="mt-3 space-y-2">
            {actions.map((a) => (
              <li key={a.label} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{a.label}</p>
                  <p className="text-[11px] text-zinc-500">{a.reason}</p>
                </div>
                <span className="flex items-center gap-2">
                  <Badge variant="outline">Unavailable</Badge>
                  <Button size="sm" variant={a.label.includes("Delete") ? "destructive" : "outline"}
                    disabled title={a.reason}>
                    {a.label}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
