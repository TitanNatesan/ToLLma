"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui";
import { passwordStrength, validatePassword } from "@/lib/password";
import { resetPassword, validateResetToken } from "@/services/api";
import { cn } from "@/lib/utils";

type TokenState = "checking" | "valid" | "invalid";

/** Reset password: token-validated, policy-checked, single-use. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [tokenState, setTokenState] = useState<TokenState>(token ? "checking" : "invalid");
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    validateResetToken(token)
      .then((result) => {
        if (cancelled) return;
        setTokenState(result.valid ? "valid" : "invalid");
        setEmail(result.email);
      })
      .catch(() => {
        if (!cancelled) setTokenState("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // After a successful reset: brief confirmation, then back to login.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.push("/login"), 3000);
    return () => clearTimeout(timer);
  }, [done, router]);

  const strength = passwordStrength(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const policy = validatePassword(password);
    if (policy) {
      setError(policy);
      return;
    }
    if (password !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Reset failed";
      setError(
        message.includes("422")
          ? "This reset link is invalid, expired, or already used. Request a new one."
          : "Could not reset your password. Please try again.",
      );
      setTokenState("invalid");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell description="You can now sign in with your new password." testId="reset-password-done" title="Password reset">
        <div className="space-y-4 text-center" data-testid="reset-success">
          <CheckCircle2 className="mx-auto size-8 text-emerald-400" />
          <p className="text-sm font-medium text-white">Password updated successfully.</p>
          <p className="text-xs text-zinc-400">Redirecting to login…</p>
          <Link className="text-xs text-tollma-400 hover:text-tollma-300" href="/login">
            Go to login now
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (tokenState === "checking") {
    return (
      <AuthShell description="Checking your reset link…" testId="reset-password-checking" title="Reset password">
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-400">
          <Loader2 className="size-4 animate-spin" /> Validating token…
        </div>
      </AuthShell>
    );
  }

  if (tokenState === "invalid") {
    return (
      <AuthShell description="This link cannot be used." testId="reset-password-invalid" title="Link expired">
        <div className="space-y-4" data-testid="reset-invalid">
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>This reset link is invalid, expired, or already used. Request a new one to continue.</p>
          </div>
          <Link
            className="flex items-center justify-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
            href="/auth/forgot-password"
          >
            Request a new link
          </Link>
          <Link
            className="flex items-center justify-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
            href="/login"
          >
            <ArrowLeft className="size-3.5" /> Back to login
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      description={email ? `Choose a new password for ${email}.` : "Choose a new password."}
      testId="reset-password-page"
      title="Reset password"
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-300">New Password</label>
          <div className="relative flex items-center">
            <Lock className="pointer-events-none absolute left-3 size-4 text-zinc-500" />
            <input
              autoComplete="new-password"
              className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-800/80 pr-10 pl-9 text-xs text-white placeholder-zinc-500 transition-colors focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 focus:outline-none"
              data-testid="reset-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              type={show ? "text" : "password"}
              value={password}
            />
            <button
              className="absolute right-3 text-zinc-500 transition-colors hover:text-zinc-300"
              onClick={() => setShow(!show)}
              type="button"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {password.length > 0 && (
            <div className="flex items-center gap-2 pt-1" data-testid="reset-password-strength">
              {[0, 1, 2, 3].map((segment) => (
                <span
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    segment < strength.score
                      ? strength.score >= 3
                        ? "bg-emerald-500"
                        : strength.score === 2
                          ? "bg-amber-500"
                          : "bg-red-500"
                      : "bg-zinc-700",
                  )}
                  key={segment}
                />
              ))}
              <span className="text-[10px] text-zinc-400">{strength.label}</span>
            </div>
          )}
          <p className="pt-1 text-[10px] text-zinc-500">
            At least 8 characters with an uppercase letter, a lowercase letter and a number.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-300">Confirm Password</label>
          <div className="relative flex items-center">
            <Lock className="pointer-events-none absolute left-3 size-4 text-zinc-500" />
            <input
              autoComplete="new-password"
              className={cn(
                "h-10 w-full rounded-lg border bg-zinc-800/80 pr-3 pl-9 text-xs text-white placeholder-zinc-500 transition-colors focus:ring-1 focus:outline-none",
                mismatch ? "border-red-500/60 focus:border-red-400 focus:ring-red-400" : "border-zinc-700 focus:border-zinc-400 focus:ring-zinc-400",
              )}
              data-testid="reset-confirm"
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="••••••••"
              type={show ? "text" : "password"}
              value={confirm}
            />
          </div>
          {mismatch && <p className="text-[10px] text-red-400">Passwords do not match.</p>}
        </div>

        {error && (
          <div
            className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400"
            data-testid="reset-error"
          >
            {error}
          </div>
        )}

        <Button
          className="w-full"
          data-testid="reset-submit"
          disabled={busy || password.length === 0 || confirm.length === 0}
          size="lg"
          type="submit"
        >
          {busy ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Resetting…
            </span>
          ) : (
            "Reset Password"
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
