"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { QueryProvider } from "@/lib/query";
import { AppShell, DeletionWarningScreen, Toaster, TooltipProvider } from "@/components/ui";
import { AuthCard } from "@/components/auth/AuthCard";
import { getCurrentUser } from "@/services/api";
import { usePreferencesSync } from "@/hooks/useSettings";
import { clearAuthAndCredentialCache, hasSessionCookie, useAuthStore } from "@/store/auth";
import { Loader2 } from "lucide-react";

const BARE_PATHS = ["/login", "/signup", "/verify", "/invite", "/auth/callback", "/auth/forgot-password", "/auth/reset-password", "/share", "/health"];

/** Loads server preferences into the settings store once a session exists.
 *  Lives inside QueryProvider (Shell itself renders outside it). */
function PreferencesSync({ enabled }: { enabled: boolean }) {
  usePreferencesSync(enabled);
  return null;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const checked = useAuthStore((s) => s.checked);
  const setUser = useAuthStore((s) => s.setUser);
  const setChecked = useAuthStore((s) => s.setChecked);
  const reset = useAuthStore((s) => s.reset);

  // Session bootstrap: presence cookie -> load user -> store.
  useEffect(() => {
    if (!hasSessionCookie()) {
      clearAuthAndCredentialCache();
      setChecked();
      return;
    }
    getCurrentUser()
      .then((u) => {
        setUser(u);
        setChecked();
      })
      .catch(() => {
        reset();
        setChecked();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bare = BARE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (checked && !user && !bare) {
      clearAuthAndCredentialCache();
      router.replace("/login");
    }
  }, [checked, user, bare, router]);

  let content: React.ReactNode;
  if (bare) {
    content = children;
  } else if (!checked) {
    content = (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Loader2 className="size-6 animate-spin text-zinc-400" />
      </div>
    );
  } else if (!user) {
    content = <AuthCard initialMode="login" />;
  } else if (user.deletion_scheduled_for) {
    // Phase 7 hard gate: pending-deletion accounts never see the AppShell.
    content = <DeletionWarningScreen />;
  } else {
    content = <AppShell>{children}</AppShell>;
  }

  return (
    <QueryProvider>
      <TooltipProvider>
        {content}
        <PreferencesSync enabled={!!user && !user.deletion_scheduled_for} />
        <Toaster />
      </TooltipProvider>
    </QueryProvider>
  );
}
