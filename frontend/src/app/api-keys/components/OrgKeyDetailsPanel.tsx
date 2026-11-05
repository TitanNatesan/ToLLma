"use client";

import { memo, useState } from "react";
import { Activity, KeyRound, Network, Pencil } from "lucide-react";
import { Badge, Button, DetailPanel } from "@/components/ui";
import { cn } from "@/lib/utils";
import { fmtBudgetAmount } from "./BudgetBar";
import { KeyAnalytics } from "./KeyAnalytics";
import { ModelPermissionChips, type ModelPermissionDisplay } from "./ModelPermissionChips";
import { NetworkPanel } from "./NetworkPanel";
import { ApiKeyStatusPill, asNumber, fmtDateTime } from "./StatusPill";
import { orgKeyStatus } from "./orgKeyStatus";
import type { OrgKey } from "@/types/orgs";

type Tab = "analytics" | "network";

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "analytics", label: "Analytics", icon: Activity },
  { id: "network", label: "Network", icon: Network },
];

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-0.5 truncate text-[11px] text-zinc-600 dark:text-zinc-300">{value}</p>
    </div>
  );
}

/** Memoized slot so tab switches and drawer state don't refetch analytics. */
const AnalyticsSlot = memo(function AnalyticsSlot({ keyId }: { keyId: string }) {
  return <KeyAnalytics keyId={keyId} />;
});

/** Memoized slot so tab switches and drawer state don't refetch network data. */
const NetworkSlot = memo(function NetworkSlot({ keyId }: { keyId: string }) {
  return <NetworkPanel keyId={keyId} />;
});

/** Read-only policy limits: every set limit on one line, unlimited when empty. */
function PolicySection({ orgKey }: { orgKey: OrgKey }) {
  const policy = (orgKey.policy ?? {}) as Record<string, number | string | null | undefined>;
  const rows: Array<[string, string]> = [];
  const budget = asNumber(policy.max_budget_usd);
  if (budget !== null) rows.push(["Budget", fmtBudgetAmount(budget)]);
  if (policy.budget_reset_days != null) rows.push(["Reset", `Every ${policy.budget_reset_days} days`]);
  for (const [field, label] of [
    ["rpm", "RPM"],
    ["rph", "RPH"],
    ["rpd", "RPD"],
    ["tpm", "TPM"],
    ["tpd", "TPD"],
  ] as const) {
    const v = policy[field];
    if (v !== null && v !== undefined && String(v) !== "") rows.push([label, String(v)]);
  }
  const daily = asNumber(policy.daily_spend_limit);
  if (daily !== null) rows.push(["Daily cap", fmtBudgetAmount(daily)]);
  const monthly = asNumber(policy.monthly_spend_limit);
  if (monthly !== null) rows.push(["Monthly cap", fmtBudgetAmount(monthly)]);
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Policy</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-[11px] text-zinc-500" data-testid={`org-key-policy-${orgKey.id}`}>
          Unlimited — no budget or rate limits.
        </p>
      ) : (
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3" data-testid={`org-key-policy-${orgKey.id}`}>
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[10px] text-zinc-400">{label}</dt>
              <dd className="truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-300">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Normalize every tolerant backend naming to display rows (UUIDs + live names). */
function modelItems(orgKey: OrgKey): ModelPermissionDisplay[] {
  const perms = orgKey.model_permissions;
  if (Array.isArray(perms)) {
    if (perms.every((entry) => typeof entry === "string")) {
      return (perms as string[]).map((name, index) => ({ id: `name-${index}`, model_name: name }));
    }
    return (perms as Array<Record<string, unknown>>).map((entry, index) => ({
      id: typeof entry.id === "string" ? entry.id : `perm-${index}`,
      provider_id: typeof entry.provider_id === "string" ? entry.provider_id : null,
      model_id:
        typeof entry.model_id === "string"
          ? entry.model_id
          : typeof entry.model === "string"
            ? entry.model
            : null,
      provider_name: typeof entry.provider_name === "string" ? entry.provider_name : null,
      model_name: typeof entry.model_name === "string" ? entry.model_name : null,
    }));
  }
  if (Array.isArray(orgKey.model_ids)) {
    return orgKey.model_ids.map((id, index) => ({ id: `model-id-${index}`, model_id: id, model_name: id }));
  }
  if (Array.isArray(orgKey.models)) {
    return orgKey.models.map((m, index) => {
      const name = typeof m === "string" ? m : String(m.id ?? m.name ?? "model");
      return { id: `model-${index}`, model_name: name };
    });
  }
  return [];
}

/** Read-only model allowlist chips; empty means the key may use any org model. */
function ModelsSection({ orgKey }: { orgKey: OrgKey }) {
  const items = modelItems(orgKey);
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Model permissions</p>
      {items.length === 0 ? (
        <p className="mt-1 text-[11px] text-zinc-500" data-testid={`org-key-models-${orgKey.id}`}>
          All organization models — no per-model restriction.
        </p>
      ) : (
        <ModelPermissionChips items={items} testId={`org-key-models-${orgKey.id}`} />
      )}
    </div>
  );
}

interface OrgKeyDetailsPanelProps {
  orgKey: OrgKey | null;
  open: boolean;
  onClose: () => void;
  /** Present only when the viewer may edit (Keys.Update). */
  onEdit?: (orgKey: OrgKey) => void;
}

/**
 * Org key console: identity summary plus Analytics and Network tabs.
 * Same observability stack as the personal KeyDetailsPanel (key-id scoped
 * analytics/network endpoints), plus read-only policy and model allowlist.
 * No editing here — revocation stays on the table row.
 */
export function OrgKeyDetailsPanel({ orgKey, open, onClose, onEdit }: OrgKeyDetailsPanelProps) {
  if (!orgKey) return null;
  return <OrgKeyDetailsContent key={orgKey.id} orgKey={orgKey} open={open} onClose={onClose} onEdit={onEdit} />;
}

const OrgKeyDetailsContent = memo(function OrgKeyDetailsContent({
  orgKey,
  open,
  onClose,
  onEdit,
}: {
  orgKey: OrgKey;
  open: boolean;
  onClose: () => void;
  onEdit?: (orgKey: OrgKey) => void;
}) {
  const [tab, setTab] = useState<Tab>("analytics");
  // Same input + spend basis as the org table badge (never usage-blind).
  const status = orgKeyStatus(orgKey);
  const masked = orgKey.masked ?? orgKey.key_prefix ?? "";

  return (
    <DetailPanel
      open={open}
      onClose={onClose}
      width="min(96vw, 1180px)"
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-3.5 text-zinc-400" />
          {orgKey.name}
        </span>
      }
      subtitle={<span className="font-mono">{masked}</span>}
      testId="org-key-details-panel"
      label={`Details for ${orgKey.name}`}
      actions={
        onEdit ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEdit(orgKey)}
            data-testid="org-key-edit-open"
          >
            <Pencil className="size-3.5" />
            Edit Key
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-2">
          <Meta label="Status" value={<ApiKeyStatusPill status={status} />} />
          <Meta
            label="Prefix"
            value={<span className="font-mono">{orgKey.key_prefix ?? masked ?? "—"}</span>}
          />
          <Meta label="Created" value={fmtDateTime(orgKey.created_at)} />
          <Meta label="Last used" value={fmtDateTime(orgKey.last_used_at ?? null)} />
          <Meta label="Expires" value={fmtDateTime(orgKey.expires_at ?? null)} />
          <Meta
            label="Owner"
            value={
              orgKey.assignee_email ?? orgKey.user_email ?? orgKey.email ?? "—"
            }
          />
        </div>

        <PolicySection orgKey={orgKey} />
        <ModelsSection orgKey={orgKey} />

        <div
          role="tablist"
          aria-label="Key observability"
          className="grid grid-cols-1 gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50/60 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/60 sm:grid-cols-2"
        >
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                data-testid={`org-key-tab-${item.id}`}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
                )}
              >
                <Icon className="size-3" />
                {item.label}
              </button>
            );
          })}
        </div>

        {tab === "analytics" && <AnalyticsSlot keyId={orgKey.id} />}
        {tab === "network" && <NetworkSlot keyId={orgKey.id} />}
      </div>
    </DetailPanel>
  );
});
