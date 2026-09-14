"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "@/services/api";
import { useAuthStore } from "@/store/auth";

// Landing page for the Google OAuth callback: the backend has already set
// httpOnly session cookies and redirected here. Load the user, then enter.
export default function OAuthCallbackPage() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    getCurrentUser()
      .then((user) => {
        setUser(user);
        router.replace("/");
      })
      .catch(() => router.replace("/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center" data-testid="oauth-callback-page">
      <p className="text-sm text-zinc-500">Signing you in…</p>
    </main>
  );
}
