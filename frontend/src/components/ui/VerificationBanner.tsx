"use client";

import { useEffect, useState } from "react";
import { Loader2, MailWarning } from "lucide-react";
import { ApiError, resendVerificationEmail } from "@/services/api";
import { useAuthStore } from "@/store/auth";
import { toastApiError } from "@/lib/errors";
import { Button } from "./primitives";

const FALLBACK_COOLDOWN_SECONDS = 60;

/** Pull a cooldown duration out of a 429 body/header, with a safe fallback. */
function cooldownFromRateLimit(error: ApiError): number {
  const data = error.data as { cooldown_seconds?: unknown; retry_after?: unknown } | null;
  const fromBody =
    typeof data?.cooldown_seconds === "number" && Number.isFinite(data.cooldown_seconds)
      ? Math.max(0, Math.ceil(data.cooldown_seconds))
      : typeof data?.retry_after === "number" && Number.isFinite(data.retry_after)
        ? Math.max(0, Math.ceil(data.retry_after))
        : null;
  return fromBody ?? error.retryAfterSeconds ?? FALLBACK_COOLDOWN_SECONDS;
}

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

/**
 * Persistent banner for authenticated-but-unverified users. Rendered inside
 * the authenticated AppShell path only (never on bare/public routes).
 * Disappears automatically once `user.email_verified` flips on refetch.
 */
export function VerificationBanner() {
  const user = useAuthStore((s) => s.user);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (!user || user.email_verified) return null;

  const cooling = cooldown > 0;

  const handleResend = async () => {
    if (sending || cooling) return;
    setSending(true);
    try {
      const res = await resendVerificationEmail();
      setSent(true);
      if (res.cooldown_seconds > 0) setCooldown(res.cooldown_seconds);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        // Rate-limited: enter cooldown instead of erroring.
        setSent(true);
        setCooldown(cooldownFromRateLimit(error));
        return;
      }
      toastApiError(error, { title: "Could not send verification email" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="status"
      data-testid="verification-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <MailWarning className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {sent ? (
          <span data-testid="verification-sent">
            Verification email sent — check your inbox to activate your account.
          </span>
        ) : (
          <span>Please verify your email to unlock all features.</span>
        )}
        {cooling && (
          <span data-testid="verification-countdown" className="ml-1 font-medium">
            You can request another email in {formatCountdown(cooldown)}.
          </span>
        )}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="verification-resend"
        disabled={sending || cooling}
        onClick={() => void handleResend()}
        className="border-amber-300 bg-transparent hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900"
      >
        {sending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
        {sending ? "Sending…" : cooling ? `Resend in ${formatCountdown(cooldown)}` : sent ? "Resend email" : "Resend verification email"}
      </Button>
    </div>
  );
}
