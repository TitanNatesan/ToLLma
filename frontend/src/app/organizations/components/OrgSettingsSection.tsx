"use client";
import { fmtBudgetAmount } from "@/app/api-keys/components/BudgetBar";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/notify";
import {
  Badge, Button, Card, CardContent, EmptyState, Field, Input, LoadingState,
} from "@/components/ui";
import { ConfirmDialog } from "./Dialogs";
import { WorkspaceLoggingSection } from "@/components/logging/WorkspaceLoggingSection";
import { isForbiddenError, isNotFoundError, useOrgBudget, useOrgMutations } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import type { Organization } from "@/types/orgs";

type Tab = "profile" | "privacy" | "sharing" | "budgets" | "logging" | "danger";

function money(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return fmtBudgetAmount(n);
}

/** Settings as tabs: profile, privacy, sharing, budgets summary, danger zone.
 * Only backend-supported actions render enabled; everything unimplemented
 * renders disabled with an "Unavailable" badge — never fake buttons. */
export function OrgSettingsSection({ orgId, org, canManage }: {
  orgId: string;
  org: Organization;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <div className="max-w-3xl space-y-2.5" data-testid="org-settings">
      <div className="flex gap-1 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800" role="tablist"
        aria-label="Organization settings" data-testid="org-settings-tabs">
        {([
          { id: "profile", label: "Profile" },
          { id: "privacy", label: "Privacy" },
          { id: "sharing", label: "Sharing" },
          { id: "budgets", label: "Budgets" },
          { id: "logging", label: "Logging" },
          { id: "danger", label: "Danger zone" },
        ] as const).map((t) => (
          <button key={t.id} type="button" role="tab" id={`org-settings-tabbtn-${t.id}`} aria-selected={tab === t.id} aria-controls={`org-settings-panel-${t.id}`}
            onClick={() => setTab(t.id)} data-testid={`org-settings-tab-${t.id}`}
            className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${tab === t.id
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <div role="tabpanel" id="org-settings-panel-profile" aria-labelledby="org-settings-tabbtn-profile">
          <ProfileTab orgId={orgId} org={org} canManage={canManage} />
        </div>
      )}
      {tab === "privacy" && (
        <div role="tabpanel" id="org-settings-panel-privacy" aria-labelledby="org-settings-tabbtn-privacy">
          <PrivacyTab orgId={orgId} org={org} canManage={canManage} />
        </div>
      )}
      {tab === "sharing" && (
        <div role="tabpanel" id="org-settings-panel-sharing" aria-labelledby="org-settings-tabbtn-sharing">
          <SharingTab orgId={orgId} org={org} canManage={canManage} />
        </div>
      )}
      {tab === "budgets" && (
        <div role="tabpanel" id="org-settings-panel-budgets" aria-labelledby="org-settings-tabbtn-budgets">
          <BudgetsTab orgId={orgId} />
        </div>
      )}
      {tab === "logging" && (
        <div role="tabpanel" id="org-settings-panel-logging" aria-labelledby="org-settings-tabbtn-logging">
          <LoggingTab orgId={orgId} canManage={canManage} />
        </div>
      )}
      {tab === "danger" && (
        <div role="tabpanel" id="org-settings-panel-danger" aria-labelledby="org-settings-tabbtn-danger">
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
            Saved via PATCH — applies immediately and is audit-logged. Slug <span className="font-mono">/{org.slug}</span> never changes.
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

function PrivacyTab({ orgId, org, canManage }: { orgId: string; org: Organization; canManage: boolean }) {
  const mut = useOrgMutations(orgId);
  const [busy, setBusy] = useState(false);

  async function save(mode: string) {
    setBusy(true);
    try {
      await mut.updateOrg.mutateAsync({ visibility_mode: mode });
      toast.success("Visibility mode updated. Members notified.");
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-bold">Privacy</h3>
        <p className="mt-0.5 text-xs text-zinc-500">Controls what the organization sees of member conversations.</p>
        <div className="mt-3 flex gap-1.5" role="radiogroup" aria-label="Conversation visibility">
          {(["metadata_only", "full_conversation_access"] as const).map((m) => (
            <Button key={m} size="sm" variant={org.visibility_mode === m ? "default" : "outline"}
              disabled={busy || !canManage}
              onClick={() => void save(m)}
              data-testid={`org-vis-${m}`}>
              {m === "metadata_only" ? "Metadata Only" : "Full Conversation Access"}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          Metadata Only shares user, model, provider, tokens, costs, and timestamps — never message content.
          Full access additionally reveals prompts, responses, and attachments, and every read is audit-logged.
        </p>
        {!canManage && (
          <p className="mt-2 text-[11px] text-zinc-400">You need organization-settings permission to change this.</p>
        )}
      </CardContent>
    </Card>
  );
}

function SharingTab({ orgId, org, canManage }: { orgId: string; org: Organization; canManage: boolean }) {
  const mut = useOrgMutations(orgId);
  const [busy, setBusy] = useState(false);
  const [confirmSharing, setConfirmSharing] = useState(false);

  async function save(value: boolean, ok: string) {
    setBusy(true);
    try {
      await mut.updateOrg.mutateAsync({ personal_sharing_enforced: value });
      toast.success(ok);
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold">Personal Usage Sharing</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Off by default. When enabled, members must share personal usage metadata. Members are notified on change.
              Message content stays private either way.
            </p>
          </div>
          <Button size="sm" variant={org.personal_sharing_enforced ? "default" : "outline"}
            disabled={busy || !canManage}
            onClick={() => {
              if (!org.personal_sharing_enforced) {
                setConfirmSharing(true);
                return;
              }
              void save(false, "Sharing enforcement disabled.");
            }} data-testid="org-enforce-toggle">
            {org.personal_sharing_enforced ? "Enforced" : "Off"}
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          </Button>
        </div>
        {!canManage && (
          <p className="mt-2 text-[11px] text-zinc-400">You need organization-settings permission to change this.</p>
        )}
        <ConfirmDialog open={confirmSharing} title="Enable Personal Usage Sharing?"
          confirmLabel="Enable Sharing" testId="org-sharing-dialog"
          description="Members will be notified that personal usage metadata will be shared with this organization. Message content stays private."
          onClose={() => setConfirmSharing(false)}
          onConfirm={() => save(true, "Sharing enforcement enabled.").then(() => setConfirmSharing(false))} />
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
            <p className="mt-0.5 text-xs text-zinc-500">Organization spend pool at a glance. Caps are edited under Budgets.</p>
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
          Workspace capture policy at a glance. Per-team and per-key overrides live under Prompt Logs.
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
          Irreversible organization actions. Only backend-supported actions render enabled.
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
