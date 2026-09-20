"use client";

import { CornerDownLeft, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Select, SettingItem, Switch } from "@/components/ui";
import { useUpdatePreferences } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";
import type { EnterBehavior } from "@/types";

const ENTER_OPTIONS: Array<{ value: EnterBehavior; title: string; keys: string; description: string }> = [
  {
    value: "send",
    title: "Enter sends",
    keys: "Enter",
    description: "Shift+Enter adds a new line.",
  },
  {
    value: "newline",
    title: "Ctrl+Enter sends",
    keys: "Ctrl+Enter",
    description: "Enter adds a new line.",
  },
];

/** Chat behavior preferences; every change persists to the user's account. */
export function ChatPreferencesSection() {
  const enterBehavior = useSettingsStore((s) => s.enterBehavior);
  const defaultThinkingLevel = useSettingsStore((s) => s.defaultThinkingLevel);
  const autoScroll = useSettingsStore((s) => s.autoScroll);
  const streamAnimations = useSettingsStore((s) => s.streamAnimations);
  const update = useUpdatePreferences();

  function save(patch: Parameters<typeof update.mutate>[0]) {
    update.mutate(patch, { onError: (e) => toast.error("Could not save preference", { description: e.message }) });
  }

  return (
    <>
      <SettingItem label="Enter behavior" description="How the composer handles the Enter key.">
        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 p-1 dark:border-zinc-800" data-testid="settings-enter-behavior">
          {ENTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => save({ enter_behavior: option.value })}
              aria-pressed={enterBehavior === option.value}
              title={option.description}
              data-testid={`enter-${option.value}`}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                enterBehavior === option.value
                  ? "bg-tollma-600 text-white dark:bg-tollma-500"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
            >
              <CornerDownLeft className="size-3" />
              <span>{option.keys}</span>
            </button>
          ))}
        </div>
      </SettingItem>

      <SettingItem
        label="Default thinking level"
        description="Applied when a model supports it; models never get an unsupported level."
      >
        <Select
          value={defaultThinkingLevel ?? ""}
          onChange={(e) => save({ default_thinking_level: e.target.value || null })}
          sizeVariant="sm"
          aria-label="Default thinking level"
          data-testid="settings-thinking-level"
          className="w-40 text-xs"
        >
          <option value="">Model default</option>
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </Select>
      </SettingItem>

      <SettingItem label="Auto-scroll" description="Follow new messages while a response streams.">
        <Switch
          checked={autoScroll}
          onCheckedChange={(checked) => save({ auto_scroll: checked })}
          aria-label="Auto-scroll"
          data-testid="settings-auto-scroll"
        />
      </SettingItem>

      <SettingItem label="Stream animations" description="Blinking cursor and pulsing indicators while generating.">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-zinc-300 dark:text-zinc-600" />
          <Switch
            checked={streamAnimations}
            onCheckedChange={(checked) => save({ stream_animations: checked })}
            aria-label="Stream animations"
            data-testid="settings-stream-animations"
          />
        </div>
      </SettingItem>
    </>
  );
}
