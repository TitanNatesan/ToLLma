"use client";

import { SidebarProfile } from "./SidebarProfile";

/** Sticky sidebar footer. Never scrolls with the content above it. */
export function SidebarFooter({
  navOpen,
  onToggleNav,
  onPeekNav,
  onUnpeekNav,
}: {
  navOpen: boolean;
  onToggleNav: () => void;
  onPeekNav: () => void;
  onUnpeekNav: () => void;
}) {
  return (
    <div
      className="shrink-0 border-t border-zinc-200 bg-zinc-50/60 px-2.5 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/60"
      data-testid="sidebar-footer"
    >
      <SidebarProfile
        navOpen={navOpen}
        onToggleNav={onToggleNav}
        onPeekNav={onPeekNav}
        onUnpeekNav={onUnpeekNav}
      />
    </div>
  );
}
