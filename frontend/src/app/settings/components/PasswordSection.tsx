"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, SettingItem } from "@/components/ui";
import { useChangePassword } from "@/hooks/useSettings";
import { passwordStrength } from "@/lib/password";
import { cn } from "@/lib/utils";

const SEGMENTS = 4;

/** Change password with current-password verification and a strength meter. */
export function PasswordSection() {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const strength = passwordStrength(next);
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && !change.isPending;

  function submit() {
    setError(null);
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    change.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: (result) => {
          toast.success("Password changed", {
            description:
              result.revoked_sessions > 0
                ? `${result.revoked_sessions} other session(s) were signed out.`
                : "Other sessions already signed out.",
          });
          setCurrent("");
          setNext("");
          setConfirm("");
        },
        onError: (e) => {
          setError(e.message.includes("401") ? "Current password is incorrect." : e.message);
        },
      },
    );
  }

  const tone = ["bg-red-500", "bg-orange-500", "bg-amber-500", "bg-lime-500", "bg-emerald-500"][strength.score];

  return (
    <>
      <SettingItem label="Current password" description="We verify it before applying the change.">
        <Input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          aria-label="Current password"
          data-testid="password-current"
          className="h-8 w-64 text-xs"
        />
      </SettingItem>
      <SettingItem label="New password" description="Minimum 8 characters.">
        <div className="flex flex-col items-end gap-1.5">
          <Input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            aria-label="New password"
            data-testid="password-new"
            className="h-8 w-64 text-xs"
          />
          {next.length > 0 && (
            <div className="w-64" data-testid="password-strength">
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
              <p className="mt-1 text-right text-[10px] text-zinc-400">
                {strength.label}
                {strength.hints[0] ? ` · ${strength.hints[0]}` : ""}
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
            data-testid="password-confirm"
            className={cn("h-8 w-64 text-xs", mismatch && "border-red-400 dark:border-red-800")}
          />
          {mismatch && <p className="text-[10px] text-red-500">Passwords do not match</p>}
        </div>
      </SettingItem>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <ShieldCheck className="size-3" />
          Changing your password signs out all other sessions.
        </p>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-[11px] text-red-500" data-testid="password-error">
              {error}
            </span>
          )}
          <Button
            size="sm"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="password-submit"
            className="gap-1.5 text-xs"
          >
            {change.isPending ? (
              "Updating…"
            ) : change.isSuccess ? (
              <>
                <CheckCircle2 className="size-3.5" /> Updated
              </>
            ) : (
              <>
                <KeyRound className="size-3.5" /> Change password
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
