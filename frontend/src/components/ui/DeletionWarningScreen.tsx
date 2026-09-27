"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LogOut, RotateCcw } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { ApiError, getCurrentUser, googleLoginUrl, restoreAccount } from "@/services/api";
import { parseApiError } from "@/lib/errors";
import { useAuthStore } from "@/store/auth";

const PASSWORD_REQUIRED = "Enter your current password to restore your account.";
const PASSWORD_WRONG = "Incorrect current password. Check it and try again.";
const GOOGLE_REAUTH_HINT = "Sign in with Google again, then retry.";

/**
 * Shared countdown helper (also used by settings badges): whole days left
 * until `scheduledFor` (ISO string), floored at 0. Lives in the screen module
 * so no new global store is needed.
 */
export function daysRemainingUntil(scheduledFor: string | null | undefined): number {
  if (!scheduledFor) return 0;
  const target = new Date(scheduledFor).getTime();
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.ceil((target - Date.now()) / 86_400_000));
}

function scheduledDateLabel(scheduledFor: string | null | undefined): string {
  if (!scheduledFor) return "";
  const date = new Date(scheduledFor);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Phase 7 hard gate: pending-deletion accounts see ONLY this screen — never
 * the AppShell, no sidebar/nav, and no links to dashboard/chat/settings.
 * Restore re-authenticates (password for has_password users, fresh Google
 * sign-in hint otherwise) and clears the gate via user refetch; Continue
 * only drops local auth and routes to /login.
 */
export function DeletionWarningScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const reset = useAuthStore((s) => s.reset);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pending, setPending] = useState(false);

  const scheduledFor = user?.deletion_scheduled_for ?? null;
  const days = daysRemainingUntil(scheduledFor);
  const hasPassword = user?.has_password === true;

  function clearError() {
    setError(null);
    setForbidden(false);
  }

  async function handleRestore() {
    if (pending) return;
    clearError();
    if (hasPassword && password === "") {
      setError(PASSWORD_REQUIRED);
      return;
    }
    setPending(true);
    try {
      // 200 carries the restored user: set it so the gate clears immediately.
      const restored = await restoreAccount(hasPassword ? { current_password: password } : {});
      setUser(restored);
      setPassword("");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : null;
      if (status === 401) {
        setError(PASSWORD_WRONG);
      } else if (status === 422) {
        setError(PASSWORD_REQUIRED);
      } else if (status === 403) {
        const data = e instanceof ApiError ? (e.data as { error?: { message?: unknown } }) : null;
        const serverMessage =
          typeof data?.error?.message === "string" && data.error.message
            ? data.error.message
            : parseApiError(e).message;
        setError(`${serverMessage} ${GOOGLE_REAUTH_HINT}`);
        setForbidden(true);
      } else if (status === 409) {
        // Nothing pending server-side (restored elsewhere): refetch so the
        // gate clears instead of stranding the user here.
        try {
          setUser(await getCurrentUser());
        } catch {
          setError(parseApiError(e).message);
        }
      } else {
        setError(parseApiError(e).message);
      }
    } finally {
      setPending(false);
    }
  }

  function handleContinueWithDeletion() {
    // Local sign-out only: the deletion schedule is untouched server-side.
    reset();
    router.replace("/login");
  }

  return (
    <div
      data-testid="deletion-warning-screen"
      className="flex h-screen w-screen items-center justify-center overflow-y-auto bg-zinc-50 px-4 py-8 dark:bg-zinc-950"
    >
      <div className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-6 shadow-sm dark:border-amber-900 dark:bg-zinc-900">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1
              data-testid="deletion-warning-title"
              className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Account scheduled for deletion
            </h1>
            <p
              data-testid="deletion-warning-countdown"
              className="mt-1 text-sm text-zinc-600 dark:text-zinc-300"
            >
              Account scheduled for deletion in {days} {days === 1 ? "day" : "days"}
              {scheduledDateLabel(scheduledFor) && (
                <span className="text-zinc-500 dark:text-zinc-400">
                  {" "}
                  — on {scheduledDateLabel(scheduledFor)}
                </span>
              )}
              .
            </p>
          </div>
        </div>

        <div
          data-testid="deletion-warning-details"
          className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"
        >
          <p>
            Your data is retained for 15 days and will be permanently purged after that. You can
            still restore your account until then — but API keys stopped working immediately when
            deletion was requested and are not restored.
          </p>
        </div>

        <div className="mt-4">
          {hasPassword ? (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="deletion-restore-password"
                className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Confirm with your current password to restore
              </label>
              <Input
                id="deletion-restore-password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearError();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRestore();
                }}
                placeholder="Current password"
                autoComplete="current-password"
                data-testid="deletion-warning-password"
                className="h-9 text-sm"
                spellCheck={false}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5" data-testid="deletion-warning-google-hint">
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Restoring requires a recent Google sign-in. If asked, sign in with Google again,
                then retry.
              </p>
              <button
                type="button"
                data-testid="deletion-warning-google-reauth"
                onClick={() => {
                  window.location.href = googleLoginUrl();
                }}
                className="self-start text-xs font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                Sign in with Google again
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-500 dark:text-red-400" data-testid="deletion-warning-error">
            {error}{" "}
            {forbidden && (
              <button
                type="button"
                data-testid="deletion-warning-forbidden-reauth"
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

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={handleContinueWithDeletion}
            data-testid="deletion-warning-continue"
            className="gap-1.5 text-xs"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            Continue with deletion
          </Button>
          <Button
            type="button"
            onClick={() => void handleRestore()}
            disabled={pending}
            data-testid="deletion-warning-restore"
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {pending ? "Restoring…" : "Restore account"}
          </Button>
        </div>
      </div>
    </div>
  );
}
