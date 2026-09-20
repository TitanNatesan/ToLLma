"use client";

import { Command } from "cmdk";
import { Keyboard } from "lucide-react";
import { Dialog, DialogContent } from "./primitives";
import { SHORTCUTS, SHORTCUT_GROUP_ORDER, displayKeys } from "@/lib/shortcuts";

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

/** Ctrl+/ reference: searchable, grouped, available from every page. */
export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="p-0 overflow-hidden shadow-2xl" data-testid="shortcuts-overlay">
        <Command className="rounded-xl bg-white dark:bg-zinc-950" label="Keyboard shortcuts">
          <div className="flex items-center border-b border-zinc-200 px-3 dark:border-zinc-800">
            <Keyboard className="mr-2 size-4 text-zinc-400" />
            <Command.Input
              placeholder="Search shortcuts…"
              className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-zinc-400"
              data-testid="shortcuts-input"
            />
            <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 dark:bg-zinc-800">
              Esc
            </kbd>
          </div>

          <Command.List className="max-h-[420px] overflow-y-auto py-1">
            <Command.Empty className="py-6 text-center text-sm text-zinc-400">
              No shortcuts found.
            </Command.Empty>
            {SHORTCUT_GROUP_ORDER.map((group) => {
              const items = SHORTCUTS.filter((s) => s.group === group);
              if (items.length === 0) return null;
              return (
                <Command.Group
                  key={group}
                  heading={group}
                  className="mt-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 first:mt-0"
                >
                  {items.map((shortcut) => (
                    <Command.Item
                      key={shortcut.id}
                      value={`${shortcut.label} ${shortcut.description} ${shortcut.keys.join(" ")} ${group}`}
                      className="flex cursor-default items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-zinc-700 data-[selected=true]:bg-tollma-50 dark:text-zinc-300 dark:data-[selected=true]:bg-tollma-950"
                      data-testid={`shortcut-${shortcut.id}`}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">{shortcut.label}</span>
                        <span className="truncate text-[11px] text-zinc-400">{shortcut.description}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {displayKeys(shortcut.keys).map((key) => (
                          <kbd
                            key={key}
                            className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                          >
                            {key}
                          </kbd>
                        ))}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>

          <div className="flex items-center justify-between border-t border-zinc-200 px-3 py-2 text-[10px] text-zinc-400 dark:border-zinc-800">
            <span>Available on every page</span>
            <span className="font-mono">
              <kbd className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">Ctrl/⌘</kbd>
              <span className="ml-1">+</span>
              <kbd className="ml-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">/</kbd>
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
