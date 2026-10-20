"use client";

import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Badge, Button, DataTable, type DataTableColumn, DetailPanel,
  EmptyState, ErrorState, Input, LoadingState, SearchInput,
} from "@/components/ui";
import { auditTargetRows, describeAuditEvent, REDACTED } from "./auditDescriptions";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { getAuditPage } from "@/services/orgs";
import { ORG_KEYS, isForbiddenError, isNotFoundError } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import type { AuditEntry } from "@/types/orgs";

const PAGE_LIMIT = 50;

function actorLabel(a: AuditEntry): string {
  if (a.actor_name) return a.actor_name;
  if (a.actor_email) return a.actor_email;
  if (typeof a.actor === "string") return a.actor;
  if (a.actor) return a.actor.email ?? a.actor.name ?? a.actor_user_id ?? "—";
  return a.actor_user_id ?? "system";
}

function resourceLabel(a: AuditEntry): string {
  if (a.resource) return a.resource;
  const t = a.target ?? {};
  for (const k of ["email", "name", "set_name", "team_name", "key_name"]) {
    const v = t[k];
    if (typeof v === "string" && v) return v;
  }
  if (a.resource_type && a.resource_id) return `${a.resource_type} ${a.resource_id}`;
  if (a.resource_type) return a.resource_type;
  return "—";
}

function outcomeLabel(a: AuditEntry): string {
  return a.outcome ?? a.status ?? "—";
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function OrgAuditTable({ orgId, canRead }: { orgId: string; canRead: boolean }) {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [inspecting, setInspecting] = useState<AuditEntry | null>(null);

  const debouncedSearch = useDebouncedValue(search.trim().toLowerCase(), 300);
  const debouncedAction = useDebouncedValue(action.trim(), 300);
  const debouncedActor = useDebouncedValue(actor.trim(), 300);

  const filters = useMemo(() => ({
    action: debouncedAction || undefined,
    actor: debouncedActor || undefined,
    from: from || undefined,
    to: to || undefined,
  }), [debouncedAction, debouncedActor, from, to]);

  const query = useInfiniteQuery({
    queryKey: [...ORG_KEYS.audit(orgId), { ...filters, limit: PAGE_LIMIT }],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      getAuditPage(orgId, { ...filters, limit: PAGE_LIMIT, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    void query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Newest first (backend orders created_at desc; re-sort defensively).
  const entries = useMemo(() => {
    const all = (query.data?.pages ?? []).flatMap((p) => p.entries);
    const seen = new Set<string>();
    const deduped = all.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
    const narrowed = debouncedSearch
      ? deduped.filter((e) => {
          const hay = `${e.action} ${actorLabel(e)} ${resourceLabel(e)} ${JSON.stringify(e.target ?? {})}`.toLowerCase();
          return hay.includes(debouncedSearch);
        })
      : deduped;
    return [...narrowed].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [query.data, debouncedSearch]);

  if (!canRead) {
    return <EmptyState title="Audit log" description="You need audit-read permission to view." />;
  }

  const columns: DataTableColumn<AuditEntry>[] = [
    {
      key: "timestamp", header: "Timestamp",
      render: (a) => <span className="whitespace-nowrap font-mono text-[11px]">{timeLabel(a.created_at)}</span>,
    },
    { key: "actor", header: "Actor", render: (a) => <span className="truncate" title={actorLabel(a)}>{actorLabel(a)}</span> },
    {
      key: "action", header: "Action",
      render: (a) => {
        const d = describeAuditEvent(a.action, a.target ?? {});
        const known = !d.title.startsWith("Unknown event");
        return (
          <span className="min-w-0" title={known ? undefined : `Unknown event: ${a.action} — no description available`}>
            <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">{d.title}</span>
            <span className="block truncate font-mono text-[10px] text-zinc-400">{a.action}</span>
          </span>
        );
      },
    },
    { key: "resource", header: "Resource", render: (a) => <span className="truncate" title={resourceLabel(a)}>{resourceLabel(a)}</span> },
    {
      key: "outcome", header: "Outcome",
      render: (a) => {
        const o = outcomeLabel(a);
        return o === "—" ? <span className="text-zinc-400">—</span> : <Badge variant="outline">{o}</Badge>;
      },
    },
    {
      key: "id", header: "ID",
      render: (a) => <span className="font-mono text-[11px] text-zinc-400" title={a.id}>{a.id.slice(0, 8)}</span>,
    },
    {
      key: "actions", header: "Actions", align: "right",
      render: (a) => (
        <Button size="sm" variant="outline" onClick={() => setInspecting(a)}
          data-testid={`org-audit-inspect-${a.id}`}>Inspect</Button>
      ),
    },
  ];

  return (
    <div className="space-y-2.5" data-testid="org-audit">
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
        <div className="min-w-44 flex-1">
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")} placeholder="Search events…" aria-label="Search audit events"
            data-testid="org-audit-search" />
        </div>
        <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action filter"
          aria-label="Filter by action" data-testid="org-audit-action" className="h-8 w-36 text-xs" maxLength={80} />
        <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Actor filter"
          aria-label="Filter by actor" data-testid="org-audit-actor" className="h-8 w-36 text-xs" maxLength={120} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          aria-label="From date" data-testid="org-audit-from" className="h-8 w-36 text-xs" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          aria-label="To date" data-testid="org-audit-to" className="h-8 w-36 text-xs" />
      </div>

      {query.isLoading && <LoadingState message="Loading audit log…" />}
      {query.isError && isForbiddenError(query.error) && (
        <EmptyState title="Audit log unavailable" testId="org-audit-forbidden"
          description="You need Audit.Read permission to view the audit log." />
      )}
      {query.isError && isNotFoundError(query.error) && (
        <ErrorState title="Audit log not found"
          message={parseApiError(query.error).message}
          onRetry={() => void query.refetch()} />
      )}
      {query.isError && !isForbiddenError(query.error) && !isNotFoundError(query.error) && (
        <ErrorState title="Could not load audit log"
          message={parseApiError(query.error).message}
          onRetry={() => void query.refetch()} />
      )}
      {!query.isLoading && !query.isError && entries.length === 0 && (
        <EmptyState title="No audit events"
          description={debouncedSearch || filters.action || filters.actor || from || to
            ? "No events match these filters."
            : "Recorded organization activity will appear here."} />
      )}
      {entries.length > 0 && (
        <>
          <p className="text-xs text-zinc-500" data-testid="org-audit-count">
            {entries.length} event{entries.length === 1 ? "" : "s"} · newest first
          </p>
          <DataTable columns={columns} rows={entries} rowKey={(a) => a.id} testId="org-audit-table" />
          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button size="sm" variant="outline" disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()} data-testid="org-audit-more">
                {query.isFetchingNextPage ? "Loading…" : "Load older events"}
              </Button>
            </div>
          )}
        </>
      )}

      <AuditDetailDrawer entry={inspecting} orgName={undefined} onClose={() => setInspecting(null)} />
    </div>
  );
}

function AuditDetailDrawer({ entry, orgName, onClose }: {
  entry: AuditEntry | null;
  orgName?: string;
  onClose: () => void;
}) {
  const desc = entry ? describeAuditEvent(entry.action, entry.target ?? {}) : null;
  const rows = entry ? auditTargetRows(entry.target ?? {}) : [];
  const before = entry?.before ?? entry?.changes ?? null;
  const after = entry?.after ?? null;
  const correlation = entry?.correlation_id ?? entry?.request_id ?? null;

  return (
    <DetailPanel open={entry !== null} onClose={onClose} testId="org-audit-detail"
      title={desc?.title ?? "Audit event"} subtitle={entry ? timeLabel(entry.created_at) : undefined}>
      {entry && desc && (
        <div className="space-y-4 text-xs">
          <p className="text-zinc-600 dark:text-zinc-300">{desc.description}</p>
          <dl className="space-y-1 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
            <div className="flex justify-between gap-2"><dt className="text-zinc-500">Actor</dt><dd className="truncate font-medium">{actorLabel(entry)}</dd></div>
            {orgName && <div className="flex justify-between gap-2"><dt className="text-zinc-500">Organization</dt><dd className="truncate">{orgName}</dd></div>}
            <div className="flex justify-between gap-2"><dt className="text-zinc-500">Time</dt><dd className="font-mono text-[11px]">{timeLabel(entry.created_at)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-zinc-500">Outcome</dt><dd>{outcomeLabel(entry)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-zinc-500">Event ID</dt><dd className="font-mono text-[11px]">{entry.id}</dd></div>
            {correlation && <div className="flex justify-between gap-2"><dt className="text-zinc-500">Correlation ID</dt><dd className="font-mono text-[11px]">{correlation}</dd></div>}
          </dl>

          {(before || after) && (
            <section>
              <h3 className="mb-1.5 text-xs font-bold">Before / after</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
                  <p className="mb-1 text-[11px] font-semibold text-zinc-500">Before</p>
                  <BeforeAfter value={before} />
                </div>
                <div className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
                  <p className="mb-1 text-[11px] font-semibold text-zinc-500">After</p>
                  <BeforeAfter value={after} />
                </div>
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-1.5 text-xs font-bold">Details</h3>
            {rows.length === 0 ? (
              <p className="text-zinc-500">No recorded details.</p>
            ) : (
              <dl className="space-y-1">
                {rows.map((r) => (
                  <div key={r.key} className="flex justify-between gap-2 rounded border border-zinc-100 px-2 py-1 dark:border-zinc-900">
                    <dt className="font-mono text-[11px] text-zinc-500">{r.key}</dt>
                    <dd className="truncate text-right font-mono text-[11px]" title={r.value === REDACTED ? "Redacted: sensitive value" : undefined}>
                      {r.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="mt-1.5 text-[11px] text-zinc-400">Sensitive values ({REDACTED}) are never displayed.</p>
          </section>
        </div>
      )}
    </DetailPanel>
  );
}

function BeforeAfter({ value }: { value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) return <p className="text-zinc-500">—</p>;
  return (
    <dl className="space-y-1">
      {Object.entries(value).slice(0, 12).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <dt className="font-mono text-[11px] text-zinc-500">{k}</dt>
          <dd className="truncate text-right font-mono text-[11px]">
            {typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "recorded"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
