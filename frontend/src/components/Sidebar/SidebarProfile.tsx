"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useOrgStore } from "@/store/org";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui";
import { WorkspaceMenuContent } from "./WorkspaceMenu";

/** Persistent profile card. Hovering the identity block reveals the workspace
 * menu (same 1s grace-hide as the nav peek); clicking toggles it pinned
 * open. The footer chevron pins the bottom-anchored navigation open or
 * closed; hovering it while hidden only peeks. Log out lives at the end of
 * the navigation list. */
export function SidebarProfile({
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
  const user = useAuthStore((s) => s.user);
  const context = useOrgStore((s) => s.context);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMenuTimer = () => {
    if (menuTimer.current !== null) {
      clearTimeout(menuTimer.current);
      menuTimer.current = null;
    }
  };

  useEffect(
    () => () => {
      if (menuTimer.current !== null) clearTimeout(menuTimer.current);
    },
    [],
  );

  // Hovering the identity block reveals the workspace menu (same 1s grace
  // as the nav peek); clicking toggles it pinned open.
  const peekMenuOpen = () => {
    clearMenuTimer();
    setMenuOpen(true);
  };
  const scheduleMenuClose = () => {
    clearMenuTimer();
    menuTimer.current = setTimeout(() => setMenuOpen(false), 1000);
  };

  if (!user) return null;
  const displayName = user.full_name?.trim() || "User";
  const email = user.email || "user@example.com";
  const initial = (email[0] ?? "?").toUpperCase();
  const workspaceName = context.type === "personal" ? "Personal" : context.orgName;

  return (
    <div className="flex items-center gap-2.5" data-testid="sidebar-profile">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Workspace menu, signed in as ${email}. Current workspace ${workspaceName}`}
            data-testid="workspace-menu-trigger"
            onMouseEnter={peekMenuOpen}
            onMouseLeave={scheduleMenuClose}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              title={email}
              data-testid="user-avatar"
              aria-hidden
            >
              {initial}
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {displayName}
              </span>
              <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={email}>
                {workspaceName}
              </span>
            </span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="top"
          align="start"
          className="w-64 p-1.5"
          data-testid="workspace-menu"
          onMouseEnter={peekMenuOpen}
          onMouseLeave={scheduleMenuClose}
        >
          <WorkspaceMenuContent />
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        onClick={onToggleNav}
        onMouseEnter={onPeekNav}
        onMouseLeave={onUnpeekNav}
        onFocus={onPeekNav}
        onBlur={onUnpeekNav}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        title={navOpen ? "Hide navigation" : "Show navigation"}
        aria-label={navOpen ? "Hide navigation. Activate to keep navigation visible." : "Show navigation temporarily. Activate to keep it visible."}
        aria-expanded={navOpen}
        data-testid="sidebar-collapse-btn"
      >
        <ChevronsUpDown className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
