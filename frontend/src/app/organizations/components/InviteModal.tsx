"use client";

import { useState } from "react";
import { Loader2, MailPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input,
} from "@/components/ui";
import { parseApiError } from "@/lib/errors";
import type { PermissionSet } from "@/types/orgs";

export function InviteModal({ open, onClose, sets, onInvite }: {
  open: boolean;
  onClose: () => void;
  sets: PermissionSet[];
  onInvite: (email: string, setIds: string[]) => Promise<unknown>;
}) {
  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onInvite(email.trim().toLowerCase(), picked);
      toast.success(`Invitation sent to ${email.trim()}.`);
      setEmail("");
      setPicked([]);
      onClose();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(n) => { if (!n && !busy) onClose(); }}>
      <DialogContent className="max-w-md p-4" data-testid="org-invite-dialog">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
            <MailPlus className="size-4" />
          </span>
          <div>
            <DialogTitle className="text-sm font-semibold">Invite user</DialogTitle>
            <DialogDescription>New addresses get an email invite; existing users also get an inbox notice.</DialogDescription>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <Field label="Email address">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com"
              data-testid="org-invite-email" maxLength={320} inputMode="email" />
          </Field>
          <Field label="Permission sets (optional)">
            <div className="space-y-1.5 rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
              {sets.filter((s) => !s.is_system || s.name !== "Owner").map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                  <span className="font-medium">{s.name}</span>
                  {s.is_system && <span className="text-zinc-400">(system)</span>}
                </label>
              ))}
              {sets.length === 0 && <p className="text-xs text-zinc-500">No sets available.</p>}
            </div>
          </Field>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => void submit()} disabled={busy || !email.includes("@")}
              data-testid="org-invite-submit">
              {busy && <Loader2 className="size-3.5 animate-spin" />} Send invite
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
