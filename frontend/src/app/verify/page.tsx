"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { verifyEmail } from "@/services/api";
import { useAuthStore } from "@/store/auth";

function VerifyBody() {
  const params = useSearchParams();
  const setUser = useAuthStore((s) => s.setUser);
  const token = params.get("token");
  // Organization invite hop-through: ?invite= (or the stored token from the
  // signup card) survives verification so login can land on the invitation.
  const inviteParam = params.get("invite");
  const [invite] = useState<string | null>(() => {
    if (inviteParam) return inviteParam;
    if (typeof window === "undefined") return null;
    try {
      return window.sessionStorage.getItem("tollma_invite_token");
    } catch {
      return null;
    }
  });
  const loginHref = invite ? `/login?invite=${encodeURIComponent(invite)}` : "/login";
  const invitesHref = invite ? `/organizations/invites?token=${encodeURIComponent(invite)}` : "/";
  // No token: render the error state directly (no effect round-trip).
  const [status, setStatus] = useState<"pending" | "ok" | "bad">(token ? "pending" : "bad");

  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController();
    verifyEmail(token, ctrl.signal).then(
      (res) => {
        setUser(res.user);
        setStatus("ok");
      },
      (err) => {
        if (ctrl.signal.aborted) return;
        setStatus("bad");
        void err;
      },
    );
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <AuthShell
      title={status === "bad" ? "Link invalid or expired" : "Email verification"}
      description="Confirming your email address."
      testId="verify-page"
    >
      {status === "pending" && (
        <p role="status" data-testid="verify-pending" className="flex items-center justify-center gap-2 text-sm text-zinc-300">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Verifying your email…
        </p>
      )}
      {status === "ok" && (
        <div className="space-y-2 text-center">
          <p role="status" data-testid="verify-ok" className="text-sm font-semibold text-white">
            Email verified — your account is active.
          </p>
          <Link href={invitesHref} className="inline-block text-sm underline underline-offset-4 hover:text-tollma-300">
            Go to ToLLma
          </Link>
        </div>
      )}
      {status === "bad" && (
        <div className="space-y-2 text-center">
          <p role="status" data-testid="verify-bad" className="text-sm text-zinc-300">
            Verification links are single-use and expire after 24 hours.
          </p>
          <Link href={loginHref} className="inline-block text-sm underline underline-offset-4 hover:text-tollma-300">
            Back to login
          </Link>
        </div>
      )}
    </AuthShell>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyBody />
    </Suspense>
  );
}
