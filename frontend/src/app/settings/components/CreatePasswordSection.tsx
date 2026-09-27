"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, SettingItem, SettingsSection } from "@/components/ui";
import { useSetPassword } from "@/hooks/useSettings";
import { passwordStrength, validatePassword } from "@/lib/password";
import { cn } from "@/lib/utils";
import { ApiError, getCurrentUser } from "@/services/api";
import { useAuthStore } from "@/store/auth";

const SEGMENTS = 4;

/** Map set-password failures to user-facing copy (409 = already set, 422 = weak). */
function setPasswordErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return "A password is already set for this account.";
    if (e.status === 422) return "That password does not meet the requirements.";
  }
  return e instanceof Error ? e.message : "Could not set password.";
}

/**
 * First local password for Google-only accounts (no current password to verify).
 * Mirrors PasswordSection's meter + validation; testids are set-password-* so the
 * change-password assertions stay scoped to the change form.
 */
export function CreatePasswordSection() {
  const set = useSetPassword();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const strength = passwordStrength(next);
  const mismatch = confirm.length > 0 && confirm !== next;
  const policyError = next.length > 0 ? validatePassword(next) : null;
  const canSubmit = next.length >= 8 && !policyError && next === confirm && !set.isPending;

  async function refreshUser() {
    try {
      useAuthStore.getState().setUser(await getCurrentUser());
    } catch {
      // Keep the stale user; the section flips on the next /auth/me load.
    }
  }

  function submit() {
    setError(null);
    const policy = validatePassword(next);
    if (policy) {
      setError(policy);
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    set.mutate(
      { password: next },
      {
        onSuccess: () => {
          toast.success("Password created", {
            description: "You can now sign in with email and password, or keep using Google.",
          });
          setNext("");
          setConfirm("");
          void refreshUser();
        },
        onError: (e) => {
          setError(setPasswordErrorMessage(e));
          // 409 means the account flipped to has_password elsewhere: refetch so
          // the section switches to the change-password form.
          if (e instanceof ApiError && e.status === 409) void refreshUser();
        },
      },
    );
  }

  const tone = ["bg-red-500", "bg-orange-500", "bg-amber-500", "bg-lime-500", "bg-emerald-500"][strength.score];

  return (
    <SettingsSection
      title="Create a password"
      description="Add email + password sign-in alongside Google. Your Google sign-in keeps working."
    >
      <div data-testid="create-password-section">
        <SettingItem
          label="New password"
          description="8+ characters with an uppercase letter, a lowercase letter and a number."
        >
          <div className="flex flex-col items-end gap-1.5">
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              aria-label="New password"
              data-testid="set-password-new"
              className="h-8 w-64 text-xs"
            />
            {next.length > 0 && (
              <div className="w-64" data-testid="set-password-strength">
                <div className="flex gap-1">
                  {Array.from({ length: SEGMENTS }, (_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1 flex-1 rounded-full",
                        i < strength.score ? tone : "bg-zinc-200 dark:bg-zinc-800",
                      )}
                    />
                  ))}
                </div>
                <p
                  className={cn("mt-1 text-right text-[10px]", policyError ? "text-amber-500" : "text-zinc-400")}
                  data-testid="set-password-policy-hint"
                >
                  {policyError ?? `${strength.label}${strength.hints[0] ? ` · ${strength.hints[0]}` : ""}`}
                </p>
              </div>
            )}
          </div>
        </SettingItem>
        <SettingItem label="Confirm new password" description="Must match exactly.">
          <div className="flex flex-col items-end gap-1">
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              aria-label="Confirm new password"
              data-testid="set-password-confirm"
              className={cn("h-8 w-64 text-xs", mismatch && "border-red-400 dark:border-red-800")}
            />
            {mismatch && <p className="text-[10px] text-red-500">Passwords do not match</p>}
          </div>
        </SettingItem>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <ShieldCheck className="size-3" />
            Google sign-in stays enabled either way.
          </p>
          <div className="flex items-center gap-2">
            {error && (
              <span className="text-[11px] text-red-500" data-testid="set-password-error">
                {error}
              </span>
            )}
            <Button
              size="sm"
              onClick={submit}
              disabled={!canSubmit}
              data-testid="set-password-submit"
              className="gap-1.5 text-xs"
            >
              {set.isPending ? (
                "Creating…"
              ) : set.isSuccess ? (
                <>
                  <CheckCircle2 className="size-3.5" /> Created
                </>
              ) : (
                <>
                  <KeyRound className="size-3.5" /> Create password
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
