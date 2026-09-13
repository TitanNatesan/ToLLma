"use client";

import { QueryProvider } from "@/lib/query";
import { AppShell, Toaster, TooltipProvider } from "@/components/ui";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <TooltipProvider>
        <AppShell>{children}</AppShell>
        <Toaster />
      </TooltipProvider>
    </QueryProvider>
  );
}
