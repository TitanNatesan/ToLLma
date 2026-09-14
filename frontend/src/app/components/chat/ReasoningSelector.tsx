"use client";

import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";

/** Step selector generated from the model's reasoning_levels — never hardcoded. */
export function ReasoningSelector({
  levels,
  value,
  onChange,
}: {
  levels: string[];
  value: string | null;
  onChange: (level: string) => void;
}) {
  if (levels.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5" data-testid="reasoning-selector" role="group" aria-label="Reasoning level">
      <span className="hidden items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400 lg:inline-flex">
        <Brain className="size-3" />
        Reasoning
      </span>
      <div className="flex items-center rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
        {levels.map((level) => {
          const selected = value === level;
          return (
            <button
              key={level}
              type="button"
              onClick={() => onChange(level)}
              aria-pressed={selected}
              data-testid={`reasoning-level-${level}`}
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] capitalize transition-colors",
                selected
                  ? "bg-tollma-600 font-medium text-white shadow-sm dark:bg-tollma-500"
                  : "text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
              )}
            >
              {level}
            </button>
          );
        })}
      </div>
    </div>
  );
}
