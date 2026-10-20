"use client";

import { useState } from "react";
import { ArrowLeft, Loader2, MailPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input,
} from "@/components/ui";
import { PermissionSetPicker, PickerReview } from "./PermissionSetPicker";
import { parseApiError } from "@/lib/errors";
import type { PermissionSet } from "@/types/orgs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteModal({ open, onClose, orgId, sets, myPermissions, isRoot, onInvite }: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  sets: PermissionSet[];
  myPermissions: string[];
  isRoot: boolean;
  onInvite: (email: string, setIds: string[]) => Promise<unknown>;
}) {
  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;
  const trimmedEmail = email.trim();
  const emailError =
    trimmedEmail === ""
      ? null
      : EMAIL_RE.test(trimmedEmail)
        ? null
        : "Enter a valid email address.";
  const validEmail = trimmedEmail !== "" && emailError === null;

  function close() {
    if (busy) return;
    setEmail("");
    setPicked([]);
    setReviewing(false);
    setError(null);
    onClose();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onInvite(email.trim().toLowerCase(), picked);
      toast.success(`Invitation sent to ${email.trim()}.`);
      close();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(n) => { if (!n) close(); }}>
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
          {!reviewing ? (
            <>
              <Field label="Email address">
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com"
                  data-testid="org-invite-email" maxLength={320} inputMode="email" type="email" />
                {emailError && (
                  <p className="text-[11px] text-red-500" data-testid="org-invite-email-error">
                    {emailError}
                  </p>
                )}
              </Field>
              <Field label="Permission sets">
                <PermissionSetPicker orgId={orgId} sets={sets} selected={picked}
                  onChange={setPicked} myPermissions={myPermissions} isRoot={isRoot}
                  testIdPrefix="org-invite" />
              </Field>
              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={close} disabled={busy}>Cancel</Button>
                <Button size="sm" onClick={() => setReviewing(true)} disabled={busy || !validEmail}
                  title={busy ? "Sending…" : validEmail ? undefined : "Enter a valid email address to continue."}
                  data-testid="org-invite-review">
                  Review invite
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2 text-xs">
                <p className="break-all"><span className="text-zinc-500">To:</span> <strong className="break-all">{email.trim()}</strong></p>
                <PickerReview sets={sets} selected={picked} />
              </div>
              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setReviewing(false)} disabled={busy}
                  title={busy ? "Sending…" : undefined}>
                  <ArrowLeft className="size-3.5" aria-hidden /> Back
                </Button>
                <Button size="sm" onClick={() => void submit()} disabled={busy}
                  title={busy ? "Sending…" : undefined}
                  data-testid="org-invite-submit">
                  {busy && <Loader2 className="size-3.5 animate-spin" />} Send invite
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
