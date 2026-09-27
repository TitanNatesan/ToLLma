"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Check,
  Clock,
  Copy,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  SearchInput,
  Tooltip,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import { ConfirmDialog } from "./ConfirmDialog";
import { BudgetBar } from "./BudgetBar";
import {
  ApiKeyStatusPill,
  apiKeyStatus,
  fmtDateTime,
  fmtRelativeTime,
  fmtUntil,
  keyStatus,
  type KeyLifecycleStatus,
} from "./StatusPill";
import type { ApiKey } from "@/types/apiKeys";

interface KeyTableProps {
  keys: ApiKey[];
  /** Analytics cost (30d) per key id; absent when no budget is configured. */
  budgetCost: Record<string, number>;
  budgetLoading?: boolean;
  busyId?: string | null;
  onCreate: () => void;
  onEdit: (key: ApiKey) => void;
  onRotate: (key: ApiKey) => void;
  onDelete: (key: ApiKey) => void;
  onToggle: (key: ApiKey) => void;
  onOpenDetails: (key: ApiKey) => void;
}

const TILE_TONE: Record<KeyLifecycleStatus, string> = {
  enabled: "bg-tollma-100 text-tollma-700 dark:bg-tollma-950/60 dark:text-tollma-300",
  disabled: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
  expired: "bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400",
  rate_limited: "bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400",
  budget_exceeded: "bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400",
  rotated: "bg-sky-100 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400",
  inactive: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
};

/** Warning window for the "expires soon" pill. */
const EXPIRY_WARNING_MS = 7 * 24 * 3600 * 1000;

/** True when the key expires in the future but within the warning window. */
function expiresSoon(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return false;
  const delta = t - Date.now();
  return delta > 0 && delta <= EXPIRY_WARNING_MS;
}

/** Sort rank for expiry ordering: soonest first, keys without expiry last. */
function expiryRank(key: ApiKey): number {
  if (!key.expires_at) return Number.POSITIVE_INFINITY;
  const t = new Date(key.expires_at).getTime();
  return isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Copies the non-secret key prefix; flips to a check as confirmation. */
function CopyPrefix({ apiKey }: { apiKey: ApiKey }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy(event: React.MouseEvent) {
    event.stopPropagation();
    const ok = await copyTextToClipboard(apiKey.key_prefix);
    if (ok) {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } else {
      setCopied(false);
      toast.error("Could not copy the prefix", {
        description: "Select the prefix text manually to copy it.",
      });
    }
  }

  return (
    <span className="flex min-w-0 items-center gap-1">
      <code
        className="min-w-0 truncate font-mono text-[10px] text-zinc-400"
        title={`Key prefix: ${apiKey.key_prefix}`}
      >
        {apiKey.masked}
      </code>
      <Tooltip content={copied ? "Copied" : "Copy prefix"}>
        <button
          type="button"
          onClick={(event) => void copy(event)}
          aria-label={`Copy key prefix for ${apiKey.name}`}
          data-testid={`key-copy-prefix-${apiKey.id}`}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded transition-colors",
            copied
              ? "text-tollma-600 dark:text-tollma-400"
              : "text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300",
          )}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </Tooltip>
    </span>
  );
}

function RowActionsInner({
  apiKey,
  busy,
  onEdit,
  onRotate,
  onDelete,
  onToggle,
  onOpenDetails,
}: {
  apiKey: ApiKey;
  busy: boolean;
  onEdit: (key: ApiKey) => void;
  onRotate: (key: ApiKey) => void;
  onDelete: (key: ApiKey) => void;
  onToggle: (key: ApiKey) => void;
  onOpenDetails: (key: ApiKey) => void;
}) {
  // Disabling is destructive (live traffic starts failing), so it asks first.
  // Enabling is harmless and stays one click.
  const [confirmDisable, setConfirmDisable] = useState(false);
  if (busy) {
    return (
      <span className="flex justify-end pr-2 text-zinc-400">
        <Loader2 className="size-4 animate-spin" />
      </span>
    );
  }
  function handleToggle() {
    if (apiKey.enabled) {
      setConfirmDisable(true);
    } else {
      onToggle(apiKey);
    }
  }
  return (
    <>
    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${apiKey.name}`}
            data-testid={`key-actions-${apiKey.id}`}
            className="flex size-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Key actions</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onOpenDetails(apiKey)}>
            <BarChart3 className="size-3.5 text-zinc-400" />
            Details &amp; analytics
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleToggle}>
            {apiKey.enabled ? (
              <PowerOff className="size-3.5 text-zinc-400" />
            ) : (
              <Power className="size-3.5 text-zinc-400" />
            )}
            {apiKey.enabled ? "Disable key" : "Enable key"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEdit(apiKey)}>
            <Pencil className="size-3.5 text-zinc-400" />
            Edit metadata
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRotate(apiKey)}>
            <RefreshCw className="size-3.5 text-zinc-400" />
            Rotate secret
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onDelete(apiKey)}
            className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
          >
            <Trash2 className="size-3.5" />
            Delete key
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <ConfirmDialog
      open={confirmDisable}
      title={`Disable “${apiKey.name}”?`}
      description="The key stops authenticating immediately — requests using it will fail until it is re-enabled. Rotation history and configuration are kept."
      confirmLabel="Disable key"
      onConfirm={() => {
        onToggle(apiKey);
        setConfirmDisable(false);
      }}
      onClose={() => setConfirmDisable(false)}
    />
    </>
  );
}

/** Row action menu, memoized so drawer state changes don't re-render rows. */
const RowActions = memo(RowActionsInner);

/**
 * User key inventory: identity, lifecycle, budget usage and row actions.
 * Summary view only — no inline editing. Activating a row opens the
 * read-only analytics drawer.
 */
export const KeyTable = memo(function KeyTable({
  keys,
  budgetCost,
  budgetLoading = false,
  busyId = null,
  onCreate,
  onEdit,
  onRotate,
  onDelete,
  onToggle,
  onOpenDetails,
}: KeyTableProps) {
  const [query, setQuery] = useState("");

  // Name/prefix text filter, then expiry ordering (soonest first, keys
  // without an expiry last) so at-risk keys surface at the top.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? keys.filter(
          (key) =>
            key.name.toLowerCase().includes(q) ||
            key.key_prefix.toLowerCase().includes(q) ||
            key.masked.toLowerCase().includes(q),
        )
      : [...keys];
    filtered.sort((a, b) => expiryRank(a) - expiryRank(b));
    return filtered;
  }, [keys, query]);

  if (keys.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        title="No API keys yet"
        description="Create a key to authenticate requests to the ToLLma gateway from your services and agents."
        action={
          <Button size="sm" onClick={onCreate} data-testid="keys-empty-create">
            <Plus className="size-3.5" />
            Create key
          </Button>
        }
        testId="keys-empty-state"
        className="py-16"
      />
    );
  }

  const enabledCount = keys.filter((key) => apiKeyStatus(key) === "enabled").length;

  return (
    <div
      className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-950"
      data-testid="keys-table"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50/70 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
        <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          {visible.length !== keys.length
            ? `${visible.length} of ${keys.length} keys`
            : `${keys.length} ${keys.length === 1 ? "key" : "keys"}`}
        </p>
        <p className="hidden text-[10px] text-zinc-400 sm:block">
          <span className="text-tollma-600 dark:text-tollma-400">{enabledCount} enabled</span>
          {keys.length - enabledCount > 0 && ` · ${keys.length - enabledCount} not active`}
        </p>
        <div className="ml-auto w-full sm:w-52">
          <SearchInput
            placeholder="Filter by name or prefix…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            aria-label="Filter API keys"
            data-testid="keys-filter"
            className="h-7 [&_input]:h-7"
          />
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center" data-testid="keys-no-match">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            No keys match &ldquo;{query.trim()}&rdquo;
          </p>
          <Button size="sm" variant="outline" onClick={() => setQuery("")}>
            Clear filter
          </Button>
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-xs" aria-label="API keys">
          <thead className="border-b border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/40">
            <tr className="text-[10px] uppercase tracking-wider text-zinc-400">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Key
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
                Budget (30d)
              </th>
              <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
                Last used
              </th>
              <th scope="col" className="hidden px-4 py-2.5 font-medium xl:table-cell">
                Created
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {visible.map((apiKey) => {
              const cost = budgetCost[apiKey.id];
              const status = keyStatus(apiKey, cost);
              const busy = busyId === apiKey.id;
              const dimmed = status === "disabled" || status === "inactive";
              return (
                <tr
                  key={apiKey.id}
                  onClick={() => onOpenDetails(apiKey)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenDetails(apiKey);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Open details for ${apiKey.name}`}
                  className={cn(
                    "group cursor-pointer transition-colors hover:bg-zinc-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tollma-500/40 dark:hover:bg-zinc-900/50",
                    dimmed && "opacity-75 hover:opacity-100",
                  )}
                  data-testid={`key-row-${apiKey.id}`}
                >
                  <td className="max-w-64 px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                          TILE_TONE[status],
                        )}
                      >
                        <KeyRound className="size-3.5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                          {apiKey.name}
                        </p>
                        <CopyPrefix apiKey={apiKey} />
                        {apiKey.description && (
                          <p className="mt-0.5 line-clamp-1 max-w-52 text-[10px] text-zinc-400">
                            {apiKey.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <ApiKeyStatusPill status={status} />
                    {apiKey.expires_at && status !== "expired" && (
                      <p
                        className="mt-1 text-[10px] text-zinc-400"
                        title={fmtDateTime(apiKey.expires_at)}
                      >
                        Expires {fmtUntil(apiKey.expires_at)}
                      </p>
                    )}
                    {apiKey.expires_at && status !== "expired" && expiresSoon(apiKey.expires_at) && (
                      <p
                        className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                        title={`Expires ${fmtDateTime(apiKey.expires_at)} — rotate or extend soon`}
                        data-testid={`key-expiry-soon-${apiKey.id}`}
                      >
                        <Clock className="size-3" aria-hidden="true" />
                        Expiring {fmtUntil(apiKey.expires_at)}
                      </p>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    <BudgetBar
                      cost={cost}
                      maxBudget={apiKey.policy?.max_budget_usd}
                      loading={budgetLoading}
                      testId="key-budget-usage"
                    />
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <span
                      className="text-[11px] text-zinc-500 dark:text-zinc-400"
                      title={fmtDateTime(apiKey.last_used_at)}
                    >
                      {fmtRelativeTime(apiKey.last_used_at)}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 xl:table-cell">
                    <span
                      className="text-[11px] text-zinc-500 dark:text-zinc-400"
                      title={fmtDateTime(apiKey.created_at)}
                    >
                      {fmtRelativeTime(apiKey.created_at)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <RowActions
                      apiKey={apiKey}
                      busy={busy}
                      onEdit={onEdit}
                      onRotate={onRotate}
                      onDelete={onDelete}
                      onToggle={onToggle}
                      onOpenDetails={onOpenDetails}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      <p className="border-t border-zinc-100 px-4 py-2 text-[10px] text-zinc-400 dark:border-zinc-800/80">
        Budget usage reflects the last 30 days against each key&apos;s reset window.
      </p>
    </div>
  );
});
