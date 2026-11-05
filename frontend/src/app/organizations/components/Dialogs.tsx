"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from "@/components/ui";
import { parseApiError } from "@/lib/errors";
import type { PermissionSet } from "@/types/orgs";

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
      {error}
    </p>
  );
}

/** Danger/confirm dialog. Never a browser alert. */
export function ConfirmDialog({ open, title, description, confirmLabel, destructive, busy: busyProp, onConfirm, onClose, testId }: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  const working = busy || !!busyProp;
  return (
    <Dialog open={open} onOpenChange={(n) => { if (!n && !working) { setError(null); onClose(); } }}>
      <DialogContent className="max-w-md p-4" data-testid={testId ?? "org-confirm-dialog"}>
        <div className="flex items-start gap-3">
          {destructive && (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
              <AlertTriangle className="size-4" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
            <DialogDescription asChild>
              <div className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</div>
            </DialogDescription>
            <div className="mt-3"><ErrorNote error={error} /></div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={working}>Cancel</Button>
              <Button variant={destructive ? "destructive" : "default"} size="sm"
                onClick={() => void confirm()} disabled={working} data-testid="org-confirm-action">
                {working && <Loader2 className="size-3.5 animate-spin" aria-hidden />}{confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Assign permission sets to a member via checkboxes (no ID pasting). */
export function AssignSetsDialog({ open, email, sets, assigned, loading, onClose, onAssign, testId }: {
  open: boolean;
  email: string;
  sets: PermissionSet[];
  assigned: string[];
  loading?: boolean;
  onClose: () => void;
  onAssign: (setIds: string[]) => Promise<void>;
  testId?: string;
}) {
  const [picked, setPicked] = useState<string[]>(assigned);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh state per opening: the parent unmounts this dialog on close
  // (see the early return below), so initializers re-run every time.
  if (!open) return null;

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onAssign(picked);
      onClose();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(n) => { if (!n && !busy) onClose(); }}>
      <DialogContent className="max-w-md p-4" data-testid={testId ?? "org-assign-dialog"}>
        <DialogTitle className="text-sm font-semibold">Assign permission sets</DialogTitle>
        <DialogDescription>{email} — grants can never exceed your own permissions.</DialogDescription>
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
          {loading && <p className="text-xs text-zinc-500" data-testid="org-assign-loading">Loading permission sets…</p>}
          {!loading && sets.map((s) => (
            <label key={s.id} data-testid={`org-assign-opt-${s.id}`} className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
              <span className="font-medium">{s.name}</span>
              {s.is_system && <span className="text-zinc-400">(system)</span>}
              <span className="ml-auto font-mono text-[10px] text-zinc-400">{s.permissions.length}</span>
            </label>
          ))}
          {!loading && sets.length === 0 && <p className="text-xs text-zinc-500">No sets available.</p>}
        </div>
        <div className="mt-3"><ErrorNote error={error} /></div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy || loading} data-testid="org-assign-submit">
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}Save grants ({picked.length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Single text-input prompt dialog (native-dialog replacement). */
export function TextPromptDialog({ open, title, description, placeholder, initial, confirmLabel, onClose, onSubmit, testId }: {
  open: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
  testId?: string;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh state per opening (see AssignSetsDialog): unmounted on close.
  if (!open) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(n) => { if (!n && !busy) onClose(); }}>
      <DialogContent className="max-w-md p-4" data-testid={testId ?? "org-prompt-dialog"}>
        <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
        <div className="mt-3">
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder}
            maxLength={80} data-testid="org-prompt-input" />
        </div>
        <div className="mt-3"><ErrorNote error={error} /></div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy || value.trim().length < 2}
            data-testid="org-prompt-submit">
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}{confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FormError({ error }: { error: string | null }) {
  return <ErrorNote error={error} />;
}
