"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useChatStore } from "@/store/chat";
import { cn } from "@/lib/utils";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarNavigation } from "./SidebarNavigation";
import { SidebarConversations } from "./SidebarConversations";
import { SidebarProviders } from "./SidebarProviders";
import { SidebarAnalytics } from "./SidebarAnalytics";
import { SidebarSettings } from "./SidebarSettings";
import { SidebarFooter } from "./SidebarFooter";

/**
 * Primary application navigation (ChatGPT-style).
 * Content switches on the active route; the header and profile footer persist.
 *
 *   /c/*, /      -> conversations context + full nav
 *   /providers*  -> providers context + nav minus Providers
 *   /analytics*  -> report shortcuts + nav minus Analytics
 *   /settings*   -> settings sections (nav lives one hop away via logo)
 */
export function Sidebar({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
  const pathname = usePathname();
  const { leftSidebarOpen, sidebarWidth, setSidebarWidth } = useChatStore();

  // Navigation links stay hidden until the profile gear toggles them open.
  // navPath records which route the menu was opened on; navigating away
  // (stale path) collapses it again on the next render.
  const [navPath, setNavPath] = useState<string | null>(null);
  const navOpen = navPath === pathname;
  const toggleNav = () => setNavPath((p) => (p === pathname ? null : pathname));

  const isProvidersPage = pathname === "/providers" || pathname.startsWith("/providers/");
  const isAnalyticsPage = pathname === "/analytics" || pathname.startsWith("/analytics/");
  const isSettingsPage = pathname === "/settings" || pathname.startsWith("/settings/");

  // Resizing state
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 200), 450);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, setSidebarWidth]);

  const currentWidth = leftSidebarOpen ? sidebarWidth : 0;
  const ariaLabel = isProvidersPage
    ? "Provider list"
    : isAnalyticsPage
      ? "Analytics"
      : isSettingsPage
        ? "Settings"
        : "Conversations";

  // Below md the sidebar becomes an off-canvas overlay so page content keeps
  // the full viewport width (analytics/settings need it).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const inner = (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ width: isMobile ? "100%" : sidebarWidth }}
    >
      <SidebarHeader onOpenCommandPalette={onOpenCommandPalette} />

      {/* Route-aware context (the only scrollable region; footer stays put) */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isProvidersPage ? (
          <SidebarProviders />
        ) : isAnalyticsPage ? (
          <SidebarAnalytics />
        ) : isSettingsPage ? (
          <SidebarSettings />
        ) : (
          <SidebarConversations />
        )}
      </div>

      <SidebarNavigation open={navOpen} />
      <SidebarFooter navOpen={navOpen} onToggleNav={toggleNav} />
    </div>
  );

  if (isMobile) {
    return (
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[min(85vw,320px)] flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50 shadow-xl transition-transform duration-200 dark:border-zinc-800 dark:bg-zinc-900",
          leftSidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label={ariaLabel}
        aria-hidden={!leftSidebarOpen}
        data-testid="left-sidebar"
      >
        {inner}
      </aside>
    );
  }

  return (
    <motion.aside
      animate={{ width: currentWidth }}
      transition={{
        duration: isResizing ? 0 : 0.25,
        ease: "easeInOut",
      }}
      className="relative flex shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-950/40"
      aria-label={ariaLabel}
      data-testid="left-sidebar"
      style={{ width: currentWidth }}
    >
      {inner}

      {/* Resizer Handle */}
      <div
        id="sidebar-resizer"
        onMouseDown={() => setIsResizing(true)}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-zinc-400/50 active:bg-zinc-500 transition-colors z-10"
      />
    </motion.aside>
  );
}
