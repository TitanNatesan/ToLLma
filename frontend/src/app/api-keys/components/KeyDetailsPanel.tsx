"use client";

import { memo, useState } from "react";
import { Activity, KeyRound, Network, Pencil } from "lucide-react";
import { Badge, Button, DetailPanel } from "@/components/ui";
import { cn } from "@/lib/utils";
import { KeyAnalytics } from "./KeyAnalytics";
import { ModelPermissionChips } from "./ModelPermissionChips";
import { NetworkPanel } from "./NetworkPanel";
import { ApiKeyStatusPill, fmtDateTime, keyStatus } from "./StatusPill";
import type { ApiKey } from "@/types/apiKeys";

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

/** Read-only model allowlist chips; empty means the key may use any model. */
function ModelsSection({ apiKey }: { apiKey: ApiKey }) {
  const perms = apiKey.model_permissions ?? [];
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Model permissions</p>
      {perms.length === 0 ? (
        <p className="mt-1 text-[11px] text-zinc-500" data-testid={`key-models-${apiKey.id}`}>
          All models — no per-model restriction.
        </p>
      ) : (
        <ModelPermissionChips items={perms} testId={`key-models-${apiKey.id}`} />
      )}
    </div>
  );
}

interface KeyDetailsPanelProps {
  apiKey: ApiKey | null;
  open: boolean;
  onClose: () => void;
  /** Opens the dedicated edit drawer for this key. */
  onEdit?: (apiKey: ApiKey) => void;
  /** 30d spend when already loaded by the list; same signal the table passes. */
  cost?: number | null;
}

/**
 * Read-only key console: identity summary plus Analytics and Network tabs.
 * All editing moved to KeyEditDrawer — this panel renders no inputs.
 * Chrome (backdrop, Escape, focus trap) comes from the shared DetailPanel.
 */
export function KeyDetailsPanel({ apiKey, open, onClose, onEdit, cost }: KeyDetailsPanelProps) {
  if (!apiKey) return null;
  return (
    <KeyDetailsContent
      key={apiKey.id}
      apiKey={apiKey}
      open={open}
      onClose={onClose}
      onEdit={onEdit}
      cost={cost}
    />
  );
}

const KeyDetailsContent = memo(function KeyDetailsContent({
  apiKey,
  open,
  onClose,
  onEdit,
  cost,
}: {
  apiKey: ApiKey;
  open: boolean;
  onClose: () => void;
  onEdit?: (apiKey: ApiKey) => void;
  cost?: number | null;
}) {
  const [tab, setTab] = useState<Tab>("analytics");
  // Identical function + spend basis as the table row: no disagreement.
  const status = keyStatus(apiKey, cost);

  return (
    <DetailPanel
      open={open}
      onClose={onClose}
      width="min(96vw, 1180px)"
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-3.5 text-zinc-400" />
          {apiKey.name}
        </span>
      }
      subtitle={<span className="font-mono">{apiKey.masked}</span>}
      actions={
        onEdit ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEdit(apiKey)}
            data-testid="key-edit-button"
          >
            <Pencil className="size-3.5" />
            Edit Key
          </Button>
        ) : undefined
      }
      testId="key-details-panel"
      backdropTestId="key-details-backdrop"
      label={`Details for ${apiKey.name}`}
    >
      <div className="space-y-4">
        {(apiKey.is_primary || apiKey.is_default) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {apiKey.is_primary && (
              <Badge
                variant="secondary"
                className="text-[10px]"
                data-testid={`key-details-primary-${apiKey.id}`}
                title="Primary is your automatic system key"
              >
                Primary
              </Badge>
            )}
            {apiKey.is_default && (
              <Badge
                variant="success"
                className="text-[10px]"
                data-testid={`key-details-default-${apiKey.id}`}
                title="Default is the most-recent key used for new requests"
              >
                Default
              </Badge>
            )}
            <span
              className="text-[11px] text-zinc-500 dark:text-zinc-400"
              data-testid="key-primary-default-explainer"
            >
              Primary is automatic. Default is the most-recent key.
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-2">
          <Meta label="Status" value={<ApiKeyStatusPill status={status} />} />
          <Meta label="Prefix" value={<span className="font-mono">{apiKey.key_prefix}</span>} />
          <Meta label="Created" value={fmtDateTime(apiKey.created_at)} />
          <Meta label="Last used" value={fmtDateTime(apiKey.last_used_at)} />
          <Meta label="Expires" value={fmtDateTime(apiKey.expires_at)} />
          <Meta
            label="Rotations"
            value={
              <Badge variant="secondary" className="text-[10px]">
                {apiKey.rotation_count}
              </Badge>
            }
          />
        </div>

                <ModelsSection apiKey={apiKey} />

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
                data-testid={`key-tab-${item.id}`}
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

        {tab === "analytics" && <AnalyticsSlot keyId={apiKey.id} />}
        {tab === "network" && <NetworkSlot keyId={apiKey.id} />}
      </div>
    </DetailPanel>
  );
});
