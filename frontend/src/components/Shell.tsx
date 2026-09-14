"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { QueryProvider } from "@/lib/query";
import { AppShell, Toaster, TooltipProvider } from "@/components/ui";
import { getCurrentUser } from "@/services/api";
import { hasSessionCookie, useAuthStore } from "@/store/auth";

const BARE_PATHS = ["/login", "/signup", "/verify", "/auth/callback"];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const setUser = useAuthStore((s) => s.setUser);
  const setChecked = useAuthStore((s) => s.setChecked);

  // Session bootstrap: presence cookie -> load user -> store.
  useEffect(() => {
    if (!hasSessionCookie()) {
      setChecked();
      return;
    }
    getCurrentUser()
      .then((user) => {
        setUser(user);
        setChecked();
      })
      .catch(() => setChecked());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bare = BARE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  return (
    <QueryProvider>
      <TooltipProvider>
        {bare ? children : <AppShell>{children}</AppShell>}
        <Toaster />
      </TooltipProvider>
    </QueryProvider>
  );
}
