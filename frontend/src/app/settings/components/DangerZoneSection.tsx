"use client";

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Checkbox, Dialog, DialogContent, DialogTitle, Input } from "@/components/ui";
import { ApiError, getCurrentUser, googleLoginUrl, requestAccountDeletion } from "@/services/api";
import { parseApiError } from "@/lib/errors";
import { useAuthStore } from "@/store/auth";
import { daysRemainingUntil } from "@/components/ui/DeletionWarningScreen";

/** Phase 7 re-auth copy: mirrors the Phase 6 email-change shapes. */
const DELETE_PASSWORD_REQUIRED = "Enter your current password to confirm deletion.";
const DELETE_PASSWORD_MISSING = "Current password is required to schedule deletion.";
const DELETE_PASSWORD_WRONG = "Incorrect current password. Check it and try again.";
const GOOGLE_FRESH_SIGNIN_HINT =
  "Deleting your account requires a recent Google sign-in. If asked, sign in with Google again, then retry.";
const GOOGLE_REAUTH_HINT = "Sign in with Google again, then retry.";
const CONFIRM_LABEL = "I understand my account and all data will be permanently deleted.";

/**
 * Danger zone: schedule account deletion (15-day retention window).
 *
 * Confirmation UX decision: explicit acknowledge-checkbox + Delete button
 * inside a modal dialog (no type-to-confirm). Rationale: it reuses the
 * existing accessible Checkbox primitive, keeps the flow to two deliberate
 * actions (check + confirm), and matches the codebase's dialog patterns —
 * type-to-confirm would add input-parsing surface for no extra safety here
 * since password re-auth already gates has_password accounts.
 *
 * Success refetches /auth/me into the auth store: the pending timestamps
 * flip on, and the Shell hard gate takes over on the next render.
 */
export function DangerZoneSection() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pending, setPending] = useState(false);

  if (!user) return null;

  // Defensive: the Shell hard gate normally replaces settings entirely once
  // pending, so this only renders after a stale read or a failed refetch.
  const scheduledFor = user.deletion_scheduled_for ?? null;
  if (scheduledFor) {
    return (
      <div
        role="status"
        data-testid="danger-zone-pending"
        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        Deletion already scheduled — your account will be permanently purged in{" "}
        {daysRemainingUntil(scheduledFor)} {daysRemainingUntil(scheduledFor) === 1 ? "day" : "days"}.
        You can still restore it until then. API keys already stopped working and will not be
        restored.
      </div>
    );
  }

  const hasPassword = user.has_password === true;

  function openDialog() {
    setDialogOpen(true);
    setAcknowledged(false);
    setCurrentPassword("");
    setError(null);
    setForbidden(false);
  }

  function clearError() {
    setError(null);
    setForbidden(false);
  }

  async function confirmDelete() {
    if (pending || !acknowledged) return;
    clearError();
    // Phase 6 parity: local-with-password accounts must confirm; the backend
    // 422s without it, so short-circuit with the same inline copy.
    if (hasPassword && currentPassword === "") {
      setError(DELETE_PASSWORD_MISSING);
      return;
    }
    setPending(true);
    try {
      const result = await requestAccountDeletion(
        hasPassword ? { current_password: currentPassword } : {},
      );
      toast.success(`Account deletion scheduled — ${result.days_remaining} days remaining`);
      setDialogOpen(false);
      // The delete-request response carries no user: refetch so the pending
      // timestamps land in the store and the hard gate takes over.
      try {
        setUser(await getCurrentUser());
      } catch {
        toast.error("Could not refresh account status — reload the page");
      }
    } catch (e) {
      const status = e instanceof ApiError ? e.status : null;
      if (status === 401) {
        setError(DELETE_PASSWORD_WRONG);
      } else if (status === 422) {
        setError(DELETE_PASSWORD_MISSING);
      } else if (status === 403) {
        // Passwordless accounts need a fresh Google sign-in: surface the
        // server message verbatim alongside the re-auth hint.
        const data = e instanceof ApiError ? (e.data as { error?: { message?: unknown } }) : null;
        const serverMessage =
          typeof data?.error?.message === "string" && data.error.message
            ? data.error.message
            : parseApiError(e).message;
        setError(`${serverMessage} ${GOOGLE_REAUTH_HINT}`);
        setForbidden(true);
      } else if (status === 409 || (e instanceof Error && e.message.includes("409"))) {
        setError("Deletion is already scheduled for this account.");
      } else {
        setError(parseApiError(e).message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-testid="danger-zone-content">
      <div
        data-testid="danger-zone-warning"
        className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-900 dark:border-red-950 dark:bg-red-950/40 dark:text-red-100"
      >
        <p className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Deleting your account is permanent.
        </p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>Your account enters a 15-day retention period before anything is removed.</li>
          <li>Recovery is possible at any time within those 15 days by restoring your account.</li>
          <li>After 15 days all data is permanently purged and cannot be recovered.</li>
          <li>API keys stop working immediately when deletion is requested and are NOT restored.</li>
        </ul>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-zinc-400">Schedule deletion of this account and all data.</p>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={openDialog}
          data-testid="danger-zone-request"
          className="gap-1.5 text-xs"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Delete account
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md p-5" data-testid="danger-zone-dialog">
          <DialogTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Delete your account?
          </DialogTitle>
          <p
            data-testid="danger-zone-dialog-copy"
            className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400"
          >
            This schedules your account for permanent deletion in 15 days. You can restore it until
            then, but API keys stop working immediately and are never restored.
          </p>

          {hasPassword ? (
            <div className="mt-3 flex flex-col gap-1">
              <Input
                id="delete-account-password"
                type="password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  clearError();
                }}
                placeholder="Current password"
                aria-label="Current password"
                autoComplete="current-password"
                data-testid="danger-zone-password"
                className="h-8 text-xs"
                spellCheck={false}
              />
              <p
                className="text-[11px] text-zinc-500 dark:text-zinc-400"
                data-testid="danger-zone-password-hint"
              >
                {DELETE_PASSWORD_REQUIRED}
              </p>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-1">
              <p
                className="text-[11px] text-zinc-500 dark:text-zinc-400"
                data-testid="danger-zone-google-hint"
              >
                {GOOGLE_FRESH_SIGNIN_HINT}
              </p>
              <button
                type="button"
                data-testid="danger-zone-google-reauth"
                onClick={() => {
                  window.location.href = googleLoginUrl();
                }}
                className="self-start text-[11px] font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                Sign in with Google again
              </button>
            </div>
          )}

          <div className="mt-3">
            <Checkbox
              id="danger-zone-confirm"
              checked={acknowledged}
              onChange={(e) => {
                setAcknowledged(e.target.checked);
                clearError();
              }}
              label={CONFIRM_LABEL}
              data-testid="danger-zone-confirm-checkbox"
            />
          </div>

          {error && (
            <p className="mt-2 text-[11px] text-red-500 dark:text-red-400" data-testid="danger-zone-error">
              {error}{" "}
              {forbidden && (
                <button
                  type="button"
                  data-testid="danger-zone-forbidden-reauth"
                  onClick={() => {
                    window.location.href = googleLoginUrl();
                  }}
                  className="font-medium underline underline-offset-2"
                >
                  Sign in with Google again
                </button>
              )}
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              data-testid="danger-zone-cancel"
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void confirmDelete()}
              disabled={!acknowledged || pending}
              data-testid="danger-zone-confirm-delete"
              className="gap-1.5 text-xs"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {pending ? "Scheduling…" : "Delete my account"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
