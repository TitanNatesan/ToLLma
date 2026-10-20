"use client";

import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { useChatStore } from "@/store/chat";
import { useAuthStore } from "@/store/auth";
import { useOrgStore } from "@/store/org";
import { cn } from "@/lib/utils";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarPersonalNav, SidebarLogoutNav } from "./SidebarNavigation";
import { SidebarAdmin, ADMIN_SECTION_IDS, type AdminSectionId } from "./SidebarAdmin";
import { SidebarSettings, SETTINGS_SECTION_IDS, type SettingsSectionId } from "./SidebarSettings";
import { SidebarConversations } from "./SidebarConversations";
import { SidebarProviders } from "./SidebarProviders";
import { SidebarAnalytics, ANALYTICS_REPORT_IDS, type AnalyticsReportId } from "./SidebarAnalytics";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarOrgNav } from "./SidebarOrgNav";

/** Hash fragment follows for section navigators (fragment navigation fires hashchange). */
function subscribeSectionHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function getSectionHash(): string {
  return window.location.hash.slice(1);
}

function getSectionHashServer(): string {
  return "";
}

function adminSectionFromHash(hash: string): AdminSectionId {
  return (ADMIN_SECTION_IDS as readonly string[]).includes(hash)
    ? (hash as AdminSectionId)
    : "overview";
}

function settingsSectionFromHash(hash: string): SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(hash)
    ? (hash as SettingsSectionId)
    : "profile";
}

function analyticsReportFromHash(hash: string): AnalyticsReportId {
  return (ANALYTICS_REPORT_IDS as readonly string[]).includes(hash)
    ? (hash as AnalyticsReportId)
    : "summary";
}

/**
 * Primary application navigation (ChatGPT-style).
 * Content switches on the active route; the header and profile footer persist.
 * Layout: scrollable middle = route-aware body ONLY; bottom-anchored section
 * = personal nav always + (when an org is selected) the collapsible org
 * group. Nothing ever swaps the body.
 *
 *   /c/*, /      -> conversations context + full nav
 *   /admin*      -> admin section navigator (platform admins only)
 *   /providers*  -> providers context + nav minus Providers
 *   /analytics*  -> report shortcuts + nav minus Analytics
 *   /settings*   -> settings sections (nav lives one hop away via logo)
 */
export function Sidebar({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
  const pathname = usePathname();
  const { leftSidebarOpen, sidebarWidth, setSidebarWidth } = useChatStore();
  // Bottom-anchored navigation visibility. The footer chevron toggles (pins)
  // it; hovering the chevron while hidden only peeks until pointer + focus
  // leave the chevron/nav area for 1s. The sidebar itself is unaffected.
  const navVisible = useChatStore((s) => s.navVisible);
  const setNavVisible = useChatStore((s) => s.setNavVisible);
  const [peekNav, setPeekNav] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPeekTimer = () => {
    if (peekTimer.current !== null) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
  };

  useEffect(() => () => {
    if (peekTimer.current !== null) clearTimeout(peekTimer.current);
  }, []);

  // Peek: hovering the chevron while nav is hidden shows the nav
  // temporarily. Clicking pins it open (unfocus then keeps it visible).
  const peekNavOpen = () => {
    if (useChatStore.getState().navVisible) return;
    clearPeekTimer();
    setPeekNav(true);
  };
  const schedulePeekClose = () => {
    if (useChatStore.getState().navVisible) return;
    clearPeekTimer();
    peekTimer.current = setTimeout(() => setPeekNav(false), 150);
  };
  const toggleNavPinned = () => {
    clearPeekTimer();
    setPeekNav(false);
    setNavVisible(!useChatStore.getState().navVisible);
  };
  const navShown = navVisible || peekNav;
  const user = useAuthStore((s) => s.user);
  const isPlatformAdmin = user?.platform_role === "platform_admin";
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const adminHash = useSyncExternalStore(subscribeSectionHash, getSectionHash, getSectionHashServer);
  const adminActiveId = adminSectionFromHash(adminHash);
  const settingsHash = useSyncExternalStore(subscribeSectionHash, getSectionHash, getSectionHashServer);
  const settingsActiveId = settingsSectionFromHash(settingsHash);
  const analyticsHash = useSyncExternalStore(subscribeSectionHash, getSectionHash, getSectionHashServer);
  const analyticsActiveId = analyticsReportFromHash(analyticsHash);

  const isChatPage = pathname === "/" || pathname.startsWith("/c/");
  const isProvidersPage = pathname === "/providers" || pathname.startsWith("/providers/");
  const isAnalyticsPage = pathname === "/analytics" || pathname.startsWith("/analytics/");
  const isSettingsPage = pathname === "/settings" || pathname.startsWith("/settings/");
  const orgSegment = pathname.split("/")[2] ?? "";
  const isOrgDetailPage = /^\/organizations\/[^/]+$/.test(pathname) && orgSegment !== "invites";
  const context = useOrgStore((s) => s.context);
  // Org scope wins everywhere; URL-derived org is a fallback until the detail
  // page writes the context itself (it owns setContext on direct visits).
  const scopeOrgId = context.type === "org" ? context.orgId : isOrgDetailPage ? orgSegment : null;

  // Resizing state
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    // Pointer events cover touch; the mouse listeners stay so existing
    // desktop behavior is untouched (both report the same clientX).
    const handleMove = (e: MouseEvent | PointerEvent) => {
      const newWidth = Math.min(Math.max(e.clientX, 200), 450);
      setSidebarWidth(newWidth);
    };

    const handleUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };
  }, [isResizing, setSidebarWidth]);

  const currentWidth = leftSidebarOpen ? sidebarWidth : 0;
  const ariaLabel = isAdminPage
    ? "Admin navigation"
    : isProvidersPage
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

      {/* Route-aware context: the only scrollable region. Conversations
          render ONLY on chat pages; providers/analytics/settings/admin keep
          their contextual bodies; everywhere else the body stays empty so
          the bottom-anchored nav is the single navigation. */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {isChatPage ? (
          <SidebarConversations />
        ) : isAdminPage ? (
          isPlatformAdmin ? (
            <SidebarAdmin activeId={adminActiveId} />
          ) : null
        ) : isProvidersPage ? (
          <SidebarProviders />
        ) : isAnalyticsPage ? (
          <SidebarAnalytics activeId={analyticsActiveId} />
        ) : isSettingsPage ? (
          <SidebarSettings activeId={settingsActiveId} />
        ) : (
          /* No contextual body content here: the bottom-anchored nav is the
             single navigation. */
          <div aria-hidden className="flex-1" />
        )}
      </div>

      {/* Bottom-anchored nav above the footer: personal links always, plus
          the org group when an org is selected. Never scrolls, never swaps
          the body above. Hidden only via the footer chevron. */}
      {/* Bottom-anchored nav: org scope shows ONLY the org navigation
          (unified pages included); personal scope shows the personal nav.
          Hidden only via the footer chevron. */}
      {!isAdminPage && navShown && (
        <div
          className="shrink-0 border-t border-zinc-200 dark:border-zinc-800"
          onMouseEnter={peekNavOpen}
          onMouseLeave={schedulePeekClose}
          onFocus={peekNavOpen}
          onBlur={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            schedulePeekClose();
          }}
          onFocusCapture={peekNavOpen}
        >
          {scopeOrgId ? (
            <SidebarOrgNav orgId={scopeOrgId} />
          ) : (
            <SidebarPersonalNav />
          )}
          <div className="border-t border-zinc-200 dark:border-zinc-800">
            <SidebarLogoutNav />
          </div>
        </div>
      )}

      {isPlatformAdmin && (
        <nav
          aria-label="Platform administration"
          className="border-t border-zinc-200 px-2 py-2 dark:border-zinc-800"
          data-testid="sidebar-admin-nav"
        >
          <Link
            href="/admin"
            aria-current={isAdminPage ? "page" : undefined}
            data-testid="sidebar-nav-admin"
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
              isAdminPage && "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
            )}
          >
            <ShieldCheck className="size-3.5 shrink-0" />
            <span>Admin</span>
          </Link>
        </nav>
      )}
      <SidebarFooter
        navOpen={navShown}
        onToggleNav={toggleNavPinned}
        onPeekNav={peekNavOpen}
        onUnpeekNav={schedulePeekClose}
        hideToggle={isAdminPage}
      />
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
        inert={!leftSidebarOpen}
        tabIndex={-1}
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
      aria-hidden={!leftSidebarOpen}
      inert={!leftSidebarOpen}
      data-testid="left-sidebar"
      style={{ width: currentWidth }}
    >
      {inner}

      {/* Resizer Handle: 8px hit area, 4px visual */}
      <div
        id="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={200}
        aria-valuemax={450}
        aria-valuenow={Math.round(sidebarWidth)}
        tabIndex={0}
        onMouseDown={() => setIsResizing(true)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setIsResizing(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setSidebarWidth(Math.max(200, sidebarWidth - 16));
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setSidebarWidth(Math.min(450, sidebarWidth + 16));
          }
        }}
        className="group absolute right-0 top-0 bottom-0 w-2 -mx-0.5 z-10 cursor-col-resize focus-visible:outline-none"
      >
        <div className="mx-auto h-full w-1 transition-colors group-hover:bg-zinc-400/50 group-active:bg-zinc-500 group-focus-visible:bg-zinc-400/50" />
      </div>
    </motion.aside>
  );
}
