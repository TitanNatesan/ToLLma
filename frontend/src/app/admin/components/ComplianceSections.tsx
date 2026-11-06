"use client";

/**
 * Admin compliance sections (Agent E, Wave 3; ADMIN_UI_SPEC.md).
 * Append-only: the 13 telemetry sections are untouched. Renders behind the
 * page's existing isAdmin gate; reporter PII only on detail views.
 */

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, MessageSquareWarning, Scale, ShieldAlert, Siren, Truck } from "lucide-react";
import type { ComponentType } from "react";
import {
  Badge,
  Button,
  DataTable,
  DetailPanel,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
  Textarea,
  type DataTableColumn,
} from "@/components/ui";
import { parseApiError } from "@/lib/errors";
import { toast } from "@/lib/notify";
import type { AbuseReviewItem, ComplianceCaseItem, SubprocessorAdmin } from "@/types/trust";
import {
  CASE_STATUSES,
  createVendor,
  getCaseDetail,
  humanizeStatus,
  listAbuseReviews,
  listCases,
  listVendors,
  patchCase,
  patchVendor,
  type CaseQueue,
  type ComplaintDetail,
  type IncidentDetail,
  type LegalRequestDetail,
  type TimelineEntry,
  type VulnReportDetail,
} from "./complianceApi";

export interface ComplianceSectionDef {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/** Appended after the 13 telemetry sections, grouped under "Compliance". */
export const COMPLIANCE_SECTIONS = [
  { id: "incidents", label: "Incidents", icon: Siren },
  { id: "abuse-reviews", label: "Abuse reviews", icon: ShieldAlert },
  { id: "legal-requests", label: "Legal requests", icon: Scale },
  { id: "vuln-reports", label: "Vuln reports", icon: Bug },
  { id: "complaints", label: "Complaints", icon: MessageSquareWarning },
  { id: "vendors", label: "Vendors", icon: Truck },
] as const satisfies readonly ComplianceSectionDef[];

export const COMPLIANCE_SECTION_IDS: readonly string[] = COMPLIANCE_SECTIONS.map((s) => s.id);

/** Jump strip for the six compliance sections (sidebar stays orchestrator-owned). */
export function ComplianceNav({ activeId }: { activeId: string }) {
  return (
    <nav aria-label="Compliance sections" data-testid="admin-compliance-nav" className="flex flex-wrap gap-1.5">
      {COMPLIANCE_SECTIONS.map(({ id, label, icon: Icon }) => (
        <Link
          key={id}
          href={`/admin#${id}`}
          aria-current={activeId === id ? "page" : undefined}
          data-testid={`admin-compliance-nav-${id}`}
          className={
            activeId === id
              ? "inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="secondary">{humanizeStatus(status)}</Badge>;
}

const CASE_COLUMNS: Array<DataTableColumn<ComplianceCaseItem>> = [
  { key: "title", header: "Title", render: (row) => <span className="font-medium">{row.title}</span> },
  { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
  {
    key: "severity",
    header: "Severity",
    render: (row) => (row.severity ? <StatusBadge status={row.severity} /> : <span className="text-zinc-400">—</span>),
  },
  { key: "updated", header: "Updated", align: "right", render: (row) => new Date(row.updated_at).toLocaleDateString() },
];

function StatusFilter({
  value,
  onChange,
  options,
  testId,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  options: string[];
  testId: string;
}) {
  return (
    <Select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      data-testid={testId}
      aria-label="Filter by status"
      className="w-48 text-xs"
    >
      <option value="">All statuses</option>
      {options.map((status) => (
        <option key={status} value={status}>
          {humanizeStatus(status)}
        </option>
      ))}
    </Select>
  );
}

function Timeline({ entries }: { entries?: TimelineEntry[] }) {
  if (!entries || entries.length === 0) return <p className="text-[11px] text-zinc-400">No timeline entries.</p>;
  return (
    <ul className="space-y-1.5">
      {entries.map((entry, i) => (
        <li key={i} className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
          <span className="font-mono text-zinc-400">{entry.at}</span> · {entry.actor}:{" "}
          {entry.from ? `${entry.from} → ` : ""}{entry.to}
          {entry.note && <span className="text-zinc-500 dark:text-zinc-400"> — {entry.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Generic case queue: filter + list + load-more + detail drawer + PATCH. */
function CaseQueueSection({ queue, testId }: { queue: CaseQueue; testId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const list = useInfiniteQuery({
    queryKey: ["admin", queue, { status }],
    queryFn: ({ pageParam, signal }) => listCases(queue, status, pageParam ?? null, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });

  const detail = useQuery({
    queryKey: ["admin", queue, "detail", selectedId],
    queryFn: () => getCaseDetail<Record<string, unknown>>(queue, selectedId as string),
    enabled: selectedId !== null,
    retry: false,
  });

  const patch = useMutation({
    mutationFn: (body: { to: string; note?: string; link_incident_id?: string; owner_admin_id?: string }) =>
      patchCase<unknown>(queue, selectedId as string, body),
    onSuccess: () => {
      toast.success("Status updated");
      void queryClient.invalidateQueries({ queryKey: ["admin", queue] });
      void queryClient.invalidateQueries({ queryKey: ["admin", queue, "detail", selectedId] });
    },
    onError: (e) => {
      toast.error("Update rejected", { description: parseApiError(e).message });
    },
  });

  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [linkIncident, setLinkIncident] = useState("");
  const [ownerAdmin, setOwnerAdmin] = useState("");

  const items = (list.data?.pages ?? []).flatMap((page) => page.data.items);
  const hasMore = list.data?.pages?.[list.data.pages.length - 1]?.nextCursor != null;

  const d = (detail.data ?? {}) as Partial<IncidentDetail & LegalRequestDetail & VulnReportDetail & ComplaintDetail>;

  return (
    <div data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusFilter value={status} onChange={(next) => setStatus(next)} options={CASE_STATUSES[queue]} testId={`${testId}-status-filter`} />
        {list.isFetching && !list.isPending && <span className="text-[11px] text-zinc-400">Refreshing…</span>}
      </div>
      {list.isPending ? (
        <LoadingState message={`Loading ${queue}…`} />
      ) : list.isError ? (
        <ErrorState
          title={`Could not load ${queue}`}
          message={parseApiError(list.error).message}
          onRetry={() => void list.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title={`No ${queue}`} description="Nothing in this queue yet." testId={`${testId}-empty`} />
      ) : (
        <>
          <DataTable
            columns={CASE_COLUMNS}
            rows={items}
            rowKey={(row) => row.id}
            testId={`${testId}-table`}
            onRowClick={(row) => {
              setSelectedId(row.id);
              setTo("");
              setNote("");
              setLinkIncident("");
              setOwnerAdmin("");
              patch.reset();
            }}
            rowTestId={(row) => `${testId}-row-${row.id}`}
          />
          {hasMore && (
            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
                data-testid={`${testId}-load-more`}
              >
                {list.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}

      <DetailPanel
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        title={typeof d.title === "string" ? d.title : "Case detail"}
        subtitle={typeof d.status === "string" ? `Status: ${humanizeStatus(d.status)}` : undefined}
        testId={`${testId}-detail`}
        width={480}
      >
        {detail.isPending ? (
          <LoadingState message="Loading detail…" />
        ) : detail.isError ? (
          <ErrorState
            title="Could not load detail"
            message={parseApiError(detail.error).message}
            onRetry={() => void detail.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-4 p-4">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {"kind" in d && d.kind != null && (
                <p><span className="text-zinc-400">Kind:</span> {String(d.kind)}</p>
              )}
              {"severity" in d && d.severity != null && (
                <p><span className="text-zinc-400">Severity:</span> {String(d.severity)}</p>
              )}
              {"request_type" in d && d.request_type != null && (
                <p><span className="text-zinc-400">Type:</span> {String(d.request_type)}</p>
              )}
              {"claimant" in d && d.claimant != null && (
                <p><span className="text-zinc-400">Claimant:</span> {String(d.claimant)}</p>
              )}
              {"category" in d && d.category != null && (
                <p><span className="text-zinc-400">Category:</span> {String(d.category)}</p>
              )}
              {"affected" in d && d.affected != null && (
                <p><span className="text-zinc-400">Affected:</span> {String(d.affected)}</p>
              )}
              {"reporter_contact" in d && d.reporter_contact != null && (
                <p className="col-span-2"><span className="text-zinc-400">Reporter contact:</span> {String(d.reporter_contact)}</p>
              )}
              {"verify_notes" in d && d.verify_notes != null && (
                <p className="col-span-2"><span className="text-zinc-400">Verify notes:</span> {String(d.verify_notes)}</p>
              )}
              {"due_at" in d && d.due_at != null && (
                <p><span className="text-zinc-400">Due:</span> {String(d.due_at)}</p>
              )}
              {"sla_due_at" in d && d.sla_due_at != null && (
                <p><span className="text-zinc-400">SLA due:</span> {String(d.sla_due_at)}</p>
              )}
            </div>
            {("summary" in d && typeof d.summary === "string") ||
            ("details" in d && typeof d.details === "string") ? (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                {String(("summary" in d ? d.summary : d.details) ?? "")}
              </p>
            ) : null}
            <div>
              <p className="mb-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">Timeline</p>
              <Timeline entries={"timeline" in d ? (d.timeline as TimelineEntry[] | undefined) : undefined} />
            </div>
            <form
              className="flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-900"
              data-testid={`${testId}-patch`}
              onSubmit={(e) => {
                e.preventDefault();
                if (to && !patch.isPending) {
                  patch.mutate({
                    to,
                    note: note.trim() || undefined,
                    link_incident_id: linkIncident.trim() || undefined,
                    owner_admin_id: ownerAdmin.trim() || undefined,
                  });
                }
              }}
            >
              <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">Transition</p>
              <Select value={to} onChange={(e) => setTo(e.target.value)} data-testid={`${testId}-patch-status`} aria-label="New status" className="text-xs">
                <option value="">Select status…</option>
                {CASE_STATUSES[queue].map((s) => (
                  <option key={s} value={s}>
                    {humanizeStatus(s)}
                  </option>
                ))}
              </Select>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note (optional)"
                data-testid={`${testId}-patch-note`}
                className="min-h-16 text-xs"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={linkIncident}
                  onChange={(e) => setLinkIncident(e.target.value)}
                  placeholder="Link incident id (optional)"
                  data-testid={`${testId}-patch-link`}
                  className="h-8 text-xs"
                />
                {queue === "incidents" && (
                  <Input
                    value={ownerAdmin}
                    onChange={(e) => setOwnerAdmin(e.target.value)}
                    placeholder="Owner admin id (optional)"
                    data-testid={`${testId}-patch-owner`}
                    className="h-8 text-xs"
                  />
                )}
              </div>
              {patch.isError && (
                <p role="alert" data-testid={`${testId}-patch-error`} className="text-[11px] text-red-500 dark:text-red-400">
                  {parseApiError(patch.error).message}
                </p>
              )}
              <div>
                <Button type="submit" size="sm" disabled={!to || patch.isPending} data-testid={`${testId}-patch-submit`}>
                  {patch.isPending ? "Updating…" : "Update status"}
                </Button>
              </div>
            </form>
          </div>
        )}
      </DetailPanel>
    </div>
  );
}

/** Abuse reviews: read-only list (D owns PATCH; F reads via this queue). */
function AbuseReviewsSection({ testId }: { testId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const reviews = useQuery({
    queryKey: ["admin", "abuse-reviews", { status }],
    queryFn: ({ signal }) => listAbuseReviews(status, signal),
    retry: false,
  });
  const items: AbuseReviewItem[] = reviews.data?.data ?? [];

  const columns: Array<DataTableColumn<AbuseReviewItem>> = [
    { key: "reason", header: "Reason", render: (row) => <span className="font-medium">{row.reason_code}</span> },
    { key: "subject", header: "Subject", render: (row) => `${row.subject_type}${row.subject_id ? ` · ${row.subject_id.slice(0, 8)}` : ""}` },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "updated", header: "Updated", align: "right", render: (row) => new Date(row.updated_at).toLocaleDateString() },
  ];

  return (
    <div data-testid={testId}>
      <div className="mb-3">
        <StatusFilter value={status} onChange={setStatus} options={CASE_STATUSES["abuse-reviews"]} testId={`${testId}-status-filter`} />
      </div>
      {reviews.isPending ? (
        <LoadingState message="Loading abuse reviews…" />
      ) : reviews.isError ? (
        <ErrorState
          title="Could not load abuse reviews"
          message={parseApiError(reviews.error).message}
          onRetry={() => void reviews.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title="No abuse reviews" description="The review queue is empty." testId={`${testId}-empty`} />
      ) : (
        <DataTable columns={columns} rows={items} rowKey={(row) => row.id} testId={`${testId}-table`} rowTestId={(row) => `${testId}-row-${row.id}`} />
      )}
    </div>
  );
}

/** Vendors: admin subprocessor registry (full shape incl. dpa_ref). */
function VendorsSection({ testId }: { testId: string }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", purpose: "", location: "", status: "active", dpa_ref: "" });

  const vendors = useQuery({ queryKey: ["admin", "vendors"], queryFn: listVendors, retry: false });
  const rows = vendors.data ?? [];

  function openEdit(row: SubprocessorAdmin) {
    setForm({ name: row.name, purpose: row.purpose, location: row.location, status: row.status, dpa_ref: row.dpa_ref ?? "" });
    setEditingId(row.id);
    setCreating(false);
  }
  function openCreate() {
    setForm({ name: "", purpose: "", location: "", status: "active", dpa_ref: "" });
    setEditingId(null);
    setCreating(true);
  }

  const save = useMutation({
    mutationFn: () =>
      creating
        ? createVendor({ name: form.name.trim(), purpose: form.purpose.trim(), location: form.location.trim(), status: form.status, dpa_ref: form.dpa_ref.trim() || undefined })
        : patchVendor(editingId as string, { purpose: form.purpose.trim(), location: form.location.trim(), status: form.status, dpa_ref: form.dpa_ref.trim() || undefined }),
    onSuccess: () => {
      toast.success(creating ? "Vendor added" : "Vendor updated");
      setEditingId(null);
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "vendors"] });
    },
    onError: (e) => {
      toast.error("Could not save vendor", { description: parseApiError(e).message });
    },
  });

  const columns: Array<DataTableColumn<SubprocessorAdmin>> = [
    { key: "name", header: "Vendor", render: (row) => <span className="font-medium">{row.name}</span> },
    { key: "purpose", header: "Purpose", render: (row) => <span className="max-w-64 truncate">{row.purpose}</span> },
    { key: "location", header: "Location", render: (row) => row.location },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "dpa", header: "DPA ref", render: (row) => (row.dpa_ref ? <span className="font-mono text-[11px]">{row.dpa_ref.slice(0, 24)}</span> : <span className="text-zinc-400">—</span>) },
  ];

  const panelOpen = editingId !== null || creating;

  return (
    <div data-testid={testId}>
      <div className="mb-3 flex justify-end">
        <Button type="button" size="sm" onClick={openCreate} data-testid={`${testId}-create`}>
          Add vendor
        </Button>
      </div>
      {vendors.isPending ? (
        <LoadingState message="Loading vendors…" />
      ) : vendors.isError ? (
        <ErrorState
          title="Could not load vendors"
          message={parseApiError(vendors.error).message}
          onRetry={() => void vendors.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No vendors" description="No subprocessors recorded yet." testId={`${testId}-empty`} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          testId={`${testId}-table`}
          onRowClick={(row) => {
            openEdit(row);
            save.reset();
          }}
          rowTestId={(row) => `${testId}-row-${row.id}`}
        />
      )}

      <DetailPanel
        open={panelOpen}
        onClose={() => {
          setEditingId(null);
          setCreating(false);
        }}
        title={creating ? "Add vendor" : "Edit vendor"}
        testId={`${testId}-detail`}
        width={440}
      >
        <form
          className="flex flex-col gap-2 p-4"
          data-testid={`${testId}-form`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending && (creating ? form.name.trim() : true)) save.mutate();
          }}
        >
          {creating && (
            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
              Name
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid={`${testId}-form-name`} className="h-8 text-xs" />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
            Purpose
            <Textarea value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} data-testid={`${testId}-form-purpose`} className="min-h-16 text-xs" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
            Location
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid={`${testId}-form-location`} className="h-8 text-xs" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
            Status
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} data-testid={`${testId}-form-status`} className="text-xs">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="removed">Removed</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-200">
            DPA reference <span className="font-normal text-zinc-400">(admin-only, never public)</span>
            <Input value={form.dpa_ref} onChange={(e) => setForm({ ...form, dpa_ref: e.target.value })} data-testid={`${testId}-form-dpa`} className="h-8 text-xs" />
          </label>
          {save.isError && (
            <p role="alert" data-testid={`${testId}-form-error`} className="text-[11px] text-red-500 dark:text-red-400">
              {parseApiError(save.error).message}
            </p>
          )}
          <div>
            <Button type="submit" size="sm" disabled={save.isPending || (creating && !form.name.trim())} data-testid={`${testId}-form-submit`}>
              {save.isPending ? "Saving…" : creating ? "Add vendor" : "Save changes"}
            </Button>
          </div>
        </form>
      </DetailPanel>
    </div>
  );
}

/** Dispatcher: compliance id → section component. */
export function ComplianceSectionBody({ id }: { id: string }) {
  switch (id) {
    case "incidents":
      return <CaseQueueSection queue="incidents" testId="admin-compliance-incidents" />;
    case "abuse-reviews":
      return <AbuseReviewsSection testId="admin-compliance-abuse-reviews" />;
    case "legal-requests":
      return <CaseQueueSection queue="legal-requests" testId="admin-compliance-legal-requests" />;
    case "vuln-reports":
      return <CaseQueueSection queue="vuln-reports" testId="admin-compliance-vuln-reports" />;
    case "complaints":
      return <CaseQueueSection queue="complaints" testId="admin-compliance-complaints" />;
    case "vendors":
      return <VendorsSection testId="admin-compliance-vendors" />;
    default:
      return null;
  }
}
