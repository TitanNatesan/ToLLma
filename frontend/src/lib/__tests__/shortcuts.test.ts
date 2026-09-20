import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  SHORTCUT_GROUP_ORDER,
  comboMatches,
  displayKeys,
  isEditableTarget,
} from "../shortcuts";

function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    code: "",
    ...init,
  } as KeyboardEvent;
}

describe("comboMatches", () => {
  it("matches ctrl and cmd for Ctrl combos", () => {
    expect(comboMatches(keyEvent({ key: "k", ctrlKey: true }), "Ctrl+K")).toBe(true);
    expect(comboMatches(keyEvent({ key: "k", metaKey: true }), "Ctrl+K")).toBe(true);
    expect(comboMatches(keyEvent({ key: "k" }), "Ctrl+K")).toBe(false);
  });

  it("requires exact modifier state", () => {
    expect(comboMatches(keyEvent({ key: "O", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+O")).toBe(true);
    expect(comboMatches(keyEvent({ key: "O", ctrlKey: true }), "Ctrl+Shift+O")).toBe(false);
    expect(comboMatches(keyEvent({ key: "r", altKey: true }), "Alt+R")).toBe(true);
  });

  it("matches slash by key or physical code", () => {
    expect(comboMatches(keyEvent({ key: "/", ctrlKey: true }), "Ctrl+/")).toBe(true);
    expect(comboMatches(keyEvent({ key: "7", code: "Slash", ctrlKey: true, shiftKey: true }), "Ctrl+/")).toBe(true);
  });

  it("matches Enter without modifiers", () => {
    expect(comboMatches(keyEvent({ key: "Enter" }), "Enter")).toBe(true);
    expect(comboMatches(keyEvent({ key: "Enter", shiftKey: true }), "Enter")).toBe(false);
  });
});

describe("shortcut registry", () => {
  it("has unique ids and known groups", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shortcut of SHORTCUTS) {
      expect(SHORTCUT_GROUP_ORDER).toContain(shortcut.group);
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.label).toBeTruthy();
    }
  });

  it("covers every product surface", () => {
    const ids = new Set(SHORTCUTS.map((s) => s.id));
    for (const required of [
      "new_chat",
      "focus_input",
      "send_message",
      "new_line",
      "regenerate",
      "stop_response",
      "go_chat",
      "go_analytics",
      "go_settings",
      "toggle_conversations",
      "toggle_intelligence",
      "open_model_selector",
      "switch_model",
      "change_thinking",
      "search_conversations",
      "command_palette",
      "shortcuts",
    ]) {
      expect(ids.has(required), required).toBe(true);
    }
  });

  it("renders key chips with the platform hint", () => {
    expect(displayKeys(["Ctrl+K"])).toEqual(["Ctrl/⌘+K"]);
    expect(displayKeys(["G", "C"])).toEqual(["G", "C"]);
  });
});

describe("isEditableTarget", () => {
  it("recognizes text fields and contenteditable", () => {
    expect(isEditableTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
