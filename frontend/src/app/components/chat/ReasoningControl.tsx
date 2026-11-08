"use client";

import { Brain } from "lucide-react";
import { Switch } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ReasoningControl as ReasoningControlConfig } from "./capabilities";
import { REASONING_OFF_LEVEL } from "./reasoningLevels";
import { ReasoningSelector } from "./ReasoningSelector";

const INDICATOR_CLASS = cn(
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2 text-xs text-zinc-500 transition-colors",
  "hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/50",
);

/** Dynamic reasoning control from the model's reasoning_options. Renders
 *  nothing when the control is null (unknown model or model without
 *  reasoning) — callers gate on caps.reasoningControl, so a missing backend
 *  field hides the UI instead of crashing it. Effort reuses the scale with
 *  none first; budget pairs a number input with an explicit None switch;
 *  toggle is an on/off switch where off persists as "none". Values flow as
 *  strings (the gateway takes reasoning_level as str); "none" is the
 *  explicit off value for every kind, resolved before send so display and
 *  payload always agree. */
export function ReasoningControl({
  control,
  value,
  onChange,
}: {
  control: NonNullable<ReasoningControlConfig>;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  if (control.kind === "effort") {
    return (
      <ReasoningSelector
        levels={control.levels}
        value={value}
        onChange={onChange}
      />
    );
  }
  if (control.kind === "budget") {
    const off = value === REASONING_OFF_LEVEL;
    return (
      <div
        className={INDICATOR_CLASS}
        data-testid="reasoning-budget"
        role="group"
        aria-label="Thinking budget"
        title={`Thinking budget in tokens (min ${control.min.toLocaleString()}); None disables thinking`}
      >
        <Brain className="size-3.5" />
        <button
          type="button"
          onClick={() => onChange(REASONING_OFF_LEVEL)}
          aria-pressed={off}
          aria-label="Thinking off"
          data-testid="reasoning-budget-none"
          className={cn(
            "rounded px-1 py-0.5 text-[10px] font-medium capitalize transition-colors",
            off
              ? "bg-tollma-600 text-white dark:bg-tollma-500"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
          )}
        >
          None
        </button>
        <input
          type="number"
          min={control.min}
          {...(control.max !== null ? { max: control.max } : {})}
          value={off || value == null ? "" : value}
          placeholder={control.defaultValue ?? String(control.min)}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          aria-label="Thinking budget in tokens"
          data-testid="reasoning-budget-input"
          className="w-16 bg-transparent text-xs font-medium text-zinc-700 outline-none placeholder:text-zinc-400 dark:text-zinc-200"
        />
      </div>
    );
  }
  return (
    <div
      className={INDICATOR_CLASS}
      data-testid="reasoning-toggle"
      role="group"
      aria-label="Thinking toggle"
      title="Thinking on or off"
    >
      <Brain className="size-3.5" />
      <span className="font-medium">Thinking</span>
      <Switch
        checked={value === control.onValue}
        onCheckedChange={(on) => onChange(on ? control.onValue : REASONING_OFF_LEVEL)}
        aria-label="Thinking"
        data-testid="reasoning-toggle-switch"
      />
    </div>
  );
}
