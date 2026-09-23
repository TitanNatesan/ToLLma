"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { comboMatches, isEditableTarget, type ShortcutDef } from "@/lib/shortcuts";
import { useChatStore } from "@/store/chat";

export interface ShortcutOverlayActions {
  openShortcuts: () => void;
  openCommandPalette: () => void;
}

const SEQUENCE_WINDOW_MS = 1400;

function emit(event: string): void {
  window.dispatchEvent(new CustomEvent(event));
}

/** Chat lives at `/` (transient new-chat) and `/c/{id}` (the conversation). */
function isChatPath(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/c/");
}

/** Navigate first when the action lives on the chat page, then emit after paint. */
function focusChatEvent(routerPush: (href: string) => void, pathname: string, event: string): void {
  if (isChatPath(pathname)) {
    emit(event);
    return;
  }
  // Return to the conversation in progress instead of minting a new one.
  const id = useChatStore.getState().activeConversationId;
  routerPush(id ? `/c/${id}` : "/");
  window.setTimeout(() => emit(event), 120);
}

/**
 * Window-level shortcut handler. Owns overlay toggles, navigation, pane
 * toggles and chat commands (dispatched as `tollma:*` CustomEvents so the
 * chat page owns their execution). Composer-local keys (Enter/Shift+Enter)
 * stay in ChatComposer.
 */
export function useGlobalShortcuts({ openShortcuts, openCommandPalette }: ShortcutOverlayActions) {
  const router = useRouter();

  useEffect(() => {
    let pendingG = 0;

    function run(id: string): void {
      const store = useChatStore.getState();
      switch (id) {
        case "new_chat":
          store.setConversation(null);
          store.clearOptimistic();
          router.push("/");
          break;
        case "focus_input":
          focusChatEvent(router.push, window.location.pathname, "tollma:focus-input");
          break;
        case "regenerate":
          focusChatEvent(router.push, window.location.pathname, "tollma:regenerate");
          break;
        case "stop_response":
          emit("tollma:stop");
          break;
        case "go_chat":
          router.push(store.activeConversationId ? `/c/${store.activeConversationId}` : "/");
          break;
        case "go_analytics":
          router.push("/analytics");
          break;
        case "go_settings":
          router.push("/settings");
          break;
        case "toggle_conversations":
          store.setLeftSidebar(!store.leftSidebarOpen);
          break;
        case "toggle_intelligence":
          store.setRightSidebar(!store.rightSidebarOpen);
          break;
        case "open_model_selector":
          focusChatEvent(router.push, window.location.pathname, "tollma:open-model-selector");
          break;
        case "switch_model":
          emit("tollma:switch-model");
          break;
        case "change_thinking":
          emit("tollma:cycle-thinking");
          break;
        case "search_conversations":
          store.setLeftSidebar(true);
          focusChatEvent(router.push, window.location.pathname, "tollma:focus-conversation-search");
          break;
        case "command_palette":
          openCommandPalette();
          break;
        case "shortcuts":
          openShortcuts();
          break;
      }
    }

    function onKey(e: KeyboardEvent): void {
      if (e.defaultPrevented) return;
      // Overlays work everywhere, including inside inputs.
      if (comboMatches(e, "Ctrl+K")) {
        e.preventDefault();
        run("command_palette");
        return;
      }
      if (comboMatches(e, "Ctrl+/")) {
        e.preventDefault();
        run("shortcuts");
        return;
      }
      const editable = isEditableTarget(e.target);
      // Plain "/" focuses the composer from anywhere non-editable.
      if (!editable && !e.ctrlKey && !e.metaKey && !e.altKey && comboMatches(e, "/")) {
        e.preventDefault();
        run("focus_input");
        return;
      }
      if (editable) {
        // Don't steal typing keys; composer handles Enter itself.
        pendingG = 0;
        return;
      }
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      if (plain && e.key.toLowerCase() === "g") {
        pendingG = Date.now();
        return;
      }
      if (pendingG && Date.now() - pendingG <= SEQUENCE_WINDOW_MS) {
        const key = e.key.toLowerCase();
        if (plain && (key === "c" || key === "a" || key === "s")) {
          e.preventDefault();
          pendingG = 0;
          run(key === "c" ? "go_chat" : key === "a" ? "go_analytics" : "go_settings");
          return;
        }
      }
      pendingG = 0;
      const combos: Array<[string, string]> = [
        ["Ctrl+Shift+O", "new_chat"],
        ["Alt+R", "regenerate"],
        ["Alt+X", "stop_response"],
        ["Ctrl+B", "toggle_conversations"],
        ["Ctrl+I", "toggle_intelligence"],
        ["Ctrl+M", "open_model_selector"],
        ["Alt+M", "switch_model"],
        ["Alt+T", "change_thinking"],
        ["Ctrl+Shift+F", "search_conversations"],
      ];
      for (const [combo, id] of combos) {
        if (comboMatches(e, combo)) {
          e.preventDefault();
          run(id);
          return;
        }
      }
    }

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openShortcuts, openCommandPalette, router]);
}

/** Definitions for the overlay; exported for unit tests. */
export type { ShortcutDef };
