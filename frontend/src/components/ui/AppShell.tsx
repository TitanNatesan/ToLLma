"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/Sidebar/Sidebar";
import { SidebarReveal } from "@/components/Sidebar/SidebarReveal";
import { useChatStore } from "@/store/chat";
import { useOrgs } from "@/hooks/useOrgs";
import { registerScopeClient, useOrgStore } from "@/store/org";
import { useGlobalShortcuts } from "@/hooks/useShortcuts";
import { CommandPalette, useCommandPalette } from "./CommandPalette";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { VerificationBanner } from "./VerificationBanner";
import { OfflineBanner } from "./OfflineBanner";

/** Runs inside QueryProvider on every route: exposes the client to the org
 * store (scope-change invalidations) and drops org contexts the user can no
 * longer access once the membership list loads. */
function ScopeSync() {
  const qc = useQueryClient();
  const orgs = useOrgs();

  useEffect(() => {
    registerScopeClient(qc);
    return () => registerScopeClient(null);
  }, [qc]);

  useEffect(() => {
    if (orgs.data) {
      useOrgStore.getState().reconcile(orgs.data.map((o) => o.id));
    }
  }, [orgs.data]);

  // NOTE: legacy cross-route redirects for removed org sections
  // (?section=providers|analytics, operations&tab=keys) live in the org
  // detail page effect, which correctly skips them on 401/403/404. They
  // must not live here: ScopeSync cannot tell a bad org id from a good one.

  return null;
}

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

  // Off-canvas sidebar (below md): Esc closes, and focus moves into the
  // sidebar on open. No full focus trap — tabbing out is allowed.
  useEffect(() => {
    if (!leftSidebarOpen) return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLeftSidebar(false);
    };
    window.addEventListener("keydown", onKey);
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="left-sidebar"]')?.focus();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
    };
  }, [leftSidebarOpen, setLeftSidebar]);

  useGlobalShortcuts({ openShortcuts, openCommandPalette });

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-white text-zinc-950 antialiased dark:bg-zinc-950 dark:text-zinc-50">
      <ScopeSync />
      {/* Primary Navigation: context-aware left sidebar */}
      <Sidebar onOpenCommandPalette={() => setCmdOpen(true)} />

      {/* Collapsed-state rail (desktop): the single shared reveal control.
          In normal flow so it is never clipped or lost across routes. */}
      {!leftSidebarOpen && (
        <Suspense fallback={null}>
          <SidebarReveal onOpenCommandPalette={() => setCmdOpen(true)} />
        </Suspense>
      )}

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
        <OfflineBanner />
        <VerificationBanner />
        {children}
      </div>

      {/* Global Command Palette (Ctrl+K) + Shortcuts reference (Ctrl+/) */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
