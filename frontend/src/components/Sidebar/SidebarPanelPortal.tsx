"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const SIDEBAR_CONTEXT_SLOT_ID = "sidebar-context-slot";

let slotNode: HTMLElement | null = null;
const listeners = new Set<() => void>();

function setSlotNode(el: HTMLElement | null) {
  slotNode = el;
  listeners.forEach((l) => l());
}

function subscribeSlot(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSlotNode() {
  return slotNode;
}

/**
 * Render target for page-owned contextual panels. Mount this once inside
 * the main layout sidebar's scrollable region; pages portal their filter
 * controls here with <SidebarPanelPortal>.
 */
export function SidebarContextSlot() {
  return <div id={SIDEBAR_CONTEXT_SLOT_ID} ref={setSlotNode} className="shrink-0 px-2 pb-2 empty:p-0" />;
}

/**
 * Renders page-specific filter/section controls inside the main layout
 * sidebar instead of a second content column. The page keeps owning all
 * state — only the render location moves.
 *
 * Tied to the page lifecycle: navigating away unmounts the page and the
 * portal with it, so stale controls are impossible. Inside the sidebar the
 * panel is always visible real estate (the sidebar itself collapses via the
 * rail and drawers on mobile), so use OrgContextSidebar bare mode.
 */
export function SidebarPanelPortal({ children }: { children: ReactNode }) {
  const slot = useSyncExternalStore(subscribeSlot, getSlotNode);
  if (!slot) return null;
  return createPortal(children, slot);
}
