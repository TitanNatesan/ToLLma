"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Mail, MailCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui";
import { forgotPassword } from "@/services/api";

/**
 * Forgot password. Always shows the same generic confirmation: the response
 * never reveals whether the address exists or which provider it uses.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await forgotPassword(email.trim());
    } catch {
      // Even a transport error must not leak account existence.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  return (
    <AuthShell
      description="We will email you a link to reset your password."
      testId="forgot-password-page"
      title="Forgot password"
    >
      {sent ? (
        <div className="space-y-5" data-testid="forgot-password-sent">
          <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            <MailCheck className="mt-0.5 size-4 shrink-0" />
            <p>If an account exists for this email, a password reset link has been sent.</p>
          </div>
          <p className="text-center text-[11px] text-zinc-500">
            The link expires in 1 hour. Check your spam folder if it does not arrive.
          </p>
          <Link
            className="flex items-center justify-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
            href="/login"
          >
            <ArrowLeft className="size-3.5" /> Back to login
          </Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">Email Address</label>
            <div className="relative flex items-center">
              <Mail className="pointer-events-none absolute left-3 size-4 text-zinc-500" />
              <input
                autoComplete="email"
                className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-800/80 pr-3 pl-9 text-xs text-white placeholder-zinc-500 transition-colors focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 focus:outline-none"
                data-testid="forgot-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                required
                type="email"
                value={email}
              />
            </div>
          </div>

          <Button
            className="w-full"
            data-testid="forgot-submit"
            disabled={busy || email.trim().length === 0}
            size="lg"
            type="submit"
          >
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Sending…
              </span>
            ) : (
              "Send Reset Link"
            )}
          </Button>

          <Link
            className="flex items-center justify-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
            href="/login"
          >
            <ArrowLeft className="size-3.5" /> Back to login
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
