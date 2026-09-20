/** Global keyboard shortcut registry — single source of truth for the
 *  Ctrl+/ overlay and the window-level handler. Combos use "Ctrl+K" grammar;
 *  "G C" style entries are two-key sequences handled by useGlobalShortcuts. */

export type ShortcutGroup = "Chat" | "Navigation" | "Models" | "Search" | "General";

export interface ShortcutDef {
  id: string;
  group: ShortcutGroup;
  keys: string[];
  label: string;
  description: string;
}

export const SHORTCUT_GROUP_ORDER: ShortcutGroup[] = [
  "Chat",
  "Navigation",
  "Models",
  "Search",
  "General",
];

export const SHORTCUTS: ShortcutDef[] = [
  // Chat
  { id: "new_chat", group: "Chat", keys: ["Ctrl+Shift+O"], label: "New chat", description: "Start a fresh conversation" },
  { id: "focus_input", group: "Chat", keys: ["/"], label: "Focus input", description: "Jump to the message box" },
  { id: "send_message", group: "Chat", keys: ["Enter"], label: "Send message", description: "Sends per your Enter behavior preference" },
  { id: "new_line", group: "Chat", keys: ["Shift+Enter"], label: "New line", description: "Insert a line break" },
  { id: "regenerate", group: "Chat", keys: ["Alt+R"], label: "Regenerate", description: "Regenerate the last response" },
  { id: "stop_response", group: "Chat", keys: ["Alt+X"], label: "Stop response", description: "Cancel the active generation" },
  // Navigation
  { id: "go_chat", group: "Navigation", keys: ["G", "C"], label: "Go to chat", description: "Open the conversation workspace" },
  { id: "go_analytics", group: "Navigation", keys: ["G", "A"], label: "Go to analytics", description: "Open usage and cost intelligence" },
  { id: "go_settings", group: "Navigation", keys: ["G", "S"], label: "Go to settings", description: "Open workspace settings" },
  { id: "toggle_conversations", group: "Navigation", keys: ["Ctrl+B"], label: "Toggle conversations panel", description: "Show or hide the left sidebar" },
  { id: "toggle_intelligence", group: "Navigation", keys: ["Ctrl+I"], label: "Toggle intelligence panel", description: "Show or hide the right sidebar" },
  // Models
  { id: "open_model_selector", group: "Models", keys: ["Ctrl+M"], label: "Open model selector", description: "Browse providers and models" },
  { id: "switch_model", group: "Models", keys: ["Alt+M"], label: "Switch models", description: "Cycle to the next registered model" },
  { id: "change_thinking", group: "Models", keys: ["Alt+T"], label: "Change thinking level", description: "Cycle the reasoning level" },
  // Search
  { id: "search_conversations", group: "Search", keys: ["Ctrl+Shift+F"], label: "Search conversations", description: "Focus conversation search" },
  // General
  { id: "command_palette", group: "General", keys: ["Ctrl+K"], label: "Open command palette", description: "Run any workspace command" },
  { id: "shortcuts", group: "General", keys: ["Ctrl+/"], label: "Open shortcuts", description: "Show this shortcut reference" },
];

/** Human-readable key chips for the overlay (⌘ on macOS). */
export function displayKeys(keys: string[]): string[] {
  return keys.map((key) => key.replace("Ctrl", "Ctrl/⌘"));
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/** Does a keyboard event exactly match a combo like "Ctrl+Shift+O", "/", "Enter"? */
export function comboMatches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+");
  const key = parts.pop() ?? "";
  const wantCtrl = parts.includes("Ctrl");
  const wantShift = parts.includes("Shift");
  const wantAlt = parts.includes("Alt");
  const hasMod = event.ctrlKey || event.metaKey;
  if (wantCtrl !== hasMod) return false;
  if (wantAlt !== event.altKey) return false;
  // Slash often needs Shift on non-US layouts; match the physical key instead.
  if (key === "/") return event.key === "/" || event.code === "Slash";
  if (wantShift !== event.shiftKey) return false;
  if (key === "Enter") return event.key === "Enter";
  return event.key.toLowerCase() === key.toLowerCase();
}
