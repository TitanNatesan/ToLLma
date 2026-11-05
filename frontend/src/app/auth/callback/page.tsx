"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui";
import { getCurrentUser } from "@/services/api";
import { useAuthStore } from "@/store/auth";

// Landing page for the Google OAuth callback: the backend has already set
// httpOnly session cookies and redirected here. Load the user, then enter.
export default function OAuthCallbackPage() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        setUser(user);
        router.replace("/");
      })
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthShell
      title={failed ? "Sign-in didn't complete" : "Signing you in"}
      description={
        failed
          ? "We couldn't load your session after Google sign-in."
          : "Finishing Google sign-in…"
      }
      testId="oauth-callback-page"
    >
      {failed ? (
        <div className="flex flex-col items-center gap-3">
          <p role="alert" className="text-center text-sm text-zinc-300">
            The sign-in didn&apos;t complete. Try again or use email login.
          </p>
          <Button
            size="sm"
            onClick={() => window.location.reload()}
            data-testid="oauth-callback-retry"
          >
            Try again
          </Button>
        </div>
      ) : (
        <p
          role="status"
          className="flex items-center justify-center gap-2 text-sm text-zinc-300"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Signing you in…
        </p>
      )}
    </AuthShell>
  );
}
