"use client";

import React from "react";
import { Sidebar } from "@/components/Sidebar/Sidebar";
import { CommandPalette, useCommandPalette } from "./CommandPalette";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-zinc-950 antialiased dark:bg-zinc-950 dark:text-zinc-50">
      {/* Primary Navigation: context-aware left sidebar */}
      <Sidebar onOpenCommandPalette={() => setCmdOpen(true)} />

      {/* Main Workspace: page content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>

      {/* Global Command Palette (Ctrl+K) */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
