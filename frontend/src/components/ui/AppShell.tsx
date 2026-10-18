"use client";

import React, { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  const router = useRouter();
  const pathname = usePathname();
  const context = useOrgStore((s) => s.context);
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

  // Org scope owns providers/keys through its dashboard sections: landing
  // on the personal routes with an org context would show personal data
  // under org navigation, so redirect to the matching org section.
  useEffect(() => {
    if (context.type !== "org") return;
    if (pathname === "/providers") {
      router.replace(`/organizations/${context.orgId}?section=providers`);
    } else if (pathname === "/api-keys") {
      router.replace(`/organizations/${context.orgId}?section=operations&tab=keys`);
    }
  }, [context, pathname, router]);

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

  useGlobalShortcuts({ openShortcuts, openCommandPalette });

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-zinc-950 antialiased dark:bg-zinc-950 dark:text-zinc-50">
      <ScopeSync />
      {/* Primary Navigation: context-aware left sidebar */}
      <Sidebar onOpenCommandPalette={() => setCmdOpen(true)} />

      {/* Collapsed-state rail (desktop): the single shared reveal control.
          In normal flow so it is never clipped or lost across routes. */}
      {!leftSidebarOpen && <SidebarReveal />}

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
