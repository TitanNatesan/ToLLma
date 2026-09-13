"use client";

import React, { useState } from "react";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { CommandPalette, useCommandPalette } from "./CommandPalette";
import { useChatStore } from "@/store/chat";
import { RepositoryCatalogModal } from "@/app/providers/components/RepositoryCatalogModal";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const { repoSearchOpen, setRepoSearchOpen } = useChatStore();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-white text-zinc-950 antialiased dark:bg-zinc-950 dark:text-zinc-50">
      {/* Persistent Global Top Navigation */}
      <TopBar onOpenCommandPalette={() => setCmdOpen(true)} />

      {/* Main Workspace: Left Sidebar + Center/Right Content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>

      {/* Global Command Palette (Ctrl+K) */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      {/* Global Model Catalog Search Modal */}
      <RepositoryCatalogModal
        open={repoSearchOpen}
        onClose={() => setRepoSearchOpen(false)}
      />
    </div>
  );
}
