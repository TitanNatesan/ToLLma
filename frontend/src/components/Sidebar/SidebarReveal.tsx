"use client";

import { PanelLeftOpen } from "lucide-react";
import { useChatStore } from "@/store/chat";
import { Button, Tooltip } from "@/components/ui/primitives";

/**
 * Shared collapsed-sidebar affordance, owned by the app shell.
 *
 * Rendered by AppShell (desktop only) when the sidebar is collapsed: a slim
 * in-flow rail, so the button can never be clipped by overflow, hidden by
 * stacking contexts, or lost on route changes. Mobile keeps its overlay +
 * header openers (the rail is `md:`-gated). Mirrors SidebarHeader's
 * collapse control (same store, same icon family, same tooltip pattern).
 */
export function SidebarReveal() {
  const setLeftSidebar = useChatStore((s) => s.setLeftSidebar);

  return (
    <div
      className="hidden w-10 shrink-0 flex-col items-center border-r border-zinc-200 bg-zinc-50 pt-2 md:flex dark:border-zinc-800 dark:bg-zinc-900"
      data-testid="sidebar-reveal-rail"
    >
      <Tooltip content="Show sidebar" side="right">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 shrink-0 p-0 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          onClick={() => setLeftSidebar(true)}
          aria-label="Expand sidebar"
          aria-expanded={false}
          title="Expand sidebar"
          data-testid="sidebar-reveal"
        >
          <PanelLeftOpen className="size-3.5" />
        </Button>
      </Tooltip>
    </div>
  );
}
