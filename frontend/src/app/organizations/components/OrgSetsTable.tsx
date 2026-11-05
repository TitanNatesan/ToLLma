"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpDown, Copy, Loader2, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "@/lib/notify";
import {
  Badge, Button, Checkbox, DataTable, type DataTableColumn, DetailPanel,
  Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState,
  ErrorState, Field, Input, LoadingState, SearchInput, Select,
} from "@/components/ui";
import { ConfirmDialog, TextPromptDialog } from "./Dialogs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { isForbiddenError, isNotFoundError, useOrgMutations, useOrgSets, usePermissionCatalog } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import { PERMISSION_GROUPS, type PermissionSet } from "@/types/orgs";

const PAGE_SIZE = 15;

function sourceName(s: PermissionSet): string | null {
  return s.source_name ?? s.cloned_from_name ?? s.cloned_from ?? null;
}

function dateLabel(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
}

function assigneeLabel(s: PermissionSet): string {
  const m = s.member_count;
  const t = s.team_count;
  if ((m === null || m === undefined) && (t === null || t === undefined)) return "—";
  return `${m ?? 0} member${(m ?? 0) === 1 ? "" : "s"} · ${t ?? 0} team${(t ?? 0) === 1 ? "" : "s"}`;
}

export type SetSortKey = "name" | "perms" | "updated";

export interface SetFilters {
  search: string;
  sortKey: SetSortKey;
  sortDir: 1 | -1;
  page: number;
}

export const EMPTY_SET_FILTERS: SetFilters = {
  search: "",
  sortKey: "name",
  sortDir: 1,
  page: 0,
};

/** Permission-set filter controls. Horizontal in the table header; vertical
 * in the section sidebar (same components/state, no duplicated copies). */
export function OrgSetsFilters({ value, onChange, layout = "horizontal" }: {
  value: SetFilters;
  onChange: (f: SetFilters) => void;
  layout?: "horizontal" | "vertical";
}) {
  const wrap = layout === "vertical"
    ? "flex flex-col gap-2"
    : "flex flex-nowrap items-center gap-2 overflow-x-auto pb-1";
  const selectClass = layout === "vertical" ? "w-full" : "w-32";
  return (
    <div className={wrap}>
      <div className={layout === "vertical" ? "w-full" : "min-w-44 flex-1"}>
        <SearchInput value={value.search} onChange={(e) => onChange({ ...value, search: e.target.value, page: 0 })}
          onClear={() => onChange({ ...value, search: "" })} placeholder="Search sets…" aria-label="Search permission sets"
          data-testid="org-sets-search" />
      </div>
      <Select value={value.sortKey} onChange={(e) => onChange({ ...value, sortKey: e.target.value as SetSortKey, page: 0 })} sizeVariant="sm"
        className={selectClass} aria-label="Sort sets" data-testid="org-sets-sort">
        <option value="name">Name</option>
        <option value="perms">Permissions</option>
        <option value="updated">Updated</option>
      </Select>
      <Button size="sm" variant="outline" onClick={() => onChange({ ...value, sortDir: value.sortDir === 1 ? -1 : 1, page: 0 })}
        aria-label={value.sortDir === 1 ? "Sort descending" : "Sort ascending"}>
        <ArrowUpDown className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}

export function OrgSetsTable({ orgId, canRead, canCreate, canUpdate, canDelete, filters, onFilters, hideFilters, creating, onCreating }: {
  orgId: string;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** Controlled filter state (section sidebar). Defaults to internal state. */
  filters?: SetFilters;
  onFilters?: (f: SetFilters) => void;
  /** Hide the in-header filter bar (it renders in the sidebar instead). */
  hideFilters?: boolean;
  /** Controlled create dialog (the New set button lives in the main header). */
  creating?: boolean;
  onCreating?: (open: boolean) => void;
}) {
  const [internal, setInternal] = useState<SetFilters>(EMPTY_SET_FILTERS);
  const filtersValue = filters ?? internal;
  const setFiltersValue = onFilters ?? setInternal;
  const { search, sortKey, sortDir, page } = filtersValue;
  const setPage = (p: number | ((prev: number) => number)) =>
    setFiltersValue({ ...filtersValue, page: typeof p === "function" ? p(filtersValue.page) : p });
  const [internalCreating, setInternalCreating] = useState(false);
  const creatingValue = creating ?? internalCreating;
  const setCreating = onCreating ?? setInternalCreating;
  const [editing, setEditing] = useState<PermissionSet | null>(null);
  const [deleting, setDeleting] = useState<PermissionSet | null>(null);
  const [cloning, setCloning] = useState<PermissionSet | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Deep link (?set=): viewing is derived from the URL (no mirror state).
  const setParam = searchParams.get("set");
  function viewSet(s: PermissionSet | null) {
    const params = new URLSearchParams(searchParams.toString());
    if ((params.get("set") ?? null) === (s?.id ?? null)) return;
    if (s) params.set("set", s.id);
    else params.delete("set");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const debounced = useDebouncedValue(search.trim(), 300);
  const sets = useOrgSets(orgId, { search: debounced || undefined, limit: 200 });
  const mut = useOrgMutations(orgId);

  const rows = useMemo(() => {
    const list = [...(sets.data ?? [])];
    list.sort((a, b) => {
      const d = sortDir;
      if (sortKey === "perms") return (a.permissions.length - b.permissions.length) * d;
      if (sortKey === "updated") {
        const ta = a.updated_at ?? a.created_at;
        const tb = b.updated_at ?? b.created_at;
        return (ta < tb ? -1 : 1) * d;
      }
      return a.name.localeCompare(b.name) * d;
    });
    return list;
  }, [sets.data, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const viewing = setParam ? (rows.find((s) => s.id === setParam) ?? null) : null;

  if (!canRead) {
    return (
      <div data-testid="org-sets">
        <EmptyState
          title="Permission sets"
          description="You need PermissionSets.Read permission to view organization permission sets. Ask an organization admin to grant it."
          testId="org-sets-denied"
        />
      </div>
    );
  }

  const editable = (s: PermissionSet) => !s.is_system && canUpdate;
  const columns: DataTableColumn<PermissionSet>[] = [
    {
      key: "name", header: "Name",
      render: (s) => (
        <span className="min-w-0">
          <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100" title={s.name}>{s.name}</span>
          {s.description && <span className="block truncate text-[11px] text-zinc-400" title={s.description ?? undefined}>{s.description}</span>}
        </span>
      ),
    },
    {
      key: "type", header: "Type",
      render: (s) => (s.is_system
        ? <Badge variant="secondary">system</Badge>
        : <Badge variant="outline">custom</Badge>),
    },
    {
      key: "source", header: "Inherited from",
      render: (s) => {
        const src = sourceName(s);
        return src
          ? <span title={`Snapshot copy of ${src}`}>{src} <span className="text-zinc-400">(snapshot copy)</span></span>
          : <span className="text-zinc-400">—</span>;
      },
    },
    { key: "perms", header: "Perms", align: "right", render: (s) => String(s.permissions.length) },
    { key: "assignees", header: "Assignees", render: (s) => <span className="whitespace-nowrap">{assigneeLabel(s)}</span> },
    { key: "updated", header: "Updated", render: (s) => <span className="whitespace-nowrap">{dateLabel(s.updated_at ?? s.created_at)}</span> },
    {
      key: "actions", header: "Actions", align: "right",
      render: (s) => (
        <span className="flex justify-end gap-1.5">
          <Button size="sm" variant="outline" onClick={() => viewSet(s)}
            data-testid={`org-set-view-${s.id}`}>View</Button>
          {editable(s) ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(s)}
              aria-label={`Edit ${s.name}`} data-testid={`org-set-edit-${s.id}`}>
              <Pencil className="size-3.5" aria-hidden />
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled
              title={s.is_system ? "System sets are immutable — clone to customize." : "You need set-update permission."}
              aria-label={`Edit ${s.name}`}>
              <Pencil className="size-3.5" aria-hidden />
            </Button>
          )}
          {canDelete && !s.is_system && (
            <Button size="sm" variant="outline" onClick={() => setDeleting(s)}
              aria-label={`Delete ${s.name}`} data-testid={`org-set-delete-${s.id}`}>
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
          )}
          {canCreate && (
            <Button size="sm" variant="outline" onClick={() => setCloning(s)}
              aria-label={`Clone ${s.name}`} title="Creates an editable snapshot copy."
              data-testid={`org-set-clone-${s.id}`}>
              <Copy className="size-3.5" aria-hidden />
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div data-testid="org-sets">
      {!hideFilters && (
        <div className="mb-2.5 flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
          <div className="min-w-0 flex-1">
            <OrgSetsFilters value={filtersValue} onChange={setFiltersValue} />
          </div>
          {canCreate && (
            <Button size="sm" onClick={() => setCreating(true)} data-testid="org-set-create">
              <ShieldCheck className="size-3.5" aria-hidden /> New set
            </Button>
          )}
        </div>
      )}
      <p className="mb-2 text-xs text-zinc-500">System sets are immutable — clone them to customize. Grants can never exceed your own permissions.</p>

      {sets.isLoading && <LoadingState message="Loading permission sets…" />}
      {sets.isError && isForbiddenError(sets.error) && (
        <EmptyState title="Permission sets unavailable" testId="org-sets-forbidden"
          description="You need PermissionSets.Read permission to view organization permission sets." />
      )}
      {sets.isError && isNotFoundError(sets.error) && (
        <ErrorState title="Permission sets not found"
          message={parseApiError(sets.error).message}
          onRetry={() => void sets.refetch()} />
      )}
      {sets.isError && !isForbiddenError(sets.error) && !isNotFoundError(sets.error) && (
        <ErrorState title="Could not load permission sets"
          message={parseApiError(sets.error).message}
          onRetry={() => void sets.refetch()} />
      )}
      {!sets.isLoading && !sets.isError && rows.length === 0 && (
        <EmptyState title="No permission sets"
          description={debounced ? "No sets match this search." : "Create a set to start granting permissions."}
          action={canCreate && !debounced ? (
            <Button size="sm" onClick={() => setCreating(true)} data-testid="org-set-create-open-empty">
              Create set
            </Button>
          ) : undefined} />
      )}
      {rows.length > 0 && (
        <>
          <DataTable columns={columns} rows={visible} rowKey={(s) => s.id} testId="org-sets-table"
            onRowClick={(s) => viewSet(s)} />
          {pageCount > 1 && (
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      {(creatingValue || editing) && (
        <SetEditDialog
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onCreate={(p) => mut.createSet.mutateAsync(p)}
          onUpdate={(id, payload) => mut.updateSet.mutateAsync({ setId: id, payload })} />
      )}

      <SetDetailDrawer set_={viewing} onClose={() => viewSet(null)} />

      <ConfirmDialog open={deleting !== null} title={`Delete "${deleting?.name}"?`} destructive
        confirmLabel="Delete set" testId="org-set-delete-dialog"
        description="Members holding this set lose these grants immediately. This cannot be undone."
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting ? mut.deleteSet.mutateAsync(deleting.id).then(() => {
          toast.success("Permission set deleted.");
          setDeleting(null);
        }) : Promise.resolve()} />

      <TextPromptDialog open={cloning !== null} title={`Clone "${cloning?.name}"`}
        description="Creates an editable snapshot copy. Later changes to the original do not propagate."
        placeholder="New set name" initial={cloning ? `${cloning.name} copy` : ""}
        confirmLabel="Clone set" testId="org-set-clone-dialog" onClose={() => setCloning(null)}
        onSubmit={(v) => cloning ? mut.cloneSet.mutateAsync({ setId: cloning.id, name: v }).then(() => {
          toast.success("Permission set cloned.");
          setCloning(null);
        }) : Promise.resolve()} />
    </div>
  );
}

function SetEditDialog({ initial, onClose, onCreate, onUpdate }: {
  initial: PermissionSet | null;
  onClose: () => void;
  onCreate: (p: { name: string; description?: string; permissions: string[] }) => Promise<unknown>;
  onUpdate: (setId: string, payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const catalogQuery = usePermissionCatalog();
  const groups = catalogQuery.data ?? PERMISSION_GROUPS;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [picked, setPicked] = useState<string[]>(initial?.permissions ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(code: string) {
    setPicked((v) => (v.includes(code) ? v.filter((x) => x !== code) : [...v, code]));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (initial) {
        await onUpdate(initial.id, { name: name.trim(), description: description.trim() || null, permissions: picked });
        toast.success("Permission set updated.");
      } else {
        await onCreate({ name: name.trim(), description: description.trim() || undefined, permissions: picked });
        toast.success("Permission set created.");
      }
      onClose();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  // Prerequisite ladder (mirrors the backend rule): a Create/Update/Delete
  // grant needs its group's Read grant, otherwise saving fails with a 422.
  const missingReads = (() => {
    const have = new Set(picked);
    const missing = new Set<string>();
    for (const code of picked) {
      const [group, op] = code.split(".");
      if ((op === "Create" || op === "Update" || op === "Delete") && !have.has(`${group}.Read`)) {
        missing.add(`${group}.Read`);
      }
    }
    return [...missing];
  })();

  return (
    <Dialog open onOpenChange={(n) => { if (!n && !busy) onClose(); }}>
      <DialogContent className="max-w-lg p-4" data-testid="org-set-dialog">
        <DialogTitle className="text-sm font-semibold">{initial ? "Edit permission set" : "New permission set"}</DialogTitle>
        <DialogDescription>Select grants by category. {picked.length} selected overall.</DialogDescription>
        <div className="mt-3 space-y-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
              data-testid="org-set-name" />
          </Field>
          <Field label="Description (optional)">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </Field>
          <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
            {groups.map((g) => {
              const codes = g.permissions.map((p) => p.code);
              const n = codes.filter((c) => picked.includes(c)).length;
              return (
                <fieldset key={g.group} className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
                  <legend className="px-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                    {g.group} <span className="font-mono font-normal text-zinc-400">({n}/{codes.length} selected)</span>
                  </legend>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {g.permissions.map((p) => (
                      <label key={p.code} className="flex cursor-pointer items-center gap-2 text-xs">
                        <Checkbox checked={picked.includes(p.code)} onChange={() => toggle(p.code)} />
                        <span title={p.code}>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          {missingReads.length > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300" data-testid="org-set-prereq-hint">
              Managing without viewing is not allowed: also select {missingReads.join(", ")} or saving will be rejected.
            </p>
          )}
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => void submit()} disabled={busy || name.trim().length < 2}
              data-testid="org-set-submit">
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Detail drawer: domain-grouped permissions with human labels from the catalog. */
function SetDetailDrawer({ set_, onClose }: { set_: PermissionSet | null; onClose: () => void }) {
  const catalogQuery = usePermissionCatalog();
  const groups = catalogQuery.data ?? PERMISSION_GROUPS;

  const labelOf = useMemo(() => {
    const m = new Map<string, { label: string; group: string }>();
    for (const g of groups) for (const p of g.permissions) m.set(p.code, { label: p.label, group: g.group });
    return m;
  }, [groups]);

  const grouped = useMemo(() => {
    if (!set_) return [];
    const byGroup = new Map<string, Array<{ code: string; label: string }>>();
    for (const code of set_.permissions) {
      const known = labelOf.get(code);
      const g = known?.group ?? "Other";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push({ code, label: known?.label ?? code });
    }
    return [...byGroup.entries()];
  }, [set_, labelOf]);

  const src = set_ ? sourceName(set_) : null;

  return (
    <DetailPanel open={set_ !== null} onClose={onClose} testId="org-set-detail"
      title={set_?.name ?? "Permission set"}
      subtitle={set_ ? `${set_.permissions.length} permission${set_.permissions.length === 1 ? "" : "s"}` : undefined}>
      {set_ && (
        <div className="space-y-4 text-xs">
          {set_.description && <p className="text-zinc-500">{set_.description}</p>}
          <dl className="space-y-1 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
            <div className="flex justify-between gap-2"><dt className="text-zinc-500">Type</dt><dd>{set_.is_system ? "system (immutable)" : "custom"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-zinc-500">Inherited from</dt><dd>{src ? `${src} (snapshot copy)` : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-zinc-500">Assignees</dt><dd>{assigneeLabel(set_)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-zinc-500">Updated</dt><dd>{dateLabel(set_.updated_at ?? set_.created_at)}</dd></div>
          </dl>
          {set_.is_system && (
            <p className="rounded-md bg-zinc-100 px-2.5 py-2 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              System sets are immutable — clone to customize.
            </p>
          )}
          {grouped.length === 0 && <p className="text-zinc-500">No permissions granted.</p>}
          {grouped.map(([group, perms]) => (
            <section key={group}>
              <h3 className="mb-1.5 text-xs font-bold">{group} <span className="font-mono font-normal text-zinc-400">({perms.length})</span></h3>
              <ul className="space-y-1">
                {perms.map((p) => (
                  <li key={p.code} className="flex items-baseline justify-between gap-2 rounded border border-zinc-100 px-2 py-1 dark:border-zinc-900">
                    <span className="font-medium">{p.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-400">{p.code}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </DetailPanel>
  );
}
