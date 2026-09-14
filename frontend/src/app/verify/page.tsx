"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { verifyEmail } from "@/services/api";
import { useAuthStore } from "@/store/auth";

function VerifyBody() {
  const params = useSearchParams();
  const setUser = useAuthStore((s) => s.setUser);
  const token = params.get("token");
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
    <main className="flex min-h-screen items-center justify-center px-4" data-testid="verify-page">
      <div className="w-full max-w-sm space-y-3 rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-950">
        {status === "pending" && <p data-testid="verify-pending">Verifying your email…</p>}
        {status === "ok" && (
          <>
            <h1 className="text-lg font-semibold" data-testid="verify-ok">Email verified</h1>
            <p className="text-sm text-zinc-500">Your account is active.</p>
            <Link href="/" className="inline-block underline">Go to ToLLma</Link>
          </>
        )}
        {status === "bad" && (
          <>
            <h1 className="text-lg font-semibold" data-testid="verify-bad">Link invalid or expired</h1>
            <p className="text-sm text-zinc-500">Verification links are single-use and expire after 24 hours.</p>
            <Link href="/login" className="inline-block underline">Back to login</Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyBody />
    </Suspense>
  );
}
