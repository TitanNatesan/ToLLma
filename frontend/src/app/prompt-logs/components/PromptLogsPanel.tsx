"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ScrollText } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  DetailPanel,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  SearchInput,
  Select,
} from "@/components/ui";
import { ConfirmDialog } from "@/app/api-keys/components/ConfirmDialog";
import { OrgContextSidebar } from "@/app/organizations/components/OrgContextSidebar";
import { SidebarPanelPortal } from "@/components/Sidebar/SidebarPanelPortal";
import { toast } from "@/lib/notify";
import { parseApiError, toastApiError } from "@/lib/errors";
import { copyWithToast } from "@/lib/clipboard";
import { exportPromptLogs, isPromptLogStatus, type PromptLogRow } from "@/services/promptLogs";
import {
  usePromptLogDetail,
  usePromptLogList,
  usePromptLogMutations,
} from "@/hooks/usePromptLogs";
import {
  EMPTY_LOG_FILTER,
  LOG_FILTER_KEYS,
  PROMPT_LOG_LEVELS,
  PROMPT_LOG_STATUSES,
  buildLogQuery,
  canShowBodies,
  filterFromParams,
  filterToParams,
  endpointLabel,
  formatCost,
  formatDurationMs,
  formatLogTime,
  getLogModelDisplay,
  getLogProviderDisplay,
  getLogUserDisplay,
  getLogKeyDisplay,
  hasPricedCost,
  isFilterEmpty,
  mergeLogPages,
  promptLogStatusVariant,
  shortRequestId,
  totalTokensOf,
  type LogFilter,
  type PromptLogPerms,
} from "./promptLogLogic";
import { ScoresPanel } from "./ScoresPanel";

function FieldsCell({ row }: { row: PromptLogRow }) {
  if (row.content_expired) {
    return <Badge variant="secondary">Expired</Badge>;
  }
  const fields = row.fields ?? [];
  if (fields.length === 0) {
    return <span className="text-zinc-400">Metadata only</span>;
  }
  return (
    <span className="flex gap-1">
      {fields.map((f) => (
        <Badge key={f} variant="secondary">{f}</Badge>
      ))}
    </span>
  );
}

function LogDetailDrawer({
  id,
  orgId,
  perms,
  onClose,
  onViewTrace,
}: {
  id: string | null;
  orgId?: string;
  perms: PromptLogPerms;
  onClose: () => void;
  onViewTrace: (traceId: string) => void;
}) {
  const detail = usePromptLogDetail(id, orgId, perms.canRead);
  const mut = usePromptLogMutations(orgId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const d = detail.data;
  const showBodies = !!d && canShowBodies(d, perms.canViewContent);
  const requestId = d?.request_id ?? null;

  return (
    <>
      <DetailPanel
        open={!!id}
        onClose={onClose}
        title={d ? (requestId ? `Log ${requestId.slice(0, 12)}…` : "Prompt log") : "Prompt log"}
        subtitle={d ? d.id : undefined}
        testId="prompt-log-drawer"
        width={520}
        actions={
          d && perms.canDelete ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
              data-testid="prompt-log-delete"
            >
              Delete
            </Button>
          ) : undefined
        }
      >
        {detail.isPending ? (
          <LoadingState message="Loading log…" />
        ) : detail.error || !d ? (
          <ErrorState
            title="Could not load log"
            message={detail.error ? parseApiError(detail.error).message : "Not found"}
            onRetry={() => void detail.refetch()}
          />
        ) : (
          <div className="space-y-3 text-xs">
            <dl className="grid grid-cols-2 gap-2">
              {[
                ["Request ID", requestId ?? "—"],
                ["Status", d.status],
                ["At", formatLogTime(d.created_at)],
                ["Completed", formatLogTime(d.completed_at)],
                ["Workspace", d.workspace_type],
                ["User", getLogUserDisplay(d)],
                ["Key", getLogKeyDisplay(d)],
                ["Provider", getLogProviderDisplay(d)],
                ["Model", getLogModelDisplay(d)],
                ["Endpoint", d.endpoint ?? "—"],
                ["Source", d.source ?? "—"],
                ["Duration", formatDurationMs(d.duration_ms)],
                ["Prompt tokens", d.prompt_tokens != null ? String(d.prompt_tokens) : "—"],
                ["Completion tokens", d.completion_tokens != null ? String(d.completion_tokens) : "—"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                  <dt className="text-[10px] uppercase tracking-wider text-zinc-400">{k}</dt>
                  <dd className="mt-0.5 break-all font-medium text-zinc-900 dark:text-zinc-100">{v}</dd>
                </div>
              ))}
            </dl>
            {requestId ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void copyWithToast(requestId, "Request ID copied")}
                data-testid="prompt-log-copy-id"
              >
                Copy request ID
              </Button>
            ) : null}

            {(d.trace_id || d.session_key) && (
              <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800" data-testid="prompt-log-correlation">
                <p className="mb-1.5 font-semibold text-zinc-900 dark:text-zinc-100">Correlation</p>
                <div className="space-y-1.5">
                  {d.trace_id && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-zinc-400">Trace</span>
                      <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{d.trace_id}</code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void copyWithToast(d.trace_id ?? "", "Trace ID copied")}
                        data-testid="prompt-log-copy-trace"
                      >
                        Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onViewTrace(d.trace_id as string)}
                        data-testid="prompt-log-view-trace"
                      >
                        View all in trace
                      </Button>
                    </div>
                  )}
                  {d.session_key && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-zinc-400">Session</span>
                      <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{d.session_key}</code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void copyWithToast(d.session_key ?? "", "Session key copied")}
                        data-testid="prompt-log-copy-session"
                      >
                        Copy
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800" data-testid="prompt-log-usage">
              <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-100">
                Usage
                {d.usage_estimated ? <Badge variant="outline" title="Usage was estimated, not metered">estimated</Badge> : null}
              </p>
              <dl className="grid grid-cols-3 gap-1.5">
                {[
                  ["Total", totalTokensOf(d) != null ? String(totalTokensOf(d)) : "—"],
                  ["Prompt", d.prompt_tokens != null ? String(d.prompt_tokens) : "—"],
                  ["Completion", d.completion_tokens != null ? String(d.completion_tokens) : "—"],
                  ["Cache read", d.cache_read_tokens != null ? String(d.cache_read_tokens) : "—"],
                  ["Cache write", d.cache_write_tokens != null ? String(d.cache_write_tokens) : "—"],
                  ["Reasoning", d.reasoning_tokens != null ? String(d.reasoning_tokens) : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-md bg-zinc-50 p-1.5 dark:bg-zinc-900">
                    <dt className="text-[10px] uppercase tracking-wider text-zinc-400">{k}</dt>
                    <dd className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800" data-testid="prompt-log-cost">
              <p className="mb-1.5 font-semibold text-zinc-900 dark:text-zinc-100">Cost</p>
              <dl className="grid grid-cols-2 gap-1.5">
                {[
                  ["Input", formatCost(d.input_cost, d.currency)],
                  ["Output", formatCost(d.output_cost, d.currency)],
                  ["Total", formatCost(d.total_cost, d.currency)],
                  ["Pricing", d.pricing_version ?? "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-md bg-zinc-50 p-1.5 dark:bg-zinc-900">
                    <dt className="text-[10px] uppercase tracking-wider text-zinc-400">{k}</dt>
                    <dd className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {(d.finish_reason || d.level || d.status_message || d.error_code || d.model_params) && (
              <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800" data-testid="prompt-log-execution">
                <p className="mb-1.5 font-semibold text-zinc-900 dark:text-zinc-100">Execution</p>
                <dl className="space-y-1">
                  {[
                    ["Finish reason", d.finish_reason ?? "—"],
                    ["Level", d.level ?? "—"],
                    ["Status", d.status_message ?? "—"],
                    ["Error code", d.error_code ?? "—"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-zinc-400">{k}</dt>
                      <dd className="min-w-0 flex-1 break-words font-medium text-zinc-900 dark:text-zinc-100">{v}</dd>
                    </div>
                  ))}
                </dl>
                {d.model_params && Object.keys(d.model_params).length > 0 && (
                  <pre className="mt-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-zinc-50 p-1.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300" data-testid="prompt-log-model-params">
                    {JSON.stringify(d.model_params, null, 2)}
                  </pre>
                )}
              </div>
            )}

            <ScoresPanel
              logId={d.id}
              traceId={d.trace_id ?? null}
              sessionKey={d.session_key ?? null}
              orgId={orgId}
              canDelete={perms.canManage}
            />

            {!showBodies ? (
              <EmptyState
                icon={ScrollText}
                title={d.content_expired ? "Content expired" : "Content not visible"}
                description={
                  d.content_expired
                    ? "This log's message bodies passed retention and were purged. Metadata above is retained."
                    : "You need the PromptLogs.ViewContent permission to read prompt and completion bodies."
                }
                testId="prompt-log-restricted"
              />
            ) : (
              <>
                {d.input_text != null && (
                  <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">Input</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void copyWithToast(d.input_text ?? "", "Input copied")}
                        data-testid="prompt-log-copy-input"
                      >
                        Copy
                      </Button>
                    </div>
                    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      {d.input_text}
                    </pre>
                  </div>
                )}
                {d.output_text != null && (
                  <div className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">Output</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void copyWithToast(d.output_text ?? "", "Output copied")}
                        data-testid="prompt-log-copy-output"
                      >
                        Copy
                      </Button>
                    </div>
                    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      {d.output_text}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </DetailPanel>
      <ConfirmDialog
        open={confirmDelete}
        destructive
        title="Delete this prompt log?"
        description="The metadata and any stored bodies are removed immediately. This cannot be undone."
        confirmLabel="Delete log"
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (!id) return;
          setConfirmDelete(false);
          onClose();
          toast.promise(mut.remove.mutateAsync(id), {
            loading: "Deleting log…",
            success: "Prompt log deleted.",
            error: (e) => parseApiError(e).message,
          });
        }}
      />
    </>
  );
}

export function PromptLogsPanel({
  orgId,
  perms,
  loggingEnabled,
  settingsLoaded,
}: {
  orgId?: string;
  perms: PromptLogPerms;
  loggingEnabled: boolean;
  settingsLoaded: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [filter, setFilter] = useState<LogFilter>(() => filterFromParams((k) => searchParams.get(k)));
  // Deep link (?requestId=): selecting a log keeps the id in the URL so the
  // detail drawer is shareable and survives reload. Matches request_id first,
  // then the row id (command palette may carry either). Selection is derived
  // from the URL (no mirror state); the drawer resolves the row id once the
  // page containing it loads.
  const requestParam = searchParams.get("requestId");
  function selectLog(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if ((params.get("requestId") ?? null) === id) return;
    if (id) params.set("requestId", id);
    else params.delete("requestId");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "jsonl" | null>(null);
  const mut = usePromptLogMutations(orgId);

  async function onExport(format: "csv" | "jsonl") {
    setExporting(format);
    try {
      const q = buildLogQuery(filter);
      const result = await exportPromptLogs(
        {
          trace_id: q.trace_id,
          session_key: q.session_key,
          status: q.status,
          level: q.level,
          min_cost: q.min_cost,
          max_cost: q.max_cost,
          min_tokens: q.min_tokens,
          max_tokens: q.max_tokens,
        },
        format,
        orgId,
      );
      toast.success(`Exported prompt logs as ${format.toUpperCase()} (${result.filename})`);
      if (result.nextCursor) {
        toast.warning("Export truncated — only the first 1000 rows were included. Narrow the filters for the rest.");
      }
    } catch (error) {
      toast.error("Export failed", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setExporting(null);
    }
  }

  function viewTrace(traceId: string) {
    setFilter((f) => ({ ...f, trace_id: traceId }));
    selectLog(null);
  }

  // Keep the filter bar in the URL (replace: no history spam, no scroll jump).
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const next = filterToParams(filter);
    let changed = false;
    for (const key of LOG_FILTER_KEYS) {
      const want = next[key] ?? "";
      if ((params.get(key) ?? "") !== want) {
        changed = true;
        if (want) params.set(key, want);
        else params.delete(key);
      }
    }
    if (changed) router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [filter, pathname, router, searchParams]);

  const query = useMemo(() => buildLogQuery(filter), [filter]);
  const feed = usePromptLogList(
    { org_id: orgId ?? undefined, ...query },
    perms.canRead,
  );
  const rows = useMemo(() => mergeLogPages((feed.data?.pages ?? []).map((p) => p)), [feed.data]);
  const selectedRow = requestParam ? rows.find((r) => r.request_id === requestParam || r.id === requestParam) : undefined;
  const selectedId = selectedRow ? selectedRow.id : null;
  const filteredOut = !isFilterEmpty(filter);

  function set<K extends keyof LogFilter>(key: K, value: string) {
    setFilter((f) => ({ ...f, [key]: value }));
  }

  if (!perms.canRead) {
    return (
      <EmptyState
        icon={ScrollText}
        title="Prompt logs"
        description="You need the PromptLogs.Read permission to view prompt logs."
        testId="prompt-logs-denied"
      />
    );
  }

  return (
    <div className="p-4" data-testid="prompt-logs-panel">
      <div className="flex flex-col gap-4">
        <SidebarPanelPortal>
        <OrgContextSidebar heading="Log filters" testId="prompt-log-sidebar" bare storageKey="prompt-log-sidebar-collapsed">
          <SearchInput
            value={filter.q}
            onChange={(e) => set("q", e.target.value)}
            onClear={() => set("q", "")}
            placeholder="Search request ID…"
            aria-label="Search by request ID"
            data-testid="prompt-log-search"
          />
          {(
            [
              ["user_id", "User"],
              ["key_id", "Key"],
              ["provider_id", "Provider"],
              ["model_id", "Model"],
            ] as const
          ).map(([k, label]) => (
            <Input
              key={k}
              value={filter[k]}
              onChange={(e) => set(k, e.target.value)}
              placeholder={label}
              aria-label={`${label} filter`}
              className="h-8 w-full text-xs"
              data-testid={`prompt-log-filter-${k}`}
            />
          ))}
          <Select value={filter.status} onChange={(e) => set("status", e.target.value)} aria-label="Status filter" data-testid="prompt-log-filter-status">
            <option value="">Status</option>
            {PROMPT_LOG_STATUSES.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </Select>
          <Input
            value={filter.trace_id}
            onChange={(e) => set("trace_id", e.target.value)}
            placeholder="Trace ID"
            aria-label="Trace ID filter"
            className="h-8 w-full text-xs"
            data-testid="prompt-log-filter-trace"
          />
          <Input
            value={filter.session_key}
            onChange={(e) => set("session_key", e.target.value)}
            placeholder="Session key"
            aria-label="Session key filter"
            className="h-8 w-full text-xs"
            data-testid="prompt-log-filter-session"
          />
          <Select value={filter.level} onChange={(e) => set("level", e.target.value)} aria-label="Level filter" data-testid="prompt-log-filter-level">
            <option value="">Level</option>
            {PROMPT_LOG_LEVELS.map((lv) => (
              <option key={lv} value={lv}>{lv}</option>
            ))}
          </Select>
          <div className="flex gap-1">
            <Input
              value={filter.min_cost}
              onChange={(e) => set("min_cost", e.target.value)}
              placeholder="Min cost"
              aria-label="Minimum cost filter"
              inputMode="decimal"
              className="h-8 w-full text-xs"
              data-testid="prompt-log-filter-min-cost"
            />
            <Input
              value={filter.max_cost}
              onChange={(e) => set("max_cost", e.target.value)}
              placeholder="Max cost"
              aria-label="Maximum cost filter"
              inputMode="decimal"
              className="h-8 w-full text-xs"
              data-testid="prompt-log-filter-max-cost"
            />
          </div>
          <div className="flex gap-1">
            <Input
              value={filter.min_tokens}
              onChange={(e) => set("min_tokens", e.target.value)}
              placeholder="Min tokens"
              aria-label="Minimum tokens filter"
              inputMode="numeric"
              className="h-8 w-full text-xs"
              data-testid="prompt-log-filter-min-tokens"
            />
            <Input
              value={filter.max_tokens}
              onChange={(e) => set("max_tokens", e.target.value)}
              placeholder="Max tokens"
              aria-label="Maximum tokens filter"
              inputMode="numeric"
              className="h-8 w-full text-xs"
              data-testid="prompt-log-filter-max-tokens"
            />
          </div>
          <Input
            type="datetime-local"
            value={filter.from}
            onChange={(e) => set("from", e.target.value)}
            aria-label="From (inclusive)"
            className="h-8 w-full text-xs"
            data-testid="prompt-log-filter-from"
          />
          <Input
            type="datetime-local"
            value={filter.to}
            onChange={(e) => set("to", e.target.value)}
            aria-label="To (exclusive)"
            className="h-8 w-full text-xs"
            data-testid="prompt-log-filter-to"
          />
          {perms.canDelete && (
            <Button size="sm" variant="outline" onClick={() => setConfirmPurge(true)} data-testid="prompt-log-purge">
              Purge expired
            </Button>
          )}
        </OrgContextSidebar>
        </SidebarPanelPortal>
        <div className="min-w-0 flex-1 space-y-3">
          {settingsLoaded && !loggingEnabled && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="prompt-logs-disabled">
              Prompt logging is currently disabled — new requests are not being recorded. A Manager can re-enable it in Settings.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-400" data-testid="prompt-log-timezone-note">
              Times shown in your timezone. From is inclusive, To is exclusive (both converted to UTC).
              Export covers the trace/session/status/level/cost/token filters below (max 1000 rows) —
              user, key, provider, model and search filters are list-only and not exported.
            </p>
            <div className="flex gap-1.5">
              {(["csv", "jsonl"] as const).map((format) => (
                <Button
                  key={format}
                  size="sm"
                  variant="outline"
                  disabled={exporting !== null}
                  onClick={() => void onExport(format)}
                  data-testid={`prompt-log-export-${format}`}
                >
                  {exporting === format ? "Exporting…" : `Export ${format.toUpperCase()}`}
                </Button>
              ))}
            </div>
          </div>

      {feed.isPending ? (
        <LoadingState message="Loading prompt logs…" className="py-12" />
      ) : feed.error ? (
        isPromptLogStatus(feed.error, 403) ? (
          <EmptyState
            icon={ScrollText}
            title="Prompt logs"
            description="You need the PromptLogs.Read permission to view prompt logs."
            testId="prompt-logs-denied"
          />
        ) : (
          <ErrorState
            title="Could not load prompt logs"
            message={parseApiError(feed.error).message}
            onRetry={() => void feed.refetch()}
          />
        )
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={filteredOut ? "No matching logs" : "No prompt logs yet"}
          description={filteredOut ? "Adjust the search or filters." : "Logged gateway requests will appear here."}
          testId="no-prompt-logs"
          action={filteredOut ? (
            <Button size="sm" variant="outline" onClick={() => setFilter(EMPTY_LOG_FILTER)}>Clear filters</Button>
          ) : undefined}
        />
      ) : (
        <>
          <DataTable<PromptLogRow>
            columns={[
              { key: "at", header: "Time", render: (r) => <span className="whitespace-nowrap">{formatLogTime(r.created_at)}</span> },
              { key: "user", header: "User", render: (r) => <span className="max-w-24 truncate font-mono" title={r.user_email ?? r.user_id ?? ""}>{getLogUserDisplay(r)}</span> },
              { key: "key", header: "Key", render: (r) => <span className="max-w-24 truncate" title={r.key_name ?? r.key_id ?? r.api_key_id ?? ""}>{getLogKeyDisplay(r)}</span> },
              { key: "model", header: "Provider / Model", render: (r) => {
                const parts = [getLogProviderDisplay(r), getLogModelDisplay(r)].filter((v) => v !== "—");
                return <span className="max-w-40 truncate" title={`${r.provider_name ?? r.provider_id ?? ""} ${r.model_name ?? r.model_id ?? ""}`.trim()}>{parts.join(" / ") || "—"}</span>;
              } },
              { key: "endpoint", header: "Endpoint", render: (r) => endpointLabel(r.endpoint) },
              { key: "status", header: "Status", render: (r) => <Badge variant={promptLogStatusVariant(r.status)}>{r.status}</Badge> },
              { key: "duration", header: "Duration", align: "right", render: (r) => formatDurationMs(r.duration_ms ?? r.latency_ms) },
              { key: "finish", header: "Finish", render: (r) => (r.finish_reason ? <span className="max-w-24 truncate" title={r.finish_reason}>{r.finish_reason}</span> : <span className="text-zinc-400">—</span>) },
              { key: "tokens", header: "Tokens", align: "right", render: (r) => (r.prompt_tokens != null || r.completion_tokens != null ? `${r.prompt_tokens ?? 0}+${r.completion_tokens ?? 0}` : "—") },
              { key: "cost", header: "Cost", align: "right",
                render: (r) => (
                  <span className="inline-flex items-center justify-end gap-1">
                    {r.usage_estimated ? <Badge variant="outline" title="Usage was estimated, not metered">est</Badge> : null}
                    <span className={hasPricedCost(r.total_cost) ? "" : "text-zinc-400"}>{formatCost(r.total_cost, r.currency)}</span>
                  </span>
                ) },
              { key: "trace", header: "Trace ID",
                render: (r) => {
                  const short = shortRequestId(r.trace_id);
                  return short ? (
                    <button
                      type="button"
                      className="max-w-28 truncate font-mono text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
                      title={r.trace_id ?? ""}
                      onClick={(e) => { e.stopPropagation(); void copyWithToast(r.trace_id ?? "", "Trace ID copied"); }}
                      data-testid={`prompt-log-copy-trace-${r.id}`}
                    >
                      {short}
                    </button>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  );
                },
              },
              { key: "fields", header: "Fields", render: (r) => <FieldsCell row={r} /> },
              {
                key: "request", header: "Request ID",
                render: (r) => {
                  const short = shortRequestId(r.request_id);
                  return short ? (
                    <button
                      type="button"
                      className="max-w-28 truncate font-mono text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
                      title={r.request_id ?? ""}
                      onClick={(e) => { e.stopPropagation(); void copyWithToast(r.request_id ?? "", "Request ID copied"); }}
                      data-testid={`prompt-log-copy-${r.id}`}
                    >
                      {short}
                    </button>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  );
                },
              },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            emptyMessage="No prompt logs in this range"
            testId="prompt-logs-table"
            onRowClick={(r) => selectLog(r.id)}
            rowTestId={(r) => `prompt-log-row-${r.id}`}
          />
          {feed.hasNextPage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void feed.fetchNextPage()}
              disabled={feed.isFetchingNextPage}
              data-testid="prompt-logs-more"
            >
              {feed.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </>
      )}

        </div>
      </div>

      <LogDetailDrawer id={selectedId} orgId={orgId} perms={perms} onClose={() => selectLog(null)} onViewTrace={viewTrace} />

      <ConfirmDialog
        open={confirmPurge}
        destructive
        title="Purge expired prompt logs?"
        description="Rows are never deleted: expiry clears message content only (bodies are set to NULL) and keeps metadata. This cannot be undone."
        confirmLabel="Purge expired"
        onClose={() => setConfirmPurge(false)}
        onConfirm={() => {
          setConfirmPurge(false);
          toast.promise(mut.purge.mutateAsync(undefined), {
            loading: "Purging expired logs…",
            success: (r) => `Purged ${r.expired_count} expired log${r.expired_count === 1 ? "" : "s"}.`,
            error: (e) => toastApiError(e, { title: "Purge failed" }).message,
          });
        }}
      />
    </div>
  );
}
