"use client";

import { useState } from "react";
import { Copy, Loader2, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from "@/components/ui";
import { usePermissionCatalog } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import { PERMISSION_GROUPS, type PermissionSet } from "@/types/orgs";
import { ConfirmDialog, TextPromptDialog } from "./Dialogs";

export function SetManager({ sets, canRead, canCreate, canUpdate, canDelete, isRoot, onCreate, onUpdate, onDelete, onClone }: {
  sets: PermissionSet[];
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isRoot: boolean;
  onCreate: (p: { name: string; description?: string; permissions: string[] }) => Promise<unknown>;
  onUpdate: (setId: string, payload: Record<string, unknown>) => Promise<unknown>;
  onDelete: (setId: string) => Promise<unknown>;
  onClone: (setId: string, name: string) => Promise<unknown>;
}) {
  const catalogQuery = usePermissionCatalog();
  const groups = catalogQuery.data ?? PERMISSION_GROUPS;
  const [editing, setEditing] = useState<PermissionSet | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PermissionSet | null>(null);
  const [cloning, setCloning] = useState<PermissionSet | null>(null);

  function openCreate() {
    setEditing(null);
    setName("");
    setPicked([]);
    setError(null);
    setCreating(true);
  }

  function openEdit(s: PermissionSet) {
    setCreating(false);
    setName(s.name);
    setPicked(s.permissions);
    setError(null);
    setEditing(s);
  }

  function toggle(code: string) {
    setPicked((p) => (p.includes(code) ? p.filter((x) => x !== code) : [...p, code]));
  }

  function groupCount(codes: string[]) {
    const n = codes.filter((c) => picked.includes(c)).length;
    return `${n}/${codes.length} selected`;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await onUpdate(editing.id, { name: name.trim(), permissions: picked });
        toast.success("Permission set updated.");
      } else {
        await onCreate({ name: name.trim(), permissions: picked });
        toast.success("Permission set created.");
      }
      setCreating(false);
      setEditing(null);
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) return null;
  const dialogOpen = creating || editing !== null;

  return (
    <div data-testid="org-sets">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">System sets are immutable — clone them to customize. Grants can never exceed your own permissions.</p>
        {canCreate && (
          <Button size="sm" onClick={openCreate} data-testid="org-set-create">
            <ShieldCheck className="size-3.5" aria-hidden /> New set
          </Button>
        )}
      </div>
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {sets.map((s) => (
          <div key={s.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            data-testid={`org-set-${s.name.toLowerCase().replace(/\s+/g, "-")}`}>
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold">{s.name}</p>
              {s.is_system && <Badge variant="secondary">system</Badge>}
              <span className="ml-auto font-mono text-[10px] text-zinc-400">
                {s.permissions.length} granted
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {s.permissions.length === 0 && <span className="text-[11px] text-zinc-400">no permissions</span>}
              {s.permissions.map((p) => (
                <Badge key={p} variant="outline" className="font-mono text-[10px]">{p}</Badge>
              ))}
            </div>
            <div className="mt-2.5 flex gap-1.5">
              {!s.is_system && canUpdate && (
                <Button size="sm" variant="outline" onClick={() => openEdit(s)}
                  aria-label={`Edit ${s.name}`} data-testid={`org-set-edit-${s.id}`}>
                  <Pencil className="size-3.5" aria-hidden /> Edit
                </Button>
              )}
              {!s.is_system && canDelete && (
                <Button size="sm" variant="outline" onClick={() => setDeleting(s)}
                  aria-label={`Delete ${s.name}`} data-testid={`org-set-delete-${s.id}`}>
                  <Trash2 className="size-3.5" aria-hidden /> Delete
                </Button>
              )}
              {s.is_system && isRoot && canCreate && (
                <Button size="sm" variant="outline" onClick={() => setCloning(s)}
                  aria-label={`Clone ${s.name}`} data-testid={`org-set-clone-${s.id}`}>
                  <Copy className="size-3.5" aria-hidden /> Clone
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(n) => { if (!n && !busy) { setCreating(false); setEditing(null); } }}>
        <DialogContent className="max-w-lg p-4" data-testid="org-set-dialog">
          <DialogTitle className="text-sm font-semibold">{editing ? "Edit permission set" : "New permission set"}</DialogTitle>
          <DialogDescription>Select grants by category. {picked.length} selected overall.</DialogDescription>
          <div className="mt-3 space-y-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
                data-testid="org-set-name" />
            </Field>
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {groups.map((g) => {
                const codes = g.permissions.map((p) => p.code);
                return (
                  <fieldset key={g.group} className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
                    <legend className="px-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      {g.group} <span className="font-mono font-normal text-zinc-400">({groupCount(codes)})</span>
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
            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setCreating(false); setEditing(null); }} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void submit()} disabled={busy || name.trim().length < 2}
                data-testid="org-set-submit">
                {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={deleting !== null} title={`Delete "${deleting?.name}"?`} destructive
        confirmLabel="Delete set" testId="org-set-delete-dialog"
        description="Members holding this set lose these grants immediately. This cannot be undone."
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting ? onDelete(deleting.id).then(() => {
          toast.success("Permission set deleted.");
          setDeleting(null);
        }) : Promise.resolve()} />

      <TextPromptDialog open={cloning !== null} title={`Clone "${cloning?.name}"`}
        description="Creates an editable custom copy." placeholder="New set name"
        initial={cloning ? `${cloning.name} copy` : ""} confirmLabel="Clone set"
        testId="org-set-clone-dialog" onClose={() => setCloning(null)}
        onSubmit={(v) => cloning ? onClone(cloning.id, v).then(() => {
          toast.success("Permission set cloned.");
          setCloning(null);
        }) : Promise.resolve()} />
    </div>
  );
}
