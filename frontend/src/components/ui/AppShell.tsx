"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar/Sidebar";
import { useChatStore } from "@/store/chat";
import { useGlobalShortcuts } from "@/hooks/useShortcuts";
import { CommandPalette, useCommandPalette } from "./CommandPalette";
import { ShortcutsOverlay } from "./ShortcutsOverlay";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const leftSidebarOpen = useChatStore((s) => s.leftSidebarOpen);
  const setLeftSidebar = useChatStore((s) => s.setLeftSidebar);

  // Mobile starts with the sidebar closed (it overlays content below md).
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setLeftSidebar(false);
  }, [setLeftSidebar]);

  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const openCommandPalette = useCallback(() => setCmdOpen((v) => !v), [setCmdOpen]);
  useGlobalShortcuts({ openShortcuts, openCommandPalette });

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-zinc-950 antialiased dark:bg-zinc-950 dark:text-zinc-50">
      {/* Primary Navigation: context-aware left sidebar */}
      <Sidebar onOpenCommandPalette={() => setCmdOpen(true)} />

      {/* Off-canvas backdrop below md; tapping it closes the sidebar. */}
      {leftSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setLeftSidebar(false)}
          aria-hidden="true"
          data-testid="sidebar-backdrop"
        />
      )}

      {/* Main Workspace: page content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>

      {/* Global Command Palette (Ctrl+K) + Shortcuts reference (Ctrl+/) */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
