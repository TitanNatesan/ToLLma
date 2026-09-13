"use client";

import { QueryProvider } from "@/lib/query";
import { Toaster } from "@/components/ui";
import { TooltipProvider } from "@/components/ui";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <TooltipProvider>
        <div className="flex h-full flex-col overflow-hidden">
          {children}
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryProvider>
  );
}
